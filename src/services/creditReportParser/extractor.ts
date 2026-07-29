import pdfWorkerRaw from 'pdfjs-dist/build/pdf.worker.mjs?raw';

// ============================================================
// extractor.ts — WORLD CLASS UNIFIED EXTRACTION ENGINE v4.2
// CRITICAL BUG FIXES over v4.1:
//   1. extractTextFromPDF: Y-coordinate grouping preserves line structure
//      (v4.1 joined all page items with spaces — destroyed all block structure)
//   2. NEGATIVE_KEYWORDS: added all Experian-specific phrases
//   3. classifyNegativeType: complete mapping (written-off→Charge-Off,
//      settled→Settlement, tax lien→Judgment/Lien, chapter 7/13→Bankruptcy,
//      "collection account" itemType→Collection)
//   4. FIELD_PATTERNS.dofd: added Experian "Date of Status" field
//   5. extractFromBlock: fallback classification on raw block text
//      (no longer hard-discards blocks when status is on separate line)
//   6. isValidCreditorName: fixed for AT&T, T-MOBILE, hyphenated names
//   7. lineBasedScan: works for unknown collectors, not just KNOWN_CREDITORS
//   8. heuristicExtract: section-aware scanning (POTENTIALLY NEGATIVE ITEMS,
//      ADVERSE ACCOUNTS, COLLECTION ACCOUNTS headers now trigger lower threshold)
//   9. findCreditorName: handles Experian inline type on same line as name
//  10. extractFromBlockLenient: new function for negative-section blocks
// ============================================================

// ── KNOWN CREDITORS — THE DEFINITIVE LIST ────────────────────
export const KNOWN_CREDITORS = new Set([
  // BANKS
  'CAPITAL ONE', 'CHASE', 'BANK OF AMERICA', 'WELLS FARGO', 'CITIBANK',
  'CITI', 'DISCOVER', 'AMERICAN EXPRESS', 'AMEX', 'US BANK', 'USBANK',
  'PNC BANK', 'TRUIST', 'TD BANK', 'REGIONS BANK', 'FIFTH THIRD BANK',
  'FIFTH THIRD', 'CITIZENS BANK', 'HUNTINGTON BANK', 'KEYBANK',
  'ALLY BANK', 'ALLY FINANCIAL', 'MARCUS BY GOLDMAN SACHS', 'MARCUS',
  'SYNCHRONY BANK', 'SYNCHRONY', 'BARCLAYS', 'HSBC',
  // CREDIT UNIONS
  'NAVY FEDERAL CREDIT UNION', 'NAVY FEDERAL', 'PENTAGON FEDERAL',
  'PENFED', 'USAA', 'TEACHERS FEDERAL', 'SCHOOL EMPLOYEES',
  // AUTO LENDERS
  'FORD MOTOR CREDIT', 'GM FINANCIAL', 'TOYOTA FINANCIAL',
  'HONDA FINANCIAL', 'HONDA FINANCIAL SERVICES', 'CHRYSLER CAPITAL',
  'SANTANDER CONSUMER', 'SANTANDER', 'WESTLAKE FINANCIAL',
  'AMERICREDIT', 'EXETER FINANCE', 'CREDIT ACCEPTANCE',
  'CARMAX AUTO FINANCE', 'CARMAX', 'AUDI FINANCIAL', 'BMW FINANCIAL',
  'MERCEDES BENZ FINANCIAL', 'VOLKSWAGEN CREDIT',
  // STUDENT LOANS
  'NAVIENT', 'SALLIE MAE', 'NELNET', 'MOHELA', 'AIDVANTAGE',
  'GREAT LAKES', 'FEDLOAN', 'EDFINANCIAL', 'GRANITE STATE',
  'DEPT OF EDUCATION', 'DEPARTMENT OF EDUCATION',
  // MEDICAL / HEALTHCARE
  'CAPIO PARTNERS', 'NARA MEDICAL', 'PHYSICIAN FINANCIAL', 'CERNER',
  // RETAIL / STORE CARDS
  'KOHLS', "KOHL'S", 'TARGET NATIONAL BANK', 'TARGET',
  'AMAZON', 'WALMART', 'HOME DEPOT', 'LOWES', "LOWE'S",
  'BEST BUY', 'MACYS', "MACY'S", 'GAP', 'BANANA REPUBLIC',
  'OLD NAVY', 'JC PENNEY', 'JCPENNEY', 'SEARS', 'PAYPAL CREDIT',
  'PAYPAL', 'EBAY', 'WEBBANK', 'COMENITY BANK', 'COMENITY',
  'COMENITY CAPITAL', 'BREAD FINANCIAL',
  // UTILITIES / TELECOM
  'AT&T', 'VERIZON', 'T-MOBILE', 'SPRINT', 'COMCAST', 'SPECTRUM',
  'XFINITY', 'COX COMMUNICATIONS', 'DIRECTV', 'DISH NETWORK',
  // COLLECTIONS — THE BIG ONES
  'PORTFOLIO RECOVERY', 'PORTFOLIO RECOVERY ASSOCIATES',
  'MIDLAND CREDIT', 'MIDLAND CREDIT MANAGEMENT', 'MIDLAND FUNDING',
  'LVNV FUNDING', 'RESURGENT CAPITAL', 'RESURGENT',
  'ASSET ACCEPTANCE', 'ASSET ACCEPTANCE LLC',
  'CAVALRY PORTFOLIO', 'CAVALRY SPV', 'CAVALRY',
  'UNIFIN INC', 'UNIFIN',
  'CONVERGENT OUTSOURCING', 'CONVERGENT',
  'ENHANCED RECOVERY', 'ERC', 'ENHANCED RECOVERY COMPANY',
  'NATIONAL RECOVERY', 'NATIONAL CREDIT SYSTEMS',
  'COLLECTION BUREAU', 'CREDIT CORP SOLUTIONS',
  'JEFFERSON CAPITAL', 'CROWN ASSET MANAGEMENT',
  'ACTIVATE FINANCIAL', 'ARS NATIONAL', 'ALTUS RECEIVABLES',
  'COLLECTION ASSOCIATES', 'COMMERCIAL RECOVERY SYSTEMS',
  'FIRST COLLECTION SERVICES', 'FIRST CREDIT SERVICES',
  'TRANSWORLD SYSTEMS', 'IC SYSTEM', 'I.C. SYSTEM',
  'ACB COLLECTIONS', 'ACA INTERNATIONAL',
  'AMERICAN COLLECTIONS ENTERPRISE', 'ANDERSON FINANCIAL',
  'BUREAUS INVESTMENT GROUP', 'BUREAUS INC',
  'CAINE AND WEINER', 'CAINE & WEINER',
  'CAPITAL ACCOUNTS', 'CAPITAL CITY BANK',
  'CMRE FINANCIAL', 'COMMONWEALTH FINANCIAL',
  'CREDIT MANAGEMENT LP', 'CREDIT MANAGEMENT SOLUTIONS',
  'DEBT RECOVERY SOLUTIONS', 'EOS CCA',
  'FINANCIAL RECOVERY SERVICES', 'FRANKLIN COLLECTION',
  'GC SERVICES', 'GLOBAL CREDIT',
  'HELVEY AND ASSOCIATES', 'HELVEY & ASSOCIATES',
  'HUNTER WARFIELD', 'INTEGRAS HEALTH',
  'NATIONAL ENTERPRISE SYSTEMS', 'NCI INFORMATION SYSTEMS',
  'NCO FINANCIAL', 'NCO GROUP',
  'NORTHLAND GROUP', 'ONLINE COLLECTIONS',
  'PIONEER CREDIT RECOVERY', 'PRA GROUP',
  'RADIUS GLOBAL SOLUTIONS', 'RAUSCH STURM',
  'RECEIVABLES PERFORMANCE', 'REGIONAL ACCEPTANCE',
  'RMS RADIOLOGY', 'SEQUIUM ASSET SOLUTIONS',
  'SIMM ASSOCIATES', 'SOUTHWEST CREDIT SYSTEMS',
  'STATE COLLECTION SERVICE', 'STELLAR RECOVERY',
  'SUNRISE CREDIT SERVICES', 'TOWER LOAN',
  'UNIVERSE MEDICAL', 'US COLLECTIONS',
  'VERO FINANCIAL', 'VIKING COLLECTION SERVICE',
  'WEST ASSET MANAGEMENT', 'WELTMAN WEINBERG',
]);

// ── HARD-BLOCK PATTERNS — NEVER A CREDITOR ───────────────────
// These match text that looks like a creditor but is NOT.
// ONLY used in isValidCreditorName() — they do NOT gate block processing.
export const HARD_BLOCK_PATTERNS: RegExp[] = [
  // Angle-bracket status (ACR Equifax)
  /^>/,
  /^<[^>]+>/,
  // URLs
  /https?:\/\//i,
  /^www\./i,
  // PO Boxes
  /\bpo\s+box\b/i,
  // Phone numbers
  /\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/,
  // Pure dollar amounts
  /^\$\b(\d{1,7}(?:,\d{3})*(?:\.\d{2})?|0(?:\.00)?)\b/,
  // Phantom Payment Histories
  /^\s*20[1-2]\d[\s\t]+(?:CO|C|OK|30|60|90|120|X|\*|[-N\/D\s\t])+$/i,
  /^\s*20[1-2]\d[\s\t]+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/i,
  /^past\s+due\b/i,
  /^account\s+balance\b/i,
  /^current\s+balance\b/i,
  /^balance\s+amount\b/i,
  /^original\s+amount\b/i,
  /^amount\s+past\s+due\b/i,
  /^charge[\s-]off\s+amount\b/i,
  /^high\s+balance\b/i,
  /^credit\s+limit\b/i,
  // Field labels
  /^account\s+status\b/i,
  /^pay\s+status\b/i,
  /^payment\s+status\b/i,
  /^account\s+type\b/i,
  /^account\s+number\b/i,
  /^date\s+opened\b/i,
  /^date\s+closed\b/i,
  /^date\s+of\s+last/i,
  /^date\s+reported\b/i,
  /^date\s+of\s+status\b/i,
  /^terms\b/i,
  /^responsibility\b/i,
  /^original\s+creditor\b/i,
  /^creditor\s+name\b/i,
  /^remarks\b/i,
  /^comments\b/i,
  /^narrative\s+code/i,
  /^collection\s+as\s+of\b/i,
  /^due\s+as\s+of\b/i,
  // Section headers (these terminate, not start)
  /^potentially\s+negative\b/i,
  /^accounts?\s+in\s+good\s+standing\b/i,
  /^satisfactory\s+accounts?\b/i,
  /^historical\s+(?:information|info|data)\b/i,
  /^historical\s+account\b/i,
  /^payment\s+history\b/i,
  /^credit\s+inquir/i,
  /^public\s+records?\b/i,
  // Legal text
  /fair\s+credit\s+reporting\s+act/i,
  /pursuant\s+to\s+section/i,
  /15\s+u\.?s\.?c/i,
  // Address components
  /^\d+\s+[a-z]+\s+(?:st|ave|blvd|rd|dr|ln|ct|pl|cir|pkwy)/i,
  /^\d{5}(?:-\d{4})?$/,
  // Standalone state abbreviations
  /^[A-Z]{2}\s+\d{5}$/,
  // Fax / Address / Phone standalone
  /^address\s*$/i,
  /^phone\s*$/i,
  /^fax\s*$/i,
  /^email\s*$/i,
  // Bureau names standalone
  /^equifax\s*$/i,
  /^experian\s*$/i,
  /^transunion\s*$/i,
  // Payment grid text (replaced by v4.4 pattern below that also covers C/O)
  // /^(?:ok|co|30|60|90|120)(?:\s+(?:ok|co|30|60|90|120)){2,}$/i,  // superseded
  // ACR specific
  /^account\s+name\s*$/i,
  /^member\s+since\b/i,
  /^credit\s+score\b/i,
  /^fico\b/i,
  /^vantage/i,
  /^report\s+date\b/i,
  /^generated\s+on\b/i,
  /^as\s+of\s+date\b/i,
  // ── v4.3 ADDITIONS — false-positive fixes ────────────────────
  // "LOAN TYPE UNSECURED / CREDIT CARD / TELECOMMUNICATIONS" field labels
  /^loan\s+type\b/i,
  /^loan\s+(?:class|category|description)\b/i,
  // Repeated-word PDF artifacts: "BALANCE BALANCE BALANCE" / "RATING RATING RATING"
  /^(\b\w{3,}\b)(?:\s+\1){2,}\s*$/i,
  // Sentence starters that can't be creditor names
  /^that\s+(may|will|could|might|can|would|should)\b/i,
  /^(?:items?|accounts?|information)\s+that\s+may\b/i,
  /^(?:this|these|those|there|their|they|the\s+following)\b/i,
  /^(?:may|will|could|should|would)\s+(?:negatively|affect|impact|lower|hurt|reduce)\b/i,
  /\bmay\s+negatively\s+affect\b/i,
  // Common table/column headers
  /^(?:rating|status|type|balance|amount|date|number|limit|payment)\s+(?:rating|status|type|balance|amount|date|number|limit|payment)/i,
  // "POSITIVELY" / "NEGATIVELY" alone or in phrases
  /^(?:positively|negatively)\b/i,
  // "POTENTIALLY NEGATIVE" / "ADVERSE ACCOUNTS" — already handled as section enders but block just in case
  /^potentially\s+negative\b/i,
  /^adverse\s+(?:accounts?|items?)\b/i,
  // ── v4.4 ADDITIONS — additional false-positive fixes ─────────
  // Report header / introductory boilerplate text
  /^prepared\s+for\b/i,
  /^an\s+overview\s+of\b/i,
  /^overview\s+of\s+your\b/i,
  // Standalone section labels that are never creditor names
  /^credit\s+accounts?\s*$/i,
  /^lines?\s+of\s+credit\.?\s*$/i,
  /^date\s+updated\b/i,
  /^date\s+reported\s+xx/i,             // "DATE REPORTED XX/XX/XXXX" placeholder
  // Standalone month names (date column artifacts from tabular PDF layout)
  /^(?:january|february|march|april|may|june|july|august|september|october|november|december)\s*$/i,
  // Single-word fragments that can never be a creditor name alone
  /^associates?\s*$/i,
  /^balance\s*$/i,
  /^closed\s*$/i,
  /^open\s*$/i,
  /^current\s*$/i,
  // Payment grid variants including C/O notation
  /^(?:ok|co|c\/o|30|60|90|120)(?:\s+(?:ok|co|c\/o|30|60|90|120)){2,}$/i,
];

// ── NEGATIVE SIGNAL KEYWORDS ──────────────────────────────────
// UPGRADED: massively expanded for maximum recall on negatives
// Includes Metro 2 codes, all ACR angle-bracket variants, subscriber codes
export const NEGATIVE_KEYWORDS = [
  'collection', 'collections', 'charge off', 'charge-off', 'charged off',
  'charged-off', 'chargeoff', 'derogatory', 'delinquent', 'delinquency',
  'late 30', 'late 60', 'late 90', 'late 120', 'past due',
  'repossession', 'repossessed', 'foreclosure', 'foreclosed',
  'judgment', 'judgement', 'bankruptcy', 'discharged', 'dismissed',
  'settled', 'settlement', 'in collection', 'placed for collection',
  'transferred to collection', 'transferred to recovery',
  'seriously past due', '120 days', '90 days past', '60 days past', '30 days past',
  'co co co', 'co co', 'seriously delinquent', 'unpaid',
  'written off', 'written-off', 'profit and loss', 'profit & loss',
  'bad debt', 'defaulted', 'default', 'cancelled by credit grantor',
  'canceled by credit grantor', 'account closed by credit grantor',
  'charged to profit', 'cbr', 'cbl', 'cbt', 'wep', 'cbg', 'ppd',
  'account purchased', 'sold to', 'placed with',
  // ── Experian-specific phrases (v4.2) ──────────────────────────
  'seriously past due date', 'assigned to attorney', 'assigned to collection',
  'account charged to profit and loss', 'unpaid balance reported as a loss',
  'written off as uncollectable', 'written off as loss', 'charged to loss',
  'transferred to attorney', 'referred to attorney',
  'voluntary repossession', 'voluntary surrender', 'voluntary repo',
  'settled for less', 'settled less than', 'partial payment accepted',
  'chapter 7', 'chapter 13', 'chapter 11',
  'in collections', 'sent to collections', 'placed in collection',
  'tax lien', 'federal tax lien', 'state tax lien',
  'civil judgment', 'civil court judgment',
  'charge off balance', 'charged off balance',
  'amount written off', 'loss amount',
  '120 day', '90 day', '60 day', '30 day',
  // ── TransUnion subscriber code negatives ────────────────────
  'da', 'db', 'dc', 'dd', 'dg', 'dh', 'di', 'dj', 'dk',
  // ── METRO 2 + HIGH-PRECISION UPGRADE ───────────────────────
  '93', '97', '05', '71', '78', '80', '82', '83', '84',
  'narrative code 057', 'narrative code 067', 'narrative 57', 'narrative 67',
  'status 93', 'status 97', 'ecoa code', 'payment rating',
  'charge off amount', 'charged off amount',
  'placed for collection', 'sold to collection agency',
  'involuntary repossession', 'foreclosure sale',
  'included in bk', 'included in bankruptcy',
  '>charge-off<', '>in collection<', '>charged off<',
  'late payment history', 'derogatory mark',
];

// ── POSITIVE-ONLY SIGNALS (these disqualify an account) ──────
export const POSITIVE_ONLY_KEYWORDS = [
  'pays as agreed', 'paid as agreed',
  'never late', '0 times late', '0 time late',
  'no late payments', 'no late payment',
  'never delinquent',
  'current/never late', 'open/never late', 'paid/never late',
  'paid satisfactorily', 'in good standing', 'too new to rate',
  'paid/closed', 'account closed', 'closed by consumer', 'closed by grantor',
  // Experian-format status combos
  'current, was 30 days late', // historical-late note on a current account
];

// Hard anchors that override a positive-only signal
// (e.g., a previously charged-off account that now "pays as agreed")
const POSITIVE_OVERRIDE_ANCHORS = [
  'charge off', 'charge-off', 'charged off', 'charged-off',
  'collection', 'in collection', 'placed for collection',
  'c/o',
];

// ── TEXT NORMALIZATION ────────────────────────────────────────
export function normalizeText(raw: string): string {
  const normalized = raw
    .normalize('NFKC')
    // Ligatures
    .replace(/\uFB00/g, 'ff').replace(/\uFB01/g, 'fi').replace(/\uFB02/g, 'fl')
    .replace(/\uFB03/g, 'ffi').replace(/\uFB04/g, 'ffl')
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-').replace(/\u00AD/g, '')
    // Hyphen-newline join (PDF artifact)
    .replace(/(\w)-\n(\w)/g, '$1$2')
    // Normalize whitespace — preserve \t (tab = column separator inserted by extractTextFromPDF)
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .replace(/[^\S\n\t]+/g, ' ')  // normalize spaces/other whitespace but keep tabs
    .replace(/ *\t */g, '\t')     // strip spaces adjacent to tabs
    // Compress blank lines
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return stitchAccountNumberContinuations(normalized.split('\n')).join('\n');
}

/** Join account labels whose masked value wrapped onto the following PDF line. */
export function stitchAccountNumberContinuations(lines: string[]): string[] {
  const label = /account\s*(?:#|number|num|no\.?|nbr)[\s:]*([0-9X*\-]{0,25})/i;
  const continuation = /^[0-9X*\-]{4,25}$/i;
  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const current = lines[i];
    if (label.test(current) && i + 1 < lines.length && continuation.test(lines[i + 1].trim())) {
      result.push(`${current.trim()} ${lines[++i].trim()}`);
    } else result.push(current);
  }
  return result;
}

// ── REPEATED LINE DETECTOR (header/footer suppressor) ────────
// Returns the set of line strings that appear on 60%+ of pages
// (i.e. page-level headers and footers, never account data).
// Only inspects the first 4 and last 4 lines of each page to stay fast.
function detectRepeatedLines(pages: string[]): Set<string> {
  if (pages.length < 3) return new Set();

  const counts = new Map<string, number>();
  for (const pageText of pages) {
    const lines = pageText.split('\n').map(l => l.trim()).filter(l => l.length > 3);
    // header candidates = first 4 lines; footer candidates = last 4 lines
    const candidates = new Set([
      ...lines.slice(0, 4),
      ...lines.slice(-4),
    ]);
    for (const line of candidates) {
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
  }

  const threshold = Math.ceil(pages.length * 0.6);
  const repeated = new Set<string>();
  for (const [line, count] of counts) {
    if (count >= threshold) repeated.add(line);
  }
  return repeated;
}

// ── PDF TEXT EXTRACTION ───────────────────────────────────────
// FIX v4.2: Use Y-coordinate grouping to reconstruct line structure.
// v4.1 bug: .join(' ') destroyed all newlines — block splitting was impossible.
export async function extractTextFromPDF(buffer: ArrayBuffer): Promise<string> {
  try {
    const pdfjsLib = await import('pdfjs-dist');
    const workerBlob = new Blob([pdfWorkerRaw], { type: 'text/javascript' });
    const workerUrl = URL.createObjectURL(workerBlob);
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

    const pdf = await pdfjsLib.getDocument({
      data: buffer,
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
      rangeChunkSize: 65536,
    }).promise;
    const rawPages: string[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();

      // Group text items by Y-coordinate to reconstruct lines.
      // In PDF coordinate space Y increases upward, so higher Y = closer to top of page.
      // Track item width so we can detect large column gaps in tabular layouts.
      // Round to nearest 4px (up from 2) for better tolerance of slight baseline shifts.
      const lineMap = new Map<number, Array<{ x: number; str: string; width: number }>>();
      for (const item of content.items as any[]) {
        const str: string = item.str ?? '';
        if (!str.trim()) continue;
        const y = Math.round(item.transform[5] / 4) * 4;
        const x: number = item.transform[4];
        const width: number = item.width ?? 0;
        if (!lineMap.has(y)) lineMap.set(y, []);
        lineMap.get(y)!.push({ x, str, width });
      }

      // Sort Y descending (top of page first) then join each line left→right.
      // Use smart spacing: check actual x-gap vs. estimated char width.
      // Insert TAB when X-gap > 40 PDF units (tabular column boundary).
      const sortedY = Array.from(lineMap.keys()).sort((a, b) => b - a);
      const text = sortedY
        .map(y => {
          const items = lineMap.get(y)!.sort((a, b) => a.x - b.x);
          let lineStr = '';
          for (let idx = 0; idx < items.length; idx++) {
            if (idx === 0) {
              lineStr = items[idx].str;
            } else {
              const prev = items[idx - 1];
              const gap = items[idx].x - (prev.x + prev.width);
              if (gap > 40) {
                lineStr += '\t' + items[idx].str;
              } else if (gap > -1) {
                // Small positive gap = normal word spacing
                lineStr += ' ' + items[idx].str;
              } else {
                // Negative gap = items overlap (ligature artifact) — join directly
                lineStr += items[idx].str;
              }
            }
          }
          return lineStr.trim();
        })
        .filter(Boolean)
        .join('\n');

      rawPages.push(text);
    }

    // Strip repeated page headers/footers (lines appearing on 60%+ of pages).
    // Credit reports print "Report for John Smith | Page N of M" etc. on every page —
    // these lines confuse account-block detection.
    const headerFooters = detectRepeatedLines(rawPages);
    const cleanedPages = rawPages.map(pageText =>
      pageText
        .split('\n')
        .filter(line => !headerFooters.has(line.trim()))
        .join('\n')
        .trim()
    );

    // Join pages with a plain double-newline.
    // The old ---PAGE--- marker severed account blocks that span page boundaries,
    // which caused a single account to parse as 2+ incomplete fragments.
    return cleanedPages.filter(Boolean).join('\n\n');
  } catch (err) {
    console.error('PDF extraction error:', err);
    throw new Error(`PDF extraction failed: ${err}`);
  }
}

// ── CONSUMER NAME EXTRACTION ──────────────────────────────────
export interface ConsumerInfo {
  fullName: string;
  firstName: string;
  lastName: string;
  nameVariants: string[];
}

export function extractConsumerInfo(text: string): ConsumerInfo {
  const upper = text.slice(0, 3000).toUpperCase();
  const lines = upper.split('\n').map(l => l.trim()).filter(Boolean);

  let fullName = '';

  // Strategy 1: Look for labeled name
  const nameLabelPatterns = [
    /^(?:NAME|CONSUMER NAME|YOUR NAME|FULL NAME|APPLICANT)[:\s]+([A-Z][A-Z\s,.-]{4,50})$/,
    /^(?:NAME)[:\s]+(.+)$/,
  ];

  for (const pattern of nameLabelPatterns) {
    for (const line of lines.slice(0, 20)) {
      const m = line.match(pattern);
      if (m) { fullName = m[1].trim(); break; }
    }
    if (fullName) break;
  }

  // Strategy 2: First all-caps line that looks like a person's name
  if (!fullName) {
    for (const line of lines.slice(0, 15)) {
      // Skip lines containing "ID #" or "ID#" — Experian report ID marker lines
      // e.g. "ID #12121 NAME ID #14119 NAME" (consumer profile table artifacts)
      if (/ID\s*#/.test(line)) continue;
      // Must be 2-4 words, all caps, 6-45 chars, no numbers
      if (/^[A-Z]+(?: [A-Z]+){1,3}$/.test(line) &&
        line.length >= 6 && line.length <= 45 &&
        !/\d/.test(line) &&
        !HARD_BLOCK_PATTERNS.some(p => p.test(line)) &&
        !line.includes('EQUIFAX') && !line.includes('EXPERIAN') &&
        !line.includes('TRANSUNION') && !line.includes('CREDIT') &&
        !line.includes('REPORT') && !line.includes('ANNUAL')) {
        fullName = line;
        break;
      }
    }
  }

  if (!fullName) {
    return { fullName: '', firstName: '', lastName: '', nameVariants: [] };
  }

  const parts = fullName.replace(/[,;]+/g, ' ').split(/\s+/).filter(Boolean);
  const firstName = parts[0] ?? '';
  const lastName = parts[parts.length - 1] ?? '';
  const middleName = parts.length >= 3 ? parts.slice(1, -1).join(' ') : '';
  const middleInitial = middleName ? middleName[0] : '';

  const variants = new Set<string>();
  variants.add(fullName);
  if (firstName && lastName) {
    variants.add(`${firstName} ${lastName}`);
    if (middleInitial) variants.add(`${firstName} ${middleInitial} ${lastName}`);
    if (firstName.length >= 4) variants.add(firstName);
    if (lastName.length >= 4) variants.add(lastName);
    variants.add(`${firstName[0]} ${lastName}`);
  }

  return {
    fullName,
    firstName,
    lastName,
    nameVariants: Array.from(variants),
  };
}

// ── SIGNAL DETECTION ─────────────────────────────────────────
export function hasNegativeSignal(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return NEGATIVE_KEYWORDS.some(kw => lower.includes(kw));
}

export function hasPositiveOnlySignal(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  const hasPos = POSITIVE_ONLY_KEYWORDS.some(kw => lower.includes(kw));
  if (!hasPos) return false;
  // A positive phrase does NOT disqualify when a hard negative anchor is present
  // (e.g., "charged off — now pays as agreed" is still a charge-off)
  const hasHardNeg = POSITIVE_OVERRIDE_ANCHORS.some(kw => lower.includes(kw));
  return !hasHardNeg;
}

// ── CREDITOR NAME VALIDATION ──────────────────────────────────
// FIX v4.2: word check now handles AT&T, T-MOBILE, hyphenated names.
// v4.1 bug: /[A-Z]{3,}/ filter rejected "AT&T" (only 2 consecutive letters before &).
export function isValidCreditorName(
  name: string,
  consumerInfo: ConsumerInfo,
): { valid: boolean; reason?: string } {
  if (!name || name.trim().length < 2) {
    return { valid: false, reason: 'Too short' };
  }

  const upper = name.toUpperCase().trim();

  // Hard blocks
  for (const pattern of HARD_BLOCK_PATTERNS) {
    if (pattern.test(name)) {
      return { valid: false, reason: `Hard block: ${pattern.source.slice(0, 40)}` };
    }
  }

  // Length guard
  if (upper.length > 80) {
    return { valid: false, reason: 'Too long for a creditor name' };
  }

  // ── v4.3: Repeated-word guard ────────────────────────────────
  // "BALANCE BALANCE BALANCE BALANCE" / "RATING RATING RATING RATING" are PDF artifacts
  const words = upper.split(/\s+/).filter(Boolean);
  if (words.length >= 3) {
    const uniqueWords = new Set(words);
    // If 50%+ of the words are the same single word → PDF artifact
    const maxSameWord = Math.max(...Array.from(uniqueWords).map(w => words.filter(x => x === w).length));
    if (maxSameWord >= 3 && maxSameWord / words.length >= 0.5) {
      return { valid: false, reason: 'Repeated-word PDF artifact' };
    }
  }

  // ── v4.3/v4.4: Word count guard ──────────────────────────────
  // Real creditor names never have 7+ words. 7+ words = sentence fragment
  // or concatenated multi-name PDF artifact (tabular rows merged together).
  if (words.length >= 7) {
    return { valid: false, reason: 'Too many words for a creditor name (7+)' };
  }
  // 6-word names require an entity keyword (INC, LLC, BANK, etc.) or they look like sentences
  if (words.length > 5) {
    const ENTITY_WORDS = /\b(BANK|CREDIT|FINANCIAL|LENDING|CAPITAL|COLLECTION|RECOVERY|FUNDING|SERVICES?|GROUP|LLC|INC|CORP|ASSOCIATES?|MANAGEMENT|SYSTEMS?|SOLUTIONS?|PARTNERS?)\b/;
    if (!ENTITY_WORDS.test(upper)) {
      return { valid: false, reason: 'Too many words without entity keyword — looks like a sentence' };
    }
  }

  // Consumer name guard
  for (const variant of consumerInfo.nameVariants) {
    if (!variant || variant.length <= 3) continue;
    const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (upper === variant || new RegExp(`\\b${escaped}\\b`).test(upper)) {
      return { valid: false, reason: `Matches consumer name: ${variant}` };
    }
  }

  // Must have meaningful letter content.
  // FIX: split on word-boundary chars (&, -, /) before checking length,
  // so "AT&T" splits to ["AT", "T"] and "T-MOBILE" splits to ["T", "MOBILE"].
  const allLetters = upper.replace(/[^A-Z]/g, '');
  if (allLetters.length < 2) {
    return { valid: false, reason: 'No recognizable letter content' };
  }

  // Require at least one chunk with 2+ consecutive letters
  const wordChunks = upper.split(/[\s&\-\/+]+/).filter(w => /[A-Z]{2,}/.test(w));
  if (wordChunks.length === 0) {
    return { valid: false, reason: 'No recognizable words' };
  }

  // All digits (after stripping separators)
  if (/^\d+$/.test(upper.replace(/[\s\-,\.]/g, ''))) {
    return { valid: false, reason: 'All digits' };
  }

  return { valid: true };
}

// ── STATUS NORMALIZATION ──────────────────────────────────────
export function normalizeStatus(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .replace(/[_\-]+/g, ' ')
    .replace(/[()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── NEGATIVE TYPE CLASSIFICATION ──────────────────────────────
// FIX v4.2: Complete mapping. All known derogatory statuses from all bureaus.
//   - written off / bad debt → Charge-Off (was: Other Derogatory in v4.1)
//   - settled / settlement → Settlement (was: Other Derogatory)
//   - tax lien → Judgment/Lien (was: missing)
//   - chapter 7 / chapter 13 → Bankruptcy (was: only "bankrupt\w*")
//   - "collection account" as itemType → Collection (was: missing)
//   - voluntary repossession / surrender → Repossession
//   - seriously past due → Late Payment (was: caught only by generic "past due")
export function classifyNegativeType(
  status: string,
  itemType: string,
  remarks: string,
  paymentHistory: string,
): string | null {
  const combined = `${status} ${itemType} ${remarks} ${paymentHistory}`.toLowerCase();

  // ── Task 2: Good-standing pre-check ──────────────────────────
  // If the combined text contains a strong "account is fine" phrase AND lacks
  // a hard charge-off/collection anchor, reject immediately.
  // This prevents historical-late footnotes on current accounts from triggering
  // a Late Payment classification.
  const GOOD_STANDING_PHRASES = [
    'never late', '0 times late', '0 time late',
    'no late payment', 'pays as agreed', 'paid as agreed',
    'in good standing', 'current/never late', 'open/never late',
  ];
  const HARD_NEGATIVE_ANCHORS_EXT = [
    'charge off', 'charge-off', 'charged off', 'charged-off',
    'collection', 'written off', 'bad debt', 'repossess',
    'foreclos', 'bankruptcy',
  ];
  const hasGoodStandingPhrase = GOOD_STANDING_PHRASES.some(p => combined.includes(p));
  const hasHardNegative = HARD_NEGATIVE_ANCHORS_EXT.some(p => combined.includes(p));
  if (hasGoodStandingPhrase && !hasHardNegative) return null;

  // Bankruptcy (highest priority — overrides charge-off if both present)
  if (/bankrupt\w*|chapter\s+(?:7|11|13)|cbl|cbr|cbt|wep/.test(combined)) return 'Bankruptcy';

  // Foreclosure
  if (/foreclos/.test(combined)) return 'Foreclosure';

  // Repossession (including voluntary)
  if (/reposses|voluntary\s+(?:repo|surrender)/.test(combined)) return 'Repossession';

  // Judgment / Tax Lien (check before charge-off)
  if (/judgment|judgement|tax\s+lien|federal\s+tax|state\s+tax\s+lien|civil\s+judgment/.test(combined))
    return 'Judgment/Lien';

  // Charge-Off: explicit status + written-off variants + bad debt
  if (
    /charge[\s-]?off|charged[\s-]?off|profit.{0,5}loss|written[\s-]?off|bad\s+debt|written\s+off\s+as|amount\s+written\s+off|charged\s+to\s+(?:loss|profit)|unpaid\s+balance\s+reported\s+as\s+a\s+loss/.test(combined)
  ) return 'Charge-Off';

  // Collection Account type (explicit itemType field takes priority over generic "collection" keyword)
  if (/collection\s+account/.test(combined)) return 'Collection';

  // Collection status/action
  if (
    /\bcollection\b|in\s+collection|placed\s+(?:for|in)\s+collection|purchased\s+by|assigned\s+to\s+(?:attorney|collection)|transferred\s+to\s+(?:collection|attorney)|placed\s+with/.test(combined)
  ) return 'Collection';

  // Settlement (must check before generic "Other Derogatory")
  if (/settled\s+for\s+less|settled\s+less\s+than|partial\s+payment\s+accepted/.test(combined))
    return 'Settlement';
  if (/\bsettled\b|\bsettlement\b/.test(combined) && !/charge[\s-]?off|collection/.test(combined))
    return 'Settlement';

  // Derogatory catch-all
  if (/derogatory|account\s+closed\s+by|canceled\s+by|cancelled\s+by/.test(combined))
    return 'Other Derogatory';

  // Payment grid detection (CO = charge-off month markers)
  if (
    /\b(?:co\s+){2,}/.test(combined) ||
    /\b(?:30|60|90|120)(?:\s+(?:30|60|90|120)){1,}\b/.test(combined)
  ) return 'Charge-Off';

  return null;
}

// ── DATE PARSING ──────────────────────────────────────────────
export function parseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const str = raw.trim();
  if (!str || str.toLowerCase() === 'n/a' || str.toLowerCase() === 'unknown') return null;

  // MM/YYYY or MM/YY
  const mmyyyy = str.match(/^(\d{1,2})\s*[\/\-]\s*(\d{4})$/);
  if (mmyyyy) return `${mmyyyy[1].padStart(2, '0')}/${mmyyyy[2]}`;

  // YYYY-MM-DD
  const isoDate = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDate) return `${isoDate[2]}/${isoDate[1]}`;

  // Month YYYY (e.g., "Mar 2024")
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const monthYear = str.match(/^([A-Za-z]{3,})\s+(\d{4})$/);
  if (monthYear) {
    const m = months[monthYear[1].toLowerCase().slice(0, 3)];
    if (m) return `${m}/${monthYear[2]}`;
  }

  // MM/DD/YYYY
  const usDate = str.match(/^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})$/);
  if (usDate) return `${usDate[1].padStart(2, '0')}/${usDate[3]}`;

  return str; // Return as-is if can't normalize
}

export function calcAutoRemovalDate(dofd: string | null): string | null {
  if (!dofd) return null;
  try {
    const parts = dofd.split('/');
    let year: number, month: number;
    if (parts.length === 2) {
      month = parseInt(parts[0]) - 1;
      year = parseInt(parts[1]);
    } else return null;
    if (isNaN(year) || isNaN(month)) return null;
    const removal = new Date(year + 7, month, 1);
    return `${String(removal.getMonth() + 1).padStart(2, '0')}/${removal.getFullYear()}`;
  } catch { return null; }
}

// ── BUREAU DETECTION ──────────────────────────────────────────
export function detectBureaus(text: string): string[] {
  const upper = text.toUpperCase();
  const bureaus: string[] = [];
  if (/\bEQUIFAX\b/.test(upper)) bureaus.push('Equifax');
  if (/\bEXPERIAN\b/.test(upper)) bureaus.push('Experian');
  if (/TRANSUNION|TRANS\s*UNION/.test(upper)) bureaus.push('TransUnion');
  return bureaus.length > 0 ? bureaus : ['Equifax', 'Experian', 'TransUnion'];
}

// ── RAW ACCOUNT CANDIDATE TYPE ────────────────────────────────
export interface RawAccountCandidate {
  creditorName: string;
  accountNumber: string | null;
  balance: number | null;
  status: string;
  itemType: string;
  dateOfFirstDelinquency: string | null;
  dateLastReported: string | null;
  dateOpened: string | null;
  originalCreditor: string | null;
  bureaus: string[];
  remarks: string;
  paymentHistory: string;
  rawBlock: string;
  confidence: number;
  source: 'heuristic' | 'ai';
}

// ── THE MAIN HEURISTIC EXTRACTION ENGINE ─────────────────────
// STRATEGY v4.2:
//   Pass 1 — Section-aware: find POTENTIALLY NEGATIVE / ADVERSE sections,
//            process blocks within them at lower threshold.
//   Pass 2 — Full document block scan (blank-line separated).
//   Pass 3 — Line-based scan for dense/non-separated formats.
export function heuristicExtract(
  text: string,
  consumerInfo: ConsumerInfo,
  detectedBureaus: string[],
): RawAccountCandidate[] {
  const candidates: RawAccountCandidate[] = [];

  const addIfNew = (c: RawAccountCandidate) => {
    if (/(?:2024|2025|2026)/.test(c.creditorName)) return;
    const key = normalizeForCompare(c.creditorName);
    if (!candidates.some(x => normalizeForCompare(x.creditorName) === key)) {
      candidates.push(c);
    }
  };

  // ── Pass 1: Section-aware scan ──────────────────────────────
  const negativeSections = detectNegativeSections(text);
  for (const sectionText of negativeSections) {
    // Split section into sub-blocks
    const sectionBlocks = sectionText
      .split(/\n\s*\n+/)
      .filter(b => b.trim().length > 5);

    for (const block of sectionBlocks) {
      // Try standard extraction first
      const candidate = extractFromBlock(block, consumerInfo, detectedBureaus);
      if (candidate) {
        addIfNew(candidate);
        continue;
      }
      // In a confirmed negative section, use lenient extraction
      const lenient = extractFromBlockLenient(block, consumerInfo, detectedBureaus);
      if (lenient) addIfNew(lenient);
    }
  }

  // ── Pass 2: Full document block scan ────────────────────────
  const blocks = text.split(/\n\s*\n+/).filter(b => b.trim().length > 10);
  for (const block of blocks) {
    const candidate = extractFromBlock(block, consumerInfo, detectedBureaus);
    if (candidate) addIfNew(candidate);
  }

  // ── Pass 3: Line-based scan ──────────────────────────────────
  const lineBasedResults = lineBasedScan(text, consumerInfo, detectedBureaus);
  lineBasedResults.forEach(addIfNew);

  // ── AGGRESSIVE FALLBACK DEDUPLICATION ──
  const deduped: RawAccountCandidate[] = [];
  for (const c of candidates) {
    const cName = c.creditorName.replace(/[^A-Z0-9]/ig, '').substring(0, 4).toUpperCase();
    const cDate = c.dateOpened ? c.dateOpened.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/)?.[0] : null;

    const existing = deduped.find(e => {
      const eName = e.creditorName.replace(/[^A-Z0-9]/ig, '').substring(0, 4).toUpperCase();
      const eDate = e.dateOpened ? e.dateOpened.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/)?.[0] : null;
      return cName === eName && ((cDate && cDate === eDate) || (c.balance && c.balance === e.balance));
    });

    if (!existing) deduped.push(c);
  }
  return deduped;
}

function normalizeForCompare(name: string): string {
  return name.toLowerCase()
    .replace(/\s+[*x\d]{4,}[*x\d\s]*$/, '') // strip trailing account number
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\b(inc|llc|corp|ltd|co|na|bank|financial|services?|group)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── NEGATIVE SECTION DETECTOR ─────────────────────────────────
// FIX v4.2: New function. Detects Experian/Equifax/TransUnion section headers
// and returns the text content between the negative header and the next
// positive/neutral section header.
function detectNegativeSections(text: string): string[] {
  const NEGATIVE_HEADERS = [
    /^POTENTIALLY\s+NEGATIVE\s+(?:ITEMS?|ACCOUNTS?|INFORMATION)/i,
    /^POTENTIALLY\s+NEGATIVE\s+ITEMS?\s*\(/i,          // "Potentially Negative Items (2)"
    /^POTENTIALLY\s+NEGATIVE\s+ITEMS?\s+AND\b/i,
    /^ADVERSE\s+(?:ACCOUNTS?|ITEMS?|INFORMATION)/i,
    /^DEROGATORY\s+(?:ACCOUNTS?|ITEMS?|INFORMATION)/i,
    /^NEGATIVE\s+(?:ACCOUNTS?|ITEMS?|INFORMATION)/i,
    /^COLLECTION\s+ACCOUNTS?/i,
    /^CHARGE[\s-]?OFF\s+ACCOUNTS?/i,
    /^CHARGED[\s-]?OFF\s+ACCOUNTS?/i,
    /^PUBLIC\s+RECORDS?(?:\s+AND\s+COLLECTIONS?)?/i,
    /^ACCOUNTS?\s+WITH\s+(?:ADVERSE|NEGATIVE|DEROGATORY)/i,
    // ── v4.4: ACR and alternate bureau formats ────────────────
    /^(?:DEROGATORY|ADVERSE|NEGATIVE)\s+(?:MARKS?|RECORDS?|DATA)\b/i,
    /^ITEMS?\s+THAT\s+MAY\s+(?:NEGATIVELY|ADVERSELY)/i,
    /^INFORMATION\s+THAT\s+MAY\s+(?:NEGATIVELY|ADVERSELY)/i,
    /^NEGATIVE\s+(?:INFORMATION|MARKS?)\b/i,
    /^COLLECTIONS?\s+AND\s+DEROGATORY\b/i,
    /^ADVERSE\s+ITEMS?\b/i,
  ];

  const END_HEADERS = [
    /^ACCOUNTS?\s+IN\s+GOOD\s+STANDING/i,
    /^OPEN\s+ACCOUNTS?\s+IN\s+GOOD\s+STANDING/i,
    /^POSITIVE\s+ACCOUNTS?/i,
    /^SATISFACTORY\s+ACCOUNTS?/i,
    /^CREDIT\s+INQUIR/i,
    /^PERSONAL\s+(?:INFORMATION|PROFILE|STATEMENT)/i,
    /^EMPLOYMENT\s+(?:HISTORY|INFORMATION)/i,
    /^EMPLOYER\b/i,
    /^CONSUMER\s+STATEMENT/i,
    /^YOUR\s+RIGHTS\s+UNDER/i,
    /^DISPUTE\s+(?:FILE|INFORMATION|INSTRUCTIONS)/i,
    /^SUMMARY\s+OF\s+(?:RIGHTS|ACCOUNTS)/i,
  ];

  const lines = text.split('\n');
  const sections: string[] = [];
  let inSection = false;
  let sectionStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!inSection) {
      if (NEGATIVE_HEADERS.some(p => p.test(line))) {
        inSection = true;
        sectionStart = i;
      }
    } else {
      // End section at any non-negative section header
      if (END_HEADERS.some(p => p.test(line))) {
        const sectionText = lines.slice(sectionStart, i).join('\n').trim();
        if (sectionText.length > 30) sections.push(sectionText);
        inSection = false;
      }
    }
  }

  // Capture any unclosed section at end of document
  if (inSection) {
    const sectionText = lines.slice(sectionStart).join('\n').trim();
    if (sectionText.length > 30) sections.push(sectionText);
  }

  return sections;
}

// ── FIELD EXTRACTION PATTERNS ─────────────────────────────────
// FIX v4.2: Added "Date of Status" to dofd (Experian's collection date field).
// Note: [:\s]+ in patterns DOES consume newlines (since \s matches \n),
// so "Label:\nValue" is handled by the existing pattern structure.
const FIELD_PATTERNS = {
  accountNumber: [
    /account\s*(?:number|#|num)[.\s:]+([*X\d\-]{4,25})/i,
    /(?:acct|account)[\s#:]+([*X\d\-]{4,25})/i,
    /\b(\d{4}[*X]+\d{4})\b/,
    /\b([*X]{4,12}\d{4})\b/,
    /\b(\d{4}[*X]{4,12})\b/,
    /\b(\d{5,20})\b/,
  ],
  balance: [
    /(?:balance|amount\s+owed|current\s+balance)[\s:\-]*\$?\b(\d{1,7}(?:,\d{3})*(?:\.\d{2})?|0(?:\.00)?)\b/i,
    /(?:balance|balance\s+amount)[\s:\-]*\$?\b(\d{1,7}(?:,\d{3})*(?:\.\d{2})?|0(?:\.00)?)\b/i,
    /\$\s*\b(\d{1,7}(?:,\d{3})*(?:\.\d{2})?|0(?:\.00)?)\b(?:\s|$)/,
  ],
  status: [
    /(?:pay\s+status|payment\s+status|account\s+status|status)[:\s]+(.{3,80})(?:\n|$)/i,
    // Experian multi-word status that may include "/" characters
    /(?:account\s+status)\s*:\s*([^\n]{3,120})/i,
  ],
  itemType: [
    /(?:account\s+type|type|portfolio\s+type)[:\s]+(.{3,50})(?:\n|$)/i,
    // Experian type on the same line as the creditor name (e.g., "ASSET LLC   Collection")
    /(?:account\s+type)\s*:\s*([^\n]{3,50})/i,
  ],
  dofd: [
    /(?:date\s+of\s+first\s+delinquency|first\s+delinquency|dofd)[:\s]+(.{6,20})(?:\n|$)/i,
    /(?:delinquency\s+date)[:\s]+(.{6,20})(?:\n|$)/i,
    /(?:first\s+reported)[:\s]+(.{6,20})(?:\n|$)/i,
    // FIX v4.2: Experian "Date of Status" = when collection/charge-off was set (proxy for DOFD)
    /(?:date\s+of\s+status)[:\s]+(.{6,20})(?:\n|$)/i,
  ],
  dateLastReported: [
    /(?:date\s+(?:of\s+)?last\s+(?:activity|reported|payment|report))[:\s]+(.{6,20})(?:\n|$)/i,
    /(?:last\s+reported)[:\s]+(.{6,20})(?:\n|$)/i,
    /(?:reported\s+since)[:\s]+(.{6,20})(?:\n|$)/i,
    /(?:date\s+reported)[:\s]+(.{6,20})(?:\n|$)/i,
  ],
  dateOpened: [
    /(?:date\s+opened|opened|open\s+date)[:\s]+(.{6,20})(?:\n|$)/i,
    /(?:opened)[:\s]+(.{6,20})(?:\n|$)/i,
  ],
  originalCreditor: [
    /original\s+creditor[:\s]+(.{3,80})(?:\n|$)/i,
    /originally\s+(?:opened|reported)\s+by[:\s]+(.{3,80})(?:\n|$)/i,
    /sold\s+to[:\s]+(.{3,80})(?:\n|$)/i,
    /purchased\s+by[:\s]+(.{3,80})(?:\n|$)/i,
  ],
  remarks: [
    /(?:remarks|comment|notation)[:\s]+(.{3,200})(?:\n|$)/i,
  ],
};

// ── STANDARD BLOCK EXTRACTOR ──────────────────────────────────
// FIX v4.2: Falls back to raw-block classification when extracted fields
// alone can't classify the type (handles Experian's split label/value format).
function extractFromBlock(
  block: string,
  consumerInfo: ConsumerInfo,
  defaultBureaus: string[],
): RawAccountCandidate | null {
  const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  // Must have a negative signal somewhere in the block
  if (!hasNegativeSignal(block)) return null;

  // Disqualify if positive-only
  if (hasPositiveOnlySignal(block)) return null;

  // Extract fields
  const extractField = (patterns: RegExp[], text: string): string | null => {
    for (const p of patterns) {
      const m = text.match(p);
      if (m) return m[1].trim();
    }
    return null;
  };

  const accountNumber = extractField(FIELD_PATTERNS.accountNumber, block);
  const balanceRaw = extractField(FIELD_PATTERNS.balance, block);
  const balance = balanceRaw
    ? parseFloat(balanceRaw.replace(/,/g, '')) || null
    : null;
  const status = extractField(FIELD_PATTERNS.status, block) ?? '';
  const itemType = extractField(FIELD_PATTERNS.itemType, block) ?? '';
  const dofd = parseDate(extractField(FIELD_PATTERNS.dofd, block));
  const dateLastReported = parseDate(extractField(FIELD_PATTERNS.dateLastReported, block));
  const dateOpened = parseDate(extractField(FIELD_PATTERNS.dateOpened, block));
  const originalCreditor = extractField(FIELD_PATTERNS.originalCreditor, block);
  const remarks = extractField(FIELD_PATTERNS.remarks, block) ?? '';
  const paymentHistory = extractPaymentHistory(block);
  const bureaus = extractBureaus(block, defaultBureaus);

  // Find creditor name
  const creditorName = findCreditorName(lines, block, consumerInfo);
  if (!creditorName) return null;

  const nameCheck = isValidCreditorName(creditorName, consumerInfo);
  if (!nameCheck.valid) return null;

  // FIX v4.2: Try to classify from extracted fields first.
  // If that fails, run classifyNegativeType on the RAW BLOCK TEXT (catches Experian
  // inline statuses and cases where status is embedded in the block but not labeled).
  let negType = classifyNegativeType(status, itemType, remarks, paymentHistory);
  if (!negType) {
    negType = classifyNegativeType(block, block, '', '');
  }
  if (!negType && hasNegativeSignal(block)) {
    // Block has clear negative keywords but type is unclassifiable — include as Other Derogatory
    negType = 'Other Derogatory';
  }
  if (!negType) return null;

  let confidence = 0.7;
  if (accountNumber) confidence += 0.1;
  if (dofd) confidence += 0.05;
  if (balance !== null) confidence += 0.05;
  if (KNOWN_CREDITORS.has(creditorName.toUpperCase())) confidence += 0.15;
  if (bureaus.length >= 2) confidence += 0.05;

  return {
    creditorName,
    accountNumber: accountNumber ?? null,
    balance,
    status,
    itemType,
    dateOfFirstDelinquency: dofd,
    dateLastReported,
    dateOpened,
    originalCreditor,
    bureaus,
    remarks,
    paymentHistory,
    rawBlock: block,
    confidence: Math.min(1, confidence),
    source: 'heuristic',
  };
}

// ── LENIENT BLOCK EXTRACTOR (for confirmed negative sections) ─
// FIX v4.2: New function. Used when a block is inside a known-negative section
// (e.g., POTENTIALLY NEGATIVE ITEMS). Does not require hasNegativeSignal because
// the section header already tells us this is a negative area.
function extractFromBlockLenient(
  block: string,
  consumerInfo: ConsumerInfo,
  defaultBureaus: string[],
): RawAccountCandidate | null {
  const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
  // Need at least creditor name + one data field
  if (lines.length < 2) return null;

  // Skip positives
  if (hasPositiveOnlySignal(block)) return null;

  const extractField = (patterns: RegExp[], text: string): string | null => {
    for (const p of patterns) {
      const m = text.match(p);
      if (m) return m[1].trim();
    }
    return null;
  };

  const creditorName = findCreditorName(lines, block, consumerInfo);
  if (!creditorName) return null;

  const nameCheck = isValidCreditorName(creditorName, consumerInfo);
  if (!nameCheck.valid) return null;

  const accountNumber = extractField(FIELD_PATTERNS.accountNumber, block);
  const balanceRaw = extractField(FIELD_PATTERNS.balance, block);
  const balance = balanceRaw ? parseFloat(balanceRaw.replace(/,/g, '')) || null : null;
  const status = extractField(FIELD_PATTERNS.status, block) ?? '';
  const itemType = extractField(FIELD_PATTERNS.itemType, block) ?? '';
  const dofd = parseDate(extractField(FIELD_PATTERNS.dofd, block));
  const dateLastReported = parseDate(extractField(FIELD_PATTERNS.dateLastReported, block));
  const dateOpened = parseDate(extractField(FIELD_PATTERNS.dateOpened, block));
  const originalCreditor = extractField(FIELD_PATTERNS.originalCreditor, block);
  const remarks = extractField(FIELD_PATTERNS.remarks, block) ?? '';
  const paymentHistory = extractPaymentHistory(block);
  const bureaus = extractBureaus(block, defaultBureaus);

  // Try classification from fields, then raw block, then default to Collection
  // (we know this block is in a negative section)
  let negType = classifyNegativeType(status, itemType, remarks, paymentHistory);
  if (!negType) negType = classifyNegativeType(block, block, '', '');
  if (!negType) negType = 'Collection';

  return {
    creditorName,
    accountNumber: accountNumber ?? null,
    balance,
    status: status || negType,
    itemType: itemType || negType,
    dateOfFirstDelinquency: dofd,
    dateLastReported,
    dateOpened,
    originalCreditor,
    bureaus,
    remarks,
    paymentHistory,
    rawBlock: block,
    confidence: 0.55, // Lenient mode — lower confidence
    source: 'heuristic',
  };
}

// ── CREDITOR NAME FINDER ──────────────────────────────────────
// FIX v4.2: Added Strategy 2.5 to handle Experian's inline format where
// account type appears on the same line as creditor name (e.g.,
// "ASSET ACCEPTANCE LLC   Collection Account").
function findCreditorName(
  lines: string[],
  block: string,
  consumerInfo: ConsumerInfo,
): string | null {
  // Strategy 1: "Account Name CREDITOR NAME" labeled line (Experian)
  const accountNameLabel = block.match(
    /account\s+name\s+([A-Z][A-Z\s&,'.\-]{2,60})/i,
  );
  if (accountNameLabel) {
    const name = accountNameLabel[1].trim().toUpperCase();
    if (isValidCreditorName(name, consumerInfo).valid) return name;
  }

  // Strategy 2: Known creditor scan — check each line against known list
  for (const line of lines) {
    const upper = line.toUpperCase().trim();
    if (KNOWN_CREDITORS.has(upper)) return upper;
    // Partial known creditor match (for "CAPITAL ONE BANK NA" etc)
    for (const kc of KNOWN_CREDITORS) {
      if (upper.startsWith(kc) && upper.length <= kc.length + 20) {
        return upper.slice(0, kc.length + 20).trim();
      }
    }
  }

  // Strategy 2.5: Experian inline format — "CREDITOR NAME   ACCOUNT_TYPE"
  // Handles: "ASSET ACCEPTANCE LLC          Collection"
  //          "MIDLAND CREDIT MANAGEMENT     Charge Off"
  for (const line of lines) {
    const upper = line.toUpperCase().trim();
    const inlineMatch = upper.match(
      /^([A-Z][A-Z\s&,'.\-]{4,50}?)\s{3,}(COLLECTION\s*(?:ACCOUNT)?|CHARGE[\s-]?OFF|INSTALLMENT|REVOLVING|OPEN\s*ACCOUNT|MORTGAGE|AUTO(?:\s+LOAN)?|STUDENT(?:\s+LOAN)?|UNSECURED|SECURED)\b/,
    );
    if (inlineMatch) {
      const name = inlineMatch[1].trim();
      if (isValidCreditorName(name, consumerInfo).valid) return name;
    }
  }

  // Strategy 3: First non-field-label, non-metadata line
  for (const line of lines) {
    // ── v4.4: Only examine first tab-separated column (creditor name column).
    // Tabs are inserted by extractTextFromPDF when X-gap > 40 PDF units (tabular layout).
    // This prevents "CREDENCE RESOURCE MANAGE\tBALANCE" merging to "CREDENCE RESOURCE MANAGE BALANCE".
    const firstCol = line.includes('\t') ? line.split('\t')[0] : line;
    const upper = firstCol.toUpperCase().trim();
    // Skip field-value lines (lines with "Label: value" structure)
    if (/^[A-Z\s]+:\s/.test(firstCol)) continue;
    // Skip pure values (start with digit, $, -, /)
    if (/^[\d\$\-\/]/.test(firstCol)) continue;
    // ── v4.3/v4.4: Strip suffixes before validity check ──
    // Handles: "VERIZON WIRELESS 7740654810****" → "VERIZON WIRELESS"
    // Handles: "MIDLAND CREDIT MANAGEMENT INC 30495****" → "MIDLAND CREDIT MANAGEMENT INC"
    // Handles: "CREDENCE RESOURCE MANAGE BALANCE" → "CREDENCE RESOURCE MANAGE"
    // Handles: "JEFFERSON CAPITAL SYSTEMS - CLOSED" → "JEFFERSON CAPITAL SYSTEMS"
    const strippedUpper = upper
      .replace(/\s+[*X\d]{4,}[*X\d\s]*$/, '')             // trailing masked/raw account number
      .replace(/\s+(?:ACCT|ACCOUNT|ACCT#|ACCT\.)\s*[*X\d\-]{4,}\s*$/, '') // "ACCT 1234***" suffix
      .replace(/\s+BALANCE\s*$/, '')                        // tabular BALANCE column header suffix
      .replace(/\s*[-–]\s*CLOSED\s*$/, '')                  // "- CLOSED" account status suffix
      .replace(/\s+CLOSED\s*$/, '')                         // "CLOSED" account status suffix
      .replace(/\s+OPEN\s*$/, '')                           // "OPEN" column header suffix
      .trim();
    if (!strippedUpper) continue;
    // Check validity
    const check = isValidCreditorName(strippedUpper, consumerInfo);
    if (check.valid) {
      const words = strippedUpper.split(/\s+/).filter(Boolean);
      if (words.length >= 1 && words.length <= 8) {
        const hasEntityWord =
          /\b(BANK|CREDIT|FINANCIAL|LENDING|CAPITAL|COLLECTION|RECOVERY|FUNDING|SERVICES?|GROUP|LLC|INC|CORP|NA|FSB|ASSOCIATES?|SYSTEMS?|MANAGEMENT|SOLUTIONS?|PARTNERS?|ACQUISITION|HOLDINGS?)\b/i.test(strippedUpper);
        // FIX v4.2: wordChunks (split on &/-) so AT&T, T-MOBILE pass the alpha check
        const wordChunks = strippedUpper.split(/[\s&\-\/]+/).filter(w => /[A-Z]{2,}/.test(w));
        const hasAlphaWords = wordChunks.length >= 1;
        if (hasEntityWord || hasAlphaWords) return strippedUpper;
      }
    }
  }

  return null;
}

function extractPaymentHistory(block: string): string {
  const matches = block.match(
    /\b(?:OK|CO|30|60|90|120)(?:\s+(?:OK|CO|30|60|90|120)){2,}\b/gi,
  );
  return matches ? matches.join(' | ') : '';
}

function extractBureaus(block: string, defaultBureaus: string[]): string[] {
  const bureaus: string[] = [];
  const upper = block.toUpperCase();
  if (/\bEQUIFAX\b/.test(upper)) bureaus.push('Equifax');
  if (/\bEXPERIAN\b/.test(upper)) bureaus.push('Experian');
  if (/TRANSUNION|TRANS\s*UNION/.test(upper)) bureaus.push('TransUnion');
  return bureaus.length > 0 ? bureaus : [...defaultBureaus];
}

// ── LINE-BASED SCAN ───────────────────────────────────────────
// FIX v4.2: Removed KNOWN_CREDITORS-only restriction.
// v4.1 bug: Only scanned lines that matched KNOWN_CREDITORS — missed all
// unknown collectors (e.g., a regional agency not in the list).
// Now also detects ALL_CAPS entity names with collection/financial keywords.
function lineBasedScan(
  text: string,
  consumerInfo: ConsumerInfo,
  defaultBureaus: string[],
): RawAccountCandidate[] {
  const results: RawAccountCandidate[] = [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    // ── v4.4: Only examine first tab-separated column (creditor name column in tabular PDFs)
    const line = rawLine.includes('\t') ? rawLine.split('\t')[0] : rawLine;
    const upper = line.toUpperCase().trim();

    if (!isValidCreditorName(upper, consumerInfo).valid) continue;

    const isKnown =
      KNOWN_CREDITORS.has(upper) ||
      Array.from(KNOWN_CREDITORS).some(kc => upper.startsWith(kc));

    if (!isKnown) {
      // For unknown names, require entity word AND all-caps style
      const hasEntityWord =
        /\b(LLC|INC|CORP|LTD|BANK|FINANCIAL|CREDIT|COLLECTION|RECOVERY|FUNDING|SERVICES?|GROUP|MANAGEMENT|ASSOCIATES?|SYSTEMS?|SOLUTIONS?|PARTNERS?|CAPITAL|ACQUISITION|HOLDINGS?)\b/.test(upper);
      // All-caps: mostly uppercase letters, may have spaces/punctuation, no digits
      const isAllCapsStyle =
        /^[A-Z][A-Z\s&,'.\-]{4,}$/.test(upper) && !/\d/.test(upper);
      if (!hasEntityWord || !isAllCapsStyle) continue;
    }

    // Look ahead 20 lines for negative context
    const contextLines = lines.slice(i, i + 20);
    const context = contextLines.join('\n');

    if (!hasNegativeSignal(context)) continue;
    if (hasPositiveOnlySignal(context)) continue;

    const status = extractFieldFromContext(context, FIELD_PATTERNS.status) ?? '';
    const itemType = extractFieldFromContext(context, FIELD_PATTERNS.itemType) ?? '';
    const payHist = extractPaymentHistory(context);

    // Try classification from extracted fields, then from full context text
    let negType = classifyNegativeType(status, itemType, '', payHist);
    if (!negType) negType = classifyNegativeType(context, context, '', '');
    if (!negType) continue;

    results.push({
      creditorName: upper,
      accountNumber: extractFieldFromContext(context, FIELD_PATTERNS.accountNumber),
      balance: null,
      status,
      itemType,
      dateOfFirstDelinquency: null,
      dateLastReported: null,
      dateOpened: null,
      originalCreditor: null,
      bureaus: defaultBureaus,
      remarks: '',
      paymentHistory: payHist,
      rawBlock: context,
      confidence: isKnown ? 0.68 : 0.60,
      source: 'heuristic',
    });
  }

  return results;
}

function extractFieldFromContext(context: string, patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = context.match(p);
    if (m) return m[1].trim();
  }
  return null;
}
