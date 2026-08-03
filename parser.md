# DYLANDOS CREDIT REPORT PARSER — TECHNICAL DEEP-DIVE
## `src/services/creditReportParser/` | v4.0.0 | April 2026

> **SUPERSEDED for live code.** This document describes the older **10-module AI pipeline** (`heuristicParser`, `aiEnhancer`, `postValidator`, etc.). The app now runs **Golden Ticket v5** (`creditParser.ts` + `extractor.ts` + TU normalizer).  
> For upgrading another build, use: **[`docs/credit-report-parser-v5-deep-dive.md`](docs/credit-report-parser-v5-deep-dive.md)**

---

## TABLE OF CONTENTS

1. [System Purpose & Design Philosophy](#1-system-purpose--design-philosophy)
2. [Architecture Overview](#2-architecture-overview)
3. [End-to-End Data Flow](#3-end-to-end-data-flow)
4. [Module Reference — All 10 Files](#4-module-reference--all-10-files)
   - 4.1 [index.ts — Pipeline Orchestrator](#41-indexts--pipeline-orchestrator)
   - 4.2 [types.ts — Full Type Definitions](#42-typests--full-type-definitions)
   - 4.3 [textAcquisition.ts — Input Handler](#43-textacquisitionts--input-handler)
   - 4.4 [textNormalizer.ts — Text Cleaner](#44-textnormalizerts--text-cleaner)
   - 4.5 [personalInfoExtractor.ts — Consumer Identity](#45-personalinfoextractorts--consumer-identity)
   - 4.6 [heuristicParser.ts — Structural Extractor](#46-heuristicparserts--structural-extractor)
   - 4.7 [aiEnhancer.ts — AI Enhancement Layer](#47-aienhancerts--ai-enhancement-layer)
   - 4.8 [postValidator.ts — Validation & Enrichment Gate](#48-postvalidatorts--validation--enrichment-gate)
   - 4.9 [accountSignals.ts — Signal Detection Library](#49-accountsignalsts--signal-detection-library)
   - 4.10 [creditorDetector.ts — Creditor Name Validator](#410-creditordetectorts--creditor-name-validator)
5. [The Phantom Line Problem — Full Explanation](#5-the-phantom-line-problem--full-explanation)
6. [Bureau-Specific Extraction Patterns](#6-bureau-specific-extraction-patterns)
   - 6.1 [Equifax (ACR / AnnualCreditReport.com)](#61-equifax-acr--annualcreditreportcom)
   - 6.2 [Experian (Web UI / ACR export)](#62-experian-web-ui--acr-export)
   - 6.3 [TransUnion (ACR / Direct portal)](#63-transunion-acr--direct-portal)
7. [Negative Signal Detection System](#7-negative-signal-detection-system)
   - 7.1 [Two-Tier Signal Architecture](#71-two-tier-signal-architecture)
   - 7.2 [Approved Negative Criteria List](#72-approved-negative-criteria-list)
   - 7.3 [Fuzzy Expansion Rules](#73-fuzzy-expansion-rules)
   - 7.4 [Positive-Only Exclusion Rules](#74-positive-only-exclusion-rules)
8. [Phantom Line Filter Chain](#8-phantom-line-filter-chain)
   - 8.1 [Metadata / Boilerplate Filter](#81-metadata--boilerplate-filter)
   - 8.2 [Consumer Name Filter](#82-consumer-name-filter)
   - 8.3 [Personal Info Token Filter](#83-personal-info-token-filter)
   - 8.4 [Positive-Only Tradeline Filter](#84-positive-only-tradeline-filter)
   - 8.5 [isValidTradeline Gate (postValidator)](#85-isvalidtradeline-gate-postvalidator)
9. [Post-Validation & Enrichment Rules](#9-post-validation--enrichment-rules)
   - 9.1 [Status Normalization](#91-status-normalization)
   - 9.2 [Status Sanitization](#92-status-sanitization)
   - 9.3 [Type-of-Negative Resolution](#93-type-of-negative-resolution)
   - 9.4 [Bureau Normalization](#94-bureau-normalization)
   - 9.5 [FCRA Auto-Removal Date Calculation](#95-fcra-auto-removal-date-calculation)
   - 9.6 [parseConfidence Scoring](#96-parseconfidence-scoring)
   - 9.7 [Cross-Bureau Deduplication](#97-cross-bureau-deduplication)
10. [AI Enhancement — Full Prompt Engineering Spec](#10-ai-enhancement--full-prompt-engineering-spec)
    - 10.1 [When AI Is Called](#101-when-ai-is-called)
    - 10.2 [Text Chunking Strategy](#102-text-chunking-strategy)
    - 10.3 [System Prompt Design](#103-system-prompt-design)
    - 10.4 [User Prompt Design](#104-user-prompt-design)
    - 10.5 [Response Parsing & Normalization](#105-response-parsing--normalization)
    - 10.6 [AI Failover Behavior](#106-ai-failover-behavior)
11. [Debug System — rejectedLines & debugLog](#11-debug-system--rejectedlines--debuglog)
12. [ParseCreditReportResult — Full Output Reference](#12-parsecreditreportresult--full-output-reference)
13. [Known Edge Cases & How They're Handled](#13-known-edge-cases--how-theyre-handled)
14. [Common Failure Modes & Root Causes](#14-common-failure-modes--root-causes)
15. [How to Call the Parser](#15-how-to-call-the-parser)
16. [How to Extend the Parser](#16-how-to-extend-the-parser)
17. [Parser Accuracy Benchmarks & Targets](#17-parser-accuracy-benchmarks--targets)

---

## 1. SYSTEM PURPOSE & DESIGN PHILOSOPHY

### What the Parser Does
The credit report parser is the application's most critical system — it is the **first
transformation** in the entire credit repair workflow. Raw, unstructured text from a
credit report (PDF, pasted text, or file) must be converted into precise, typed
`NegativeItem` objects before any dispute letter can be generated.

If the parser extracts wrong items (phantom lines, metadata rows, the consumer's own name),
the entire downstream workflow is contaminated — letters get sent disputing non-existent
accounts, which is both legally meaningless and harmful to the user.

### Three Core Design Principles

1. **Negative-only extraction.** The parser only cares about derogatory, adverse, or
   potentially negative accounts. Positive tradelines, inquiries, and good-standing
   accounts are explicitly excluded. Every extracted item must have a verified negative
   signal to pass through the pipeline.

2. **Zero silent failures.** Every item the parser looks at is either accepted into the
   output or rejected with a reason into `rejectedLines[]`. Nothing is silently dropped.
   Nothing is silently included. The debug system tells you exactly what happened to
   every candidate line.

3. **Defense in depth.** No single filter is responsible for correctness. The pipeline
   applies independent filters at multiple stages — heuristic extraction, AI extraction,
   post-validation, and the final clean filter in the orchestrator — so that a miss at
   one stage is caught at the next.

### The False Positive Problem (Why the Parser Is Complex)
Credit reports from AnnualCreditReport.com paste into a mess of:
- Field labels that look like account names (`"Account Status"`, `"Pay Status"`)
- Dollar amounts in account-name positions (`"Past Due $1,442"`, `"Account Balance $949"`)
- Bureau metadata (`"Potentially Negative"`, `"Historical Info"`)
- Angle-bracket status notation (`">Charge-Off<"`, `">In Collection<"`)
- URLs from web UI print pages (`"Https://Usa.Experian.Com/..."`)
- Phone numbers and PO Box addresses at end of every account block
- FCRA legal boilerplate text in the middle of account sections
- The consumer's own name appearing in the report header

Every one of these must be classified and rejected before the parser produces output.

---

## 2. ARCHITECTURE OVERVIEW

The parser is a **10-module, multi-stage pipeline** housed in a dedicated subdirectory.

```
src/services/creditReportParser/
├── index.ts              ← Orchestrator — calls each stage in sequence
├── types.ts              ← All TypeScript interfaces for the pipeline
├── textAcquisition.ts    ← Input layer (PDF / paste / file path)
├── textNormalizer.ts     ← Unicode cleanup + section boundary detection
├── personalInfoExtractor.ts  ← Consumer identity extraction (anti-false-positive)
├── heuristicParser.ts    ← Regex-based structural extraction (Stage 4)
├── aiEnhancer.ts         ← AI-assisted extraction + enrichment (Stage 5)
├── postValidator.ts      ← Final validation gate + enrichment (Stage 6)
├── accountSignals.ts     ← Shared signal-detection utility library
└── creditorDetector.ts   ← Creditor name validator + known creditor list
```

### Module Dependency Graph
```
index.ts
  ├── textAcquisition.ts          (no internal deps)
  ├── textNormalizer.ts           (no internal deps)
  ├── personalInfoExtractor.ts    (no internal deps)
  ├── heuristicParser.ts
  │     ├── accountSignals.ts
  │     └── creditorDetector.ts
  ├── aiEnhancer.ts
  │     ├── accountSignals.ts
  │     ├── creditorDetector.ts
  │     └── aiRouter.ts           (external — AI provider cascade)
  └── postValidator.ts
        └── accountSignals.ts
```

---

## 3. END-TO-END DATA FLOW

```
 USER INPUT
 ──────────────────────────────────────────────────────────────────────────
 PDF Buffer (ArrayBuffer)   │  Paste Text (string)  │  File Path (string)
 ──────────────────────────────────────────────────────────────────────────
            │                       │                       │
            └───────────────────────┴───────────────────────┘
                                    │
                     ┌──────────────▼──────────────┐
                     │  STAGE 1: textAcquisition   │  5% progress
                     │  → pdfjs-dist page extract  │
                     │  → paste passthrough        │
                     │  → Electron fs.readFile     │
                     │  Output: AcquiredText       │
                     │  { rawPages[], fullText,    │
                     │    pageCount, warnings[] }  │
                     └──────────────┬──────────────┘
                                    │
                     ┌──────────────▼──────────────┐
                     │  STAGE 2: textNormalizer    │  15% progress
                     │  → NFKC normalization       │
                     │  → ligature resolution      │
                     │  → control char strip       │
                     │  → hyphen-newline join      │
                     │  → section detection        │
                     │  Output: NormalizedText     │
                     │  { pages[], fullText,       │
                     │    sections[], log[] }      │
                     └──────────────┬──────────────┘
                                    │
                     ┌──────────────▼──────────────┐
                     │  STAGE 3: personalInfo      │  22% progress
                     │    Extractor                │
                     │  → find consumer name       │
                     │  → extract addresses        │
                     │  → build namevariants[]     │
                     │  → build exclusionTokens    │
                     │  Output: ExtractedConsumer  │
                     │         Info                │
                     └──────────────┬──────────────┘
                                    │
                     ┌──────────────▼──────────────┐
                     │  STAGE 4: heuristicParser   │  28% progress
                     │  → detect negative sections │
                     │  → scan account blocks      │
                     │  → extract field values     │
                     │  → filter positive-only     │
                     │  → isLikelyCreditor gate    │
                     │  Output: HeuristicParse     │
                     │    Result { accounts[],     │
                     │    inquiries[], rawMatch    │
                     │    Count, debugLog[] }      │
                     └──────────────┬──────────────┘
                                    │
                     ┌──────────────▼──────────────┐
                     │  STAGE 5: aiEnhancer        │  35%→85% progress
                     │  → chunk text for context   │
                     │  → build system + user      │
                     │    prompts                  │
                     │  → aiRouter.aiComplete()    │
                     │    (Gemini → OpenRouter)    │
                     │  → parse JSON response      │
                     │  → filter boilerplate       │
                     │  → merge & deduplicate      │
                     │  Output: AIEnhanced         │
                     │         Account[]           │
                     └──────────────┬──────────────┘
                                    │
                     ┌──────────────▼──────────────┐
                     │  STAGE 6: Clean Filter      │  88% progress
                     │  (in index.ts)              │
                     │  → isNonDerogatoryMetadata  │
                     │  → looksLikeBoilerplate     │
                     │  → consumer name match      │
                     │  → personal info token      │
                     │  → positive-only signal     │
                     └──────────────┬──────────────┘
                                    │
                     ┌──────────────▼──────────────┐
                     │  STAGE 7: postValidator     │  88%→95%
                     │  → isValidTradeline() gate  │
                     │  → status normalization     │
                     │  → typeOfNegative resolve   │
                     │  → bureau normalization     │
                     │  → DOFD → autoRemovalDate   │
                     │  → parseConfidence compute  │
                     │  → cross-bureau dedup       │
                     │  Output: NegativeItem[]     │
                     │    + rejectedLines[]        │
                     └──────────────┬──────────────┘
                                    │
                     ┌──────────────▼──────────────┐
                     │  ParseCreditReportResult    │  100%
                     │  { success, items[],        │
                     │    consumerName,            │
                     │    totalFound,              │
                     │    needsReviewCount,        │
                     │    warnings[], rejected     │
                     │    Lines[], parseMethod,    │
                     │    rawTextPreview,          │
                     │    processingTimeMs,        │
                     │    debugLog[] }             │
                     └─────────────────────────────┘
```

---

## 4. MODULE REFERENCE — ALL 10 FILES

### 4.1 `index.ts` — Pipeline Orchestrator

**Responsibility**: Calls each stage in sequence. Contains the final `cleanedAccounts`
filter loop. Returns the final `ParseCreditReportResult`.

**Key Logic Sections**:

```typescript
// 1. Source routing
if (source === "pdf_buffer")   → acquireFromPDFBuffer(pdfBuffer)
if (source === "paste")        → acquireFromPaste(pasteText)
if (source === "file_path")    → acquireFromFilePath(filePath)

// 2. Chain stages
normalized = normalizeText(acquired)
detectedBureaus = detectReportBureaus(normalized.fullText)
consumerInfo = extractConsumerInfo(normalized.fullText)
heuristic = heuristicParse(normalized, consumerInfo)
aiAccounts = await aiEnhanceParse(normalized, heuristic, consumerInfo, onProgress)

// 3. Source selection — AI preferred over heuristic
sourceAccounts = aiAccounts.length > 0 ? aiAccounts : heuristic.accounts.map(toAIShape)

// 4. Final clean filter (5 checks per account — see Section 8)
cleanedAccounts = sourceAccounts.filter(account => ...)

// 5. Post-validation
{ items, warnings, rejectedLines } = validateAndEnrich(cleanedAccounts, { defaultBureaus })

// 6. Return
return { success, items, consumerName, totalFound, needsReviewCount, warnings,
         parseMethod, rawTextPreview, processingTimeMs, debugLog, rejectedLines }
```

**`parseMethod` Values**:
| Value | Meaning |
|---|---|
| `"ai_full"` | AI returned results; AI result used |
| `"ai_partial_heuristic"` | AI called but returned empty; heuristic fallback used |
| `"heuristic_only"` | AI call threw error; heuristic fallback used |

---

### 4.2 `types.ts` — Full Type Definitions

All shared interfaces for the pipeline. Nothing in the parser imports types from
`src/types.ts` directly — it uses its own internal types and only produces `NegativeItem`
at the output boundary via `postValidator.ts`.

| Type | Description |
|---|---|
| `ParseSource` | `"pdf_buffer" \| "paste" \| "file_path"` |
| `ParseCreditReportOptions` | Parser input options (source, buffers, progress callback) |
| `AcquiredText` | Raw extraction output from `textAcquisition.ts` |
| `SectionType` | One of 7 section classification values |
| `ReportSection` | A detected section with type, raw text, start page, confidence |
| `NormalizedText` | Cleaned text with sections and normalization log |
| `HeuristicAccount` | Single account from regex-based structural extraction |
| `HeuristicInquiry` | Single inquiry from structural extraction |
| `HeuristicParseResult` | Full output from `heuristicParser.ts` |
| `AIEnhancedAccount` | Single account from AI extraction |
| `ParseCreditReportResult` | Final output of `parseCreditReport()` |
| `ParserRejectedLine` | One rejected line with reason and pipeline stage |

**`ParserRejectedLine` structure** (critical for debugging):
```typescript
interface ParserRejectedLine {
  line: string;     // The exact text that was rejected
  reason: string;   // Human-readable explanation of why
  stage: "clean_filter" | "post_validation" | "heuristic" | "ai_enhancer";
}
```

---

### 4.3 `textAcquisition.ts` — Input Handler

**Responsibility**: Accept raw input from any of three sources and produce a normalized
`AcquiredText` object with consistent structure.

**PDF Buffer Path** (`acquireFromPDFBuffer`):
- Uses `pdfjs-dist ^5.6.205` with `getDocument({ data: buffer })`.
- Iterates each page with `page.getTextContent()`.
- Concatenates text items per page, joining with `\n`.
- Page separator: inserts `"\n\n---PAGE BREAK---\n\n"` between pages.
- Stores each page separately in `rawPages[]`.
- Reports page count and any extraction warnings.

**Paste Path** (`acquireFromPaste`):
- Accepts raw string. Wraps as a single-page `rawPages[0]`.
- `pageCount: 1`.
- Minimal preprocessing at this stage — normalization happens in Stage 2.

**File Path** (`acquireFromFilePath`):
- Electron-only: uses IPC or `fs.readFile` to read the file.
- Auto-detects: if extension is `.pdf`, delegates to PDF buffer path.
- Otherwise treats content as paste text.

**Output** `AcquiredText`:
```typescript
{
  source: "pdf" | "paste" | "file",
  rawPages: string[],   // One entry per page
  fullText: string,     // All pages joined with page-break markers
  pageCount: number,
  warnings: string[],   // Any extraction warnings (e.g., encrypted PDF, empty page)
}
```

---

### 4.4 `textNormalizer.ts` — Text Cleaner

**Responsibility**: Clean raw extracted text to a canonical form that regex patterns can
reliably match, and detect section boundaries.

**Normalization Steps** (applied per page):
1. `NFKC` normalization — decomposes Unicode characters to canonical form.
2. **Ligature resolution** — maps Unicode ligatures to ASCII equivalents:
   - `ﬀ` (U+FB00) → `ff`, `ﬁ` (U+FB01) → `fi`, `ﬂ` (U+FB02) → `fl`
   - `ﬃ` (U+FB03) → `ffi`, `ﬄ` (U+FB04) → `ffl`, `ﬅ/ﬆ` (U+FB05/06) → `st`
   - Typographic quotes/dashes → ASCII equivalents
3. **Control character strip** — removes C0/C1 control characters (U+0000–U+001F except LF, U+007F).
4. **Hyphen-newline join** — `word-\nword` → `wordword` (PDF line-break artifact).
5. **Line normalization** — compress multiple spaces/tabs to single space, trim each line.
6. **Horizontal rule strip** — removes `---`, `===`, `___` divider lines (≥4 chars).
7. **Blank line compression** — 3+ consecutive blank lines → 2 blank lines.

**Ligature Map** (important — PDF extractors commonly fail to resolve these):
```
U+FB00 ff  U+FB01 fi  U+FB02 fl  U+FB03 ffi  U+FB04 ffl
U+2019 '   U+2018 '   U+201C "   U+201D "
U+2013 -   U+2014 -   U+2022 *   U+00B7 *    U+00AD -
```

**Section Detection** — scans each page for these pattern groups:

| SectionType | Detection Patterns |
|---|---|
| `personal_info` | "personal information", "consumer information", "your information" |
| `account_history` | "account history", "account information", "open accounts" |
| `negative_items` | "negative items", "potentially negative", "derogatory information" |
| `collections` | "collection accounts?", "collections" |
| `inquiries` | "inquiries", "credit inquiries", "requests for credit" |
| `public_records` | "public records?", "bankruptcy", "judgment" |
| `score_summary` | "credit score", "fico", "vantageScore" |

Each detected section captures the next 100 lines of text for targeted pattern matching.

---

### 4.5 `personalInfoExtractor.ts` — Consumer Identity

**Responsibility**: Extract the consumer's identifying information from the report header.
This data is used by every downstream stage to **exclude** the consumer's own identity
from being mistakenly classified as a creditor.

**Why This Is Critical**:
Credit reports print the consumer's name, address, employer, and other PII throughout the
document. Without extracting this first, the parser would classify "JOHN A. SMITH" (the
consumer) as a creditor named "JOHN A SMITH" — a ghost account that would generate a
useless dispute letter.

**Extraction Strategy**:
1. Isolate the personal info section first (searches up to 2000 chars after section header).
2. Falls back to the first 3000 characters of the report if no section found.
3. Apply sequential pattern matching for name, address, DOB, SSN, employer, phone.

**Name Extraction Patterns**:
```
^(?:name|consumer name|applicant|borrower):\s+(.+)
^(?:your name):\s+(.+)
// Fallback: first ALL-CAPS line in first 500 chars that looks like a name
```

**Name Variant Generation** (`namevariants[]`):
From `"JOHN ALEXANDER SMITH"`, generates:
- `"JOHN ALEXANDER SMITH"` (full)
- `"JOHN SMITH"` (first + last)
- `"JOHN A SMITH"` (first + middle initial + last)
- `"J SMITH"` (initial + last)
- `"SMITH"` (last name alone, if ≥5 chars)
- `"JOHN"` (first name alone, if ≥5 chars)

**`exclusionTokens` Set** — built from:
- All name variants (uppercased)
- All extracted addresses (city, state tokens — but NOT generic street abbreviations)
- Employer names
- Phone numbers

**Address Stop Words** — address tokens that are intentionally NOT added to `exclusionTokens`
because they would block real creditors:
```
AVE, BLVD, ST, RD, DR, LN, CT, WAY, PL, CIR, PKWY, HWY
N, S, E, W, NE, NW, SE, SW, NORTH, SOUTH, EAST, WEST
All 2-letter US state abbreviations (AL, AK, AZ ... WY, DC)
```

**Output** `ExtractedConsumerInfo`:
```typescript
{
  fullName: string,
  firstName: string,
  lastName: string,
  namevariants: string[],       // All name forms to exclude
  addresses: string[],
  dob: string,
  ssn: string,                  // MASKED — e.g., "XXX-XX-1234"
  employers: string[],
  phones: string[],
  exclusionTokens: Set<string>, // Complete set of non-creditor tokens
}
```

---

### 4.6 `heuristicParser.ts` — Structural Extractor

**Responsibility**: Pure-regex structural analysis of the normalized text. Detects
negative sections, extracts account blocks, and applies field extraction patterns.
Runs without AI — provides the foundation and fallback for Stage 5.

#### Negative Section Detection Strategy

The heuristic parser does NOT scan the entire document for accounts. It first localizes
the **negative section** using `NEGATIVE_SECTION_HEADERS` patterns, then only parses
within that bounded region. This is the primary defense against false positives.

**Section Entry Patterns** (`NEGATIVE_SECTION_HEADERS`) — 20+ patterns including:
```
/potentially negative items?/i
/negative (?:items?|information|accounts?)/i
/derogatory (?:items?|accounts?|information)/i
/collection accounts?/i
/adverse (?:items?|accounts?|information)/i
/late payment history/i
/^\s*.\s{0,3}potentially\s+negative\s*$/i   ← ACR Experian icon + header
```

**Section Exit Patterns** (`SECTION_END_HEADERS`) — terminates scanning when hit:
```
/accounts? in good standing/i
/satisfactory accounts?/i
/positive (?:items?|accounts?|information)/i
/no negative (?:items?|information|accounts?)/i
/credit (?:inquir|inquiries)/i
```
Note: `"account history"` and `"your credit history"` are intentionally **NOT** exit
patterns — AnnualCreditReport.com embeds these inside payment history tables within
account blocks.

**Max section size**: 600 lines per negative section (covers 3-bureau ACR reports where
a single bureau section can exceed 400 lines).

**Section-end line guard**: Section-end patterns only trigger on lines ≤80 characters.
This prevents payment-grid column headers (often >80 chars) from prematurely terminating
a section.

#### Account Block Extraction

Within the detected negative section, the parser splits into blocks (separated by 2+ blank
lines) and attempts to extract account data from each block using `FIELD_PATTERNS`.

**Field Extraction Patterns** (selected key patterns):

```typescript
// Account Number
/account\s*(?:number|#|num)[.:\s]+([*X\d\-]{4,20})/i
/\b(\d{4,6}[*X]{4,12})\b/      // 5359********
/\b([*X]{4,12}\d{4,6})\b/      // ************2923
/\b(\d{4}[*X]+\d{4})\b/        // 5359****2923

// Balance
/(?:balance|amount\s+owed|amount\s+past\s+due)[:\s]+\$?([\d,]+(?:\.\d{2})?)/i

// Status
/(?:status|pay\s+status|account\s+status)[:\s]+(.+)/i

// Date of First Delinquency (DOFD — critical for 7-year clock)
/(?:date\s+of\s+first\s+delinquency|dofd|first\s+delinquency)[:\s]+(.+)/i

// Payment History Grid
/\bco(?:\s+co){1,}\b/i                        // CO CO CO (repeated charge-offs)
/\b(?:30|60|90|120)(?:\s+(?:30|60|90))+\b/i  // 30 60 90 grid
```

#### Creditor Name Extraction (Multiple Strategies)

The parser tries multiple strategies per block to find the creditor name:

1. `extractLabeledAccountNameFromBlock()` — looks for `"Account Name PORTFOLIO RECOVERY"`
   labeled lines (Experian / 3-bureau HTML export format).
2. `extractNameAfterAccountNameLabel()` — single-line variant.
3. `stripBalanceSuffixFromCreditorLine()` — ACR/Equifax often glues `"Balance $X"` onto
   the creditor line; this strips the suffix before creditor validation.
4. First non-metadata line in block — after all field lines are stripped.
5. High-confidence payment grid detection — `HIGH_CONFIDENCE_PAYMENT_GRID_REGEX` can
   confirm a block is negative even without a clean creditor name.

**Experian wrapped-name handling**:
```
"Account Name PORTFOLIO RECOVERY"   ← line i
"ASSOCIATES"                         ← line i+1 (wrapped continuation)
→ extracted as: "PORTFOLIO RECOVERY ASSOCIATES"
```

#### Negative Verification Gate

Every extracted account passes through `NEGATIVE_STATUS_REGEX` — a compiled OR of all
`NEGATIVE_STATUS_KEYWORDS`. If neither the block's status field, nor any context line
within `CONTEXT_LOOKAHEAD_LINES = 15` lines matches, the block is rejected.

Additionally, `POSITIVE_ONLY_REGEX` is checked — if the block has an explicit positive
status and no negative signal, it is rejected.

#### `isLikelyCreditor()` Gate

After extracting a candidate creditor name, `isLikelyCreditor(name, consumerInfo)` is
called. This gate returns `{ isCreditor, confidence, reason }`. A `confidence < 0.3`
causes the block to be rejected at the heuristic stage. See Section 4.10 for full
`creditorDetector.ts` documentation.

---

### 4.7 `aiEnhancer.ts` — AI Enhancement Layer

**Responsibility**: Send normalized text + heuristic context to the AI router, receive
structured `AIEnhancedAccount[]` JSON, apply post-processing filters, and return results
for the pipeline to use in preference over heuristic results.

**When AI is called**: Always — unless `aiComplete` throws an unrecoverable error, in
which case the heuristic result is used as the fallback.

**AI Provider**: Uses `aiComplete(systemPrompt, userPrompt, "parse")` from `aiRouter.ts`.
The `"parse"` task type routes to **Gemini first** (large context window), then
OpenRouter as fallback. Groq is not used for parsing (insufficient context window for
large multi-bureau reports).

**Key Functions**:
```typescript
aiEnhanceParse(normalized, heuristic, consumerInfo, onProgress)
  → string[]         // Returns AIEnhancedAccount[] or throws
chunkText(fullText, maxChunkTokens = 3500)
  → string[]         // Splits into ≤3500-token chunks
buildSystemPrompt(consumerInfo)
  → string           // Static consumer-identity-aware system prompt
buildPrompt(textChunk, chunkIndex, consumerInfo)
  → string           // Per-chunk user prompt
parseProviderResponse(text)
  → { accounts, inquiries }
```

See Section 10 for full prompt engineering specification.

---

### 4.8 `postValidator.ts` — Validation & Enrichment Gate

**Responsibility**: Apply the final set of strict validation rules to every account,
transform to `NegativeItem`, compute enrichment fields, and deduplicate.

This is the last stage before results leave the parser. It is the most rule-dense module.

**Primary exported function**:
```typescript
validateAndEnrich(
  accounts: AIEnhancedAccount[],
  options: { defaultBureaus: string[] }
): {
  items: NegativeItem[],
  warnings: string[],
  rejectedLines: ParserRejectedLine[],
}
```

**Processing per account**:
1. `isValidTradeline()` — minimum data requirement gate (see Section 8.5).
2. `sanitizeStatusForValidation()` — detect and reject status-as-creditor-name cases.
3. `toTypeOfNegative()` — resolve to canonical negative type (see Section 9.3).
4. If type is null → reject with reason `"Could not classify as a valid negative type"`.
5. `normalizeBureaus()` — standardize bureau names, fallback to detected report bureaus.
6. Field mapping to `NegativeItem` shape.
7. `autoRemovalDate` computation from DOFD (see Section 9.5).
8. `parseConfidence` computation (see Section 9.6).
9. Cross-bureau deduplication pass (see Section 9.7).

**`APPROVED_NEGATIVE_STATUSES`** (strict list — case-normalized to lowercase):
```
collection | charge off | charged off | late 30 | late 60 | late 90 | late 120
derogatory | delinquent | repossession | foreclosure | judgment | bankruptcy
settled | account closed by credit grantor
```

**`STATUS_TO_NEGATIVE_TYPE` Mapping**:
```
collection           → "Collection"
charge off           → "Charge-Off"
charged off          → "Charge-Off"
late 30/60/90/120    → "Late Payment"
derogatory           → "Other Derogatory"
delinquent           → "Other Derogatory"
repossession         → "Repossession"
foreclosure          → "Foreclosure"
judgment             → "Judgment"
bankruptcy           → "Bankruptcy"
settled              → "Other Derogatory"
account closed by..  → "Other Derogatory"
```

---

### 4.9 `accountSignals.ts` — Signal Detection Library

**Responsibility**: Shared utility library of pure functions used by `heuristicParser.ts`,
`aiEnhancer.ts`, `postValidator.ts`, and `index.ts`. Contains all pattern arrays and
detection logic that is reused across multiple stages.

**Exported Functions**:

| Function | Used By | Description |
|---|---|---|
| `hasNegativeSignals(status, itemType?, remarks?, paymentHistory?)` | All stages | Returns `true` if any argument matches a negative signal pattern |
| `hasPositiveOnlySignals(status, itemType?, remarks?, paymentHistory?)` | All stages | Returns `true` if all signals are positive-only |
| `looksLikeBoilerplateAccountText(text)` | All stages | Returns `true` if text matches any boilerplate/metadata pattern |
| `isNonDerogatoryMetadataLine(text)` | Clean filter, postValidator | Catches specific field-label mis-reads |
| `detectReportBureaus(fullText)` | index.ts | Returns `string[]` of detected bureaus |
| `countStructuredFieldHits(text)` | creditorDetector | Counts how many field-label patterns match (high count = metadata) |
| `normalizeComparisonText(text)` | aiEnhancer | Lowercase + strip punctuation for comparison |
| `blockLooksLikeParserNoise(block)` | heuristicParser | True if block is entirely parser noise |

**`NEGATIVE_SIGNAL_PATTERNS`** — 60+ regex patterns including:
- Standard: `\bcharge[\s-]?off\b`, `\bcollection\b`, `\bdelinquen\w*\b`
- ACR angle-bracket notation: `/>(?:charge[\s-]?off|in\s+collection|...)[<\s]/i`
- Payment grid: `\b(?:30|60|90|120)(?:\s+(?:30|60|90|120)){1,}\b`
- Experian-specific: `\bcollection\s+as\s+of\b`, `\bdue\s+as\s+of\b`
- Abbreviations: `\b(?:cbl|cbr|cbt|wep|cbg|ppd)\b`

**`BOILERPLATE_ACCOUNT_PATTERNS`** — 80+ regex patterns including:
- Field labels: `^account\s+type[:\s]`, `^pay\s+status[:\s]`, `^balance[:\s]`
- ACR artifacts: `^>`, `^https?:\/\/`, `^www\.`, `^address\s*$`, `^phone\s*$`
- Dollar-amount-as-name: `^\$[\d,]+`, `^past\s+due\b`, `^account\s+balance\b`
- Legal boilerplate: `/fair\s+credit\s+reporting\s+act/i`
- PO Box: `\bpo\s+box\b`
- Phone numbers: `\(\d{3}\)\s*\d{3}[-.\s]\d{4}`

---

### 4.10 `creditorDetector.ts` — Creditor Name Validator

**Responsibility**: Determine whether a given line of text is a real creditor name.
Returns `{ isCreditor: boolean, confidence: number, reason: string }`.

**`isLikelyCreditor(line, consumerInfo)`** — Decision tree:

```
1. Strip trailing balance fragment (e.g., "CAPITAL ONE Balance $1,200" → "CAPITAL ONE")
2. Check consumer exclusionTokens → if match: isCreditor=false
3. Length check: < 3 or > 65 chars → isCreditor=false
4. looksLikeBoilerplateAccountText() → if true: isCreditor=false
5. countStructuredFieldHits() ≥ 2 → isCreditor=false (looks like metadata)
6. DEFINITELY_NOT_CREDITOR patterns (100+ patterns) → isCreditor=false
7. Check KNOWN_CREDITORS list (exact match, uppercased) → isCreditor=true, confidence=0.99
8. Check CREDITOR_SUFFIX_PATTERNS → if match: confidence += bonus
9. Has ≥2 words AND all caps AND ≥6 chars → creditor candidate
10. All-numeric / phone / date patterns → isCreditor=false
11. Default: isCreditor=(confidence > 0.3)
```

**`KNOWN_CREDITORS`** — 100+ pre-loaded creditor names including:
- Major banks: Capital One, Chase, Bank of America, Wells Fargo, Citibank, Discover, Amex, Synchrony
- Auto lenders: Ford Motor Credit, GM Financial, Toyota Financial, Santander Consumer
- Student loans: Navient, Sallie Mae, Nelnet, MOHELA, Aidvantage
- Retail cards: Kohls, Target, Comenity, WebBank, Synchrony-branded stores
- Collection agencies: Midland Credit, Portfolio Recovery Associates, LVNV Funding, Resurgent Capital
- Utilities: AT&T, Verizon, T-Mobile, Comcast, Spectrum

**`CREDITOR_SUFFIX_PATTERNS`** — 14 suffix groups (bank, credit union, financial, etc.)
give a confidence boost when matched.

**`DEFINITELY_NOT_CREDITOR`** — 60+ hard-block patterns including:
- Address formats, ZIP codes, state/ZIP combos
- Date formats, "as of", "generated", "report date"
- Bureau names themselves (Equifax, Experian, TransUnion as standalone lines)
- ACR-specific artifacts: `>`, URLs, `"Historical Info"`, phone numbers, PO Boxes
- Field labels: `"Pay Status"`, `"Account Balance"`, `"Original Creditor"` (as standalone lines)

---

## 5. THE PHANTOM LINE PROBLEM — FULL EXPLANATION

### What Is a Phantom Line?

A phantom line is any text extracted as a candidate account name that is NOT actually a
creditor. Credit report parsers — especially naive regex-only parsers — produce phantom
lines in large numbers from AnnualCreditReport.com (ACR) paste output.

### Categories of Phantom Lines Found in ACR Paste Output

**Category 1: Angle-Bracket Status Notation**
ACR uses angle-bracket wrappers to render status fields visually. When pasted, these
become raw text in the account block position:
```
>Charge-Off<
>In Collection<
>Placed For Collection<
>90 Days Past Due<
>Seriously Past Due Date<
```
A naive parser reads `">Charge-Off<"` as the account name and creates a dispute letter
for a creditor called ">Charge-Off<". The fix: `BOILERPLATE_ACCOUNT_PATTERNS` has
`/^>[^<\n]{0,80}/` as a hard block.

**Category 2: Field Value as Account Name**
TransUnion ACR paste often renders field VALUES (dollars, status words) in the
position where the creditor name should appear:
```
Past Due $1,442
Account Balance $949
Current Balance $200
Charge-Off Amount $3,400
Minimum Payment $50
```
The fix: `BOILERPLATE_ACCOUNT_PATTERNS` and `DEFINITELY_NOT_CREDITOR` have explicit
patterns for all these forms including `^\$[\d,]+` (starts with dollar sign).

**Category 3: Contact Field Labels**
After every account block in ACR, the format appends:
```
Address
Address: PO Box 1269, Greenville SC 29602
Phone
Phone: (866) 464-1183
Fax
```
Without filtering, each of these becomes a false account. The fix: patterns for
`/^address\s*$/i`, `/^phone\s*$/i`, `/\bpo\s+box\b/i`, phone number regex.

**Category 4: Section Headers**
```
Potentially Negative
Historical Information
Historical Account
Collections
Narrative Code  Narrative Code Description
```
These appear as the first line of a section, easily mistaken for a creditor name.
The fix: `DEFINITELY_NOT_CREDITOR` and `BOILERPLATE_ACCOUNT_PATTERNS` patterns.

**Category 5: Consumer Name as Creditor**
The report header on every ACR report is:
```
JOHN ALEXANDER SMITH
Current Address: 123 Main St, Dallas TX 75201
```
A parser without `personalInfoExtractor.ts` would extract "JOHN ALEXANDER SMITH" as a
creditor. The fix: `ExtractedConsumerInfo.namevariants` + exclusion filter in `index.ts`.

**Category 6: URLs from Web UI Print Pages**
When printing from Experian's web interface:
```
Https://Usa.Experian.Com/Memberportal/ShowFullReport
```
The fix: `/https?:\/\//i` in boilerplate patterns.

**Category 7: FCRA Legal Boilerplate**
```
Of the Fair Credit Reporting Act
Pursuant to Section 611
In Accordance With 15 U.S.C.
```
The fix: `/fair\s+credit\s+reporting\s+act/i` and related patterns.

---

## 6. BUREAU-SPECIFIC EXTRACTION PATTERNS

### 6.1 Equifax (ACR / AnnualCreditReport.com)

**Format Characteristics**:
- Negative section announced by: `"Potentially Negative"` (sometimes with Unicode private-use icon prefix)
- Account status often wrapped in angle brackets: `>Charge-Off<`, `>In Collection<`
- Creditor name often has balance appended: `"MIDLAND CREDIT Balance $1,200"`
- Payment history grids: `"CO CO CO CO"` or `"30 60 90 CO"`
- Section ends at `"Accounts in Good Standing"` or `"Hard Inquiries"`

**Parser Handling**:
- `looksLikeBoilerplateAccountText()` catches `>...<` forms via `/^>[^<\n]{0,80}/`
- `stripBalanceSuffixFromCreditorLine()` strips `" Balance $X"` from creditor lines
- `HIGH_CONFIDENCE_PAYMENT_GRID_REGEX` catches `CO CO CO` as a strong negative signal
- `detectReportBureaus()` looks for `"Equifax"` or `"EFX"` in the first 2000 chars

### 6.2 Experian (Web UI / ACR export)

**Format Characteristics**:
- Negative section: `"Potentially Negative"` or icon + `"POTENTIALLY NEGATIVE"` (section header)
- Account names often labeled: `"Account Name PORTFOLIO RECOVERY"` on its own line
- Multi-word account names can wrap: `"Account Name PORTFOLIO RECOVERY"` + `"ASSOCIATES"` on next line
- Status appears inline: `"Collection as of Mar 2026"`, `"Due as of Apr 2026"`
- Each account block ends with: `"Address"`, `"Address: PO Box..."`, `"Phone: (xxx) xxx-xxxx"`
- URLs appear in Experian web-print output: `"Https://Usa.Experian.Com/..."`

**Parser Handling**:
- `extractLabeledAccountNameFromBlock()` specifically handles `"Account Name X"` format
- `extractLabeledAccountNameFromBlock()` handles the PORTFOLIO RECOVERY + ASSOCIATES wrap case
- `hasNegativeSignals()` catches `"collection as of"` and `"due as of"` patterns
- Contact field patterns block Address/Phone/Fax lines
- URL patterns block Experian print-page URLs

### 6.3 TransUnion (ACR / Direct portal)

**Format Characteristics**:
- Field values often appear displaced — dollar amounts, status words appear where
  account names should be in PDF extraction
- Balance fields: `"Past Due $1,442"`, `"Account Balance $949"` in account-name position
- Status fields: `"Derogatory"`, `"Collection"` in account-name position without company name
- Account blocks less clearly delimited (fewer blank-line separators)
- `"Narrative Code"` / `"Narrative Code Description"` header appears in some formats

**Parser Handling**:
- `DEFINITELY_NOT_CREDITOR` has explicit `^past\s+due\b`, `^account\s+balance\b`,
  `^current\s+balance\b`, `^\$[\d,]+` patterns for dollar-value-as-name
- `BOILERPLATE_ACCOUNT_PATTERNS` catches `"Narrative Code"` via `/^narrative\s+code/i`
- `inferNegativeTypeFromContext()` in `postValidator.ts` handles status-only entries
  by checking `itemType` + `remarks` + `paymentHistory` fields when status alone is ambiguous

---

## 7. NEGATIVE SIGNAL DETECTION SYSTEM

### 7.1 Two-Tier Signal Architecture

The negative signal system operates on two tiers:

**Tier 1 — Heuristic Parser Tier** (`heuristicParser.ts`):
Uses `NEGATIVE_STATUS_KEYWORDS` (string array) compiled into `NEGATIVE_STATUS_REGEX` at
module load time. Applied to account block text within the detected negative section.
A match in ANY context line within `CONTEXT_LOOKAHEAD_LINES = 15` lines qualifies the
block as negative.

**Tier 2 — Shared Signal Library** (`accountSignals.ts`):
`hasNegativeSignals(status, itemType, remarks, paymentHistory)` — the canonical negative
classifier. Tests each non-null argument against `NEGATIVE_SIGNAL_PATTERNS`. Used by
`heuristicParser.ts`, `postValidator.ts`, `index.ts` clean filter, and `aiEnhancer.ts`.

### 7.2 Approved Negative Criteria List

These are the only values that pass the `APPROVED_NEGATIVE_STATUSES` strict check
in `postValidator.ts` for direct type mapping:

```
"collection"                    → Collection
"charge off"                    → Charge-Off
"charged off"                   → Charge-Off
"late 30"                       → Late Payment
"late 60"                       → Late Payment
"late 90"                       → Late Payment
"late 120"                      → Late Payment
"derogatory"                    → Other Derogatory
"delinquent"                    → Other Derogatory
"repossession"                  → Repossession
"foreclosure"                   → Foreclosure
"judgment"                      → Judgment
"bankruptcy"                    → Bankruptcy
"settled"                       → Other Derogatory
"account closed by credit grantor" → Other Derogatory
```

All status values are normalized via `normalizeStatusValue()` before comparison:
- Lowercase
- `_` and `-` → space
- `()` stripped ("Late (30)" → "late 30")
- Multiple spaces compressed

### 7.3 Fuzzy Expansion Rules

When the strict list doesn't match, `FUZZY_STATUS_RULES` in `postValidator.ts` apply:

```typescript
{ pattern: /\b(?:collection|c\s+collection|c\s+col|col)\b/i,        → "Collection" }
{ pattern: /\b(?:charge[\s-]?off|charged\s+off|co)\b/i,             → "Charge-Off" }
{ pattern: /\b(?:bankrupt\w*|cbl|cbr|cbt|wep)\b/i,                  → "Bankruptcy" }
{ pattern: /\b(?:placed\s+for|transferred\s+to)\b/i,                 → "Collection" }
{ pattern: /\b(?:canceled\s+by\s+credit\s+grantor|cbg)\b/i,         → "Other Derogatory" }
{ pattern: /\b(?:paid\s+by\s+co-?maker|ppd)\b/i,                    → "Other Derogatory" }
{ pattern: /\bco(?:\s+co){1,}\b|payment grid pattern/i,              → "Charge-Off" }
```

These operate on the combined text of `[itemType, status, remarks, paymentHistory]`.

### 7.4 Positive-Only Exclusion Rules

`hasPositiveOnlySignals()` returns `true` (and causes rejection) when ANY of these
patterns match AND no negative signal is present:

```
/\bpays as agreed\b/i          /\bpaid as agreed\b/i
/\bnever late\b/i              /\bnever delinquent\b/i
/\baccount in good standing\b/i
/\bopen\s*[\/\-–]\s*never late\b/i
/\bclosed\s*[\/\-–]\s*never late\b/i
/\bclosed\s*[\/\-–]\s*paid\b/i
/\bpaid satisfactorily\b/i
/\btoo new to rate\b/i
/\bopen\/paid as agreed\b/i
/(?:status|account\s+status|pay\s+status)[:\s]+current\b/i
```

Note: `"current"` alone is NOT a positive-only trigger — it must appear as a labeled
status field value. This prevents matching "current balance" or "current address".

---

## 8. PHANTOM LINE FILTER CHAIN

The filter chain runs in this exact order. Each check runs independently — passing one
does not exempt from the rest.

### 8.1 Metadata / Boilerplate Filter

**Location**: `index.ts` clean filter, `heuristicParser.ts`, `creditorDetector.ts`
**Function**: `isNonDerogatoryMetadataLine(name)` + `looksLikeBoilerplateAccountText(name)`

```
isNonDerogatoryMetadataLine catches:
  "Interest Type"            (mis-read as account name from account-type field)
  "Account Type – Interest"  (compound field label)
  "Revolving – Credit Limit" (combined field descriptor)

looksLikeBoilerplateAccountText catches:
  80+ patterns (see accountSignals.ts Section 4.9)
  Key: angle-brackets, URLs, field labels, PO boxes, phone numbers, dollar amounts
```

**On match**: Rejected with `stage: "clean_filter"`, reason written to `rejectedLines[]`.

### 8.2 Consumer Name Filter

**Location**: `index.ts` clean filter
**Function**: Compare against `consumerInfo.namevariants`

Matching algorithm:
```typescript
namevariants.find(variant => {
  const u = variant.toUpperCase().trim();
  if (!u) return false;
  if (name === u) return true;   // Exact match
  if (u.length <= 3) return     // Short tokens: must be isolated word
    name.split(/[^A-Z0-9]+/).filter(Boolean).includes(u);
  return new RegExp(`\\b${escaped}\\b`).test(name);  // Whole-word match
})
```

Short tokens (≤3 chars like "JR", "II") require exact word boundary match to avoid
false positives against creditors that contain common short words.

**On match**: Rejected with message: `"Removed X — matches consumer name variant Y."`

### 8.3 Personal Info Token Filter

**Location**: `index.ts` clean filter
**Function**: Compare against `consumerInfo.exclusionTokens`

Only tokens with `length > 4` are used to avoid blocking creditors with common short
words. Uses exact equality check (`name === token`).

### 8.4 Positive-Only Tradeline Filter

**Location**: `index.ts` clean filter
**Function**: `hasPositiveOnlySignals()` AND NOT `hasNegativeSignals()`

An account that has explicit positive signals (e.g., "Pays as Agreed") and NO negative
signals is rejected at this stage. This is a final safety net before `postValidator`.

### 8.5 `isValidTradeline` Gate (postValidator)

**Location**: `postValidator.ts`, `validateAndEnrich()`

A tradeline is valid if and only if:
```
creditorName  (non-empty, non-whitespace, length ≥ 2)
AND
(accountNumber  OR  balance ≠ null)
AND
status  (non-empty)
AND
NOT looksLikeBoilerplateAccountText(creditorName)
AND
creditorName !== status  (prevents status label being used as creditor name)
```

If any required field is missing, the item is rejected with stage `"post_validation"` and
the specific missing field identified in the rejection reason.

---

## 9. POST-VALIDATION & ENRICHMENT RULES

### 9.1 Status Normalization

`normalizeStatusValue(value)`:
```typescript
(value || "")
  .toLowerCase()
  .replace(/[_-]+/g, " ")       // charge_off → charge off
  .replace(/[()]+/g, " ")       // Late (30) → late  30
  .replace(/\s+/g, " ")         // compress spaces
  .trim()
```

### 9.2 Status Sanitization

`sanitizeStatusForValidation(status, creditorName, accountName)`:

Before checking the approved list, status is rejected (returned as `""`) if:
1. It matches `creditorName` exactly — status field was populated with creditor data.
2. It matches `accountName` exactly — same confusion in reverse.
3. `looksLikeBoilerplateAccountText(status)` AND NOT `hasNegativeSignals(status)`.
4. Contains a dollar sign (`\$\s*\d`) — balance leaked into status field.
5. Contains creditor-entity words (`llc|inc|corp|bank|financial|...`) AND no negative
   signal — organization name leaked into status field.

### 9.3 Type-of-Negative Resolution

`toTypeOfNegative(itemType, status, remarks, paymentHistory)` — 4-step cascade:

```
Step 1: hasNegativeSignals() on all fields — if none found: return null (reject)
Step 2: APPROVED_NEGATIVE_STATUSES strict match on normalized status
Step 3: FUZZY_STATUS_RULES pattern match on combined fields
Step 4: inferNegativeTypeFromContext() — deep context analysis using combined text
```

If `null` is returned after all 4 steps, the item is rejected at `postValidator.ts`
with reason `"Could not classify as a valid negative type"`.

### 9.4 Bureau Normalization

`normalizeBureaus(bureaus, defaultBureaus)`:
```
Input → lowercase → map to canonical:
  equifax|eq|efx     → "Equifax"
  experian|ex|exp    → "Experian"
  transunion|tu|tru  → "TransUnion"
  (anything else)    → filtered out

If result is empty:
  Use defaultBureaus (detected from report via detectReportBureaus())
  If still empty: ["Unknown"]
```

### 9.5 FCRA Auto-Removal Date Calculation

The Date of First Delinquency (DOFD) drives the FCRA §605(a)(4) 7-year clock.

```typescript
// autoRemovalDate = DOFD + 7 years
// DOFD sources checked in order:
//   1. dateOfFirstDelinquency (explicit DOFD field)
//   2. originalDateOfDelinquency (alias)
//   3. dateOpened (fallback — less accurate)

if (dofd) {
  const dofDate = new Date(dofd);
  dofDate.setFullYear(dofDate.getFullYear() + 7);
  autoRemovalDate = dofDate.toISOString().split("T")[0];  // YYYY-MM-DD
}
```

Items without any DOFD source cannot have `autoRemovalDate` computed and are flagged
with `needsUserReview: true`.

### 9.6 `parseConfidence` Scoring

`parseConfidence` is a 0–1 float assigned per item:

```
Base score: aiConfidence from AI response (0.7 if not provided)

Upward adjustments:
  + accountNumber present         → +0.10
  + dateOfFirstDelinquency present → +0.05
  + balance > 0                   → +0.05
  + dateOpened present            → +0.03
  + originalCreditor present      → +0.02
  + bureaus.length ≥ 2            → +0.05
  Known creditor exact match      → +0.15

Downward adjustments:
  - creditorName = "Unknown Creditor"  → -0.20
  - needsUserReview = true             → -0.10
  - status = "Unknown"                 → -0.10

Clamp to [0.0, 1.0]
```

Items with `parseConfidence < 0.70` are counted in `needsReviewCount` on the result.

### 9.7 Cross-Bureau Deduplication

After all items are validated and enriched, the post-validator runs a deduplication pass:

**Match Criteria** (items are considered the same account if):
- Creditor names match after normalization (lowercase, strip punctuation/common suffixes)
- AND account number suffix matches (last 4 non-masked digits), OR both are null/unknown

**Deduplication Action**:
- Keep one item (the one with highest `parseConfidence`)
- Merge `creditBureau[]` arrays from all duplicates into the kept item
- If merged item now has 3 bureaus, it gets a `crossBureauGroupId` UUID

This prevents the common case where a 3-bureau ACR report yields 3 separate items for
the same Capital One account — one per bureau section.

---

## 10. AI ENHANCEMENT — FULL PROMPT ENGINEERING SPEC

### 10.1 When AI Is Called

AI is always attempted after heuristic parsing. The heuristic result (`rawMatchCount`,
`accounts[]`) is passed to `aiEnhancer.ts` as context. AI has several advantages:
- Handles ambiguous or non-standard layouts the regex system misses
- Fills in fields the heuristic parser can't extract (originalCreditor, paymentHistory, DOFD)
- Can detect account blocks that don't match any known section header anchor
- Provides `aiConfidence` score that drives `parseConfidence` calculation

### 10.2 Text Chunking Strategy

Large reports (especially 3-bureau ACR reports) exceed AI context limits.
`chunkText(fullText, maxChunkTokens = 3500)` splits by:

```typescript
// 1. If fullText <= 14,000 chars (3500 tokens × 4): send as one chunk
// 2. Otherwise split at natural boundaries:
segments = fullText.split(/\n{2,}|---PAGE BREAK---|(?=\n[A-Z]{3,})/)
// Pack segments into chunks of ≤14,000 chars
// When adding next segment would exceed limit: close current chunk, start new
```

Each chunk is processed in parallel with `Promise.all()`. Results from all chunks are
merged and deduplicated by creditor name before returning.

### 10.3 System Prompt Design

The system prompt is built once per parse call, incorporating:

**Consumer Identity Guard** (most important section):
```
CRITICAL — CONSUMER IDENTITY (DO NOT EXTRACT AS ACCOUNTS):
- Consumer Name: [fullName]
- Name Variants: [namevariants joined]
- Address Lines: [addresses joined]
THESE ARE NOT ACCOUNTS. If you see the consumer's name as a potential account name, REJECT IT.
```

**Role Definition**:
```
You are a specialized credit report data extraction system.
YOUR JOB: Extract ONLY actual NEGATIVE creditor/lender/collection agency accounts.
```

**Extraction Rules** (13 rules covering):
- Negative-only mandate
- Explicit exclusion of positive statuses
- Required negative marker in any field
- Never invent data — missing = null
- JSON-only output
- `itemType` valid values (17 types)
- `status` valid values (11 values)
- Date format (MM/YYYY preferred)
- DOFD precision requirement
- Balance as number (no currency)
- Bureau array format
- Low-confidence flagging protocol

**Absolute Prohibitions section** explicitly lists 10+ types of phantom lines the AI
must never use as `accountName` (angle-bracket values, URLs, section headers, contact
field labels, PO boxes, phone numbers, FCRA legal text).

### 10.4 User Prompt Design

Per-chunk user prompt includes:

1. Consumer exclusion reminder with first/last name
2. `"STRICT NEGATIVE-ONLY RULE"` — full include/exclude status list
3. `"CRITICAL — accountName MUST be..."` — 12 explicit prohibitions for accountName
4. JSON schema with all fields, types, and examples
5. The actual text chunk (bounded by `---` markers)

The prompt is designed to be maximally explicit — it repeats the key prohibition rules
(especially for angle-bracket status values and dollar amounts) in both the system prompt
AND the user prompt to maximize compliance.

### 10.5 Response Parsing & Normalization

`parseProviderResponse(text)`:
```typescript
// 1. Strip markdown code fences (```json ... ```)
cleaned = stripCodeFences(text)

// 2. JSON.parse
parsed = JSON.parse(cleaned)

// 3. Extract accounts array (graceful — empty array if missing)
rawAccounts = Array.isArray(parsed?.accounts) ? parsed.accounts : []

// 4. Normalize each account to AIEnhancedAccount shape
// All string fields: typeof check, default to "" if not string
// All number fields: typeof check, default to null
// bureaus: must be non-empty array or []
// aiConfidence: typeof check, default to 0.7
// needsUserReview: boolean coercion
```

**Post-parse filters in `aiEnhancer.ts`**:
After JSON parsing, `aiEnhancer.ts` applies its own boilerplate filter:
- `looksLikeBoilerplateAccountText(account.accountName)`
- `isLikelyCreditor(account.accountName, consumerInfo).isCreditor === false`
- `hasNegativeSignals(...)` — re-verify AI result has a negative signal
- `hasPositiveOnlySignals(...)` — reject AI-included positive accounts
- Confidence threshold: `aiConfidence < 0.2` → reject

Chunk-level deduplication: if the same creditor name appears in results from multiple
chunks, the higher-confidence entry is kept.

### 10.6 AI Failover Behavior

```
aiRouter.aiComplete(system, user, "parse")
  → Gemini first (1M token window, best for large multi-page reports)
  → OpenRouter fallback (if Gemini unavailable or rate-limited)
  → Groq NOT used for parse taskType (128K window insufficient for 3-bureau ACR)

If all providers fail:
  aiEnhancer.ts throws an Error
  index.ts catches it, sets parseMethod = "heuristic_only"
  warnings.push("AI enhancement failed. Structural parser fallback was used.")
  Pipeline continues with heuristic accounts
```

---

## 11. DEBUG SYSTEM — `rejectedLines` & `debugLog`

### `rejectedLines[]` — The Full Audit Trail

Every rejected candidate is recorded here. Never silently dropped.

```typescript
interface ParserRejectedLine {
  line: string;   // The exact text that was rejected (account name / raw line)
  reason: string; // Human-readable explanation
  stage: "clean_filter" | "post_validation" | "heuristic" | "ai_enhancer";
}
```

**Stage values**:
| Stage | Where Populated | What It Covers |
|---|---|---|
| `"clean_filter"` | `index.ts` | Boilerplate, consumer name, personal info token, positive-only filters |
| `"post_validation"` | `postValidator.ts` | Missing required fields, unclassifiable type, status/creditor clash |
| `"heuristic"` | `heuristicParser.ts` | Blocks that fail negative signal check or creditor validation |
| `"ai_enhancer"` | `aiEnhancer.ts` | Accounts AI returned that fail post-parse boilerplate/signal check |

### `debugLog[]` — Pipeline Execution Log

A `string[]` of timestamped messages from the heuristic parser and AI enhancer:
- Which sections were detected
- How many blocks were scanned per section
- Which creditor name extraction strategy succeeded per block
- Account number anchor matches
- Confidence scores per extracted account
- AI chunk sizes and response lengths
- Deduplication events

**Accessing debug data**:
```typescript
const result = await parseCreditReport({ source: "paste", pasteText });
console.log(result.rejectedLines);  // See what was filtered and why
console.log(result.debugLog);       // See parser execution trace
console.log(result.warnings);       // Consumer-visible warnings
```

**`DebugParsePanel.tsx`** — UI component in `src/components/` that renders all three
debug arrays in a formatted view after parsing. Available via the Upload Report page's
"Debug" tab.

---

## 12. `ParseCreditReportResult` — FULL OUTPUT REFERENCE

```typescript
interface ParseCreditReportResult {
  // PRIMARY RESULTS
  success: boolean;           // true if items.length > 0
  items: NegativeItem[];      // Final validated negative items (ready for dispute use)
  consumerName: string;       // Extracted from report ("JOHN SMITH") or ""

  // METADATA
  totalFound: number;         // items.length
  needsReviewCount: number;   // items where parseConfidence < 0.70
  parseMethod: "ai_full" | "ai_partial_heuristic" | "heuristic_only";
  processingTimeMs: number;   // Wall time for entire pipeline

  // DIAGNOSTIC
  warnings: string[];         // Consumer-visible warnings (empty pages, AI failures, etc.)
  debugLog?: string[];        // Parser execution trace (heuristic + AI chunks)
  rejectedLines?: ParserRejectedLine[];  // Full audit trail of every rejected item

  // PREVIEW
  rawTextPreview: string;     // First 2000 chars of normalized text (for manual review)
}
```

**Consuming `items`**: Each `NegativeItem` in the result is a fully populated object
ready to be passed to `AppContext.addNegativeItems()`. All required fields are present.
Fields with `parseConfidence < 0.70` have `item.parseConfidence` set and
`item.additionalInfo` contains the review reason.

---

## 13. KNOWN EDGE CASES & HOW THEY'RE HANDLED

| Edge Case | Report Source | Detection | Fix |
|---|---|---|---|
| Consumer name as creditor | All bureaus | `namevariants[]` + clean filter | Rejected with clear reason |
| `">Charge-Off<"` as account name | ACR/Equifax | `BOILERPLATE_ACCOUNT_PATTERNS: /^>/` | Hard-blocked |
| `"Past Due $1,442"` as account name | ACR/TransUnion | `/^past\s+due\b/` | Hard-blocked |
| URL as account name | Experian web print | `/https?:\/\//i` | Hard-blocked |
| Phone number as account name | ACR (all) | Phone regex | Hard-blocked |
| PO Box as account name | ACR (all) | `/\bpo\s+box\b/i` | Hard-blocked |
| Wrapped account name (`"PORTFOLIO RECOVERY" + "ASSOCIATES"`) | ACR/Experian | `extractLabeledAccountNameFromBlock()` | Rejoined correctly |
| Balance appended to creditor line | ACR/Equifax | `stripBalanceSuffixFromCreditorLine()` | Stripped before creditor detection |
| Same account on 3 bureaus = 3 items | All 3-bureau reports | Cross-bureau dedup in `postValidator` | Merged to 1 item with `bureaus[]` |
| "Collection as of Mar 2026" status | ACR/Experian | `hasNegativeSignals()` + `inferNegativeTypeFromContext()` | Classified as Collection |
| Encrypted PDF | Electron file path | `pdfjs-dist` extraction error caught | Warning returned, graceful failure |
| Report with no personal info section | Non-standard formats | `personalInfoExtractor` fallback to first 3000 chars | Partial extraction, warns user |
| FCRA legal boilerplate inline | ACR all | `/fair\s+credit\s+reporting\s+act/i` | Hard-blocked |
| "C/O Company Name, PO Box..." | ACR collection agencies | AI prompt: strip C/O prefix, use company name only | AI-handled |
| Status label as only identifier | TransUnion | `inferNegativeTypeFromContext()` uses `itemType` + `remarks` | Context-based resolution |
| High-confidence payment grid without creditor | All bureaus | `HIGH_CONFIDENCE_PAYMENT_GRID_REGEX` | Block flagged negative, `needsUserReview: true` |
| Duplicate from multi-chunk AI processing | Large reports | Chunk-level dedup in `aiEnhancer` | Highest-confidence kept |

---

## 14. COMMON FAILURE MODES & ROOT CAUSES

### Failure: Parser returns 0 items from a real report

**Most common causes**:
1. The negative section header wasn't detected → parser never entered the section.
   *Check*: `debugLog` should show "No negative section detected".
   *Fix*: Add the specific header pattern to `NEGATIVE_SECTION_HEADERS` in `heuristicParser.ts`.
2. All items failed the `isValidTradeline()` gate → missing creditorName or status.
   *Check*: `rejectedLines` with `stage: "post_validation"`.
3. AI returned empty array and heuristic also returned 0 → report format unrecognized.
   *Check*: `parseMethod === "heuristic_only"`, `rawTextPreview` shows content was extracted.
4. PDF extraction failed → `pdfjs-dist` returned empty text per page.
   *Check*: `warnings` array for PDF extraction errors.

### Failure: Parser returns phantom items (wrong account names)

**Most common causes**:
1. New ACR format artifact not yet in `BOILERPLATE_ACCOUNT_PATTERNS`.
   *Check*: `rejectedLines` — if it's not there, it wasn't caught.
   *Fix*: Add the specific pattern to `BOILERPLATE_ACCOUNT_PATTERNS` in `accountSignals.ts`.
2. New field value format appearing in account-name position.
   *Check*: `result.items` — look at `creditorName` values that look like field labels.
   *Fix*: Add pattern to `DEFINITELY_NOT_CREDITOR` in `creditorDetector.ts`.
3. AI returning non-creditor text from a new format.
   *Check*: `result.items` with `parseMethod === "ai_full"`, suspicious `creditorName` values.
   *Fix*: Add the pattern to the `"ABSOLUTE PROHIBITIONS"` section of `buildSystemPrompt()`.

### Failure: Correct items rejected (false negatives)

**Most common causes**:
1. Unusual creditor name pattern not in `KNOWN_CREDITORS` and failing `isLikelyCreditor()`.
   *Check*: `rejectedLines` with reason `"Matches not-creditor pattern"` or `"Length out of range"`.
   *Fix*: Add to `KNOWN_CREDITORS` list or `CREDITOR_SUFFIX_PATTERNS`.
2. Status value not in approved list and not caught by fuzzy rules.
   *Check*: `rejectedLines` with reason `"Could not classify as a valid negative type"`.
   *Fix*: Add the status variant to `FUZZY_STATUS_RULES` or `NEGATIVE_SIGNAL_PATTERNS`.
3. Item has negative signals but ALL in `paymentHistory` — other fields are clean.
   *Check*: `parseConfidence` low, `needsUserReview: true`.
   *Fix*: Ensure `paymentHistory` is being passed to `hasNegativeSignals()` correctly.

### Failure: Items missing DOFD (autoRemovalDate not computed)

**Cause**: Report didn't include a Date of First Delinquency field in the account block.
**Impact**: `autoRemovalDate` is null, `needsUserReview: true`.
**Action**: User must manually enter DOFD in the item detail panel.
**Parser fix**: Ensure `dateOfFirstDelinquency` is extracted by AI prompt — it's explicitly
listed in the system prompt as `"DOFD — extract precisely — critical for 7-year clock."`.

---

## 15. HOW TO CALL THE PARSER

### Basic Usage (Paste Input)
```typescript
import { parseCreditReport } from "@/services/creditReportParser";

const result = await parseCreditReport({
  source: "paste",
  pasteText: "... raw credit report text ...",
  onProgress: (pct, msg) => console.log(`${pct}% — ${msg}`),
});

if (result.success) {
  console.log(`Found ${result.totalFound} negative items`);
  console.log(`Needs review: ${result.needsReviewCount}`);
  // result.items is NegativeItem[] ready for AppContext
}
```

### PDF Buffer Input (from file upload)
```typescript
const file = event.target.files[0];
const arrayBuffer = await file.arrayBuffer();

const result = await parseCreditReport({
  source: "pdf_buffer",
  pdfBuffer: arrayBuffer,
  onProgress: (pct, msg) => setProgress({ pct, msg }),
});
```

### File Path Input (Electron)
```typescript
const result = await parseCreditReport({
  source: "file_path",
  filePath: "/path/to/credit-report.pdf",
  onProgress: (pct, msg) => updateStatus(msg),
});
```

### Adding Results to AppContext
```typescript
if (result.success) {
  addNegativeItems(result.items);
  logEvent({
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    type: "report_parsed",
    description: `Parsed ${result.totalFound} items (${result.parseMethod})`,
  });
  addXP(100);  // Gamification
}
```

### Accessing Debug Output
```typescript
// All rejected items with reasons
result.rejectedLines?.forEach(r =>
  console.log(`[${r.stage}] ${r.line}: ${r.reason}`)
);

// Parser execution trace
result.debugLog?.forEach(line => console.log(line));

// Consumer-visible warnings
result.warnings.forEach(w => console.warn(w));
```

---

## 16. HOW TO EXTEND THE PARSER

### Adding a New Phantom Line Pattern

1. Identify the exact text format from a real report sample.
2. Write a regex that matches it but does NOT match real creditor names.
3. Test: does `KNOWN_CREDITORS` list contain any entries that would match your regex?
4. Add to the appropriate list:
   - **Boilerplate/noise**: `BOILERPLATE_ACCOUNT_PATTERNS` in `accountSignals.ts`
   - **Definitely-not-creditor**: `DEFINITELY_NOT_CREDITOR` in `creditorDetector.ts`
   - **AI prohibition**: Add to the `"ABSOLUTE PROHIBITIONS"` section of `buildSystemPrompt()` in `aiEnhancer.ts`

### Adding a New Known Creditor

Add to `KNOWN_CREDITORS` array in `creditorDetector.ts` (exact uppercase string).
Example: `'AVANT FINANCIAL'`, `'ONEMAIN FINANCIAL'`.

### Adding a New Negative Status

1. Add to `NEGATIVE_STATUS_KEYWORDS` in `heuristicParser.ts` (string, lowercase).
2. Add to `NEGATIVE_SIGNAL_PATTERNS` in `accountSignals.ts` (regex).
3. If it should map directly to a type, add to `APPROVED_NEGATIVE_STATUSES` in `postValidator.ts`
   and `STATUS_TO_NEGATIVE_TYPE` mapping.
4. If it requires fuzzy matching, add a `FUZZY_STATUS_RULES` entry in `postValidator.ts`.

### Adding a New Bureau

1. Add detection pattern to `detectReportBureaus()` in `accountSignals.ts`.
2. Add normalization case to `normalizeBureaus()` in `postValidator.ts`.
3. Add bureau-specific section header patterns to `NEGATIVE_SECTION_HEADERS` in `heuristicParser.ts`.
4. Add bureau-specific field extraction patterns to `FIELD_PATTERNS` in `heuristicParser.ts` if the format differs.

### Improving DOFD Extraction

The DOFD (Date of First Delinquency) is the most critical date in the report. To improve
extraction:

1. Add new DOFD label patterns to `FIELD_PATTERNS.dateOfFirstDelinquency` in `heuristicParser.ts`.
2. Update the AI system prompt to add the new label format to its extraction guidance.
3. Add the label to the AI's `"DOFD — extract precisely"` instruction.

### Adding New Section Types

1. Add `SectionType` value to `types.ts`.
2. Add detection pattern to `SECTION_PATTERNS` in `textNormalizer.ts`.
3. If the section contains negative items, add the header to `NEGATIVE_SECTION_HEADERS`
   in `heuristicParser.ts`.

---

## 17. PARSER ACCURACY BENCHMARKS & TARGETS

### Current Performance Targets (v4.0.0)

| Metric | Target | Method |
|---|---|---|
| Precision (no phantom lines) | ≥ 95% | `rejectedLines` audit per test case |
| Recall (no missed negative items) | ≥ 90% | Manual comparison vs known items |
| DOFD extraction rate | ≥ 80% | `dateOfFirstDelinquency` non-null rate |
| Bureau detection accuracy | ≥ 98% | `creditBureau[]` matches expected |
| Processing time (3-bureau ACR, PDF) | ≤ 30s | `processingTimeMs` in result |
| Processing time (paste input) | ≤ 15s | `processingTimeMs` in result |
| AI-assisted vs heuristic-only | ≥ 80% AI | `parseMethod !== "heuristic_only"` rate |

### `parseConfidence` Distribution Targets

| Range | Expected % of Items | Meaning |
|---|---|---|
| 0.90–1.00 | ≥ 50% | High confidence — known creditor, full field set |
| 0.70–0.89 | ≥ 35% | Medium confidence — unknown creditor but complete data |
| 0.50–0.69 | ≤ 10% | Low confidence — needs user review |
| 0.00–0.49 | ≤ 5% | Very low — flag for manual verification |

### Known Precision Killers (Track These)

1. **New ACR format changes** — AnnualCreditReport.com updates its HTML export format
   periodically. New field rendering positions break existing field extraction patterns.
   Monitor by checking `rejectedLines` for patterns not covered by any existing rule.

2. **AI provider hallucination** — AI occasionally invents plausible-sounding creditor
   names ("National Financial Services") or constructs balance amounts that weren't in
   the text. Detected by: `aiConfidence < 0.6` on items where creditorName is generic.
   Fix: Add the hallucinated patterns to the AI prohibition list and `DEFINITELY_NOT_CREDITOR`.

3. **Multi-consumer reports** — Some users paste reports for a spouse or co-borrower.
   The `personalInfoExtractor` only extracts the primary consumer. Second consumer's
   accounts may be included or excluded incorrectly.

---

*Document version: April 28, 2026 — DylandOs Ultimate Credit Repair Suite v4.0.0*
*Parser directory: `src/services/creditReportParser/`*
*For the full application technical manifest, see `TECHNICAL_MANIFEST.md`.*
