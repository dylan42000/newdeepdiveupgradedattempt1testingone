// ============================================================
// letterTemplateService.ts — WORLD CLASS v4.1
// One letter per physical page. Court-grade typography.
// Print-ready, mail-ready, deletion-ready.
// ============================================================

import type { NegativeItem, LetterTemplateType } from '../types';
import { buildGroundedContext } from './letterGroundingService';
import { stripLetterBodyPreamble } from './letterBodySanitizer';

export interface LetterRenderOptions {
  content: string;
  senderName: string;
  senderAddress: string;
  senderCity: string;
  senderState: string;
  senderZip: string;
  senderPhone?: string;
  senderEmail?: string;
  senderDOB?: string;
  senderSSNLast4?: string;
  recipientName: string;
  recipientAddress: string;
  recipientCity: string;
  recipientState: string;
  recipientZip: string;
  date?: string;
  re?: string;
  certifiedMail?: boolean;
  certifiedNumber?: string;
  round?: number;
  totalRounds?: number;
  bureau?: string;
  templateType?: string;
  enclosures?: string[];
}

export function getPdfExportMarkup(html: string): string {
  const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const styleMarkup = styleMatch ? `<style>${styleMatch[1]}</style>` : '';
  const bodyMarkup = bodyMatch ? bodyMatch[1] : html;
  const exportOverrides = `
    <style>
      .letter-page .sender-block,
      .letter-page .sender-info,
      .letter-page .personal-info {
        margin: 0 0 12px 0 !important;
        padding: 0 !important;
        line-height: 1.05 !important;
        white-space: normal !important;
      }
      .letter-page .sender-block > p,
      .letter-page .sender-info > p,
      .letter-page .personal-info > p,
      .letter-page .recipient-block > p {
        display: block !important;
        margin: 0 !important;
        padding: 0 !important;
        line-height: 1.05 !important;
        white-space: normal !important;
      }
    </style>`;
  return `${styleMarkup}${exportOverrides}${bodyMarkup}`;
}

/**
 * ONE LETTER = ONE PAGE BOUNDARY.
 * This is the golden rule. Never break it.
 * Each call to renderLetter() produces a self-contained
 * HTML document that prints as exactly one letter,
 * starting fresh on a new page.
 */
export function renderLetter(opts: LetterRenderOptions): string {
  const today = opts.date ?? new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  const roundBadge = '';

  const certifiedBlock = opts.certifiedMail ? `
    <div class="certified-block">
      <span class="certified-label">✉ CERTIFIED MAIL — RETURN RECEIPT REQUESTED</span>
      ${opts.certifiedNumber
      ? `<span class="certified-number">Tracking: ${opts.certifiedNumber}</span>`
      : ''}
    </div>` : '';

  const enclosuresBlock = (opts.enclosures && opts.enclosures.length > 0)
    ? `<div class="enclosures">
        <strong>Enclosures:</strong>
        <ul>${opts.enclosures.map(e => `<li>${e}</li>`).join('')}</ul>
       </div>`
    : '';

  const ssnLine = opts.senderSSNLast4
    ? `<br><span class="sender-detail">SSN (Last 4): XXX-XX-${opts.senderSSNLast4}</span>`
    : '';

  const dobLine = opts.senderDOB
    ? `<br><span class="sender-detail">Date of Birth: ${opts.senderDOB}</span>`
    : '';

  const senderCityStateZip = [
    [opts.senderCity, opts.senderState].filter(Boolean).join(', '),
    opts.senderZip || '',
  ].filter(Boolean).join(' ').trim();

  const recipientCityStateZip = [
    [opts.recipientCity, opts.recipientState].filter(Boolean).join(', '),
    opts.recipientZip || '',
  ].filter(Boolean).join(' ').trim();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Dispute Letter — ${opts.bureau ?? 'Credit Bureau'}</title>
<style>
  /* ── RESET & BASE ── */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  /* ── PAGE ISOLATION — THE FIX ── */
  html, body, .letter-page, .letter-container {
    box-sizing: border-box;
    word-wrap: break-word;
    overflow-wrap: break-word;
    height: auto !important;
    min-height: 0 !important;
    display: block !important;
    background: #ffffff;
    margin: 0;
    padding: 0;
  }

  html, body {
    width: 100%;
    background: #ffffff;
    color: #000000;
    margin: 0;
    padding: 0;
  }

  /* ── STRICT WORD + PAGINATION SAFETY ── */
  body, p, div, span, .dispute-item {
    word-break: normal !important;
    overflow-wrap: normal !important;
    white-space: pre-wrap !important;
    page-break-inside: avoid !important;
    break-inside: avoid !important;
    font-size: 11.5pt !important;
    line-height: 1.4 !important;
    hyphens: none !important;
    -webkit-hyphens: none !important;
  }

  h1, h2, h3 {
    page-break-after: avoid !important;
    break-after: avoid !important;
  }

  /*
   * Outer containers must remain splittable so a letter longer than one page
   * can paginate between complete paragraphs instead of being clipped.
   */
  html, body, .letter-page, .letter-container, .letter-body {
    page-break-inside: auto !important;
    break-inside: auto !important;
  }

  html, body, .letter-page, .letter-container {
    white-space: normal !important;
  }

  p, h1, h2, h3, h4, h5, h6, .address-block, .signature-block {
    page-break-inside: avoid !important;
    break-inside: avoid !important;
  }

  .letter-page {
    width: 8.5in !important;
    max-width: 8.5in !important;
    min-height: auto;
    margin: 0 auto !important;
    padding: 1in !important;
    box-sizing: border-box !important;
    font-family: "Times New Roman", Times, serif;
    font-size: 12pt;
    line-height: 1.6;
    background: #ffffff;
    color: #000000;
    position: relative;
    display: block;
    page-break-inside: avoid;
    break-inside: avoid;
  }

  /* ── CERTIFIED MAIL HEADER ── */
  .certified-block {
    border: 2px solid #000;
    padding: 6pt 10pt;
    margin-bottom: 18pt;
    display: block;
    font-size: 10pt;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.5pt;
  }

  .certified-label { font-weight: 900; }
  .certified-number { font-family: "Courier New", monospace; font-size: 9pt; }

  /* ── ROUND BADGE ── */
  .round-badge {
    display: inline-block;
    margin-bottom: 12pt;
    font-size: 9pt;
    font-weight: bold;
    border: 1pt solid #000;
    padding: 3pt 8pt;
    font-family: Arial, sans-serif;
    letter-spacing: 0.5pt;
  }

  /* ── SENDER BLOCK ── */
  .letter-page .sender-block > p,
  .letter-page .sender-info > p,
  .letter-page .personal-info > p,
  .letter-page .recipient-block > p {
    display: block !important;
    margin: 0 !important;
    padding: 0 !important;
    line-height: 1.05 !important;
    white-space: normal !important;
  }
  .letter-page .sender-block,
  .letter-page .sender-info,
  .letter-page .personal-info {
    margin: 0 0 12px 0 !important;
    padding: 0 !important;
    line-height: 1.05 !important;
    white-space: normal !important;
  }
  .sender-name { font-weight: bold; font-size: 12pt; }
  .sender-detail { font-size: 11pt; }

  /* ── DATE ── */
  .letter-date { margin-bottom: 18pt; font-size: 12pt; }

  /* ── RECIPIENT BLOCK ── */
  .recipient-block {
    margin: 0 0 12pt 0 !important;
    padding: 0 !important;
    font-size: 12pt;
    line-height: 1.05 !important;
    white-space: normal !important;
  }
  .recipient-name { font-weight: bold; }

  /* ── RE LINE ── */
  .re-line {
    margin-bottom: 18pt;
    font-size: 12pt;
    font-weight: bold !important;
    text-align: center !important;
    width: 100%;
    display: block;
  }
  .re-line span { font-weight: bold; text-decoration: underline; }

  /* ── SALUTATION ── */
  .salutation { margin-bottom: 12pt; font-size: 12pt; }

  /* ── BODY ── */
  .letter-body {
    font-size: 11.5pt !important;
    line-height: 1.4 !important;
    margin-bottom: 18pt;
    text-align: left !important;
    word-break: normal !important;
    overflow-wrap: normal !important;
    white-space: normal !important;
    hyphens: none !important;
    -webkit-hyphens: none !important;
  }

  .letter-body p,
  .letter-body li,
  .dispute-item {
    margin-bottom: 12pt;
    page-break-inside: avoid !important;
    break-inside: avoid !important;
    word-break: normal !important;
    overflow-wrap: normal !important;
    white-space: pre-wrap !important;
    hyphens: none !important;
    -webkit-hyphens: none !important;
  }

  /* Legal citations — bold + italic per court standards */
  .letter-body .citation,
  .letter-body strong em,
  .letter-body em strong {
    font-weight: bold;
    font-style: italic;
  }

  /* Demand language — bold */
  .letter-body .demand { font-weight: bold; }

  /* ── CLOSING ── */
  .closing-block { margin-top: 24pt; margin-bottom: 48pt; font-size: 12pt; }
  .signature-name { font-weight: bold; margin-top: 36pt; font-size: 12pt; }
  .signature-title { font-size: 11pt; }

  /* ── ENCLOSURES ── */
  .enclosures {
    margin-top: 12pt;
    font-size: 11pt;
    border-top: 1pt solid #000;
    padding-top: 8pt;
  }
  .enclosures ul { margin-left: 18pt; margin-top: 6pt; }
  .enclosures li { margin-bottom: 3pt; }

  /* ── PRINT MEDIA ── */
  @media print {
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      background: #fff;
    }

    .letter-page {
      width: 8.5in !important;
      max-width: 8.5in !important;
      margin: 0 auto !important;
      padding: 1in !important;
      box-sizing: border-box !important;
      page-break-inside: avoid;
      break-inside: avoid;
    }

    @page {
      size: letter;
      margin: 0;
    }
  }

  /* ── PRE-BAKED CANVAS PATTERN ── */
  /* Exact 8.5x11 paper with 1-inch margins baked INSIDE the padding. */
  /* Centered via left:50% + translateX so preview and canvas both look correct. */
  .letter-page-clone {
    display: block !important;
    width: 816px !important;           /* 8.5 inches @ 96 dpi */
    padding: 96px !important;          /* 1-inch margin on all four sides */
    box-sizing: border-box !important;
    background-color: white !important;
    margin: 0 auto !important;
    position: absolute !important;
    top: 0 !important;
    left: 50% !important;
    transform: translateX(-50%) !important;
    z-index: -9999 !important;
    text-align: left !important;
    page-break-inside: avoid;
  }

  /* CRITICAL: Kill margin-collapse which pushes the canvas down */
  .letter-page-clone > :first-child,
  .letter-page-clone * {
    margin-top: 0 !important;
  }

  /* Restore normal paragraph spacing, but safely */
  .letter-page-clone p {
    margin-bottom: 1em !important;
    page-break-inside: avoid;
  }

  .letter-page-clone .sender-info p,
  .letter-page-clone .header p,
  .letter-page-clone .personal-info p {
    margin: 0 !important;
    padding: 0 !important;
    line-height: 1.15 !important;
  }
</style>
</head>
<body>
<div class="letter-page">
  ${roundBadge}
  ${certifiedBlock}

  <div class="sender-block sender-info personal-info">
    <p class="sender-lines"><span class="sender-name">${opts.senderName}</span><br>
    <span class="sender-detail">${opts.senderAddress}</span>
    ${senderCityStateZip ? `<br><span class="sender-detail">${senderCityStateZip}</span>` : ''}
    ${opts.senderPhone ? `<br><span class="sender-detail">Phone: ${opts.senderPhone}</span>` : ''}
    ${opts.senderEmail ? `<br><span class="sender-detail">Email: ${opts.senderEmail}</span>` : ''}
    ${dobLine}${ssnLine}</p>
  </div>

  <p class="letter-date">${today}</p>

  <div class="recipient-block">
    <p class="recipient-name">${opts.recipientName}</p>
    <p>${opts.recipientAddress}</p>
    ${recipientCityStateZip ? `<p>${recipientCityStateZip}</p>` : ''}
  </div>

  ${opts.re ? `<p class="re-line"><span>RE:</span> ${opts.re}</p>` : ''}

  <div class="letter-body">
    ${opts.content}
  </div>

  <div class="closing-block">
    <p>Sincerely,</p>
    <br><br><br>
    <p class="signature-name">${opts.senderName}</p>
  </div>

  ${enclosuresBlock}
</div>
</body>
</html>`;
}

/**
 * BATCH RENDERER — Critical function.
 * Wraps multiple letters into ONE HTML document
 * with guaranteed page isolation between each letter.
 * This is what the PDF exporter and print dialog receive.
 */
export function renderLetterBatch(letters: LetterRenderOptions[]): string {
  if (letters.length === 0) return '';
  if (letters.length === 1) return renderLetter(letters[0]);

  // Build combined document with hard page breaks between letters
  const pages = letters.map((opts, idx) => {
    const singleHtml = renderLetter(opts);
    // Extract just the letter-page div from each individual render
    const bodyMatch = singleHtml.match(/<body>([\s\S]*?)<\/body>/);
    const pageContent = bodyMatch ? bodyMatch[1] : singleHtml;
    return pageContent;
  }).join('\n<!-- PAGE BREAK -->\n');

  // Wrap in single document with shared styles
  const firstRender = renderLetter(letters[0]);
  const styleMatch = firstRender.match(/<style>([\s\S]*?)<\/style>/);
  const styles = styleMatch ? styleMatch[1] : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Dispute Letter Batch — ${letters.length} Letters</title>
<style>
${styles}
/* Batch-specific: enforce page breaks between all letter-pages */
.letter-page + .letter-page {
  page-break-before: always;
  break-before: page;
}
@media print {
  .letter-page {
    page-break-before: always;
    break-before: page;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .letter-page:first-of-type {
    page-break-before: auto;
    break-before: auto;
  }
}
</style>
</head>
<body>
${pages}
</body>
</html>`;
}

/**
 * PDF EXPORT CONFIG for html2pdf.js
 * PRE-BAKED CANVAS PATTERN: margin: 0 because margins are baked into the CSS.
 * Use these options EXACTLY — they guarantee one letter per page.
 */
export const PDF_EXPORT_OPTIONS = {
  margin: 0, // CRITICAL: Disabled. We are baking the margin into the CSS.
  filename: 'dispute-letter.pdf',
  image: { type: 'jpeg' as const, quality: 1 },
  html2canvas: {
    scale: 2,
    useCORS: true,
    scrollX: 0,
    scrollY: 0,
    x: 0,
    y: 0,
    width: 816,
    windowWidth: 816,
  },
  jsPDF: {
    unit: 'in',
    format: 'letter',
    orientation: 'portrait' as const,
    compress: true,
  },
  pagebreak: {
    mode: ['avoid-all', 'css', 'legacy'],
    before: '.letter-page',
    avoid: [
      '.certified-block',
      '.sender-block',
      '.recipient-block',
      '.letter-body p',
      '.letter-body li',
      '.dispute-item',
      'h1',
      'h2',
      'h3',
    ],
  },
};

export const BATCH_PDF_OPTIONS = (filename: string) => ({
  ...PDF_EXPORT_OPTIONS,
  filename,
  margin: 0, // CRITICAL: PRE-BAKED CANVAS — margins in CSS, not here
  pagebreak: {
    mode: ['css', 'legacy'],
    before: '.letter-page',
  },
});

// ── V2 ENGINE COMPATIBILITY SHIMS ─────────────────────────────
// autoPilotEngineV2.ts uses these legacy exports.
export interface LetterPersonalInfo {
  firstName: string;
  lastName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  ssn?: string;
  dob?: string;
}

interface BuildLetterHTMLParams {
  content: string;
  personalInfo: LetterPersonalInfo;
  items: NegativeItem[];
  bureau: string;
  round: number;
  templateType: LetterTemplateType | string;
  certifiedMail?: boolean;
  passNumber?: number;
  totalPasses?: number;
}

export function getAccountTail(item: NegativeItem): string {
  if (item && (item as any).accountNumberTail) {
    const tail = String((item as any).accountNumberTail).replace(/\D/g, "").slice(-4);
    if (tail && tail.length === 4) return tail;
  }
  if (item && (item as any).accountTail) {
    const tail = String((item as any).accountTail).replace(/\D/g, "").slice(-4);
    if (tail && tail.length === 4) return tail;
  }
  if (item) {
    try {
      const grounded = buildGroundedContext(item);
      const groundedTail = grounded.allowedFacts.accountTail || grounded.allowedFacts.accountNumber;
      if (groundedTail && groundedTail !== "XXXX" && groundedTail !== "unconfirmed") {
        const tail = String(groundedTail).replace(/\D/g, "").slice(-4);
        if (tail && tail.length === 4) return tail;
      }
    } catch (e) {
      // ignore
    }
  }
  if (item && (item.fullAccountNumber || item.accountNumber)) {
    const raw = String(item.fullAccountNumber || item.accountNumber);
    const digits = raw.replace(/\D/g, "");
    if (digits.length >= 4) return digits.slice(-4);
    // Masked as-reported token without inventing digits
    const visible = raw.replace(/[^0-9A-Za-z]/g, "").slice(-4);
    if (visible.length >= 2) return visible;
  }
  // Never invent account digits (no fake 1234)
  return "unconfirmed";
}

export function maskAccountNumber(acct: string | null | undefined, item?: NegativeItem | null): string {
  // 1. Prefer the last 4 digits of the explicitly provided account number string
  let tail = "";
  if (acct) {
    const digits = acct.replace(/\D/g, "").slice(-4);
    if (digits.length === 4) tail = digits;
  }
  // 2. If the account string didn't yield 4 digits, pull from the NegativeItem
  if ((!tail || tail.length < 4) && item) {
    const fromItem = getAccountTail(item);
    if (fromItem && fromItem !== "unconfirmed") tail = fromItem;
  }
  // 3. Never fabricate digits — use as-reported placeholder when unknown
  if (!tail || tail.length < 4 || tail === "unconfirmed") {
    return "XXXX-????";
  }
  // ANTI-SPAM FORMAT: 4 Xs then the real 4 digits (e.g. "XXXX-1234").
  return `XXXX-${tail}`;
}

function getBureauAddress(bureau: string): string {
  const addresses: Record<string, string> = {
    equifax: 'Equifax Information Services LLC\nP.O. Box 740256\nAtlanta, GA 30374-0256',
    experian: 'Experian\nP.O. Box 4500\nAllen, TX 75013',
    transunion: 'TransUnion Consumer Solutions\nP.O. Box 2000\nChester, PA 19016',
  };
  const key = (bureau || '').toLowerCase().trim();
  return addresses[key] || bureau;
}

export function buildSenderBlock(personalInfo: LetterPersonalInfo): string {
  const name = `${personalInfo.firstName ?? ''} ${personalInfo.lastName ?? ''}`.trim() || '[YOUR NAME]';
  const addr1 = personalInfo.address || '[YOUR STREET ADDRESS]';
  const cityStateZip = `${personalInfo.city || '[CITY]'}, ${personalInfo.state || '[ST]'} ${personalInfo.zip || '[ZIP]'}`;
  const phone = personalInfo.phone ? `<br>Phone: ${personalInfo.phone}` : '';
  const email = personalInfo.email ? `<br>Email: ${personalInfo.email}` : '';

  return `
    <div class="sender-block" style="font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 1.6; margin-bottom: 20px;">
      <strong>${name}</strong><br>
      ${addr1}<br>
      ${cityStateZip}
      ${phone}
      ${email}
    </div>
  `;
}

export function buildRecipientBlock(bureau: string, contactAddress?: string | null): string {
  const isBureau = ['equifax', 'experian', 'transunion'].includes((bureau || '').toLowerCase().trim());
  const recipientAddress = (isBureau ? getBureauAddress(bureau) : (contactAddress || getBureauAddress(bureau) || '')).trim();
  const lines = recipientAddress.split(/\r?\n/).filter(Boolean);
  return `
    <div class="recipient-block" style="font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 1.6; margin-bottom: 20px;">
      ${lines.map((line) => `${line}<br>`).join('')}
    </div>
  `;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeLetterBody(raw: string): { reLine: string; bodyHtml: string } {
  // Strip AI-emitted sender/recipient identity dumps before paragraph wrapping.
  // The structured header is rendered separately by renderLetter().
  const cleaned = stripLetterBodyPreamble(
    (raw || '')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/^\s*here(?:\sis)?\s+\w+\s+letter:?\s*/i, '')
      .replace(/\r\n/g, '\n')
      .trim(),
  );

  const lines = cleaned.split('\n');
  let reLine = '';

  while (lines.length > 0 && lines[0].trim() === '') lines.shift();

  // BUG-10 SUPPORT FIX: Strip HTML <p>RE:...</p> patterns from legacy buildWorldClassFallback output.
  // Before the fix, buildWorldClassFallback opened with <p>RE:...</p> — after the fix it doesn't,
  // but existing stored letters may still have it. This guard handles both.
  if (lines[0] && /^<p>\s*re\s*:/i.test(lines[0].trim())) {
    const htmlReLine = lines.shift()!;
    // Extract the RE text from the HTML tag for use as the reLine
    const extracted = htmlReLine.replace(/<\/?p>/gi, '').replace(/^re\s*:\s*/i, '').trim();
    if (extracted) reLine = extracted;
  }

  if (lines[0] && /^re\s*:/i.test(lines[0].trim())) {
    reLine = lines.shift()!.trim().replace(/^re\s*:/i, '').trim();
  }

  const filtered = lines
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      if (/^to whom it may concern[:]?$/i.test(t)) return false;
      if (/^(sincerely|respectfully|regards)[,]?$/i.test(t)) return false;
      return true;
    })
    .join('\n')
    .trim();

  // BUG-10 FIX: If the body already contains block-level HTML elements (produced by
  // buildWorldClassFallback or any AI model that returns HTML), skip the paragraph-wrapping
  // and escapeHtml pipeline — they would double-encode the tags into visible &lt;p&gt; text.
  if (/<(p|div|br|ul|ol|li|h[1-6])\b/i.test(filtered)) {
    return { reLine, bodyHtml: filtered };
  }

  const paragraphs = filtered
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n+/g, ' ').trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join('\n');

  return {
    reLine,
    bodyHtml: paragraphs || `<p>${escapeHtml(filtered || cleaned || 'Please see attached dispute narrative.')}</p>`,
  };
}

function parseRecipientAddress(address: string, targetName?: string): {
  line1: string;
  city: string;
  state: string;
  zip: string;
} {
  const isBureau = ['equifax', 'experian', 'transunion'].includes((targetName || '').toLowerCase().trim());
  let addressToParse = isBureau ? getBureauAddress(targetName || '') : address;
  if (!addressToParse || addressToParse.toLowerCase().includes('address on file')) {
    addressToParse = isBureau ? getBureauAddress(targetName || '') : 'P.O. Box 123\nUnknown, XX 00000';
  }
  const lines = addressToParse
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { line1: addressToParse || 'P.O. Box 123', city: 'Unknown', state: 'XX', zip: '00000' };
  }

  const cityStateZipLine = lines[lines.length - 1];
  const csz = cityStateZipLine.match(/^(.+?),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (!csz) {
    return {
      line1: lines.join(', '),
      city: '',
      state: '',
      zip: '',
    };
  }

  const line1 = lines.slice(0, -1).join(', ').trim() || 'P.O. Box 123';
  return {
    line1,
    city: csz[1].trim(),
    state: csz[2].toUpperCase(),
    zip: csz[3],
  };
}

export function buildLetterHTML(
  letter: {
    letterContent?: string;
    htmlContent?: string;
    content?: string;
    targetName?: string;
    targetAddress?: string;
    itemName?: string;
    passNumber?: number;
  },
  info: LetterPersonalInfo,
): string;
export function buildLetterHTML(params: BuildLetterHTMLParams): string;
export function buildLetterHTML(
  arg1: {
    letterContent?: string;
    htmlContent?: string;
    content?: string;
    targetName?: string;
    targetAddress?: string;
    itemName?: string;
    passNumber?: number;
  } | BuildLetterHTMLParams,
  info?: LetterPersonalInfo,
): string {
  if (!info && 'personalInfo' in arg1) {
    const params = arg1 as BuildLetterHTMLParams;
    const primaryItem = params.items[0];
    const reLine = primaryItem
      ? `Dispute of Account - ${primaryItem.creditorName} | Account: ${maskAccountNumber(primaryItem.accountNumber, primaryItem)}`
      : 'Credit Report Dispute';

    const todayFormatted = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const senderBlock = buildSenderBlock(params.personalInfo);
    const recipientBlock = buildRecipientBlock(params.bureau, primaryItem?.disputeContactAddress);
    const passBadge = '';
    const certifiedMailHeader = params.certifiedMail
      ? '<div style="font-weight:bold;text-transform:uppercase;margin-bottom:16px;">Via Certified Mail - Return Receipt Requested</div>'
      : '';

    let bodyContent = params.content || '';
    if (primaryItem) {
      const tail = getAccountTail(primaryItem);
      const replacement = `XXXXX-${tail}`;
      bodyContent = bodyContent.replace(/(?:\b|(?<=\s))([*xX]{4,}(?:-\d{1,4}|\d{1,4})?)(?=\b|(?=\s)|$)/gi, (match) => {
        if (match.match(/X{3}-X{2}-\d{4}/i)) return match;
        return replacement;
      });
    }

    // Always normalize: strip duplicated identity preamble + wrap paragraphs.
    // Previously this overload injected raw plain text into .letter-body, which
    // collapsed newlines and left AI-emitted header dumps as a run-on line.
    const { reLine: extractedRe, bodyHtml } = normalizeLetterBody(bodyContent);

    const ssnDigits = (params.personalInfo.ssn ?? '').replace(/\D/g, '');
    const recipientAddress = parseRecipientAddress(params.bureau || '', params.bureau || '');

    return renderLetter({
      content: bodyHtml,
      senderName: `${params.personalInfo.firstName} ${params.personalInfo.lastName}`.trim() || 'Consumer',
      senderAddress: params.personalInfo.address || 'P.O. Box 123',
      senderCity: params.personalInfo.city || '',
      senderState: params.personalInfo.state || '',
      senderZip: params.personalInfo.zip || '',
      senderPhone: params.personalInfo.phone || undefined,
      senderEmail: params.personalInfo.email || undefined,
      senderDOB: params.personalInfo.dob || undefined,
      senderSSNLast4: ssnDigits.length >= 4 ? ssnDigits.slice(-4) : undefined,
      recipientName: params.bureau || 'Credit Reporting Department',
      recipientAddress: recipientAddress.line1,
      recipientCity: recipientAddress.city,
      recipientState: recipientAddress.state,
      recipientZip: recipientAddress.zip,
      date: todayFormatted,
      re: extractedRe || reLine || 'Credit Report Dispute',
      certifiedMail: params.certifiedMail,
      round: typeof params.round === 'number' ? params.round : undefined,
      totalRounds: params.totalPasses ?? 5,
      bureau: params.bureau || undefined,
      templateType: params.templateType,
    });
  }

  const letter = arg1 as {
    letterContent?: string;
    htmlContent?: string;
    content?: string;
    targetName?: string;
    targetAddress?: string;
    itemName?: string;
    passNumber?: number;
  };
  const safeInfo = info as LetterPersonalInfo;

  if (letter.htmlContent && /<html[\s>]/i.test(letter.htmlContent)) {
    return letter.htmlContent;
  }

  const rawBody = letter.letterContent ?? letter.content ?? '';
  let interceptedBody = rawBody;

  if (letter.itemName) {
    // Find the tail from the item name or some logic if primaryItem is not available directly
    // Since we don't have the full item here, we might not be able to get the exact tail, 
    // but we can try to find it or default. Let's assume the body was processed elsewhere if item isn't passed,
    // or we can use a regex replacement if we find a tail in the text.
    // But actually, buildLetterHTML usually gets called with the first signature (params: BuildLetterHTMLParams) when item is available.
    // If it's the second signature, we just replace it if we can find it.
  }

  interceptedBody = interceptedBody.replace(/(?:\b|(?<=\s))([*xX]{4,}(?:-\d{1,4}|\d{1,4})?)(?=\b|(?=\s)|$)/gi, (match) => {
    // Preserve SSN mask patterns (e.g. "XXX-XX-1234") unchanged
    if (match.match(/X{3}-X{2}-\d{4}/i)) return match;
    // In the second buildLetterHTML overload we do not have the NegativeItem
    // available, so we cannot resolve the real account tail here.
    // Leave unresolvable placeholders unchanged rather than substituting a
    // generic mask — the first overload (with personalInfo + items) always
    // resolves the tail correctly before reaching this branch.
    return match;
  });

  const { reLine, bodyHtml } = normalizeLetterBody(interceptedBody);
  const recipient = parseRecipientAddress(letter.targetAddress ?? '', letter.targetName);
  const ssnDigits = (safeInfo.ssn ?? '').replace(/\D/g, '');

  const defaultRe = `Formal Dispute - ${letter.itemName ?? 'Account on File'}`;

  return renderLetter({
    content: bodyHtml,
    senderName: `${safeInfo.firstName} ${safeInfo.lastName}`.trim() || 'Consumer',
    senderAddress: safeInfo.address || 'P.O. Box 123',
    senderCity: safeInfo.city || '',
    senderState: safeInfo.state || '',
    senderZip: safeInfo.zip || '',
    senderPhone: safeInfo.phone || undefined,
    senderEmail: safeInfo.email || undefined,
    senderDOB: safeInfo.dob || undefined,
    senderSSNLast4: ssnDigits.length >= 4 ? ssnDigits.slice(-4) : undefined,
    recipientName: letter.targetName || 'Credit Reporting Department',
    recipientAddress: recipient.line1,
    recipientCity: recipient.city,
    recipientState: recipient.state,
    recipientZip: recipient.zip,
    re: reLine || defaultRe,
    round: typeof letter.passNumber === 'number' ? letter.passNumber : undefined,
    totalRounds: 5,
    bureau: letter.targetName || undefined,
  });
}
