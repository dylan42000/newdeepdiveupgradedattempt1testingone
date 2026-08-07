/**
 * placeholderService.ts — World-Class Placeholder Registry & Smart Fill Engine
 *
 * Resolves EVERY generic placeholder an AI model or template might emit in a
 * dispute letter, pulling values from:
 *   1. personalInfo  (consumer profile)
 *   2. NegativeItem  (account-level data)
 *   3. contacts      (address book — saved bureau/furnisher addresses)
 *   4. furnisherAddresses built-in DB (fallback bureau lookup)
 *   5. runtime context (today's date, round number, etc.)
 *
 * After calling smartFillLetter() you get back:
 *   - `filled`       : the fully-resolved letter string
 *   - `autoFilled`   : list of every replacement that was made automatically
 *   - `remaining`    : list of placeholders that still need a human value
 *   - `isComplete`   : true if zero unfilled required placeholders remain
 */

import { NegativeItem } from "../types";
import type { PersonalInfo, Contact } from "../context/AppContext";
import { BUREAU_DISPUTE_ADDRESSES, findFurnisherAddress } from "../data/furnisherAddresses";
import { maskAccountNumber } from "./letterTemplateService";

const BRACKET_TOKEN_PATTERN = String.raw`\[[A-Za-z][A-Za-z0-9 _/'()\-]{1,80}\]`;
const MUSTACHE_TOKEN_PATTERN = String.raw`\{\{[A-Za-z][A-Za-z0-9 _\-]{1,80}\}\}`;

function bracketTokenRegex(): RegExp {
  return new RegExp(BRACKET_TOKEN_PATTERN, "g");
}

function mustacheTokenRegex(): RegExp {
  return new RegExp(MUSTACHE_TOKEN_PATTERN, "g");
}

// ─── Placeholder field descriptor ─────────────────────────────────────────────

export type PlaceholderSource =
  | "profile"          // from personalInfo
  | "item"             // from the NegativeItem being disputed
  | "bureau_address"   // from contacts / furnisher DB
  | "date"             // today's date or computed date
  | "manual";          // no automatic source — user must supply

export interface PlaceholderField {
  /** Internal key, unique across registry */
  key: string;
  /** Human-readable label shown in the review panel */
  label: string;
  /**
   * All bracket/brace patterns that the AI or templates might emit.
   * Always case-insensitive. Sorted broadest → most specific so the first
   * match per region is the most likely winner.
   */
  patterns: RegExp[];
  source: PlaceholderSource;
  /** If true, an unfilled placeholder is an ERROR (not just a warning) */
  required: boolean;
  /** Where to go inside the app to fill this field */
  fillPath?: string;
  /** Short example shown in the review panel */
  example: string;
}

// ─── Registry ─────────────────────────────────────────────────────────────────
// Each entry covers every variant we've seen emitted by GPT-4, Gemini, Groq, or
// legacy templates.  Patterns are intentionally broad — better to over-match
// than leave a raw bracket in a mailed letter.

export const PLACEHOLDER_REGISTRY: PlaceholderField[] = [
  // ── Consumer identity ────────────────────────────────────────────────────
  {
    key: "consumer_name",
    label: "Consumer Full Name",
    patterns: [
      /\[(?:YOUR\s+)?(?:FULL\s+)?(?:LEGAL\s+)?NAME\]/gi,
      /\[CONSUMER(?:\s+FULL)?\s+NAME\]/gi,
      /\[PRINT(?:ED)?\s+NAME\]/gi,
      /\{\{(?:FULL_?)?NAME\}\}/gi,
      /\[YOUR_NAME\]/gi,
      /\[CONSUMER\]/gi,
    ],
    source: "profile",
    required: true,
    fillPath: "profile",
    example: "Jane A. Smith",
  },
  {
    key: "consumer_first_name",
    label: "Consumer First Name",
    patterns: [
      /\[FIRST\s+NAME\]/gi,
      /\[CONSUMER\s+FIRST(?:\s+NAME)?\]/gi,
      /\{\{FIRST_?NAME\}\}/gi,
    ],
    source: "profile",
    required: false,
    fillPath: "profile",
    example: "Jane",
  },
  {
    key: "consumer_last_name",
    label: "Consumer Last Name",
    patterns: [
      /\[LAST\s+NAME\]/gi,
      /\[CONSUMER\s+LAST(?:\s+NAME)?\]/gi,
      /\{\{LAST_?NAME\}\}/gi,
    ],
    source: "profile",
    required: false,
    fillPath: "profile",
    example: "Smith",
  },
  {
    key: "consumer_address",
    label: "Consumer Mailing Address",
    patterns: [
      /\[(?:YOUR\s+)?(?:MAILING\s+|CURRENT\s+|HOME\s+)?ADDRESS\]/gi,
      /\[CONSUMER(?:'S)?\s+ADDRESS\]/gi,
      /\[STREET\s+ADDRESS\]/gi,
      /\{\{ADDRESS\}\}/gi,
      /\[YOUR_ADDRESS\]/gi,
    ],
    source: "profile",
    required: true,
    fillPath: "profile",
    example: "123 Main St, Atlanta, GA 30301",
  },
  {
    key: "consumer_city_state_zip",
    label: "Consumer City, State ZIP",
    patterns: [
      /\[CITY,?\s+STATE(?:\s+ZIP(?:\s+CODE)?)?\]/gi,
      /\[CITY_STATE_ZIP\]/gi,
      /\{\{CITY_STATE_ZIP\}\}/gi,
    ],
    source: "profile",
    required: false,
    fillPath: "profile",
    example: "Atlanta, GA 30301",
  },
  {
    key: "consumer_phone",
    label: "Consumer Phone",
    patterns: [
      /\[(?:YOUR\s+)?(?:PHONE|TELEPHONE|PHONE\s+NUMBER)\]/gi,
      /\[CONSUMER\s+PHONE\]/gi,
      /\{\{PHONE\}\}/gi,
    ],
    source: "profile",
    required: false,
    fillPath: "profile",
    example: "(404) 555-1234",
  },
  {
    key: "consumer_email",
    label: "Consumer Email",
    patterns: [
      /\[(?:YOUR\s+)?E-?MAIL(?:\s+ADDRESS)?\]/gi,
      /\[CONSUMER\s+E-?MAIL\]/gi,
      /\{\{EMAIL\}\}/gi,
    ],
    source: "profile",
    required: false,
    fillPath: "profile",
    example: "jane.smith@email.com",
  },
  {
    key: "consumer_ssn",
    label: "SSN (Last 4 only)",
    patterns: [
      /\[(?:LAST\s+4(?:\s+OF)?\s+)?SSN(?:\s+LAST\s+4)?\]/gi,
      /\[SOCIAL\s+SECURITY(?:\s+NUMBER)?\]/gi,
      /\[SS#\]/gi,
      /\{\{SSN\}\}/gi,
    ],
    source: "profile",
    required: false,
    fillPath: "profile",
    example: "XXX-XX-1234",
  },
  {
    key: "consumer_dob",
    label: "Date of Birth",
    patterns: [
      /\[(?:DATE\s+OF\s+BIRTH|DOB|BIRTH(?:\s+DATE)?)\]/gi,
      /\{\{DOB\}\}/gi,
    ],
    source: "profile",
    required: false,
    fillPath: "profile",
    example: "01/15/1985",
  },

  // ── Bureau / recipient ────────────────────────────────────────────────────
  {
    key: "bureau_name",
    label: "Bureau / Target Name",
    patterns: [
      /\[(?:CREDIT\s+)?BUREAU(?:\s+NAME)?\]/gi,
      /\[TARGET(?:\s+BUREAU)?\]/gi,
      /\[BUREAU_NAME\]/gi,
      /\{\{BUREAU\}\}/gi,
      /\[FURNISHER(?:\s+NAME)?\]/gi,
      /\[CREDITOR(?:\s+NAME)?\]/gi,
      /\[RECIPIENT(?:\s+NAME)?\]/gi,
    ],
    source: "bureau_address",
    required: true,
    fillPath: "address-lookup",
    example: "Equifax",
  },
  {
    key: "bureau_address",
    label: "Bureau / Furnisher Mailing Address",
    patterns: [
      /\[(?:CREDIT\s+)?BUREAU(?:\s+MAILING)?\s+ADDRESS\]/gi,
      /\[BUREAU_ADDRESS\]/gi,
      /\[(?:FURNISHER|CREDITOR|RECIPIENT)(?:\s+MAILING)?\s+ADDRESS\]/gi,
      /\[TARGET\s+ADDRESS\]/gi,
      /\{\{BUREAU_ADDRESS\}\}/gi,
    ],
    source: "bureau_address",
    required: true,
    fillPath: "address-lookup",
    example: "Equifax Information Services\nPO Box 740256\nAtlanta, GA 30374",
  },

  // ── Account / tradeline ───────────────────────────────────────────────────
  {
    key: "account_name",
    label: "Account / Creditor Name",
    patterns: [
      /\[ACCOUNT(?:\s+NAME)?\]/gi,
      /\[ACCOUNT_NAME\]/gi,
      /\{\{ACCOUNT_NAME\}\}/gi,
    ],
    source: "item",
    required: true,
    example: "LVNV Funding LLC",
  },
  {
    key: "account_number",
    label: "Account Number",
    patterns: [
      /\[ACCOUNT(?:\s+NUMBER|#|NO\.?)\]/gi,
      /\[ACCT(?:\s+#|\s+NUMBER|NO\.?)?\]/gi,
      /\[ACCOUNT_NUMBER\]/gi,
      /\{\{ACCOUNT_NUMBER\}\}/gi,
    ],
    source: "item",
    required: false,
    example: "XXXX-XXXX-1234",
  },
  {
    key: "account_balance",
    label: "Account Balance",
    patterns: [
      /\[(?:ACCOUNT\s+)?BALANCE\]/gi,
      /\[AMOUNT\s+(?:OWED|DUE|REPORTED)\]/gi,
      /\[BALANCE_AMOUNT\]/gi,
      /\{\{BALANCE\}\}/gi,
    ],
    source: "item",
    required: false,
    example: "$4,820",
  },
  {
    key: "account_type",
    label: "Account / Debt Type",
    patterns: [
      /\[(?:ACCOUNT|DEBT)\s+TYPE\]/gi,
      /\[TYPE\s+OF\s+(?:ACCOUNT|DEBT|NEGATIVE)\]/gi,
      /\{\{ACCOUNT_TYPE\}\}/gi,
    ],
    source: "item",
    required: false,
    example: "Collection",
  },
  {
    key: "dofd",
    label: "Date of First Delinquency",
    patterns: [
      /\[(?:DATE\s+OF\s+FIRST\s+DELINQUENCY|DOFD)\]/gi,
      /\[FIRST\s+DELINQUENCY(?:\s+DATE)?\]/gi,
      /\{\{DOFD\}\}/gi,
    ],
    source: "item",
    required: false,
    example: "March 2019",
  },
  {
    key: "original_creditor",
    label: "Original Creditor",
    patterns: [
      /\[ORIGINAL\s+CREDITOR(?:\s+NAME)?\]/gi,
      /\{\{ORIGINAL_CREDITOR\}\}/gi,
    ],
    source: "item",
    required: false,
    example: "Capital One",
  },

  // ── Date / time ───────────────────────────────────────────────────────────
  {
    key: "today_date",
    label: "Today's Date",
    patterns: [
      /\[(?:TODAY(?:'S)?\s+)?DATE\]/gi,
      /\[CURRENT\s+DATE\]/gi,
      /\[DATE_TODAY\]/gi,
      /\{\{DATE\}\}/gi,
      /\{\{TODAY\}\}/gi,
    ],
    source: "date",
    required: false,
    example: "April 15, 2026",
  },
  {
    key: "response_deadline",
    label: "Response Deadline (30 days from today)",
    patterns: [
      /\[(?:RESPONSE\s+)?DEADLINE(?:\s+DATE)?\]/gi,
      /\[30[- ]DAY\s+DEADLINE\]/gi,
      /\{\{DEADLINE\}\}/gi,
    ],
    source: "date",
    required: false,
    example: "May 15, 2026",
  },

  // ── Round / campaign ──────────────────────────────────────────────────────
  {
    key: "dispute_round",
    label: "Dispute Round Number",
    patterns: [
      /\[ROUND(?:\s+NUMBER)?\]/gi,
      /\[DISPUTE\s+ROUND\]/gi,
      /\{\{ROUND\}\}/gi,
    ],
    source: "manual",
    required: false,
    example: "2",
  },

  // ── Goodwill / negotiation ────────────────────────────────────────────────
  {
    key: "goodwill_reason",
    label: "Reason for Goodwill Request",
    patterns: [
      /\[REASON(?:\s+FOR\s+(?:LATE\s+PAYMENT|HARDSHIP|DIFFICULTY))?\]/gi,
      /\[HARDSHIP(?:\s+REASON)?\]/gi,
      /\[EXTENUATING\s+CIRCUMSTANCE(?:S)?\]/gi,
      /\{\{REASON\}\}/gi,
    ],
    source: "manual",
    required: false,
    example: "a medical emergency / unexpected job loss",
  },
  {
    key: "settlement_amount",
    label: "Settlement / Pay-for-Delete Amount",
    patterns: [
      /\[(?:SETTLEMENT|OFFER)\s+AMOUNT\]/gi,
      /\[PAY(?:MENT)?\s+AMOUNT\]/gi,
      /\[AMOUNT\]/gi,
      /\{\{AMOUNT\}\}/gi,
    ],
    source: "manual",
    required: false,
    example: "$500",
  },

  // ── State / jurisdiction ──────────────────────────────────────────────────
  {
    key: "consumer_state",
    label: "Consumer State",
    patterns: [
      /\[STATE(?:\s+NAME)?\]/gi,
      /\[YOUR\s+STATE\]/gi,
      /\{\{STATE\}\}/gi,
    ],
    source: "profile",
    required: false,
    fillPath: "profile",
    example: "Georgia",
  },

  // ── Certified mail ────────────────────────────────────────────────────────
  {
    key: "certified_mail_number",
    label: "Certified Mail Tracking Number",
    patterns: [
      /\[CERTIFIED\s+MAIL(?:\s+(?:NUMBER|#|TRACKING(?:\s+NUMBER)?))?\]/gi,
      /\[TRACKING(?:\s+(?:NUMBER|#))?\]/gi,
      /\{\{TRACKING\}\}/gi,
    ],
    source: "manual",
    required: false,
    example: "9400 1000 0000 0000 0000 00",
  },
];

// ─── Value resolvers ───────────────────────────────────────────────────────────

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function maskedSSN(ssn: string): string {
  // Only ever put the last 4 in the letter
  const digits = ssn.replace(/\D/g, "");
  if (digits.length >= 4) return `XXX-XX-${digits.slice(-4)}`;
  return ssn || "XXX-XX-XXXX";
}

function normalizeLooseName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function contactMatchesTarget(contactName: string, target: string): boolean {
  const a = contactName.toLowerCase().trim();
  const b = target.toLowerCase().trim();
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) return true;
  const ta = normalizeLooseName(a)
    .split(" ")
    .filter((t) => t.length > 2);
  const tb = normalizeLooseName(b)
    .split(" ")
    .filter((t) => t.length > 2);
  if (ta.length === 0 || tb.length === 0) return false;
  return ta.some((t) => tb.includes(t)) || tb.some((t) => ta.includes(t));
}

function officialBureauLineAddress(bureauName: string): string | null {
  const nb = normalizeLooseName(bureauName);
  if (nb.length < 3) return null;
  const key = (Object.keys(BUREAU_DISPUTE_ADDRESSES) as string[]).find((k) => {
    const nk = normalizeLooseName(k);
    return nb.includes(nk) || nk.includes(nb.slice(0, Math.min(9, nb.length)));
  });
  if (!key) return null;
  return BUREAU_DISPUTE_ADDRESSES[key];
}

function lookupBureauAddress(
  bureauName: string,
  contacts: Contact[],
): string {
  if (!bureauName.trim()) return "";

  // 1. Saved contacts (fuzzy match — address book uses varied legal names)
  const saved = contacts.find((c) => contactMatchesTarget(c.name, bureauName));
  if (saved?.address) return saved.address;

  // 2. Built-in furnisher / creditor DB
  const dbEntry = findFurnisherAddress(bureauName);
  if (dbEntry) {
    return `${dbEntry.legalName}\n${dbEntry.disputeAddress}\n${dbEntry.city}, ${dbEntry.state} ${dbEntry.zip}`;
  }

  // 3. Hard-coded bureau PO boxes (Equifax / Experian / TransUnion name variants)
  const bureauLine = officialBureauLineAddress(bureauName);
  if (bureauLine) return bureauLine;

  return "";
}

function buildConsumerFullAddress(p: PersonalInfo): string {
  const lines = [
    p.address,
    `${p.city}, ${p.state} ${p.zip}`.trim(),
  ].filter((line) => Boolean(line?.trim()));
  return lines.join("\n");
}

// Removed duplicate local maskAccountNumber

function getBureauAddress(bureau: string): string {
  const addresses: Record<string, string> = {
    equifax: "Equifax Information Services LLC\nP.O. Box 740256\nAtlanta, GA 30374-0256",
    experian: "Experian\nP.O. Box 4500\nAllen, TX 75013",
    transunion: "TransUnion LLC\nConsumer Dispute Center\nP.O. Box 2000\nChester, PA 19016",
  };
  const key = bureau.toLowerCase().trim();
  return addresses[key] || bureau;
}

function replaceLiteralToken(content: string, token: string, value: string): string {
  if (!token) return content;
  return content.split(token).join(value);
}

function applyStrictTokenMaps(
  content: string,
  personalInfo: PersonalInfo,
  item: NegativeItem | null,
  bureauName: string,
  round: number,
): string {
  let filled = content;

  const consumerMap: Record<string, string> = {
    '{{CONSUMER_NAME}}': `${personalInfo.firstName || ''} ${personalInfo.lastName || ''}`.trim(),
    '{{FULL_NAME}}': `${personalInfo.firstName || ''} ${personalInfo.lastName || ''}`.trim(),
    '{{FIRST_NAME}}': personalInfo.firstName || '',
    '{{LAST_NAME}}': personalInfo.lastName || '',
    '{{SENDER_NAME}}': `${personalInfo.firstName || ''} ${personalInfo.lastName || ''}`.trim(),
    '{{ADDRESS}}': personalInfo.address || '',
    '{{ADDRESS_LINE_1}}': personalInfo.address || '',
    '{{ADDRESS_LINE_2}}': '',
    '{{CITY}}': personalInfo.city || '',
    '{{STATE}}': personalInfo.state || '',
    '{{ZIP}}': personalInfo.zip || '',
    '{{ZIP_CODE}}': personalInfo.zip || '',
    '{{CITY_STATE_ZIP}}': `${personalInfo.city || ''}, ${personalInfo.state || ''} ${personalInfo.zip || ''}`.trim(),
    '{{FULL_ADDRESS}}': buildConsumerFullAddress(personalInfo),
    '{{PHONE}}': personalInfo.phone || '',
    '{{CONSUMER_PHONE}}': personalInfo.phone || '',
    '{{EMAIL}}': personalInfo.email || '',
    '{{CONSUMER_EMAIL}}': personalInfo.email || '',
    '{{DOB}}': personalInfo.dob || '',
    '{{DATE_OF_BIRTH}}': personalInfo.dob || '',
    '{{SSN_LAST_4}}': personalInfo.ssn ? `XXX-XX-${personalInfo.ssn.replace(/\D/g, '').slice(-4)}` : '',
  };

  const creditorMap: Record<string, string> = {
    '{{CREDITOR_NAME}}': item?.creditorName || '',
    '{{CREDITOR}}': item?.creditorName || '',
    '{{ACCOUNT_NUMBER}}': maskAccountNumber(item?.accountNumber, item),
    '{{ACCOUNT_NO}}': maskAccountNumber(item?.accountNumber, item),
    '{{BALANCE}}': item?.balance != null ? `$${item.balance.toLocaleString()}` : '',
    '{{ACCOUNT_BALANCE}}': item?.balance != null ? `$${item.balance.toLocaleString()}` : '',
    '{{ACCOUNT_STATUS}}': item?.status || '',
    '{{ITEM_TYPE}}': item?.typeOfNegative || '',
    '{{NEGATIVE_TYPE}}': item?.typeOfNegative || '',
    '{{DATE_OPENED}}': item?.dateOpened || item?.originalOpeningDate || '',
    '{{DATE_OF_DELINQUENCY}}': item?.originalDateOfDelinquency || item?.dateOfFirstDelinquency || '',
    '{{DOFD}}': item?.originalDateOfDelinquency || item?.dateOfFirstDelinquency || '',
    '{{AUTO_REMOVAL_DATE}}': item?.autoRemovalDate || '',
    '{{ORIGINAL_CREDITOR}}': item?.originalCreditor || item?.creditorName || '',
    '{{FURNISHER}}': item?.furnisher || item?.creditorName || '',
  };

  const inferredBureau = bureauName || item?.creditBureau?.[0] || '';
  const bureauMap: Record<string, string> = {
    '{{BUREAU_NAME}}': inferredBureau,
    '{{BUREAU}}': inferredBureau,
    '{{BUREAU_ADDRESS}}': getBureauAddress(inferredBureau),
    '{{DISPUTE_ROUND}}': String(round || 1),
    '{{ROUND_NUMBER}}': String(round || 1),
    '{{TODAY_DATE}}': new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    '{{FCRA_DEADLINE}}': item?.disputeDeadline || '',
  };

  for (const [token, value] of Object.entries(consumerMap)) {
    filled = replaceLiteralToken(filled, token, value);
  }
  for (const [token, value] of Object.entries(creditorMap)) {
    filled = replaceLiteralToken(filled, token, value);
  }
  for (const [token, value] of Object.entries(bureauMap)) {
    filled = replaceLiteralToken(filled, token, value);
  }

  return filled;
}

/**
 * Resolve the auto-fill value for a given placeholder field, given available context.
 */
function resolveValue(
  field: PlaceholderField,
  personalInfo: PersonalInfo,
  item: NegativeItem | null,
  bureauName: string,
  contacts: Contact[],
  round: number,
): string | null {
  const today = new Date();

  switch (field.key) {
    // ── Profile ──────────────────────────────────────────────────────────────
    case "consumer_name": {
      const n = `${personalInfo.firstName ?? ""} ${personalInfo.lastName ?? ""}`.trim();
      return n || null;
    }
    case "consumer_first_name":
      return personalInfo.firstName || null;
    case "consumer_last_name":
      return personalInfo.lastName || null;
    case "consumer_address": {
      const parts = [
        personalInfo.address,
        [personalInfo.city, personalInfo.state, personalInfo.zip].filter(Boolean).join(", "),
      ].filter(Boolean);
      return parts.length ? parts.join("\n") : null;
    }
    case "consumer_city_state_zip": {
      const parts = [personalInfo.city, personalInfo.state, personalInfo.zip].filter(Boolean);
      return parts.length ? parts.join(", ") : null;
    }
    case "consumer_phone":
      return personalInfo.phone || null;
    case "consumer_email":
      return personalInfo.email || null;
    case "consumer_ssn":
      return personalInfo.ssn ? maskedSSN(personalInfo.ssn) : null;
    case "consumer_dob":
      return personalInfo.dob || null;
    case "consumer_state":
      return personalInfo.state || null;

    // ── Bureau / target ──────────────────────────────────────────────────────
    case "bureau_name":
      return bureauName || null;
    case "bureau_address": {
      const addr = lookupBureauAddress(bureauName, contacts);
      return addr || null;
    }

    // ── Account data ──────────────────────────────────────────────────────────
    case "account_name":
      return item?.creditorName || null;
    case "account_number": {
      if (!item) return null;
      return maskAccountNumber(item.accountNumber, item);
    }
    case "account_balance":
      return item?.balance != null ? `$${item.balance.toLocaleString()}` : null;
    case "account_type":
      return item?.typeOfNegative || item?.accountType || null;
    case "dofd": {
      const d = item?.originalDateOfDelinquency || item?.dateOfFirstDelinquency;
      if (!d) return null;
      try {
        return new Date(d).toLocaleDateString("en-US", { month: "long", year: "numeric" });
      } catch { return d; }
    }
    case "original_creditor":
      return item?.originalCreditor || null;

    // ── Date ──────────────────────────────────────────────────────────────────
    case "today_date":
      return formatDate(today);
    case "response_deadline": {
      const deadline = new Date(today);
      deadline.setDate(deadline.getDate() + 30);
      return formatDate(deadline);
    }

    // ── Round ─────────────────────────────────────────────────────────────────
    case "dispute_round":
      return String(round || 1);

    // ── Manual fields (can't auto-resolve) ────────────────────────────────────
    default:
      return null;
  }
}

// ─── Core smart fill function ──────────────────────────────────────────────────

export interface AutoFilledField {
  key: string;
  label: string;
  placeholder: string;  // the raw token that was replaced
  value: string;
}

export interface RemainingField {
  key: string;
  label: string;
  placeholder: string;  // the raw token still in the letter
  required: boolean;
  hint: string;
  fillPath?: string;
}

export interface SmartFillResult {
  filled: string;
  autoFilled: AutoFilledField[];
  remaining: RemainingField[];
  isComplete: boolean;
  /** Raw set of unresolved token strings still in the letter */
  unresolvedTokens: string[];
}

/**
 * Scan `letterContent` for ALL registered placeholder patterns, resolve what
 * we can from context, and return the filled letter plus a detailed report.
 *
 * Safe to call multiple times — idempotent on an already-filled letter.
 */
export function smartFillLetter(
  letterContent: string,
  personalInfo: PersonalInfo,
  item: NegativeItem | null,
  bureauName: string,
  contacts: Contact[],
  round: number = 1,
): SmartFillResult {
  if (!personalInfo?.firstName?.trim()) {
    console.error(
      '[placeholderService] CRITICAL: personalInfo is missing firstName; sender block tokens may be blank. Ensure AutoPilot passes profile data from AppContext.'
    );
  }

  let filled = applyStrictTokenMaps(letterContent, personalInfo, item, bureauName, round);
  const autoFilled: AutoFilledField[] = [];
  const remaining: RemainingField[] = [];

  for (const field of PLACEHOLDER_REGISTRY) {
    const value = resolveValue(field, personalInfo, item, bureauName, contacts, round);

    for (const pattern of field.patterns) {
      // Find all matches first so we can record what was replaced
      const matches = [...filled.matchAll(new RegExp(pattern.source, "gi"))];
      if (matches.length === 0) continue;

      if (value) {
        // Replace all occurrences
        matches.forEach((m) => {
          autoFilled.push({
            key: field.key,
            label: field.label,
            placeholder: m[0],
            value,
          });
        });
        filled = filled.replace(new RegExp(pattern.source, "gi"), value);
      } else {
        // Can't resolve — record as remaining
        matches.forEach((m) => {
          // Avoid duplicate entries for the same key
          if (!remaining.some((r) => r.key === field.key)) {
            remaining.push({
              key: field.key,
              label: field.label,
              placeholder: m[0],
              required: field.required,
              hint: `Provide ${field.label}. Example: "${field.example}"`,
              fillPath: field.fillPath,
            });
          }
        });
      }
    }
  }

  // Final sweep: find any remaining bracket/brace tokens we don't have registered
  const unknownBracketTokens = [...filled.matchAll(bracketTokenRegex())].map((m) => m[0]);
  const unknownMustacheTokens = [...filled.matchAll(mustacheTokenRegex())].map((m) => m[0]);
  const unresolved = [...new Set([...unknownBracketTokens, ...unknownMustacheTokens])];

  return {
    filled,
    autoFilled,
    remaining,
    isComplete: remaining.filter((r) => r.required).length === 0 && unresolved.length === 0,
    unresolvedTokens: unresolved,
  };
}

/**
 * Quick utility: does this letter still contain any raw placeholders?
 */
export function hasUnfilledPlaceholders(content: string): boolean {
  return bracketTokenRegex().test(content) || mustacheTokenRegex().test(content);
}

/**
 * Scan a letter and return all unique unfilled bracket tokens — for quick
 * validation before the user clicks SEND.
 */
export function scanForUnfilledTokens(content: string): string[] {
  return [...new Set([
    ...[...content.matchAll(bracketTokenRegex())].map((m) => m[0]),
    ...[...content.matchAll(mustacheTokenRegex())].map((m) => m[0]),
  ])];
}
