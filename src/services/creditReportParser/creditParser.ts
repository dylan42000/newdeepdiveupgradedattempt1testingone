export type Bureau = "Experian" | "Equifax" | "TransUnion" | "Unknown";

export interface ParseInput {
  sourceName: string;
  text: string;
}

export interface NegativeItem {
  id: string;
  sourceName: string;
  bureau: Bureau;
  category: string;
  creditor: string;
  accountNumber: string;
  status: string;
  balance: string;
  dateOpened: string;
  /** Date of First Delinquency when present on the report; never invent from dateOpened. */
  dateOfFirstDelinquency: string;
  lastReported: string;
  confidence: number;
  rawSnippet: string;
}

const ACCOUNT_NUMBER_PATTERNS = [
  /(?:account\s*(?:#|number|num|no\.?|nbr)[:\s]+)([\dX*\-\s]{4,25})/i,
  /(?:acct\.?\s*(?:#|no\.?)?[:\s]+)([\dX*\-\s]{4,25})/i,
  /(\d{4,}[Xx*]{4,}\d{0,4})/,
  /([Xx*]{4}[-\s]?[Xx*]{4}[-\s]?[Xx*]{4}[-\s]?\d{4})/,
  /\b(\d{2,4}[Xx*]{2,}\d{2,4})\b/,
  /\b(\d{8,20})\b/,
];

export function extractBestAccountNumber(text: string): string | null {
  for (const pattern of ACCOUNT_NUMBER_PATTERNS) {
    const candidate = text.match(pattern)?.[1]?.trim().replace(/\s+/g, '');
    if (candidate && (candidate.match(/[\dXx*]/g)?.length ?? 0) >= 4) return candidate;
  }
  return null;
}

const toNumber = (value: string): number => {
  const cleaned = value.replace(/[^0-9.\-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};

const cleanField = (value: string): string =>
  compact(value)
    .replace(/^>+|<+$/g, "")
    .replace(/\s*\|\s*$/g, "")
    .trim();

const cleanMoney = (value: string): string => {
  const amount = value.match(/\$?\s*([0-9][0-9,]*(?:\.\d{2})?)/);
  if (!amount?.[1]) return cleanField(value);
  return `$${amount[1]}`;
};

const extractTransUnionBalance = (block: string): string => {
  const direct = extractField(block, [
    /Past Due Amount\s+\$?([0-9,]+(?:\.\d{2})?)/i,
    /\bPast Due\s+\$?([0-9,]+(?:\.\d{2})?)/i,
    /\bBalance\s+\$?([0-9,]+(?:\.\d{2})?)/i,
    /High Balance\s+\$?([0-9,]+(?:\.\d{2})?)/i,
    /High\s+balance\s+of\s+\$?([0-9,]+(?:\.\d{2})?)/i,
    /\$([0-9,]+(?:\.\d{2})?)\s+past\s+due/i
  ]);

  if (direct) return cleanMoney(direct);

  // Last fallback: choose the largest dollar figure in the block.
  const amounts = [...block.matchAll(/\$\s*([0-9,]+(?:\.\d{2})?)/g)].map((match) => toNumber(match[1]));
  if (amounts.length === 0) return "Not listed";
  const largest = Math.max(...amounts);
  return largest > 0 ? cleanMoney(String(largest)) : "Not listed";
};

const CREDITOR_NOISE_PATTERNS = [
  /summary of rights/i,
  /you have the right/i,
  /security freeze/i,
  /consumer reporting agency/i,
  /federal trade commission/i,
  /www\./i,
  /http/i,
  /washington,\s*dc/i,
  /contact:/i
];

const normalizeCreditor = (value: string): string =>
  cleanField(value)
    .replace(/^creditor information\s*/i, "")
    .replace(/^account name\s*/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();

const isCreditorNoise = (value: string): boolean => {
  const normalized = normalizeCreditor(value);
  if (!normalized) return true;
  if (normalized.length > 100) return true;
  if (CREDITOR_NOISE_PATTERNS.some((pattern) => pattern.test(normalized))) return true;

  const words = normalized.split(/\s+/);
  if (words.length > 12) return true;

  return false;
};

const NEGATIVE_KEYWORDS = [
  "collection",
  "collection account",
  "charge off",
  "charge-off",
  "charged off",
  "c/o",
  "past due",
  "late",
  "delinquent",
  "repossession",
  "bankruptcy",
  "foreclosure",
  "judgment",
  "lien",
  "adverse",
  "negative",
  "settled for less",
  "default",
  "placed for collection",
  "adverse information",
  "included in bankruptcy",
  "date of 1st delinquency",
  "60 days",
  "90 days",
  "120 days"
];

const IGNORE_BLOCK_HINTS = [
  "dispute online",
  "important information",
  "contact us",
  "your rights",
  "how to read",
  "summary",
  "index",
  "summary of rights",
  "account review inquiries",
  "supplemental consumer credit information"
];

const SECTION_STOP_MARKERS = [
  "public records",
  "hard inquiries",
  "soft inquiries",
  "inquiries",
  "important messages",
  "contact experian",
  "satisfactory accounts",
  "additional information",
  "summary of rights"
];

const CATEGORY_RULES: Array<{ keyword: string; category: string }> = [
  { keyword: "collection", category: "Collection" },
  { keyword: "charge off", category: "Charge-off" },
  { keyword: "charged off", category: "Charge-off" },
  { keyword: "repossession", category: "Repossession" },
  { keyword: "bankruptcy", category: "Bankruptcy" },
  { keyword: "judgment", category: "Judgment" },
  { keyword: "lien", category: "Lien" },
  { keyword: "foreclosure", category: "Foreclosure" },
  { keyword: "settled for less", category: "Settlement" },
  { keyword: "past due", category: "Late / Past Due" },
  { keyword: "late", category: "Late / Past Due" },
  { keyword: "delinquent", category: "Late / Past Due" },
  { keyword: "default", category: "Default" }
];

const compact = (value: string): string => value.replace(/\s+/g, " ").trim();

const cleanText = (text: string): string =>
  text
    .replace(/\u0000/g, "")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const detectBureau = (text: string): Bureau => {
  const lower = text.toLowerCase();

  // Prefer explicit bureau-specific report markers before plain name mentions.
  if (/(accounts?\s+with\s+adverse\s+information|transunion consumer relations|transunion interactive)/i.test(lower)) {
    return "TransUnion";
  }

  if (/(equifax\s+credit\s+report|confirmation\s+#\s*\d+\s*.*equifax|efx-acr)/i.test(lower)) {
    return "Equifax";
  }

  if (/(experian\s+credit\s+report\s+prepared|potentially\s+negative\s+items)/i.test(lower)) {
    return "Experian";
  }

  const counts = {
    Experian: (lower.match(/experian/g) ?? []).length,
    Equifax: (lower.match(/equifax/g) ?? []).length,
    TransUnion: (lower.match(/transunion/g) ?? []).length
  };

  const max = Math.max(counts.Experian, counts.Equifax, counts.TransUnion);
  if (max > 0) {
    if (counts.TransUnion === max && counts.TransUnion > counts.Experian && counts.TransUnion > counts.Equifax) return "TransUnion";
    if (counts.Equifax === max && counts.Equifax > counts.Experian && counts.Equifax > counts.TransUnion) return "Equifax";
    if (counts.Experian === max && counts.Experian > counts.Equifax && counts.Experian > counts.TransUnion) return "Experian";
  }

  return "Unknown";
};

const buildItem = (
  sourceName: string,
  bureau: Bureau,
  idSuffix: string,
  values: Omit<NegativeItem, "id" | "sourceName" | "bureau" | "dateOfFirstDelinquency"> & {
    dateOfFirstDelinquency?: string;
  }
): NegativeItem => ({
  id: `${sourceName}-${idSuffix}`,
  sourceName,
  bureau,
  ...values,
  dateOfFirstDelinquency: values.dateOfFirstDelinquency || "Not listed",
});

const extractLabelValue = (block: string, label: string): string => {
  const safeLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const withColon = new RegExp(`${safeLabel}\\s*:\\s*([^\\n]+)`, "i");
  const withoutColon = new RegExp(`${safeLabel}\\s+([^\\n]+)`, "i");

  const withColonMatch = block.match(withColon);
  if (withColonMatch?.[1]) return compact(withColonMatch[1]);

  const withoutColonMatch = block.match(withoutColon);
  if (!withoutColonMatch?.[1]) return "";

  // Keep label-based extraction safe by stopping before another known label.
  return compact(
    withoutColonMatch[1].split(/\s+(Account|Status|Balance|Date|Phone|Address|Loan|Term|Opened|Reported|Remarks)\b/i)[0]
  );
};

const extractField = (block: string, patterns: RegExp[]): string => {
  for (const pattern of patterns) {
    const match = block.match(pattern);
    if (match?.[1]) return compact(match[1]);
  }
  return "";
};

const extractDofd = (block: string): string =>
  extractField(block, [
    /Date of First Delinquency\s*:?\s*([0-9/]+)/i,
    /Date of 1st Delinquency\s*:?\s*([0-9/]+)/i,
    /First Delinquency\s*:?\s*([0-9/]+)/i,
    /DOFD\s*:?\s*([0-9/]+)/i,
  ]) || "Not listed";

/**
 * Experian and TransUnion often do not expose a DOFD, but do expose the
 * statutory removal month/year.  This is a parser fallback only: an explicit
 * report DOFD always wins, and Equifax is deliberately left alone.
 */
function parseMonthYear(value: string): { month: number; year: number } | null {
  const clean = value.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  const numeric = clean.match(/\b(0?[1-9]|1[0-2])\s*[\/-]\s*(\d{4})\b/);
  if (numeric) return { month: Number(numeric[1]), year: Number(numeric[2]) };
  const named = clean.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+(\d{4})\b/i);
  if (!named) return null;
  const months: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  return { month: months[named[1].toLowerCase().slice(0, 3)], year: Number(named[2]) };
}

function extractRemovalMonthYear(text: string, bureau: Bureau): { month: number; year: number } | null {
  const label = bureau === 'Experian'
    ? /on\s+record\s+until\b/gi
    : /estimated\s+(?:month\s+and\s+year\s+)?(?:this\s+)?item\s+will\s+be\s+removed\b/gi;
  for (const match of text.matchAll(label)) {
    // The report can put the value on the same line or visually to the right;
    // PDF text extraction normally linearizes both inside this small window.
    const candidate = text.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 120);
    const parsed = parseMonthYear(candidate);
    if (parsed) return parsed;
  }
  return null;
}

export function deriveDofdFromRemovalDate(bureau: Bureau, text: string, explicitDofd = 'Not listed'): string {
  if (explicitDofd && explicitDofd !== 'Not listed') return explicitDofd;
  if (bureau !== 'Experian' && bureau !== 'TransUnion') return 'Not listed';
  const removal = extractRemovalMonthYear(text, bureau);
  if (!removal || removal.year < 1900) return 'Not listed';
  return `${String(removal.month).padStart(2, '0')}/${removal.year - 7}`;
}

function withDerivedDofd(item: NegativeItem, reportText: string): NegativeItem {
  if (item.dateOfFirstDelinquency !== 'Not listed' || (item.bureau !== 'Experian' && item.bureau !== 'TransUnion')) return item;
  const account = item.accountNumber === 'Not listed' ? '' : item.accountNumber;
  const creditor = item.creditor === 'Not listed' ? '' : item.creditor;
  const accountIndex = account ? reportText.indexOf(account) : -1;
  const creditorIndex = creditor ? reportText.toLowerCase().indexOf(creditor.toLowerCase()) : -1;
  const index = accountIndex >= 0 ? accountIndex : creditorIndex;
  // Never use an unrelated report-level removal date when this account cannot
  // be located. Generic parsing already supplies its account block directly.
  const context = index >= 0 ? reportText.slice(Math.max(0, index - 350), index + 1_600) : item.rawSnippet;
  const derived = deriveDofdFromRemovalDate(item.bureau, `${item.rawSnippet}\n${context}`);
  return derived === 'Not listed' ? item : { ...item, dateOfFirstDelinquency: derived };
}

const deriveCategory = (blockLower: string): string => {
  const match = CATEGORY_RULES.find((rule) => blockLower.includes(rule.keyword));
  return match ? match.category : "Negative Account";
};

const detectCreditorFallback = (block: string): string => {
  const accountName = extractLabelValue(block, "Account Name");
  if (accountName) return accountName;

  const transUnionHeader = block.match(/^([A-Z0-9/&'.,\- ]+\s[\w-]*\d{3,}[*X]{2,}[\w*X]*)/m);
  if (transUnionHeader?.[1]) {
    return compact(transUnionHeader[1].replace(/[\w-]*\d{3,}[*X]{2,}[\w*X]*$/, ""));
  }

  const lines = block
    .split("\n")
    .map((line) => compact(line))
    .filter(Boolean);

  const likelyName = lines.find((line) => /^[A-Z0-9&'.,\- ]{5,}$/.test(line));
  if (likelyName) return likelyName;

  return lines[0] ?? "Unknown Creditor";
};

const calculateConfidence = (block: string): number => {
  const lower = block.toLowerCase();
  let score = 0;

  if (NEGATIVE_KEYWORDS.some((keyword) => lower.includes(keyword))) score += 35;
  if (/status\s*:/i.test(block)) score += 20;
  if (/account\s*(number|#|no)/i.test(block)) score += 20;
  if (/(creditor|subscriber|account name)\s*:/i.test(block)) score += 15;
  if (/(last reported|date of status|reported since)/i.test(block)) score += 10;
  if (lower.includes("potentially negative")) score += 10;
  if (lower.includes("account info")) score += 5;
  if (/(hard inquiries|soft inquiries|public records)/i.test(block)) score -= 20;
  if (/(pay status\s*[>:]|narrative code\(s\)\s*:\s*.*(057|067))/i.test(block)) score += 15;

  return Math.min(100, Math.max(0, score));
};

const isLikelyNegativeBlock = (block: string): boolean => {
  const lower = block.toLowerCase();

  if (IGNORE_BLOCK_HINTS.some((hint) => lower.includes(hint))) return false;
  if (/(hard inquiries|soft inquiries)/i.test(lower)) return false;

  const hasNegativeSignal = NEGATIVE_KEYWORDS.some((keyword) => lower.includes(keyword));
  const hasAccountContext =
    /(account\s*(number|#|no)|status\s*:|date opened|last reported|responsibility|pay status|amount past due)/i.test(
      block
    ) || /(public records|collections?|adverse accounts?|accounts with adverse information)/i.test(block);

  return hasNegativeSignal && hasAccountContext;
};

const splitExperianSections = (text: string): string[] => {
  const sections: string[] = [];
  const marker = /([A-Z0-9/&'.,\- ]{3,})\s*\n\s*POTENTIALLY NEGATIVE/gi;
  const matches = [...text.matchAll(marker)];

  if (matches.length === 0) return sections;

  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const start = current.index ?? 0;
    const nextStart = matches[index + 1]?.index ?? text.length;
    let segment = text.slice(start, nextStart).trim();

    const stopIndex = SECTION_STOP_MARKERS.map((stop) => segment.toLowerCase().indexOf(stop)).filter((value) => value > 0);
    if (stopIndex.length > 0) {
      segment = segment.slice(0, Math.min(...stopIndex)).trim();
    }

    if (segment.length > 25) sections.push(segment);
  }

  return sections;
};

const splitEquifaxSections = (text: string): string[] => {
  const sections: string[] = [];
  const marker = /\n\s*([A-Z0-9/&'.,\- ]{3,})\s+-\s+Closed\b/g;
  const matches = [...text.matchAll(marker)];

  if (matches.length === 0) return sections;

  for (let index = 0; index < matches.length; index += 1) {
    const start = matches[index].index ?? 0;
    const nextStart = matches[index + 1]?.index ?? text.length;
    let segment = text.slice(start, nextStart).trim();

    const stopIndex = SECTION_STOP_MARKERS.map((stop) => segment.toLowerCase().indexOf(stop)).filter((value) => value > 0);
    if (stopIndex.length > 0) {
      segment = segment.slice(0, Math.min(...stopIndex)).trim();
    }

    if (segment.length > 25) sections.push(segment);
  }

  return sections;
};

const findEquifaxCreditor = (lines: string[], accountLineIndex: number): string => {
  const start = Math.max(0, accountLineIndex - 8);
  const candidates = lines.slice(start, accountLineIndex);

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const line = compact(candidates[index]).replace(/\s+-\s+Closed\s*$/i, "");
    if (!line || /\d/.test(line)) continue;
    if (
      /^(prepared for|date|confirmation|credit accounts|collections|narrative code|payment history|year|page)\b/i.test(line)
    ) {
      continue;
    }
    if (/^(po box|care of|credit bureau dispute)\b/i.test(line)) continue;
    if (!/[A-Z]{2}/.test(line) || line.length > 90) continue;
    return normalizeCreditor(line);
  }

  return "Unknown Creditor";
};

const deriveEquifaxCategory = (
  status: string,
  accountType: string,
  narrativeCodes: string,
  amountPastDue: string
): string => {
  const signals = `${status} ${accountType} ${narrativeCodes}`;
  if (/charge\s*off|charged\s*off|\b067\b/i.test(signals)) return "Charge-off";
  if (/collection|debt buyer|\b057\b/i.test(signals)) return "Collection";
  if (/repossession|\brepossession\b/i.test(signals)) return "Repossession";
  if (/foreclosure/i.test(signals)) return "Foreclosure";
  if (/bankruptcy/i.test(signals)) return "Bankruptcy";
  if (/past due|delinquen|\b(?:30|60|90|120|150|180)\s*(?:-|days?)/i.test(signals) || toNumber(amountPastDue) > 0) {
    return "Late / Past Due";
  }
  return "Negative Account";
};

const parseEquifaxCollections = (sourceName: string, text: string): NegativeItem[] => {
  const collectionsStart = text.search(/\n\s*Collections\s*\n/i);
  if (collectionsStart < 0) return [];

  const section = text.slice(collectionsStart);
  const accountMatches = [...section.matchAll(/^Account Number:\s*([^\s|]+)/gim)];

  return accountMatches
    .map((match, index) => {
      const matchIndex = match.index ?? 0;
      const nextIndex = accountMatches[index + 1]?.index ?? section.length;
      const linesBefore = section.slice(0, matchIndex).split("\n");
      const creditor = findEquifaxCreditor(linesBefore, linesBefore.length);
      const block = section.slice(matchIndex, nextIndex);

      if (creditor === "Unknown Creditor" || isCreditorNoise(creditor)) return null;

      const accountNumber = cleanField(match[1]);
      const amount =
        extractField(block, [
          /Collection Reported\s*:\s*[^\n]*?\bAmount\s*:\s*(\$?[\d,]+(?:\.\d{2})?)/i,
          /Balance as of\s+[^:]+:\s*(\$?[\d,]+(?:\.\d{2})?)/i
        ]) || "Not listed";
      const reported = extractField(block, [/Collection Reported\s*:\s*([0-9/]+)/i]) || "Not listed";
      const dateOpened = extractField(block, [/Assigned\s*:\s*([0-9/]+)/i]) || "Not listed";
      const dateOfFirstDelinquency =
        extractField(block, [/Date of 1st Delinquency\s*:\s*([0-9/]+)/i, /Date of First Delinquency\s*:\s*([0-9/]+)/i]) ||
        "Not listed";
      const status =
        extractField(block, [/Status as of\s+[0-9/]+\s*:\s*([^\n]+)/i]) || "Collection Account";
      const originalCreditor = extractField(block, [/Original Creditor\s*:\s*([^\n]+)/i]);
      const evidenceCreditor = originalCreditor ? `${creditor} (Original: ${cleanField(originalCreditor)})` : creditor;

      return buildItem(sourceName, "Equifax", `efx-collection-${index}`, {
        category: "Collection",
        creditor,
        accountNumber,
        status: cleanField(status),
        balance: amount === "Not listed" ? amount : cleanMoney(amount),
        dateOpened,
        dateOfFirstDelinquency,
        lastReported: reported,
        confidence: 99,
        rawSnippet: compact(
          `${evidenceCreditor} | ${accountNumber} | Status ${cleanField(status)} | Balance ${
            amount === "Not listed" ? amount : cleanMoney(amount)
          } | Collection Reported ${reported}`
        ).slice(0, 320)
      });
    })
    .filter((item): item is NegativeItem => item !== null);
};

const splitTransUnionAdverseSections = (text: string): string[] => {
  const adverseStart = text.toLowerCase().indexOf("accounts with adverse information");
  if (adverseStart < 0) return [];

  const tail = text.slice(adverseStart);
  const endMarkers = ["satisfactory accounts", "inquiries", "additional information", "summary of rights"];
  const adverseEndCandidates = endMarkers
    .map((marker) => tail.toLowerCase().indexOf(marker))
    .filter((value) => value > 0);

  const adverseEnd = adverseEndCandidates.length > 0 ? Math.min(...adverseEndCandidates) : tail.length;
  const adverseOnly = tail.slice(0, adverseEnd);

  const blockPattern =
    /([A-Z][A-Z0-9/&'.,\- ]+\s[\w-]*\d{3,}[*X]{2,}[\w*X]*)\s*\nAccount Information([\s\S]*?)(?=\n[A-Z][A-Z0-9/&'.,\- ]+\s[\w-]*\d{3,}[*X]{2,}[\w*X]*\s*\nAccount Information|$)/g;
  const matches = [...adverseOnly.matchAll(blockPattern)];

  return matches.map((match) => `${compact(match[1])}\nAccount Information${match[2]}`.trim());
};

const parseEquifaxNegativeAccounts = (sourceName: string, text: string): NegativeItem[] => {
  const lower = text.toLowerCase();
  if (!lower.includes("equifax") || !lower.includes("credit accounts")) return [];

  const creditAccountsStart = lower.indexOf("credit accounts");
  const collectionsStart = lower.indexOf("\ncollections", creditAccountsStart);
  const section = text.slice(creditAccountsStart, collectionsStart > creditAccountsStart ? collectionsStart : text.length);
  const lines = section.split("\n");
  const accountLineIndexes = lines
    .map((line, index) => (/^Account Number\s*:/i.test(line.trim()) ? index : -1))
    .filter((index) => index >= 0);
  if (accountLineIndexes.length === 0) return parseEquifaxCollections(sourceName, text);

  const results: NegativeItem[] = [];

  for (let index = 0; index < accountLineIndexes.length; index += 1) {
    const accountLineIndex = accountLineIndexes[index];
    const nextAccountLineIndex = accountLineIndexes[index + 1] ?? lines.length;
    const previousAccountLineIndex = index > 0 ? accountLineIndexes[index - 1] : -1;
    const blockStart = Math.max(previousAccountLineIndex + 1, accountLineIndex - 8);
    const block = lines.slice(blockStart, nextAccountLineIndex).join("\n").trim();

    if (/(inquiries|summary of your rights)/i.test(block)) continue;

    const creditor = findEquifaxCreditor(lines, accountLineIndex);
    if (isCreditorNoise(creditor)) continue;
    const accountNumber =
      extractBestAccountNumber(block) || extractField(block, [/Account Number\s*:\s*([*0-9A-Z-]+)/i]) || extractLabelValue(block, "Account Number") || "Not listed";
    const statusFromLine =
      extractField(block, [/Loan\/Account Type\s*:\s*[^|\n]+\|\s*Status\s*:[ \t]*([^\n]*)/i]);
    const accountType = extractField(block, [/Loan\/Account Type\s*:\s*([^|\n]+)/i]);
    const balance =
      extractField(block, [
        /Date Reported\s*:\s*[^\n|]+\|\s*Balance\s*:\s*([^\n]+)/i,
        /Amount Past Due\s*:\s*([^\n]+)/i,
        /Charge Off Amount\s*:\s*([^\n]+)/i
      ]) || "Not listed";
    const dateOpened = extractField(block, [/Date Opened\s*:\s*([0-9/]+)/i]) || "Not listed";
    const lastReported = extractField(block, [/Date Reported\s*:\s*([0-9/]+)/i]) || "Not listed";

    const amountPastDue = extractLabelValue(block, "Amount Past Due");
    const narrativeCodes = extractField(block, [/Narrative Code\(s\)\s*:[ \t]*([^\n]*)/i]);
    const hasCollectionCode = /\b057\b/.test(narrativeCodes);
    const hasChargeOffCode = /\b067\b/.test(narrativeCodes);
    const status =
      cleanField(statusFromLine) ||
      (hasChargeOffCode ? "Charge Off" : hasCollectionCode ? "Collection Account" : toNumber(amountPastDue) > 0 ? "Past Due" : "Not listed");
    const hasNegativeSignal =
      /charge\s*off|collection|past due|delinquen|repossession|foreclosure|bankruptcy/i.test(status) ||
      hasCollectionCode ||
      hasChargeOffCode ||
      toNumber(amountPastDue) > 0;

    const isPaysAsAgreed = /pays\s+as\s+agreed/i.test(status);

    // Equifax closed positive tradelines can include legend text that mentions charge-off/collection.
    // Only keep true negatives with explicit negative status, narrative codes, or non-zero past due.
    if (isPaysAsAgreed && !hasCollectionCode && !hasChargeOffCode && toNumber(amountPastDue) === 0) {
      continue;
    }

    if (!hasNegativeSignal) continue;

    const category = deriveEquifaxCategory(status, accountType, narrativeCodes, amountPastDue);
    const rawSnippet = compact(
      `${creditor} | ${accountNumber} | Status ${status} | Balance ${cleanMoney(balance)} | Date Opened ${dateOpened} | Date Reported ${lastReported}`
    ).slice(0, 320);
    const confidence = Math.min(100, 88 + (toNumber(amountPastDue) > 0 ? 5 : 0) + (hasCollectionCode || hasChargeOffCode ? 5 : 0));

    results.push(
      buildItem(sourceName, "Equifax", `efx-${index}`, {
        category,
        creditor: normalizeCreditor(creditor),
        accountNumber,
        status: cleanField(status),
        balance: cleanMoney(balance),
        dateOpened,
        dateOfFirstDelinquency: extractDofd(block),
        lastReported,
        confidence,
        rawSnippet
      })
    );
  }

  return [...results, ...parseEquifaxCollections(sourceName, text)];
};

const parseTransUnionPortalSnapshot = (sourceName: string, text: string): NegativeItem[] => {
  if (!/credit report\s+https:\/\/members\.transunion\.com/i.test(text)) return [];

  const matches = [
    ...text.matchAll(
      /Last Payment Status\s+([^\n]+?)\s+Loan Term[\s\S]*?Opened\s+([0-9/]+)\s+Reported\s+([0-9/]+)[\s\S]*?Remarks\s+([^\n]+)[\s\S]*?Creditor Information\s+([A-Z0-9/&'.,\- ]+)[\s\S]*?Account Details\s+Account Number\s+([A-Z0-9*]+)/gi
    )
  ];

  return matches
    .map((match, index) => {
      const status = cleanField(match[1]);
      if (!/charge\s*off|collection/i.test(status)) return null;

      const opened = cleanField(match[2]);
      const reported = cleanField(match[3]);
      const remarks = cleanField(match[4]);
      const creditor = normalizeCreditor(match[5]);
      if (isCreditorNoise(creditor)) return null;
      const accountNumber = cleanField(match[6]);
      const block = match[0];
      const parsedBalance = extractTransUnionBalance(block);

      return buildItem(sourceName, "TransUnion", `tu-portal-${index}`, {
        category: /charge\s*off/i.test(status) ? "Charge-off" : "Collection",
        creditor,
        accountNumber,
        status,
        balance: parsedBalance,
        dateOpened: opened,
        dateOfFirstDelinquency: extractDofd(block),
        lastReported: reported,
        confidence: 95,
        rawSnippet: compact(`${creditor} | ${accountNumber} | ${status} | ${remarks}`).slice(0, 320)
      });
    })
    .filter((item): item is NegativeItem => item !== null);
};

const parseTransUnionAnnualCreditReport = (sourceName: string, text: string): NegativeItem[] => {
  const lower = text.toLowerCase();
  const hasTransUnionShape =
    /adverse information typically remains|accounts?\s+with\s+adverse\s+information|account information/i.test(lower) &&
    /pay status|date opened|date updated/i.test(lower);

  if (!hasTransUnionShape) return [];

  const startIndexCandidates = [
    lower.indexOf("accounts with adverse information"),
    lower.indexOf("adverse information typically remains")
  ].filter((value) => value >= 0);

  const sectionStart = startIndexCandidates.length > 0 ? Math.min(...startIndexCandidates) : 0;
  const tail = text.slice(sectionStart);
  const stopCandidates = ["satisfactory accounts", "inquiries", "additional information", "summary of rights"]
    .map((marker) => tail.toLowerCase().indexOf(marker))
    .filter((value) => value > 0);
  const section = tail.slice(0, stopCandidates.length > 0 ? Math.min(...stopCandidates) : tail.length);

  const accountNumberPattern = /[\w-]*\d{3,}[*X]{2,}[\w*X-]*/i;
  const accountInfoMatches = [...section.matchAll(/^Account Information\s*$/gim)];
  const blocks: Array<{ header: string; body: string }> = [];

  for (let index = 0; index < accountInfoMatches.length; index += 1) {
    const accountInfo = accountInfoMatches[index];
    const markerStart = accountInfo.index ?? 0;
    const markerEnd = markerStart + accountInfo[0].length;
    const nextMarkerStart = accountInfoMatches[index + 1]?.index ?? section.length;
    const precedingLines = section
      .slice(0, markerStart)
      .split("\n")
      .map((line) => compact(line))
      .filter(Boolean);

    const lastLine = precedingLines.at(-1) ?? "";
    const previousLine = precedingLines.at(-2) ?? "";
    let header = "";

    if (accountNumberPattern.test(lastLine)) {
      if (/^[\w-]*\d{3,}[*X]{2,}[\w*X-]*$/i.test(lastLine) && previousLine && !/^Account Name$/i.test(previousLine)) {
        header = `${previousLine} ${lastLine}`;
      } else {
        header = lastLine;
      }
    }

    if (!header) continue;

    blocks.push({
      header,
      body: section.slice(markerEnd, nextMarkerStart).trim()
    });
  }

  // Fallback for flattened text where visual rows were not preserved.
  if (blocks.length === 0) {
    const inlinePattern =
      /([A-Z][A-Z0-9/&'.,\- ]+?\s[\w-]*\d{3,}[*X]{2,}[\w*X]*)\s+Account Information([\s\S]*?)(?=(?:[A-Z][A-Z0-9/&'.,\- ]+?\s[\w-]*\d{3,}[*X]{2,}[\w*X]*\s+Account Information)|$)/g;
    const inlineMatches = [...section.matchAll(inlinePattern)];
    for (const match of inlineMatches) {
      blocks.push({ header: compact(match[1]), body: compact(match[2]) });
    }
  }

  return blocks
    .map(({ header, body }, index) => {
      const accountNumber = extractField(header, [/([\w-]*\d{3,}[*X]{2,}[\w*X-]*)/i]) || "Not listed";
      const creditor = normalizeCreditor(header.replace(/[\w-]*\d{3,}[*X]{2,}[\w*X-]*$/, ""));
      if (isCreditorNoise(creditor)) return null;

      const status =
        extractField(body, [/Pay Status\s*>?([^<\n]+)</i, /Pay Status\s+([^\n]+?)(?:\s{2,}|Terms|Date Closed|Remarks|Payment History|$)/i]) ||
        "Not listed";
      const dateOpened = extractField(body, [/Date Opened\s+([0-9/]+)/i]) || "Not listed";
      const lastReported = extractField(body, [/Date Updated\s+([0-9/]+)/i, /Reported\s+([0-9/]+)/i]) || "Not listed";
      const balance = extractTransUnionBalance(body);

      const negativeSignal = /charg(?:e|ed)[ -]?off|collection|past due|delinquent|repossession|foreclosure|bankruptcy|default/i.test(
        `${status} ${body}`
      );
      if (!negativeSignal) return null;

      const category = /charg(?:e|ed)[ -]?off/i.test(status)
        ? "Charge-off"
        : /collection/i.test(`${status} ${body}`)
          ? "Collection"
          : /past due|delinquent|\b(?:30|60|90|120)\s+days?\b/i.test(`${status} ${body}`)
            ? "Late / Past Due"
            : deriveCategory(`${status} ${body}`.toLowerCase());

      return buildItem(sourceName, "TransUnion", `tu-acr-${index}`, {
        category,
        creditor: creditor || "Unknown Creditor",
        accountNumber,
        status: cleanField(status),
        balance,
        dateOpened,
        dateOfFirstDelinquency: extractDofd(body),
        lastReported,
        confidence: 96,
        rawSnippet: compact(
          `${creditor} | ${accountNumber} | Status ${cleanField(status)} | Balance ${cleanMoney(balance)} | Date Opened ${dateOpened} | Date Updated ${lastReported}`
        ).slice(0, 320)
      });
    })
    .filter((item): item is NegativeItem => item !== null);
};

const parseTransUnionNegativeAccounts = (sourceName: string, text: string): NegativeItem[] => {
  const lower = text.toLowerCase();
  if (!lower.includes("accounts with adverse information")) return [];

  const adverseStart = lower.indexOf("accounts with adverse information");
  const adverseTail = text.slice(adverseStart);
  const stopCandidates = ["satisfactory accounts", "inquiries", "additional information", "summary of rights"]
    .map((marker) => adverseTail.toLowerCase().indexOf(marker))
    .filter((value) => value > 0);
  const adverseSection = adverseTail.slice(0, stopCandidates.length > 0 ? Math.min(...stopCandidates) : adverseTail.length);

  const pattern =
    /(?:^|\n)(?:Account Name\s*\n)?([A-Z][A-Z0-9/&'.,\- ]+?\s[\w-]*\d{3,}[*X]{2,}[\w*X]*)\s*\nAccount Information([\s\S]*?)(?=\n(?:Account Name\s*\n)?[A-Z][A-Z0-9/&'.,\- ]+?\s[\w-]*\d{3,}[*X]{2,}[\w*X]*\s*\nAccount Information|$)/g;

  const matches = [...adverseSection.matchAll(pattern)];
  if (matches.length === 0) return [];

  return matches
    .map((match, index) => {
      const header = compact(match[1]);
      const body = `Account Information${match[2]}`;
      const creditor = normalizeCreditor(header.replace(/[\w-]*\d{3,}[*X]{2,}[\w*X]*$/, "")) || "Unknown Creditor";
      if (isCreditorNoise(creditor)) return null;
      const accountNumber =
        extractBestAccountNumber(`${header}\n${body}`) || extractLabelValue(body, "Account Number") ||
        extractField(header, [/([\w-]*\d{3,}[*X]{2,}[\w*X]*)/i]) ||
        "Not listed";
      const status =
        extractField(body, [/Pay Status\s*>?([^<\n]+)</i, /Pay Status\s+([^\n]+?)(?:\s{2,}|Loan Term|Terms|Date Closed|Remarks|$)/i]) ||
        extractLabelValue(body, "Pay Status") ||
        extractLabelValue(body, "Status") ||
        "Not listed";
      const balance =
        extractTransUnionBalance(body) !== "Not listed"
          ? extractTransUnionBalance(body)
          : extractLabelValue(body, "Balance") || extractLabelValue(body, "High Balance") || extractLabelValue(body, "Past Due") || "Not listed";
      const dateOpened = extractLabelValue(body, "Date Opened") || "Not listed";
      const lastReported = extractLabelValue(body, "Date Updated") || "Not listed";

      const negativeSignal = /charge\s*off|collection|sold; was in collection|placed for collection/i.test(
        `${status} ${body}`
      );
      if (!negativeSignal) return null;

      const category = /charge\s*off/i.test(status) ? "Charge-off" : "Collection";

      return buildItem(sourceName, "TransUnion", `tu-${index}`, {
        category,
        creditor,
        accountNumber,
        status: cleanField(status),
        balance: balance === "Not listed" ? balance : cleanMoney(balance),
        dateOpened,
        dateOfFirstDelinquency: extractDofd(body),
        lastReported,
        confidence: 94,
        rawSnippet: compact(
          `${creditor} | ${accountNumber} | Status ${cleanField(status)} | Balance ${balance === "Not listed" ? balance : cleanMoney(balance)} | Date Opened ${dateOpened} | Date Updated ${lastReported}`
        ).slice(0, 320)
      });
    })
    .filter((item): item is NegativeItem => item !== null);
};

const splitPotentialBlocks = (text: string): string[] => {
  const experianSections = splitExperianSections(text);
  if (experianSections.length > 0) return experianSections;

  const transUnionSections = splitTransUnionAdverseSections(text);
  if (transUnionSections.length > 0) return transUnionSections;

  const equifaxSections = splitEquifaxSections(text);
  if (equifaxSections.length > 0) return equifaxSections;

  const firstPass = text
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter((block) => block.length >= 25);

  if (firstPass.length > 3) return firstPass;

  return text
    .split(/(?=\b(Account Number|Status|Creditor|Collection|Public Records?)\b)/i)
    .map((block) => block.trim())
    .filter((block) => block.length >= 25);
};

export const parseNegativeItems = (inputs: ParseInput[]): NegativeItem[] => {
  const results: NegativeItem[] = [];

  for (const input of inputs) {
    const normalized = cleanText(input.text);
    if (!normalized) continue;

    // Multi-bureau reports (e.g. AnnualCreditReport.com) contain TU + EQ + EX.
    // Union all specialized parsers — never early-exit after the first hit.
    const specialized: NegativeItem[] = [
      ...parseTransUnionAnnualCreditReport(input.sourceName, normalized),
      ...parseTransUnionPortalSnapshot(input.sourceName, normalized),
      ...parseTransUnionNegativeAccounts(input.sourceName, normalized),
      ...parseEquifaxNegativeAccounts(input.sourceName, normalized),
    ];

    if (specialized.length > 0) {
      results.push(...specialized.map(item => withDerivedDofd(item, normalized)));
      continue;
    }

    const sourceBureau = detectBureau(normalized);
    const blocks = splitPotentialBlocks(normalized);

    blocks.forEach((block, index) => {
      if (!isLikelyNegativeBlock(block)) return;

      const lower = block.toLowerCase();
      const creditor =
        extractField(block, [
          /(?:creditor|subscriber|account name|furnisher)\s*:\s*([^\n]+)/i,
          /(?:company name)\s*:\s*([^\n]+)/i
        ]) || extractLabelValue(block, "Account Name") || detectCreditorFallback(block);

      const normalizedCreditor = normalizeCreditor(creditor);
      if (isCreditorNoise(normalizedCreditor)) return;

      const accountNumber =
        extractBestAccountNumber(block) || extractField(block, [
          /(?:account\s*(?:number|#|no))\s*:\s*([^\n]+)/i,
          /(?:partial account number)\s*:\s*([^\n]+)/i
        ]) ||
        extractLabelValue(block, "Account Number") ||
        extractField(block, [/([\w-]*\d{3,}[*X]{2,}[\w*X]*)/i]) ||
        "Not listed";

      const status =
        extractField(block, [
          /(?:status|payment status|account status)\s*:\s*([^\n]+)/i,
          /(?:account history)\s*:\s*([^\n]+)/i
        ]) ||
        extractLabelValue(block, "Status") ||
        extractLabelValue(block, "Pay Status") ||
        "Not listed";

      const balance =
        extractField(block, [
          /(?:recent balance|current balance|balance)\s*:\s*([^\n]+)/i,
          /(?:amount past due)\s*:\s*([^\n]+)/i,
          /(?:claim amount|liability amount)\s*:\s*([^\n]+)/i,
          /(?:high balance)\s*:\s*([^\n]+)/i,
          /(?:charge off amount)\s*:\s*([^\n]+)/i
        ]) || extractLabelValue(block, "Balance") || "Not listed";

      const dateOpened =
        extractField(block, [
          /(?:date opened|opened)\s*:?\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4})/i,
          /(?:date opened|opened)\s*:\s*([^\n]+)/i,
          /(?:date filed)\s*:\s*([^\n]+)/i
        ]) || extractLabelValue(block, "Date Opened") || "Not listed";

      const blockBureau = detectBureau(block);
      const dateOfFirstDelinquency = deriveDofdFromRemovalDate(
        blockBureau === 'Unknown' ? sourceBureau : blockBureau,
        block,
        extractDofd(block),
      );

      const lastReported =
        extractField(block, [
          /(?:last reported|reported since|date of status|balance updated|status updated)\s*:?\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4})/i,
          /(?:last reported|reported since|date of status)\s*:\s*([^\n]+)/i,
          /(?:date resolved)\s*:\s*([^\n]+)/i
        ]) ||
        extractLabelValue(block, "Balance Updated") ||
        extractLabelValue(block, "Status Updated") ||
        extractLabelValue(block, "Date Reported") ||
        extractLabelValue(block, "Date Updated") ||
        "Not listed";

      results.push({
        id: `${input.sourceName}-${index}`,
        sourceName: input.sourceName,
        bureau: blockBureau === "Unknown" ? sourceBureau : blockBureau,
        category: deriveCategory(lower),
        creditor: normalizedCreditor,
        accountNumber,
        status,
        balance,
        dateOpened,
        dateOfFirstDelinquency,
        lastReported,
        confidence: calculateConfidence(block),
        rawSnippet: compact(block).slice(0, 320)
      });
    });
  }

  const normalizeIdentityText = (value: string): string => value
    .toLowerCase()
    .replace(/\b(?:incorporated|inc|llc|ltd|corp(?:oration)?|company|co)\b/g, "")
    .replace(/[^a-z0-9]/g, "");

  const normalizeAccount = (value: string): string => {
    if (!value || value === "Not listed") return "";
    return value.toUpperCase().replace(/[X*]/g, "*").replace(/[^A-Z0-9*]/g, "");
  };

  const visibleAccountChars = (value: string): string => normalizeAccount(value).replace(/\*/g, "");

  const accountsMatch = (left: string, right: string): boolean => {
    const a = normalizeAccount(left);
    const b = normalizeAccount(right);
    if (!a || !b) return false;
    if (a === b) return true;

    // TU's different layouts often expose different masks for the same account.
    // Match only when at least three visible trailing characters agree, which
    // avoids collapsing unrelated fully-masked accounts from one creditor.
    const av = visibleAccountChars(a);
    const bv = visibleAccountChars(b);
    const sharedLength = Math.min(4, av.length, bv.length);
    return sharedLength >= 3 && av.slice(-sharedLength) === bv.slice(-sharedLength);
  };

  const sameParsedAccount = (left: NegativeItem, right: NegativeItem): boolean => {
    if (left.bureau !== right.bureau) return false;
    if (normalizeIdentityText(left.creditor) !== normalizeIdentityText(right.creditor)) return false;

    if (accountsMatch(left.accountNumber, right.accountNumber)) return true;

    // If one parser did not recover the account number, require two other
    // stable fields. Never use this fallback when both account numbers exist.
    const leftAccount = normalizeAccount(left.accountNumber);
    const rightAccount = normalizeAccount(right.accountNumber);
    if (leftAccount && rightAccount) return false;
    const sameOpened = left.dateOpened !== "Not listed" && left.dateOpened === right.dateOpened;
    const sameBalance = left.balance !== "Not listed" && left.balance === right.balance;
    return sameOpened && sameBalance;
  };

  const itemRichness = (item: NegativeItem): number => [
    item.accountNumber,
    item.status,
    item.balance,
    item.dateOpened,
    item.dateOfFirstDelinquency,
    item.lastReported,
  ].filter(value => value && value !== "Not listed").length;

  const deduped: NegativeItem[] = [];
  for (const item of results) {
    const existingIndex = deduped.findIndex(existing => sameParsedAccount(existing, item));
    const existing = existingIndex >= 0 ? deduped[existingIndex] : undefined;
    if (!existing) {
      deduped.push(item);
      continue;
    }

    if (itemRichness(item) > itemRichness(existing) ||
        (itemRichness(item) === itemRichness(existing) && item.confidence > existing.confidence)) {
      deduped[existingIndex] = item;
    }
  }

  return deduped.sort((a, b) => b.confidence - a.confidence);
};

export const parseCreditReport = (input: ParseInput): NegativeItem[] => parseNegativeItems([input]);

export const parseCreditReportText = (
  text: string,
  sourceName = "Credit report"
): NegativeItem[] => parseCreditReport({ sourceName, text });
