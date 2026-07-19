# Credit Report Parser — Deep Dive (Golden Ticket v5)

**Audience:** Engineers porting or upgrading this parser into another codebase.  
**Source of truth:** `src/services/creditReportParser/` in this repo (July 2026).  
**Related entry points:** `src/workers/creditReportParserWorker.ts`, `src/pages/UploadReport.tsx`

> **Important:** The root file `parser.md` documents an older **10-module AI pipeline** (`heuristicParser`, `aiEnhancer`, `postValidator`, etc.). That architecture is **not** what this app runs today. Use **this** document for the live v5 system.

---

## Table of contents

1. [What the parser does](#1-what-the-parser-does)
2. [File map (what to copy)](#2-file-map-what-to-copy)
3. [Live vs legacy code](#3-live-vs-legacy-code)
4. [End-to-end pipeline](#4-end-to-end-pipeline)
5. [PDF text extraction (critical)](#5-pdf-text-extraction-critical)
6. [Normalization & TransUnion repair](#6-normalization--transunion-repair)
7. [Golden detection engine (`creditParser.ts`)](#7-golden-detection-engine-creditparserts)
8. [Bureau-specific parsers](#8-bureau-specific-parsers)
9. [Generic fallback block parser](#9-generic-fallback-block-parser)
10. [Dedup, confidence, categories](#10-dedup-confidence-categories)
11. [Mapping to app `NegativeItem`](#11-mapping-to-app-negativeitem)
12. [Web Worker integration](#12-web-worker-integration)
13. [Public API contracts](#13-public-api-contracts)
14. [Porting / upgrade checklist](#14-porting--upgrade-checklist)
15. [Known edge cases & failure modes](#15-known-edge-cases--failure-modes)
16. [Dependencies](#16-dependencies)

---

## 1. What the parser does

The parser is the first transformation in the credit-repair workflow:

**Raw credit report (PDF / pasted text / Electron file) → structured negative tradelines**

Design principles in the **live** v5 path:

1. **Negative-only.** Positive / good-standing accounts are not the goal. Specialized bureau parsers require an explicit negative signal (charge-off, collection, past due, etc.).
2. **Bureau-first specialization.** Prefer format-specific extractors (TU ACR, TU portal, Equifax collections/accounts, Experian “POTENTIALLY NEGATIVE”) before a generic block scan.
3. **Heuristic-only in production orchestrator.** `index.ts` always reports `parseMethod: 'heuristic_only'`. There is **no AI enhancer** in the live orchestrator (legacy AI fields in `debugInfo` are zeroed).
4. **Defense against PDF garbage.** PDF extraction preserves line structure (Y-coordinate grouping). TransUnion multi-column linearization is repaired before detection.

---

## 2. File map (what to copy)

```
src/services/creditReportParser/
├── index.ts                              # Orchestrator — public parseCreditReport()
├── creditParser.ts                       # Golden detection engine (~910 lines)
├── extractor.ts                          # PDF extract + normalize + helpers (~1313 lines)
└── bureauNormalizers/
    └── transunionNormalizer.ts           # TU column / label repair (~48 lines)

src/workers/creditReportParserWorker.ts   # Off-main-thread runner (optional but recommended)
```

| File | Role in live path | Approx size |
|------|-------------------|-------------|
| `index.ts` | Acquire → normalize → TU preprocess → `parseNegativeItems` → map to app types | ~261 lines |
| `creditParser.ts` | All negative-item detection | ~910 lines |
| `extractor.ts` | `extractTextFromPDF`, `normalizeText`, `extractConsumerInfo`, `detectBureaus` (+ large unused heuristic stack) | ~1313 lines |
| `transunionNormalizer.ts` | Column un-interleave + label standardization | ~48 lines |

**Standalone reference copy:** `Testparsercreated/src/utils/creditParser.ts` is essentially the same golden engine as `creditParser.ts` (useful as a minimal drop-in without the orchestrator).

---

## 3. Live vs legacy code

### Live (called by `index.ts`)

From `extractor.ts`:

- `extractTextFromPDF`
- `normalizeText`
- `extractConsumerInfo`
- `detectBureaus`

From `creditParser.ts`:

- `parseNegativeItems`

From `index.ts` itself:

- `preprocessTransUnionText`
- `normalizeTransUnionText` (imported)
- `mapParsedToNegativeItem`

### Present but **not** called by the live orchestrator

`extractor.ts` still contains a full older heuristic stack used by earlier versions / possible future merge:

- `KNOWN_CREDITORS`, `HARD_BLOCK_PATTERNS`, `NEGATIVE_KEYWORDS`, `POSITIVE_ONLY_KEYWORDS`
- `hasNegativeSignal`, `hasPositiveOnlySignal`, `isValidCreditorName`
- `normalizeStatus`, `classifyNegativeType`, `parseDate`, `calcAutoRemovalDate`
- `heuristicExtract` + `extractFromBlock` + `extractFromBlockLenient` + `lineBasedScan`

If you are upgrading another app and want **parity with this repo’s UI behavior**, port the **live path only**. If you want richer false-positive filtering / FCRA auto-removal / creditor validation, consider also porting the helper exports from `extractor.ts` and wiring them after `parseNegativeItems` (this repo currently does **not** run that post-gate).

---

## 4. End-to-end pipeline

```
INPUT
  source: 'pdf_buffer' | 'paste' | 'file_path'
       │
       ▼
┌──────────────────────────────┐
│ STEP 1 — Acquire text (5%)   │
│  pdf  → extractTextFromPDF   │
│  paste → raw string          │
│  file_path → electronAPI     │
│  Reject if < 50 chars        │
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│ STEP 2 — normalizeText (20%) │
│  NFKC, ligatures, hyphen-NL  │
│  preserve tabs from PDF      │
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│ STEP 3 — Identity (35%)      │
│  extractConsumerInfo()       │
│  detectBureaus()             │
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│ STEP 3b — TU normalize       │
│  if TU detected OR multi-bureau │
│  preprocessTransUnionText()  │
│  normalizeTransUnionText()   │
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│ STEP 4 — Golden detect (55%) │
│  parseNegativeItems([{text}])│
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│ STEP 5 — Map (85%→100%)      │
│  mapParsedToNegativeItem()   │
│  needsReviewCount if conf<55 │
└──────────────────────────────┘
```

**Multi-bureau note:** AnnualCreditReport.com often packs Equifax + Experian + TransUnion in one PDF. TU preprocessing must run whenever TU is present **or** `detectedBureaus.length >= 2`, not only when TransUnion is listed first. Older bugs skipped TU repair on Equifax-first 3-bureau reports.

---

## 5. PDF text extraction (critical)

**Function:** `extractTextFromPDF(buffer: ArrayBuffer)` in `extractor.ts`  
**Library:** `pdfjs-dist` with worker loaded from `pdfjs-dist/build/pdf.worker.mjs?raw` as a Blob URL.

### Why Y-coordinate grouping matters

Older code joined all page text items with spaces. That destroyed newlines and made account-block splitting impossible.

Current approach:

1. For each page, read `getTextContent()` items.
2. Bucket items by rounded Y (`Math.round(y / 4) * 4`).
3. Sort Y descending (PDF Y grows upward → top of page first).
4. Within a line, sort by X ascending.
5. Spacing rules:
   - Gap `> 40` PDF units → insert **TAB** (column boundary)
   - Gap `> -1` → space
   - Negative gap → concatenate (ligature / overlap)
6. Strip repeated header/footer lines (same trim line on ≥60% of pages, checking first/last 4 lines per page).
7. Join pages with `\n\n` only — **do not** insert `---PAGE---` markers (those split accounts that span pages).

### Porting gotchas

- You must keep **tabs**; `normalizeText` intentionally preserves `\t`.
- Worker blob + `GlobalWorkerOptions.workerSrc` is required in Vite/browser builds.
- Electron `file_path` path uses `window.electronAPI.readFile` — web-only ports should use `pdf_buffer` or `paste`.

---

## 6. Normalization & TransUnion repair

### `normalizeText` (extractor)

- Unicode NFKC
- Ligature fixes (`ﬁ` → `fi`, etc.)
- Smart quotes / en-dashes → ASCII
- Soft hyphen strip
- Join hyphenated line breaks: `word-\nword` → `wordword`
- Collapse runs of spaces (keep newlines + tabs)
- Collapse 3+ blank lines to 2

### `preprocessTransUnionText` (index)

TU PDFs often smash footers into the next account header. Fixes:

1. Split after `Total Months: N` when followed by `CREDITOR 123****`
2. Split after `Rating …` when followed by next account header
3. Strip leading `|` “vertical pipe” artifacts
4. Force `****` onto fully numeric account headers before `Account Information` so the golden regex recognizes them

### `normalizeTransUnionText` (bureauNormalizers)

1. Split lines with 3+ space gaps **and** dollar amounts into separate lines (column un-interleave)
2. Standardize date / status labels (`DATE OF 1ST DELINQUENCY` → `Date of First Delinquency:`, etc.)
3. Normalize `ACCOUNT INFORMATION` casing

**Do not** rewrite the words `ADVERSE` / `DEROGATORY` to `NEGATIVE` — detection relies on the literal TU section title `Accounts with Adverse Information`.

---

## 7. Golden detection engine (`creditParser.ts`)

### Types (parser-local — not the app type)

```ts
export type Bureau = "Experian" | "Equifax" | "TransUnion" | "Unknown";

export interface NegativeItem {
  id: string;
  sourceName: string;
  bureau: Bureau;
  category: string;       // Collection | Charge-off | Late / Past Due | ...
  creditor: string;
  accountNumber: string;  // or "Not listed"
  status: string;
  balance: string;        // "$1,234.00" or "Not listed"
  dateOpened: string;
  lastReported: string;
  confidence: number;     // 0–100 integer
  rawSnippet: string;     // ≤320 chars evidence
}
```

### Entry point priority order

`parseNegativeItems(inputs)` processes each input **sequentially** and uses **first successful specialized parser**, then `continue`s (skips generic for that input):

| Order | Function | When it wins |
|------:|----------|--------------|
| 1 | `parseTransUnionAnnualCreditReport` | TU ACR shape: adverse section + Pay Status / Date Opened / Date Updated |
| 2 | `parseTransUnionPortalSnapshot` | Text contains `credit report https://members.transunion.com` |
| 3 | `parseTransUnionNegativeAccounts` | Contains `accounts with adverse information` + header/`Account Information` blocks |
| 4 | `parseEquifaxNegativeAccounts` | Contains `equifax` + `credit accounts` (also merges dedicated Collections section) |
| 5 | Generic `splitPotentialBlocks` + `isLikelyNegativeBlock` | Everything else (Experian ACR, odd layouts, mixed pastes) |

**Implication for multi-bureau ACR PDFs:** If the combined document triggers a TU specialized parser first and returns ≥1 item, **Equifax/Experian sections in the same string may be skipped** for that input. In practice the orchestrator passes the **entire** report as one `ParseInput`. When upgrading, consider splitting by bureau sections before calling `parseNegativeItems` if you need full 3-bureau coverage from a single ACR file.

---

## 8. Bureau-specific parsers

### 8.1 TransUnion — Annual Credit Report

**Anchor:** `Accounts with Adverse Information` (or “adverse information typically remains”).  
**Stop markers:** satisfactory accounts, inquiries, additional information, summary of rights.

**Block discovery:**

1. Prefer lines that are exactly `Account Information`, then look **backward** for a header containing a masked account number pattern:  
   `[\w-]*\d{3,}[*X]{2,}[\w*X-]*`
2. Header may be two lines: creditor name on previous line, number alone on last line.
3. Fallback: inline regex `CREDITOR 123**** Account Information …`

**Fields:**

| Field | Patterns |
|-------|----------|
| Creditor | Header minus trailing account mask |
| Account # | From header mask |
| Status | `Pay Status >…<` or `Pay Status …` |
| Dates | `Date Opened`, `Date Updated` / `Reported` |
| Balance | `extractTransUnionBalance` (Past Due → Balance → High Balance → largest `$` in block) |

**Gate:** Must match charge-off / collection / past due / delinquent / repo / foreclosure / bankruptcy / default in status+body.

### 8.2 TransUnion — Member portal snapshot

Huge regex over:

`Last Payment Status` → `Opened` → `Reported` → `Remarks` → `Creditor Information` → `Account Number`

Only keeps status matching charge-off or collection. Confidence **95**.

### 8.3 TransUnion — Adverse section (alternate)

Similar to ACR but uses a slightly different header/`Account Information` regex and stricter negative gate (`charge off`, `collection`, `sold; was in collection`, `placed for collection`). Confidence **94**.

### 8.4 Equifax — Credit Accounts + Collections

**Credit Accounts path:**

- Find `Credit Accounts` … up to `\nCollections`
- Find every `Account Number:` line; take ~8 lines above for creditor
- Creditor via `findEquifaxCreditor` (skip prepared-for / PO BOX / lines with digits)
- Status from `Loan/Account Type | Status:` pipe layout
- Narrative codes: **057** = collection, **067** = charge-off
- Skip `Pays as Agreed` unless code or past-due amount present (legend text false positives)

**Collections path (`parseEquifaxCollections`):**

- Section starting at `\nCollections\n`
- Each `Account Number:` block → category always `Collection`, confidence **99**
- Original creditor appended into snippet when present

### 8.5 Experian (generic path)

No dedicated Experian function. Relies on:

- `splitExperianSections`: marker  
  `CREDITOR_NAME\nPOTENTIALLY NEGATIVE`
- Stop at public records / inquiries / satisfactory / summary of rights
- Then generic field extractors + `deriveCategory`

Experian web/ACR pastes often put the creditor name on the line **immediately above** `POTENTIALLY NEGATIVE`.

---

## 9. Generic fallback block parser

Used when no specialized parser returns items.

### Block splitting (`splitPotentialBlocks`)

1. Experian sections if any  
2. Else TU adverse sections  
3. Else Equifax `NAME - Closed` sections  
4. Else blank-line paragraphs (≥25 chars)  
5. Else split before `Account Number|Status|Creditor|Collection|Public Records`

### Acceptance (`isLikelyNegativeBlock`)

Must have:

- A **negative keyword** (`collection`, `charge off`, `past due`, `late`, `delinquent`, `repossession`, `bankruptcy`, `lien`, `judgment`, `60/90/120 days`, …), **and**
- **Account context** (account number/status/date opened/pay status/amount past due **or** public records / collections / adverse section language)

Rejects blocks containing ignore hints (dispute online, summary of rights, soft/hard inquiries-only, etc.).

### Creditor noise filter

Rejects names matching FTC / rights boilerplate, URLs, or >12 words / >100 chars.

---

## 10. Dedup, confidence, categories

### Dedup key

```
`${bureau}|${creditor}|${accountNumber}|${dateOpened}`
```

On collision, keep higher `confidence`, else richer status/balance (prefer non-`"Not listed"`). Final sort: confidence descending.

### Confidence (`calculateConfidence`) — generic path only

| Signal | Score |
|--------|------:|
| Negative keyword | +35 |
| `status:` | +20 |
| Account number | +20 |
| Creditor / account name label | +15 |
| Last reported / date of status | +10 |
| “potentially negative” | +10 |
| “account info” | +5 |
| Narrative 057/067 or pay status | +15 |
| Hard/soft inquiries / public records language | −20 |

Clamped 0–100. Specialized parsers hardcode high values (88–99).

### Categories (`CATEGORY_RULES` / bureau helpers)

Normalized strings include: `Collection`, `Charge-off`, `Repossession`, `Bankruptcy`, `Judgment`, `Lien`, `Foreclosure`, `Settlement`, `Late / Past Due`, `Default`, fallback `Negative Account`.

---

## 11. Mapping to app `NegativeItem`

Orchestrator `mapParsedToNegativeItem` converts parser-local items → `src/types.ts` `NegativeItem`:

| Parser field | App field | Notes |
|--------------|-----------|-------|
| `creditor` | `creditorName`, `furnisher` | |
| `accountNumber` | `accountNumber` | `"Not listed"` → `""` |
| `balance` | `balance`, `originalBalance` | Parsed float; invalid → `null` |
| `category` | `typeOfNegative` | |
| `status` | `status` | If status was `"Not listed"`, uses category |
| `dateOpened` | `dateOpened`, `originalOpeningDate`, `originalDateOfDelinquency`, `dateOfFirstDelinquency` | DOFD is **approximated** from opened date — not true Metro 2 DOFD |
| `lastReported` | `dateOfLastReporting`, `dateLastActive` | |
| `bureau` | `creditBureau: [bureau]` | `"Unknown"` → `Experian` |
| `confidence` | `parseConfidence` | Divided by 100 (0–1). Review flag if `< 0.55` |
| `rawSnippet` | `additionalInfo` | |
| — | `id` | New UUID (`uuid` package) |
| — | dispute defaults | round 1, Undisputed, `dataSource: 'parser'`, etc. |

**Not populated by mapper today:** `autoRemovalDate`, `solDropDate`, `crossBureauGroupId`, `originalCreditor` (except Equifax collections snippet text), Metro 2 codes, contact address/phone.

`extractor.calcAutoRemovalDate` (DOFD + 7 years) exists but is **not** wired in `index.ts`.

---

## 12. Web Worker integration

`UploadReport.tsx` spawns `creditReportParserWorker.ts?worker` (Vite).

**Main → Worker**

```ts
{ type: 'PARSE', options: WorkerParseOptions }  // ParseOptions without onProgress
```

Transfer `pdfBuffer` via `postMessage(..., [arrayBuffer])` for zero-copy.

**Worker → Main**

```ts
{ type: 'PROGRESS', pct, msg }
{ type: 'RESULT', result: ParseResult }
{ type: 'ERROR', error: string }
```

Terminate the worker on unmount / re-parse to avoid leaks.

---

## 13. Public API contracts

### `parseCreditReport(options)` — orchestrator

```ts
interface ParseOptions {
  source: 'pdf_buffer' | 'paste' | 'file_path';
  pdfBuffer?: ArrayBuffer;
  pasteText?: string;
  filePath?: string;
  onProgress?: (pct: number, msg: string) => void;
}

interface ParseResult {
  success: boolean;
  items: NegativeItem[];          // app type
  consumerName: string;
  totalFound: number;
  needsReviewCount: number;
  warnings: string[];
  parseMethod: 'ai_full' | 'ai_partial_heuristic' | 'heuristic_only'; // always heuristic_only today
  rawTextPreview: string;         // first 2000 chars of normalized text
  processingTimeMs: number;
  debugInfo: {
    heuristicFound: number;
    aiFound: number;              // always 0
    finalCount: number;
    detectedBureaus: string[];
  };
}

type ParseCreditReportResult = ParseResult; // alias
```

### Direct engine (no PDF / no mapping)

```ts
parseNegativeItems([{ sourceName: 'report', text }]): ParserNegativeItem[]
parseCreditReportText(text, sourceName?): ParserNegativeItem[]
```

---

## 14. Porting / upgrade checklist

Use this when upgrading a **different** build of the app.

### Minimum files to bring over

1. `creditParser.ts` (or `Testparsercreated/.../creditParser.ts`)
2. PDF/Y-coord extract + `normalizeText` + `detectBureaus` + `extractConsumerInfo` from `extractor.ts`
3. `preprocessTransUnionText` + `normalizeTransUnionText`
4. Mapping layer adapted to **your** `NegativeItem` shape
5. `pdfjs-dist` worker wiring for your bundler

### Verify against real samples

| Sample type | Expect |
|-------------|--------|
| Experian ACR paste with `POTENTIALLY NEGATIVE` | Creditor = line above marker; category from status |
| Equifax ACR with narrative `057` / `067` | Collections + charge-offs kept; pays-as-agreed without past due dropped |
| TransUnion ACR adverse section | Header `NAME 1234****` + Account Information blocks |
| TU member portal HTML/text dump | Portal regex path |
| 3-bureau AnnualCreditReport PDF | TU preprocess runs; watch for early `continue` skipping later bureaus |

### Behavioral differences vs old `parser.md` AI pipeline

| Old (documented in root `parser.md`) | Current v5 |
|--------------------------------------|------------|
| 10 modules + AI enhancer | 4 files, heuristic golden engine |
| `rejectedLines[]` / rich debug log | Console + `warnings[]` + `debugInfo` only |
| Post-validator FCRA dates / confidence gates | Confidence only; no auto-removal date |
| AI failover `ai_full` / `ai_partial_heuristic` | Always `heuristic_only` |
| Phantom-line filter chain in orchestrator | Noise filters inside golden parsers + CREDITOR_NOISE |

### Suggested upgrade order

1. Drop in `creditParser.ts` behind a feature flag; compare counts vs old parser on the same paste.
2. Replace PDF extraction with Y-coordinate grouping (biggest accuracy win).
3. Add TU preprocess for multi-bureau PDFs.
4. Swap orchestrator mapping to your types.
5. Optionally re-introduce `extractor.heuristicExtract` / AI as a **second pass** that merges missing creditors — do not delete specialized parsers.

### Optional hardening (not live here, but useful)

- Split multi-bureau text into three inputs before `parseNegativeItems` so early TU success does not skip EQ/EX.
- After mapping, run `isValidCreditorName` + consumer-name exclusion from `extractor.ts`.
- Compute `autoRemovalDate` via `calcAutoRemovalDate` when true DOFD is available.
- Cross-bureau group IDs on masked account + creditor fuzzy match.

---

## 15. Known edge cases & failure modes

| Symptom | Likely cause | Fix direction |
|---------|--------------|---------------|
| Zero items from PDF | Flat text join (no newlines) | Confirm Y-grouping extract, not `items.map(str).join(' ')` |
| TU accounts missing in 3-bureau PDF | Preprocess only when TU is first bureau | Use `hasTransUnion \|\| isMultiBureau` |
| Account numbers not detected on TU | Unmasked digits without `*`/`X` | `preprocessTransUnionText` fix #4 |
| Consumer name as creditor | Generic fallback on header lines | Port `extractConsumerInfo` + name exclusion |
| Positive closed accounts as charge-offs | Equifax legend text | Pays-as-agreed + narrative code gate |
| Duplicate same account | Masked `#` collision | Dedup includes `dateOpened`; enrich with balance |
| Only TU items from ACR | First specialized parser `continue` | Split by bureau sections |
| Columns smashed (`$0 $500 $1200` one line) | TU multi-column PDF | `normalizeTransUnionText` 3+ space split |
| UI freeze on large PDF | Parsing on main thread | Use the Web Worker |

---

## 16. Dependencies

| Package | Used for |
|---------|----------|
| `pdfjs-dist` | PDF text extraction |
| `uuid` | App `NegativeItem.id` in orchestrator |
| Vite `?raw` + `?worker` | Worker blob + module worker (this repo) |

No AI/Gemini dependency on the live parse path (`geminiService.parseCreditReport` is a **separate** legacy/AI helper — do not confuse with `creditReportParser/index.ts`).

---

## Quick reference — call from another app

```ts
import { parseCreditReport } from './services/creditReportParser';

const result = await parseCreditReport({
  source: 'paste',
  pasteText: reportText,
  onProgress: (pct, msg) => console.log(pct, msg),
});

if (result.success) {
  // result.items → your dispute UI / storage
}
```

Or engine-only:

```ts
import { parseNegativeItems } from './services/creditReportParser/creditParser';

const items = parseNegativeItems([{ sourceName: 'acr', text: normalized }]);
```

---

*Generated from the live v5.0 Golden Ticket parser in this repository. Prefer reading the TypeScript sources when behavior and this doc disagree — the code wins.*
