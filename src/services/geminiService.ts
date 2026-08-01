/**
 * AI Service — Multi-provider router (Groq → Gemini → Cloudflare → OpenAI)
 * All public function signatures unchanged — no other files need modification.
 * Configure keys at Settings → AI Configuration.
 */

import { NegativeItem, LetterTemplateType, DisputeRound } from "../types";
import { v4 as uuidv4 } from "uuid";
import {
  aiComplete,
  routeAIRequest,
  routeAIRequestFast,
  getGroqApiKey,
  setGroqApiKey,
  GROQ_PRIMARY_MODEL,
  type AIMessage,
} from "./aiRouter";
import { apiQueueManager } from "./apiQueueManager";
import { stripLetterBodyPreamble } from "./letterBodySanitizer";

// Re-export key helpers so existing Settings page callers don't break
export { getGroqApiKey, setGroqApiKey };

// ─── Internal chat wrapper (routes through aiRouter) ──────────────────────────

const MODEL_MAIN = GROQ_PRIMARY_MODEL;
const FACT_ONLY_OPENING_RULE = `FIRST PARAGRAPH RULE: You are strictly forbidden from citing any law, statute, section number, FCRA provision, or U.S.C. code in the opening paragraph. Do not use "Pursuant," "15 U.S.C.," "FCRA," or the "§" symbol there. The first paragraph must contain only the factual account narrative: creditor/furnisher, masked account number, reported balance, status, dates, and the specific disputed error. Begin legal citations in paragraph 2.`;

const DISPUTE_LETTER_SYSTEM_PROMPT = `You are an expert consumer credit compliance writer drafting a formal dispute demand.

${FACT_ONLY_OPENING_RULE}

TONE AND STYLE MANDATE:
- No introductory pleasantries, greetings, or sign-offs.
- Professional court-grade language with concrete account facts.
- Never begin with "Pursuant," "I am writing," "This letter," or a legal citation.
- Output ONLY the letter BODY narrative — the app template already adds sender identity, recipient address, date, RE line, salutation, and signature.
- Do NOT print the consumer name/address/phone/email/DOB/SSN block.
- Do NOT print bureau/furnisher address blocks or placeholders like "[Experian Address]".
- Do NOT output markdown fences or explanations.`;

function buildFactOnlyOpening(
  negativeItems: NegativeItem[],
  bureau: string,
): string {
  const item = negativeItems[0];
  if (!item) {
    return `The information currently reported by ${bureau} contains disputed account details that require correction or documented verification.`;
  }

  const tail = (item.accountNumber || '').replace(/\D/g, '').slice(-4);
  const details = [
    `${item.creditorName || 'The reported creditor'} account${tail ? ` ending in ${tail}` : ''}`,
    item.typeOfNegative ? `listed as ${item.typeOfNegative}` : '',
    item.balance != null ? `with a reported balance of $${item.balance.toLocaleString()}` : '',
    item.status ? `and a reported status of ${item.status}` : '',
  ].filter(Boolean).join(' ');
  const additional = item.additionalInfo?.trim();

  return `${details} contains information that is inaccurate, incomplete, or unsupported by the records available to me.${additional ? ` The disputed reporting includes: ${additional}.` : ''}`;
}

function enforceFactOnlyOpening(
  content: string,
  negativeItems: NegativeItem[],
  bureau: string,
): string {
  const trimmed = content.trim();
  const paragraphs = trimmed.split(/\n\s*\n/);
  const firstBodyIndex = paragraphs.findIndex(
    (paragraph) => paragraph.trim() && !/^(?:\*{0,2})?re\s*:/i.test(paragraph.trim()),
  );
  const paragraphIndex = firstBodyIndex >= 0 ? firstBodyIndex : 0;
  const firstParagraph = paragraphs[paragraphIndex] ?? '';
  const containsLaw = /\bpursuant\b|§|\b(?:15\s+)?u\.?\s*s\.?\s*c\.?\b|\bFCRA\b|\bFair Credit Reporting Act\b|\bstatut(?:e|ory)\b/i
    .test(firstParagraph);

  if (!containsLaw) return trimmed;
  const factualOpening = buildFactOnlyOpening(negativeItems, bureau);
  if (paragraphs.length === 1) {
    return `${factualOpening}\n\n${trimmed}`;
  }
  paragraphs[paragraphIndex] = factualOpening;
  return paragraphs.join('\n\n');
}

/**
 * All Groq calls use the same production model. Small max-token / JSON jobs use
 * the lean path (lower default cap) while long letters use the full request cap.
 */
async function groqChat(
  messages: AIMessage[],
  _model: string = MODEL_MAIN,
  jsonMode: boolean = false,
  maxTokens: number = 4096,
  taskType?: 'parse' | 'letter' | 'analyze',
  providerScope?: 'all' | 'groq-gemini-only'
): Promise<string> {
  const useLean = maxTokens <= 800;
  if (useLean) {
    return routeAIRequestFast(messages, { jsonMode, maxTokens, taskType, providerScope });
  }
  return routeAIRequest(messages, { model: GROQ_PRIMARY_MODEL, jsonMode, maxTokens, taskType, providerScope });
}

// ─── Credit Report Parser ─────────────────────────────────────────────────────
function computeAutoRemoval(dofd: string | null | undefined): string | null {
  if (!dofd) return null;
  try {
    const d = new Date(dofd);
    if (isNaN(d.getTime())) return null;
    d.setFullYear(d.getFullYear() + 7);
    return d.toISOString().split("T")[0];
  } catch { return null; }
}

function normalizeAccountForMatch(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/[^0-9X\*]/gi, "").toUpperCase();
}

// ─── Credit Report Parser — system prompt (AI-routed, task: 'parse') ─────────
const CREDIT_REPORT_PARSER_PROMPT = `You are a world-class credit report data extraction specialist.
Parse the following credit report text and extract ALL negative items, derogatories, bankruptcies, collections, and charge-offs into a JSON array.

IMPORTANT: You must recognize non-standard codes! "CO" means Charge-Off. "30/60/90" indicates late payments. "Cbl/Cbt" means Bankruptcy. "Transferred" or "Purchased" often indicate collections. DO NOT skip these.

For EACH item, extract:
{
  "creditor": "string",
  "accountNumber": "string (leave empty if none)",
  "balance": "number (integers only, no $ or commas)",
  "originalBalance": "number",
  "type": "Collection | Charge-Off | Late Payment | Bankruptcy | Judgment | Inquiry | Other Derogatory",
  "accountType": "string",
  "paymentStatus": "string (the exact status text, e.g., 'Transferred to collection')",
  "bureau": "Equifax | Experian | TransUnion",
  "dateOpened": "YYYY-MM-DD",
  "dateOfFirstDelinquency": "YYYY-MM-DD"
}

CRITICAL RULES:
1. DOFD is paramount for the 7-year FCRA rule. If explicitly missing, infer it from the first missed payment. If unfindable, return null. NEVER use the collection agency's dateOpened.
2. Return ONLY a valid JSON array starting with [ and ending with ].
3. If NO negative items are found, return exactly: []
4. The "creditor" field MUST be the actual name of the bank or collection agency. DO NOT use payment history (e.g., "30 60 90 CO"), account statuses (e.g., "Purchased by another lender"), or summary data (e.g., "Total Months") as the creditor name.`;

/**
 * Preprocess raw credit report text for better AI extraction.
 * Cleans OCR artifacts, normalizes whitespace, removes page headers/footers.
 */
function preprocessReportText(raw: string): string {
  let text = raw;
  // Remove common PDF artifacts
  text = text.replace(/\f/g, '\n'); // form feeds
  text = text.replace(/Page \d+ of \d+/gi, ''); // page numbers
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n'); // normalize newlines
  // Remove repeated header/footer patterns (credit report headers that repeat on every page)
  text = text.replace(/(CREDIT REPORT|CONSUMER CREDIT FILE|PERSONAL CREDIT REPORT).*?\n/gi, (m, _, offset) => offset < 200 ? m : '');
  // Collapse 3+ blank lines to 2
  text = text.replace(/\n{3,}/g, '\n\n');
  // Normalize common OCR issues
  text = text.replace(/[""]/g, '"').replace(/['']/g, "'");
  // Remove null bytes and other binary artifacts
  text = text.replace(/\x00/g, '');
  return text.trim();
}

function chunkText(input: string, maxLen = 4000): string[] {
  if (input.length <= maxLen) return [input];
  const chunks: string[] = [];
  let cursor = 0;
  const overlap = 800; // Keep overlap to avoid splitting items across chunks
  while (cursor < input.length) {
    let end = Math.min(cursor + maxLen, input.length);
    // Find the best split point — prefer double newlines (between accounts)
    if (end < input.length) {
      const doubleNewline = input.lastIndexOf('\n\n', end);
      if (doubleNewline > cursor + 3000) {
        end = doubleNewline;
      } else {
        const newline = input.lastIndexOf('\n', end);
        if (newline > cursor + 1000) end = newline;
      }
    }
    chunks.push(input.slice(cursor, end));
    cursor = end - (end < input.length ? overlap : 0); // Overlap to catch split items
  }
  return chunks;
}

/**
 * Robustly parse a JSON array string returned by the AI.
 * Multi-strategy extraction: direct parse → boundary extraction → object stitching → regex fallback.
 * Never throws — returns [] on any unrecoverable failure.
 */
function safeJSONParse(text: string): any[] {
  // Strategy 1: Direct parse after basic cleanup
  try {
    let cleaned = text.replace(/```json/gi, '').replace(/```/gi, '').trim();

    const startIndex = cleaned.indexOf('[');
    const endIndex = cleaned.lastIndexOf(']');
    if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
      cleaned = cleaned.substring(startIndex, endIndex + 1);
    } else if (cleaned.includes('{')) {
      const objStart = cleaned.indexOf('{');
      const objEnd = cleaned.lastIndexOf('}');
      cleaned = `[${cleaned.substring(objStart, objEnd + 1)}]`;
    }

    // Strip control characters but preserve valid whitespace
    cleaned = cleaned.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "");
    // Fix common AI JSON mistakes: trailing commas before ] or }
    cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
    // Fix unescaped newlines inside strings
    cleaned = cleaned.replace(/"([^"]*)\n([^"]*)"/g, (_, a, b) => `"${a} ${b}"`);

    const result = JSON.parse(cleaned);
    if (Array.isArray(result)) return result;
    if (typeof result === 'object' && result !== null) return [result];
    return [];
  } catch (e) {
    // Strategy 2: Extract individual objects with brace counting
    try {
      const objects: any[] = [];
      let depth = 0;
      let objStart = -1;
      for (let i = 0; i < text.length; i++) {
        if (text[i] === '{') {
          if (depth === 0) objStart = i;
          depth++;
        } else if (text[i] === '}') {
          depth--;
          if (depth === 0 && objStart !== -1) {
            const objStr = text.substring(objStart, i + 1)
              .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
              .replace(/,\s*}/g, '}');
            try {
              objects.push(JSON.parse(objStr));
            } catch { /* skip malformed object */ }
            objStart = -1;
          }
        }
      }
      if (objects.length > 0) return objects;
    } catch { /* fallthrough */ }

    console.warn("[Parser] JSON recovery failed for chunk. Returning empty array.");
    return [];
  }
}

/**
 * Sanitize and validate a date string. Returns YYYY-MM-DD or null.
 */
function sanitizeDate(val: any): string | null {
  if (!val || typeof val !== 'string') return null;
  // Strip non-date characters
  let d = val.trim().replace(/[^0-9\-\/a-zA-Z]/g, '');
  if (!d) return null;

  // Try ISO format first
  const isoMatch = d.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const [, y, m, day] = isoMatch;
    const yr = parseInt(y);
    if (yr >= 2000 && yr <= 2030) return `${y}-${m.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Try MM/DD/YYYY or M/D/YYYY
  const usMatch = d.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (usMatch) {
    const [, m, day, y] = usMatch;
    const yr = parseInt(y);
    if (yr >= 2000 && yr <= 2030) return `${y}-${m.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Try Mon DD, YYYY or DD-Mon-YYYY
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
  };
  const namedMatch = d.match(/([a-zA-Z]{3})\w*\s*(\d{1,2})\s*,?\s*(\d{4})/);
  if (namedMatch) {
    const [, mon, day, y] = namedMatch;
    const m = months[mon.toLowerCase().slice(0, 3)];
    const yr = parseInt(y);
    if (m && yr >= 2000 && yr <= 2030) return `${y}-${m}-${day.padStart(2, '0')}`;
  }

  // Try DD-Mon-YYYY
  const dmyMatch = d.match(/(\d{1,2})\s*[\/\-]?\s*([a-zA-Z]{3})\w*\s*[\/\-]?\s*(\d{4})/);
  if (dmyMatch) {
    const [, day, mon, y] = dmyMatch;
    const m = months[mon.toLowerCase().slice(0, 3)];
    const yr = parseInt(y);
    if (m && yr >= 2000 && yr <= 2030) return `${y}-${m}-${day.padStart(2, '0')}`;
  }

  return null;
}

/**
 * Sanitize a balance value: strip $, commas, convert to number or null.
 */
function sanitizeBalance(val: any): number | null {
  if (val === null || val === undefined || val === '' || val === 'N/A' || val === 'n/a') return null;
  if (typeof val === 'number') return isNaN(val) ? null : Math.round(val);
  const cleaned = String(val).replace(/[$,\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : Math.round(num);
}

/**
 * Validate and repair a single parsed item with post-processing.
 * Handles both the legacy field names (creditorName, typeOfNegative, creditBureau)
 * and the current prompt's field names (creditor, type, bureau, paymentStatus).
 * NEVER drops an item due to a type or status string mismatch — always falls back
 * to "Other Derogatory".
 */
function validateAndRepairItem(item: any): any | null {
  // ── Field name normalization (new prompt → legacy internal field names) ──────
  // Support both old and new prompt field naming so callers don't break.
  if (!item.creditorName && item.creditor) item.creditorName = item.creditor;
  if (!item.typeOfNegative && item.type) item.typeOfNegative = item.type;
  if (!item.status && item.paymentStatus) item.status = item.paymentStatus;
  if (item.creditBureau === undefined || item.creditBureau === null) {
    if (item.bureau) {
      item.creditBureau = Array.isArray(item.bureau) ? item.bureau : [item.bureau];
    }
  }
  // New prompt uses dateOfFirstDelinquency; map to originalDateOfDelinquency
  if (!item.originalDateOfDelinquency && item.dateOfFirstDelinquency) {
    item.originalDateOfDelinquency = item.dateOfFirstDelinquency;
  }

  // Must have at minimum a creditor name — only truly unrecoverable skip
  if (!item.creditorName || typeof item.creditorName !== 'string' || item.creditorName.trim().length < 2) {
    return null;
  }

  // Aggressive Garbage Collection for hallucinated creditor names
  const lowerName = item.creditorName.toLowerCase().trim();
  const garbagePatterns = [
    /total months/i,
    /purchased by/i,
    /placed for/i,
    /transferred to/i,
    /closed/i,
    /^[0-9\s]+$/,                   // Only numbers and spaces
    /^[0-9\scona\-]+$/i,            // Payment history strings like "30 60 90 CO ND"
    /payment history/i,
    /credit limit/i,
    /^collection$/i,
    /^unknown/i,
    /collection as of/i,          // Catches "Collection as of Sep 2022"
    /due as of/i,                 // Catches "Due as of Apr 2026"
    /account summary/i,
    /at a glance/i,
    /overall credit usage/i
  ];

  if (garbagePatterns.some(regex => regex.test(lowerName))) {
    console.log(`[Parser] Dropped garbage item: ${item.creditorName}`);
    return null;
  }

  // Strip "- Closed" or "- Collection" from the end of valid creditor names
  item.creditorName = item.creditorName.replace(/\s*-\s*(Closed|Collection|Charge-Off).*$/i, '').trim();

  // Sanitize all date fields
  const dateFields = [
    'originalDateOfDelinquency', 'dateOpened', 'dateClosed', 'dateLastActive',
    'dateOfLastReporting', 'originalOpeningDate', 'dateOfFirstDelinquency'
  ];
  for (const field of dateFields) {
    item[field] = sanitizeDate(item[field]);
  }

  // Sanitize balance fields
  item.balance = sanitizeBalance(item.balance);
  item.originalBalance = sanitizeBalance(item.originalBalance);
  item.creditLimit = sanitizeBalance(item.creditLimit);

  // Normalize typeOfNegative — expanded map covers non-standard codes.
  // NEVER drop an item for an unrecognized type; always fall back to 'Other Derogatory'.
  const KNOWN_TYPES = new Set([
    'Collection', 'Charge-Off', 'Late Payment', 'Bankruptcy', 'Foreclosure',
    'Repossession', 'Tax Lien', 'Judgment', 'Inquiry', 'Other Derogatory',
  ]);
  const typeMap: Record<string, string> = {
    // Collection variants
    'collection': 'Collection', 'collections': 'Collection', 'coll': 'Collection',
    'col': 'Collection', 'in collections': 'Collection', 'transferred to collection': 'Collection',
    'col transferred to collection': 'Collection', 'purchased by collection agency': 'Collection',
    'transferred': 'Collection', 'purchased': 'Collection', 'placed for collection': 'Collection',
    'assigned to collections': 'Collection',
    // Charge-off variants
    'charge-off': 'Charge-Off', 'chargeoff': 'Charge-Off', 'charge off': 'Charge-Off',
    'co': 'Charge-Off', 'charged off': 'Charge-Off', 'charged-off': 'Charge-Off',
    // Late payment variants
    'late payment': 'Late Payment', 'late': 'Late Payment', 'latepayment': 'Late Payment',
    '30': 'Late Payment', '60': 'Late Payment', '90': 'Late Payment', '120': 'Late Payment',
    '30 days late': 'Late Payment', '60 days late': 'Late Payment', '90 days late': 'Late Payment',
    '120 days late': 'Late Payment', 'past due': 'Late Payment', 'delinquent': 'Late Payment',
    // Bankruptcy variants
    'bankruptcy': 'Bankruptcy', 'bk': 'Bankruptcy',
    'chapter 7': 'Bankruptcy', 'chapter 13': 'Bankruptcy', 'chapter 11': 'Bankruptcy',
    'cbl': 'Bankruptcy', 'cbt': 'Bankruptcy', 'cbl: chapter 7': 'Bankruptcy',
    'cbl: chapter 13': 'Bankruptcy', 'cbt: chapter 7': 'Bankruptcy', 'cbt: chapter 13': 'Bankruptcy',
    'included in bankruptcy': 'Bankruptcy', 'discharged in bankruptcy': 'Bankruptcy',
    'petitioned for bankruptcy': 'Bankruptcy',
    // Foreclosure
    'foreclosure': 'Foreclosure', 'fc': 'Foreclosure', 'foreclosed': 'Foreclosure',
    // Repossession
    'repossession': 'Repossession', 'repo': 'Repossession', 'repossessed': 'Repossession',
    'voluntary repossession': 'Repossession',
    // Tax lien
    'tax lien': 'Tax Lien', 'taxlien': 'Tax Lien', 'federal tax lien': 'Tax Lien',
    'state tax lien': 'Tax Lien',
    // Judgment
    'judgment': 'Judgment', 'civil judgment': 'Judgment', 'judgement': 'Judgment',
    // Inquiry
    'inquiry': 'Inquiry', 'hard inquiry': 'Inquiry', 'hard pull': 'Inquiry',
  };

  const rawType = (item.typeOfNegative || '').trim();
  if (rawType) {
    const mapped = typeMap[rawType.toLowerCase()];
    if (mapped) {
      item.typeOfNegative = mapped;
    } else if (!KNOWN_TYPES.has(rawType)) {
      // Unknown type string — map to Other Derogatory rather than drop or keep raw.
      // Check if we can infer from the status/paymentStatus text.
      const statusText = (item.status || item.paymentStatus || '').toLowerCase();
      if (statusText.includes('collection') || statusText.includes('transferred') || statusText.includes('purchased')) {
        item.typeOfNegative = 'Collection';
      } else if (statusText.includes('charge') || statusText.includes(' co')) {
        item.typeOfNegative = 'Charge-Off';
      } else if (statusText.includes('bankrupt') || statusText.includes('cbl') || statusText.includes('cbt')) {
        item.typeOfNegative = 'Bankruptcy';
      } else if (statusText.includes('late') || statusText.includes('past due') || statusText.includes('delinq')) {
        item.typeOfNegative = 'Late Payment';
      } else {
        item.typeOfNegative = 'Other Derogatory';
      }
    }
    // else: rawType is already a known value — keep it as-is
  } else {
    // typeOfNegative missing — infer from status/paymentStatus
    const statusText = (item.status || item.paymentStatus || '').toLowerCase();
    if (statusText.includes('collection') || statusText.includes('transferred') || statusText.includes('purchased')) {
      item.typeOfNegative = 'Collection';
    } else if (statusText.includes('charge') || statusText.includes(' co')) {
      item.typeOfNegative = 'Charge-Off';
    } else if (statusText.includes('bankrupt') || statusText.includes('cbl') || statusText.includes('cbt')) {
      item.typeOfNegative = 'Bankruptcy';
    } else if (statusText.includes('late') || statusText.includes('past due') || statusText.includes('delinq')) {
      item.typeOfNegative = 'Late Payment';
    } else {
      item.typeOfNegative = 'Other Derogatory';
    }
  }

  // Ensure creditBureau is always an array
  if (!Array.isArray(item.creditBureau)) {
    if (typeof item.creditBureau === 'string' && item.creditBureau) {
      item.creditBureau = [item.creditBureau];
    } else {
      item.creditBureau = [];
    }
  }
  // Normalize bureau names
  item.creditBureau = item.creditBureau.map((b: string) => {
    const lower = (b || '').toLowerCase().trim();
    if (lower.includes('equifax') || lower === 'efx') return 'Equifax';
    if (lower.includes('experian') || lower === 'exp') return 'Experian';
    if (lower.includes('transunion') || lower === 'tu') return 'TransUnion';
    return b;
  }).filter((b: string) => b && ['Equifax', 'Experian', 'TransUnion'].includes(b));

  // Clean creditor name
  item.creditorName = item.creditorName.replace(/[\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim();

  // Ensure parseConfidence
  if (typeof item.parseConfidence !== 'number' || item.parseConfidence < 0 || item.parseConfidence > 1) {
    item.parseConfidence = 0.7;
  }

  return item;
}

async function parseChunk(chunkTextValue: string, retryCount = 0): Promise<any[]> {
  try {
    const responseText = await aiComplete(CREDIT_REPORT_PARSER_PROMPT, chunkTextValue, 'parse');
    const parsed = safeJSONParse(responseText);
    if (parsed.length === 0 && chunkTextValue.length > 500 && retryCount < 1) {
      // Retry once with a more explicit prompt nudge
      console.warn('[Parser] Empty result on non-trivial chunk — retrying...');
      const retryPrompt = CREDIT_REPORT_PARSER_PROMPT + '\n\nIMPORTANT: The previous attempt returned no items. Look harder — there ARE negative accounts in this text. Check for collections, charge-offs, late payments, and other derogatory marks. Return the JSON array.';
      const retryText = await aiComplete(retryPrompt, chunkTextValue, 'parse');
      return safeJSONParse(retryText);
    }
    return parsed;
  } catch (err) {
    if (retryCount < 1) {
      console.warn('[Parser] Chunk parse error, retrying:', err);
      return parseChunk(chunkTextValue, retryCount + 1);
    }
    throw err;
  }
}

export async function parseCreditReport(fileData: string, mimeType: string = "text/plain"): Promise<NegativeItem[]> {
  try {
    if (mimeType === "application/octet-stream") {
      throw new Error("Unsupported file format. Please upload a PDF, TXT, or CSV credit report.");
    }

    // Preprocess: clean OCR artifacts, normalize whitespace & formatting
    const reportText = preprocessReportText(fileData);

    console.log(`[Parser] Original report length: ${reportText.length} chars.`);
    let cleanedText = reportText;

    // Find where the actual credit data ends and the legal garbage begins
    const legalBoilerplateIndex = cleanedText.search(/(Your Rights Under The Fair Credit Reporting Act|Notification of Rights|State Notice of Rights|A security freeze does not apply|Consumer reporting agencies may not report|What this means to you:\s*Credit scoring)/i);

    if (legalBoilerplateIndex > -1) {
      console.log(`[Parser] Truncated legal boilerplate. Saved ${cleanedText.length - legalBoilerplateIndex} characters!`);
      cleanedText = cleanedText.substring(0, legalBoilerplateIndex);
    }

    // Detect bureau from report header for fallback tagging
    const detectedBureau: string[] = [];
    const headerBlock = cleanedText.slice(0, 2000).toLowerCase();
    if (headerBlock.includes('equifax') || headerBlock.includes('efx')) detectedBureau.push('Equifax');
    if (headerBlock.includes('experian') || headerBlock.includes('exp')) detectedBureau.push('Experian');
    if (headerBlock.includes('transunion') || headerBlock.includes('tu ')) detectedBureau.push('TransUnion');

    // Process long reports in chunks with overlap to avoid splitting items
    const chunks = chunkText(cleanedText, 4000);
    const parsedChunks: NegativeItem[][] = [];
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    for (let i = 0; i < chunks.length; i++) {
      console.log(`[Parser] Processing chunk ${i + 1} of ${chunks.length} (${chunks[i].length} chars)...`);
      if (i > 0) {
        console.log(`[Parser] Anti-Rate-Limit: Waiting 6 seconds...`);
        await delay(6000);
      }
      try {
        parsedChunks.push(await parseChunk(chunks[i]));
      } catch (chunkErr) {
        console.error(`[parseCreditReport] Chunk ${i + 1} failed:`, chunkErr);
        parsedChunks.push([]);
      }
    }
    const parsed = parsedChunks.flat();
    if (!Array.isArray(parsed) || parsed.length === 0) return [];

    // Post-processing: validate, sanitize, and repair each item
    const validated = parsed
      .map((item: any) => validateAndRepairItem(item))
      .filter((item: any): item is any => item !== null);

    const hydrated = validated.map((item: any) => {
      const dofd = item.originalDateOfDelinquency || item.dateOfFirstDelinquency || null;
      // If no bureau detected by AI, use header-detected bureau
      const bureaus = (item.creditBureau && item.creditBureau.length > 0)
        ? item.creditBureau
        : (detectedBureau.length > 0 ? [...detectedBureau] : []);

      return {
        ...item,
        id: uuidv4(),
        // Required NegativeItem fields — supply defaults for any the AI didn't return
        creditorName: item.creditorName || '',
        accountNumber: item.accountNumber || '',
        status: item.status || item.paymentStatus || item.typeOfNegative || '',
        additionalInfo: item.additionalInfo || item.paymentStatus || '',
        dateOfFirstDelinquency: dofd,
        originalDateOfDelinquency: dofd,
        dateOfLastReporting: item.dateOfLastReporting || null,
        originalOpeningDate: item.originalOpeningDate || item.dateOpened || null,
        autoRemovalDate: item.autoRemovalDate || computeAutoRemoval(dofd),
        dateOpened: item.dateOpened || item.originalOpeningDate || null,
        fullAccountNumber: item.fullAccountNumber || null,
        parseConfidence: typeof item.parseConfidence === "number" ? Math.max(0, Math.min(1, item.parseConfidence)) : 0.75,
        disputeContactPhone: item.disputeContactPhone || null,
        disputeContactAddress: item.disputeContactAddress || null,
        creditBureau: bureaus,
        // Initialize dispute fields
        disputeRound: item.disputeRound ?? 1,
        disputeStatus: item.disputeStatus ?? "Undisputed",
        lastDisputeDate: item.lastDisputeDate ?? null,
        disputeDeadline: item.disputeDeadline ?? null,
        priorityScore: item.priorityScore ?? 0,
        estimatedScoreImpact: item.estimatedScoreImpact ?? null,
        notes: item.notes ?? [],
        solDropDate: item.solDropDate ?? null,
      };
    });

    // Deduplicate items from overlapping chunks (same creditor+account across chunk boundaries)
    const deduped = deduplicateOverlapItems(hydrated);

    return deduped;
  } catch (error) {
    console.error("Error parsing credit report:", error);
    throw error;
  }
}

/**
 * Remove duplicate items introduced by chunk overlap.
 * Items with same creditorName + accountNumber (fuzzy) are merged.
 */
function deduplicateOverlapItems(items: NegativeItem[]): NegativeItem[] {
  const seen = new Map<string, NegativeItem>();
  for (const item of items) {
    const key = [
      (item.creditorName || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20),
      normalizeAccountForMatch(item.accountNumber).slice(-6),
      (item.typeOfNegative || '').toLowerCase(),
    ].join('|');
    const existing = seen.get(key);
    if (existing) {
      // Merge: keep higher confidence, merge bureaus
      const mergedBureaus = Array.from(new Set([...(existing.creditBureau || []), ...(item.creditBureau || [])]));
      const keepItem = (item.parseConfidence ?? 0) > (existing.parseConfidence ?? 0) ? { ...item } : { ...existing };
      keepItem.creditBureau = mergedBureaus;
      // Prefer non-null values for dates
      for (const f of ['originalDateOfDelinquency', 'dateOpened', 'dateClosed', 'dateLastActive', 'originalCreditor'] as const) {
        if (!(keepItem as any)[f] && (item as any)[f]) (keepItem as any)[f] = (item as any)[f];
        if (!(keepItem as any)[f] && (existing as any)[f]) (keepItem as any)[f] = (existing as any)[f];
      }
      seen.set(key, keepItem);
    } else {
      seen.set(key, item);
    }
  }
  return Array.from(seen.values());
}

// ─── Template definitions ──────────────────────────────────────────────────────
const TEMPLATE_PROMPTS: Record<LetterTemplateType, string> = {
  "609-Identity": `Write a formal FCRA Section 609 (15 U.S.C. § 1681g) identity verification request. Demand the credit bureau provide all information they have on file for the consumer including the source of all reported information. State consumer is exercising their federal right to disclosure. Any items that cannot be fully documented must be deleted per the Act.`,
  "609-Disclosure": `Write a Round 1 Section 609 (15 U.S.C. § 1681g) disclosure request in formal compliance demand language. Under 15 U.S.C. § 1681g, request the bureau disclose: (1) all information in the consumer file, (2) the source of each reported item, (3) each entity that received the consumer report in the past 2 years, (4) the name/address of any user who requested the report for employment purposes. State this is preparatory to subsequent reinvestigation disputes under §1681i. Professional, methodical, direct, and authoritative.`,
  "611-Reinvestigation": `Write a formal FCRA Section 611 (15 U.S.C. § 1681i) reinvestigation dispute letter. Demand verification. State consumer is not admitting to the debt but is challenging the bureau's legal right to report it without complete, accurate, verifiable documentation. If unable to fully verify, items must be deleted immediately. Firm and authoritative.`,
  "611a7-MethodOfInvestigation": `Write a FCRA Section 611(a)(7) (15 U.S.C. § 1681i(a)(7)) Method of Investigation Demand. Consumer previously disputed and bureau claimed "verified." Demand full description of the procedure used to investigate, all documents reviewed, and name/contact of furnisher contacted. If proper investigation was not conducted, items must be deleted per law.`,
  "623-Furnisher": `Write a direct furnisher dispute under FCRA Section 623(a)(8) (15 U.S.C. § 1681s-2(a)(8)). This goes directly to the data furnisher (not the bureau). Demand they conduct a reasonable investigation into accuracy of reported information. State that if they cannot verify with original documentation within 45 days they must correct or delete per FDCPA and FCRA.`,
  "Goodwill": `Write a professional, empathetic goodwill removal request. Consumer acknowledges the negative item and takes responsibility. Explains extenuating circumstances (job loss, medical emergency, etc. — use [REASON] as placeholder). Requests a one-time courtesy removal as a goodwill gesture. Mentions long relationship and future commitment to timely payments. Respectful, not demanding.`,
  "PayForDelete": `Write a pay-for-delete negotiation letter. Consumer offers to pay [AMOUNT] or settle for [SETTLEMENT AMOUNT] in exchange for complete deletion of the tradeline from all bureau files upon payment. States this is not an admission of liability but a resolution offer. Requests written confirmation of deletion agreement before payment is made. References FCRA and standard pay-for-delete practice.`,
  "CeaseAndDesist": `Write a FCRA + FDCPA legal demand letter and cease-and-desist. This is Round 4 escalation. Consumer has made multiple good-faith dispute attempts. Bureau/furnisher has failed obligations under 15 U.S.C. § 1681i, § 1681s-2, and § 1692g. Demand immediate deletion. State that consumer is prepared to file CFPB complaint, FTC complaint, and civil action under 15 U.S.C. § 1681n for willful noncompliance (up to $1,000 statutory damages + attorney fees). Give 15 days to respond with deletion confirmation or dispute outcome.`,
  "DualDispute-BureauFurnisher": `Write a DUAL TARGET dispute letter that simultaneously addresses both the credit bureau AND the furnisher. Section 1: Cite FCRA §611 (15 U.S.C. § 1681i) demanding the bureau reinvestigate. Section 2: Cite FCRA §623(a)(8) (15 U.S.C. § 1681s-2(a)(8)) demanding the furnisher investigate accuracy. Both are legally obligated to respond within 30 days. State the letter is being sent to both parties simultaneously and each is on notice that the other received a copy. This dual-pressure approach maximizes removal probability.`,
  "CFPBComplaint": `Write a formal CFPB complaint narrative suitable for submission at consumerfinance.gov. Use compliance demand voice. Explain the dispute history, the specific FCRA violations, and desired resolution. Keep under 3000 characters. End with a request for CFPB enforcement.`,
  "CFPBComplaintStateAG": `Write a combined Round 5 escalation: a CFPB complaint narrative AND a State Attorney General complaint. Section 1 (CFPB): Formal compliance demand narrative under 2000 chars citing FCRA §1681i and §1681s-2 violations. Section 2 (State AG): Formal letter to the State Attorney General citing state consumer protection statutes (use [STATE] as placeholder), the history of FCRA violations, and requesting state enforcement action. Reference that the State AG may coordinate with CFPB and FTC. This dual-agency escalation signals maximum regulatory pressure.`,
  "PreLitigation": `Write a pre-litigation demand letter / cease-and-desist for Round 6 — final warning before civil suit. State that the consumer has exhausted all administrative remedies (6 dispute rounds, CFPB complaint). Cite: 15 U.S.C. §1681n (willful noncompliance — $100-$1,000 statutory damages per violation + punitive damages + attorney fees), 15 U.S.C. §1681o (negligent noncompliance), and applicable state UDAP statutes. Demand complete deletion and written confirmation within 10 calendar days or the consumer will file suit without further notice. Tone: measured, factual, compliance demand voice, and final.`,
  "AggressiveDual": `Write an extremely aggressive dispute letter combining §611 reinvestigation demand, §623 furnisher dispute, and a warning of imminent §1681n civil action. This is for the Aggressive+ campaign mode where no quarter is given. Every item gets a specific attack vector. Reference Metro 2 compliance standards, maximum reporting period rules, and demand original account-level documentation from both the bureau and furnisher within 15 days or face deletion by default.`,
  ReInsertionViolation: `Write a formal FCRA compliance demand challenging re-insertion, re-aging, or re-reporting of an item that was previously deleted, disputed to resolution, or is past the legal reporting period under 15 U.S.C. §1681c. Demand immediate investigation and permanent deletion. Cite the consumer's prior dispute history and the bureau's duty not to reinsert without certification.`,
};

// ─── Dispute Letter Generator ─────────────────────────────────────────────────
async function generateDisputeLetterOnce(
  negativeItems: NegativeItem[],
  personalInfo: { name: string; address: string; ssn: string; dob: string },
  templateType: LetterTemplateType = "611-Reinvestigation",
  bureau = "Credit Bureau",
  round: DisputeRound = 1,
  extraInstructions = ""
): Promise<string> {
  try {
    const itemsDescription = negativeItems
      .map((item) => `- Creditor: ${item.creditorName}, Account: ${item.accountNumber}, Type: ${item.typeOfNegative}, Balance: $${item.balance ?? 0}, Status: ${item.status}, Additional: ${item.additionalInfo || "N/A"}`)
      .join("\n");

    const templateInstruction = TEMPLATE_PROMPTS[templateType] || TEMPLATE_PROMPTS["611-Reinvestigation"];

    const content = await groqChat([
      {
        role: "system",
        content: DISPUTE_LETTER_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: `${templateInstruction}

DISPUTE TARGET: ${bureau}
ROUND: ${round} of 6
DISPUTED ITEMS:
${itemsDescription}

CONSUMER CONTEXT (for factual accuracy only — DO NOT print in the letter body; the app adds the header):
Name: ${personalInfo.name || "[Your Name]"}
Address: ${personalInfo.address || "[Your Address]"}
SSN (last 4 only): ***-**-${(personalInfo.ssn || "").replace(/\D/g, "").slice(-4) || "[XXXX]"}
DOB: ${personalInfo.dob || "[Your Date of Birth]"}

INSTRUCTIONS:
1. Format as a formal legal compliance demand — not a casual consumer letter.
2. Letter BODY only. Do NOT include sender identity/contact lines, recipient address blocks, dates, RE lines, salutations, or signatures.
3. Do NOT emit placeholders like "[${bureau} Address]" — the recipient block is added by the template.
4. Be firm, authoritative, mention records are being kept for potential legal action.
5. Include all relevant FCRA statute citations in the body.
6. NEVER use phrases like "I am writing to dispute" or "To Whom It May Concern."
7. The first paragraph is facts only. Begin every legal citation in paragraph 2 or later.
8. Start immediately with the dispute narrative (e.g. account facts / "The credit report...").

EXTRA INSTRUCTIONS (HIGH PRIORITY):
${extraInstructions || "None"}`,
      },
    ], MODEL_MAIN, false, 4096, 'letter');

    if (!content || !content.trim()) {
      throw new Error(
        "[LLM_EMPTY_RESPONSE] The AI provider returned an empty response. " +
        "This is likely caused by a rate-limit (HTTP 429) that was not surfaced. " +
        "The batch processor will retry with exponential backoff."
      );
    }
    return enforceFactOnlyOpening(
      stripLetterBodyPreamble(content),
      negativeItems,
      bureau,
    );
  } catch (error) {
    console.error("Error generating dispute letter:", error);
    // Re-throw the real error — never swallow it with a silent template.
    // The calling batch loop (apiQueueManager / handleGenerate) must see the failure
    // so it can retry or report it to the user instead of silently accepting garbage.
    throw error instanceof Error
      ? error
      : new Error(`Failed to generate dispute letter: ${String(error)}`);
  }
}

/**
 * Queue every manually generated dispute letter as well as AutoPilot letters.
 * Provider cooldowns are allowed to clear instead of creating a substitute draft.
 */
export function generateDisputeLetter(
  negativeItems: NegativeItem[],
  personalInfo: { name: string; address: string; ssn: string; dob: string },
  templateType: LetterTemplateType = "611-Reinvestigation",
  bureau = "Credit Bureau",
  round: DisputeRound = 1,
  extraInstructions = ""
): Promise<string> {
  const itemKey = negativeItems.map(item => item.id).join('-') || 'empty';
  const taskId = `manual-dispute-${bureau}-${round}-${itemKey}-${Date.now()}`;
  // World-Class §6.1: exhausted AI retries resolve null → DisputeLetters.tsx
  // orchestrator adapter renders the deterministic fallback (Net-100%).
  return apiQueueManager.enqueue(taskId, () => generateDisputeLetterOnce(
    negativeItems,
    personalInfo,
    templateType,
    bureau,
    round,
    extraInstructions,
  ), { resolveNullOnExhaustion: true });
}

// ─── Score Impact Estimator (O14) ─────────────────────────────────────────────
export async function estimateScoreImpact(item: NegativeItem): Promise<string> {
  try {
    const content = await groqChat(
      [
        {
          role: "system",
          content: `You are a FICO 8 scoring expert. Respond ONLY with a single concise sentence estimating score gain upon removal. Example: "+25 to +45 points (FICO 8)". Nothing else.`,
        },
        {
          role: "user",
          content: `Estimate FICO 8 score impact of removing: ${item.creditorName} — ${item.typeOfNegative}, Balance: $${item.balance ?? 0}, Status: ${item.status}, Bureaus: ${item.creditBureau.join(", ")}, Delinquency: ${item.originalDateOfDelinquency || "Unknown"}`,
        },
      ],
      MODEL_MAIN,
      false,
      80,
      'analyze'
    );
    return content || "Impact unknown";
  } catch {
    return "Impact estimate unavailable";
  }
}

// ─── AI Address Lookup (O12 — replaces static address book) ──────────────────
export async function lookupDisputeAddress(query: string): Promise<{
  name: string;
  legalName?: string;
  disputeAddress: string;
  phone: string;
  fax?: string;
  onlineDisputeUrl: string;
  notes: string;
  type?: string;
}> {
  try {
    const content = await groqChat(
      [
        {
          role: "system",
          content: `You are a credit dispute routing expert. Return official dispute contact info as ONLY a valid JSON object — no markdown, no explanation text. Prefer consumer dispute mailing addresses over payment/remittance addresses.`,
        },
        {
          role: "user",
          content: `Return the official dispute contact information for: "${query}"\n\nRespond with ONLY this JSON (no markdown fences):\n{"name":"Official entity name","legalName":"Legal name if known","disputeAddress":"Full mailing address for disputes","phone":"Phone number or empty string","fax":"Fax or empty string","onlineDisputeUrl":"URL or empty string","type":"bank|credit_card|auto|student|collection|mortgage|utility|telecom|unknown","notes":"Important mailing guidance for consumers"}`,
        },
      ],
      MODEL_MAIN,
      true,
      400,
      'analyze',
      'groq-gemini-only'
    );
    const cleaned = (content || "")
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    const jsonPayload = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
    const parsed = JSON.parse(jsonPayload);

    return {
      name: typeof parsed.name === "string" ? parsed.name.trim() : query,
      legalName: typeof parsed.legalName === "string" && parsed.legalName.trim() ? parsed.legalName.trim() : undefined,
      disputeAddress: typeof parsed.disputeAddress === "string" ? parsed.disputeAddress.trim() : "",
      phone: typeof parsed.phone === "string" ? parsed.phone.trim() : "",
      fax: typeof parsed.fax === "string" && parsed.fax.trim() ? parsed.fax.trim() : undefined,
      onlineDisputeUrl: typeof parsed.onlineDisputeUrl === "string" ? parsed.onlineDisputeUrl.trim() : "",
      notes: typeof parsed.notes === "string" ? parsed.notes.trim() : "Verify before mailing.",
      type: typeof parsed.type === "string" && parsed.type.trim() ? parsed.type.trim() : undefined,
    };
  } catch {
    throw new Error("Address lookup failed. Try a more specific search term.");
  }
}

// ─── Multi-bureau report comparison analysis (O7) ─────────────────────────────
export async function analyzeBureauDiscrepancies(
  equifaxItems: NegativeItem[],
  experianItems: NegativeItem[],
  transunionItems: NegativeItem[]
): Promise<string> {
  try {
    const buildList = (items: NegativeItem[]) =>
      items.map((i) => `${i.creditorName} | ${i.accountNumber} | ${i.typeOfNegative}`).join("\n") || "None";

    const content = await groqChat([
      {
        role: "system",
        content: `You are a credit bureau analysis expert specializing in FCRA dispute strategy. Identify discrepancies and provide actionable dispute ammunition.`,
      },
      {
        role: "user",
        content: `Compare negative items across bureaus and identify discrepancies for dispute use.\n\nEQUIFAX ITEMS:\n${buildList(equifaxItems)}\n\nEXPERIAN ITEMS:\n${buildList(experianItems)}\n\nTRANSUNION ITEMS:\n${buildList(transunionItems)}\n\nIdentify:\n1. Items only on one bureau (bureau-specific disputes)\n2. Items with different amounts/statuses across bureaus (accuracy disputes)\n3. Items missing from one or more bureaus (suggests unverifiability)\n4. Strategic dispute recommendations for each discrepancy\n\nFormat as clear Markdown with sections.`,
      },
    ], MODEL_MAIN, false, 4096, 'analyze');
    return content || "Analysis unavailable.";
  } catch {
    throw new Error("Bureau comparison analysis failed.");
  }
}

// ─── Upgrade 4: Smart Dispute Letter with Vulnerability Targeting + Anti-Frivolous ─
export async function generateSmartDisputeLetter(
  negativeItems: NegativeItem[],
  personalInfo: { name: string; address: string; ssn: string; dob: string },
  templateType: LetterTemplateType,
  bureau: string,
  round: DisputeRound,
  personalizationVars?: { hardshipReason?: string; preferredName?: string; specialInstructions?: string },
  extraInstructions = ""
): Promise<string> {
  try {
    // Import lazily to avoid circular deps at top-level
    const { generateVariationSeed, buildVariationInstruction } = await import("./letterVariation");
    const primaryItem = negativeItems[0];
    const variationSeed = primaryItem
      ? generateVariationSeed(primaryItem, bureau, round, templateType)
      : null;
    const variationInstruction = variationSeed ? buildVariationInstruction(variationSeed) : "";

    const itemsDescription = negativeItems
      .map((item) => {
        const ageYears = item.originalDateOfDelinquency
          ? ((Date.now() - new Date(item.originalDateOfDelinquency).getTime()) / (1000 * 60 * 60 * 24 * 365)).toFixed(1)
          : null;
        const solNote = item.solDropDate
          ? `SOL Drop: ${item.solDropDate}`
          : "SOL Drop: Unknown";
        return `- Creditor: ${item.creditorName}, Account: ${item.accountNumber}, Type: ${item.typeOfNegative}, Balance: $${item.balance ?? 0}, Status: ${item.status}, Age: ${ageYears ? `${ageYears} years` : "Unknown"}, ${solNote}, Info: ${item.additionalInfo || "N/A"}`;
      })
      .join("\n");

    const templateInstruction = TEMPLATE_PROMPTS[templateType] || TEMPLATE_PROMPTS["611-Reinvestigation"];
    const name = (personalizationVars?.preferredName || personalInfo.name || "[Your Name]").trim();
    const hardship = personalizationVars?.hardshipReason ? `Consumer's hardship context: ${personalizationVars.hardshipReason}` : "";
    const special = personalizationVars?.specialInstructions ? `Additional instructions: ${personalizationVars.specialInstructions}` : "";

    const content = await groqChat([
      {
        role: "system",
        content: `${DISPUTE_LETTER_SYSTEM_PROMPT}\n- Never write as a law firm or attorney representative.\n\n${variationInstruction}`,
      },
      {
        role: "user",
        content: `${templateInstruction}\n\nSMART TARGETING — for each item identify the strongest legal attack vector:\n- Age-based: if 5+ years old, reference §1681c reporting period limitations\n- Verification gap: if date of delinquency unclear, challenge as unverifiable\n- Balance discrepancy: if showing balance on charged-off/sold debt, dispute as inaccurate per Metro 2\n- SOL proximity: if within 2 years of drop date, reference mandatory deletion timeline\n- Pattern: if multiple items share same furnisher, argue systematic reporting errors\n\nDISPUTE TARGET: ${bureau}\nROUND: ${round} of 6\nDISPUTED ITEMS:\n${itemsDescription}\n\nCONSUMER CONTEXT (for factual accuracy only — DO NOT print in the letter body; the app adds the header):\nName: ${name}\nAddress: ${personalInfo.address || "[Your Address]"}\nSSN (last 4 only): ***-**-${(personalInfo.ssn || "").replace(/\D/g, "").slice(-4) || "[XXXX]"}\nDOB: ${personalInfo.dob || "[Your Date of Birth]"}\n${hardship}\n${special}\n\nSTANDARDS:\n1. Specific legal citations for every claim\n2. Each item gets its own vulnerability paragraph\n3. Mention correspondence is logged for potential §1681n willful noncompliance litigation\n4. Do NOT use template language bureaus flag for auto-rejection\n5. Letter BODY only — no sender/recipient address blocks, no phone/email/DOB/SSN lines, no "[${bureau} Address]" placeholders, no signatures.\n6. Start immediately with the dispute narrative.\n\nEXTRA INSTRUCTIONS (HIGH PRIORITY):\n${extraInstructions || "None"}`,
      },
    ], MODEL_MAIN, false, 4096, 'letter');

    return content
      ? enforceFactOnlyOpening(
          stripLetterBodyPreamble(content),
          negativeItems,
          bureau,
        )
      : "Failed to generate smart letter.";
  } catch (error) {
    console.error("Smart letter generation error:", error);
    throw new Error("Failed to generate smart dispute letter.");
  }
}

// ─── Upgrade 16: Dispute Strength Scorer ──────────────────────────────────────
export async function analyzeDisputeStrength(letterContent: string, itemType: string): Promise<{
  score: number;
  reason: string;
}> {
  try {
    const content = await groqChat(
      [
        {
          role: "system",
          content: `You are a credit dispute attorney. Rate dispute letter strength 1-10. Respond ONLY with valid JSON: {"score": <1-10>, "reason": "<one sentence>"}`,
        },
        {
          role: "user",
          content: `Rate this ${itemType} dispute letter (1=weak/generic, 10=airtight legal argument):\n\n${letterContent.slice(0, 1500)}\n\nRespond ONLY with: {"score": <number>, "reason": "<one sentence explaining score>"}`,
        },
      ],
      MODEL_MAIN,
      true,
      150,
      'analyze'
    );
    const result = JSON.parse(content);
    return { score: Math.min(10, Math.max(1, Math.round(result.score || 5))), reason: result.reason || "" };
  } catch {
    return { score: 5, reason: "Strength analysis unavailable." };
  }
}

// ─── Upgrade 12: CFPB Complaint Draft Generator ───────────────────────────────
export async function generateCFPBComplaint(
  items: NegativeItem[],
  personalInfo: { name: string; address: string; ssn: string; dob: string },
  bureau: string,
  previousRoundsCount: number
): Promise<string> {
  try {
    const itemsList = items
      .map((i) => `${i.creditorName} (${i.typeOfNegative}, $${i.balance ?? 0})`)
      .join("; ");

    const content = await groqChat([
      {
        role: "system",
        content: `You are a consumer rights advocate drafting CFPB complaints. Write first-person plain text, under 3000 characters, no markdown. Output ONLY the complaint text.`,
      },
      {
        role: "user",
        content: `Write a CFPB complaint for consumerfinance.gov.\n\nCONSUMER: ${personalInfo.name}\nBUREAU: ${bureau}\nDISPUTED ITEMS: ${itemsList}\nPRIOR ROUNDS: ${previousRoundsCount}\n\n1. Explain dispute history (${previousRoundsCount} rounds, no resolution)\n2. Cite FCRA violations: §1681i, §1681s-2\n3. Request deletion of all disputed items\n4. First-person voice\n5. Plain text, under 3000 chars\n6. End with: "I am requesting CFPB intervention to enforce my rights under the FCRA."\n\nOutput ONLY the complaint text.`,
      },
    ], MODEL_MAIN, false, 4096, 'letter');
    return content || "CFPB complaint generation failed.";
  } catch (error) {
    console.error("CFPB complaint generation error:", error);
    throw new Error("Failed to generate CFPB complaint.");
  }
}

// ─── Upgrade 11: Furnisher Bypass — Combined legal demand letter ──────────────
export async function generateFurnisherBypassLetter(
  items: NegativeItem[],
  personalInfo: { name: string; address: string; ssn: string; dob: string },
  furnisherName: string
): Promise<string> {
  try {
    const itemsList = items
      .map((i) => `${i.creditorName} | ${i.accountNumber} | ${i.typeOfNegative} | $${i.balance ?? 0}`)
      .join("\n");

    const content = await groqChat([
      {
        role: "system",
        content: `Draft a firm first-person letter from the named consumer. The consumer is the author and signer; never use client, on behalf of, our office, or representative language. Prior disputes were verified twice. Use only supplied history. Output ONLY the letter BODY in Markdown — do NOT include sender identity/contact lines, recipient address blocks, dates, RE lines, salutations, or signatures (the app template adds those).`,
      },
      {
        role: "user",
        content: `Write a first-person direct furnisher dispute and optional CFPB escalation notice.\n\nFURNISHER: ${furnisherName}\nCONSUMER CONTEXT (for factual accuracy only — DO NOT print in the letter body):\nName: ${personalInfo.name}\nAddress: ${personalInfo.address}\n\nITEMS VERIFIED IN TWO PRIOR BUREAU DISPUTES:\n${itemsList}\n\nInclude:\n1. The specific unresolved account reporting fields\n2. The prior bureau dispute history only as supplied\n3. A request to review the account-level records relevant to those fields\n4. CFPB escalation only as an option unless history confirms filing\n5. A statement that I may seek qualified legal advice if unresolved\n6. A request for correction or deletion when information cannot be verified as accurate and complete\n\nFirm, specific, first-person, and factual. Start immediately with the dispute narrative. Output only the letter body.`,
      },
    ], MODEL_MAIN, false, 4096, 'letter');
    return content
      ? stripLetterBodyPreamble(content)
      : "Furnisher bypass letter generation failed.";
  } catch (error) {
    console.error("Furnisher bypass letter error:", error);
    throw new Error("Failed to generate furnisher bypass letter.");
  }
}

// ─── Upgrade 20: Campaign Success Report ─────────────────────────────────────
export async function generateCampaignSuccessReport(params: {
  campaignName: string;
  startDate: string;
  totalItems: number;
  wonItems: number;
  roundsCompleted: number;
  bureaus: string[];
}): Promise<string> {
  try {
    const winRate = params.totalItems > 0 ? Math.round((params.wonItems / params.totalItems) * 100) : 0;
    const content = await groqChat(
      [
        {
          role: "system",
          content: `You are a credit repair analyst. Write concise 2-paragraph campaign performance reports in Markdown. Output ONLY the report.`,
        },
        {
          role: "user",
          content: `Write a campaign performance report.\n\nCAMPAIGN: ${params.campaignName}\nSTARTED: ${params.startDate}\nITEMS DISPUTED: ${params.totalItems}\nITEMS WON: ${params.wonItems} (${winRate}%)\nROUNDS: ${params.roundsCompleted} of 6\nBUREAUS: ${params.bureaus.join(", ")}\n\nParagraph 1: What was achieved (factual).\nParagraph 2: Recommended next steps.\n\nOutput in Markdown.`,
        },
      ],
      MODEL_MAIN,
      false,
      500,
      'analyze'
    );
    return content || "Report generation failed.";
  } catch {
    return "Campaign report unavailable.";
  }
}

// ─── Letter template preview (O5) ─────────────────────────────────────────────
export async function generateTemplatePreview(
  templateType: LetterTemplateType,
  personalInfo: { name: string; address: string; ssn: string; dob: string }
): Promise<string> {
  const mockItem: NegativeItem = {
    id: "preview",
    creditorName: "[Creditor Name]",
    accountNumber: "****1234",
    balance: 0,
    typeOfNegative: "Collection",
    originalDateOfDelinquency: null,
    dateOfLastReporting: null,
    originalOpeningDate: null,
    status: "Derogatory",
    creditBureau: ["Equifax"],
    additionalInfo: "",
    disputeRound: 1,
    disputeStatus: "Undisputed",
    lastDisputeDate: null,
    disputeDeadline: null,
    priorityScore: 80,
    estimatedScoreImpact: null,
    notes: [],
    solDropDate: null,
  };
  return generateDisputeLetter([mockItem], personalInfo, templateType, "[Bureau Name]", 1);
}
