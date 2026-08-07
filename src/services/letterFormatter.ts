/**
 * Letter Formatter Service
 * Generates print-ready HTML for dispute letters.
 * Used by:
 *   - Windows: Electron IPC "print-to-pdf" handler
 *   - Android: Capacitor Share plugin / File Save
 *   - Browser: window.print() fallback
 */

import type { GeneratedLetter } from './disputeEngine';
import { stripLetterBodyPreamble } from './letterBodySanitizer';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Optional metadata that callers can attach when passing a letter to the formatter. */
export interface LetterMetadata {
  recipientName?: string;
  recipientAddress?: string;
  subject?: string;
  accountName?: string;
}

/** Accepted input: a GeneratedLetter plus optional display metadata. */
export type LetterFormatInput = GeneratedLetter & LetterMetadata;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LetterFormattingOptions {
  senderName: string;
  senderAddress: string;
  senderCity: string;
  senderState: string;
  senderZip: string;
  senderPhone?: string;
  senderEmail?: string;
  /** SSN last 4 digits (for bureau verification block — show as XXX-XX-XXXX) */
  ssnLast4?: string;
  dateOfBirth?: string; // YYYY-MM-DD
  certifiedMailNumber?: string;
  /** Show "VIA CERTIFIED MAIL, RETURN RECEIPT REQUESTED" block */
  showCertifiedMailBlock?: boolean;
  /** Attach list of enclosures at the bottom */
  enclosures?: string[];
}

export interface FormattedLetter {
  html: string;
  plainText: string;
  recipientName: string;
  subject: string;
  wordCount: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(date?: Date | string): string {
  const d = date ? new Date(date) : new Date();
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function bodyTextToHtml(text: string): string {
  // Convert plain text letter body to paragraphs
  return text
    .split(/\n{2,}/)
    .map(para => `<p>${escapeHtml(para.replace(/\n/g, ' ')).trim()}</p>`)
    .join('\n');
}

// ─── CSS Styles ───────────────────────────────────────────────────────────────

const LETTER_CSS = `
  body {
    font-family: 'Times New Roman', Times, serif;
    font-size: 12pt;
    line-height: 1.5;
    color: #000;
    max-width: 6.5in;
    margin: 0;
    padding: 0;
  }
  .sender-block { margin-bottom: 1em; }
  .sender-block p { margin: 0; line-height: 1.4; }
  .date-block { margin-bottom: 1.5em; }
  .certified-block {
    border: 1px solid #000;
    padding: 0.4em 0.8em;
    display: inline-block;
    margin-bottom: 1em;
    font-size: 10pt;
    font-weight: bold;
    letter-spacing: 0.05em;
  }
  .recipient-block { margin-bottom: 1.5em; }
  .recipient-block p { margin: 0; line-height: 1.4; }
  .re-line { margin-bottom: 1.5em; }
  .re-line strong { text-decoration: underline; }
  .salutation { margin-bottom: 1em; }
  .body-content p { margin: 0 0 1em 0; }
  .closing-block { margin-top: 2em; }
  .signature-space { height: 3em; }
  .printed-name { margin: 0; }
  .enclosures { margin-top: 2em; border-top: 1px solid #ccc; padding-top: 1em; font-size: 10pt; }
  .dna-footer { margin-top: 3em; font-size: 7pt; color: #999; border-top: 1px solid #eee; padding-top: 0.5em; word-break: break-all; }
  @media print {
    body { margin: 0; max-width: 100%; }
    .dna-footer { display: none; }
  }
`;

// ─── Main formatter ───────────────────────────────────────────────────────────

/**
 * Format a GeneratedLetter into print-ready HTML.
 */
export function formatLetterToHtml(
  letter: LetterFormatInput,
  options: LetterFormattingOptions
): FormattedLetter {
  const date = formatDate();

  // Parse recipient from letter metadata
  const recipientName = letter.recipientName ?? letter.bureauName;
  const recipientAddress = letter.recipientAddress ?? '';

  // Build subject / RE line
  const subject = letter.subject ?? `Re: Dispute of Inaccurate Credit Information — ${letter.accountName ?? 'Account on File'}`;

  // Sender identification block
  const senderIdLine = options.ssnLast4
    ? `SSN: XXX-XX-${options.ssnLast4}`
    : '';
  const dobLine = options.dateOfBirth
    ? `Date of Birth: ${formatDate(options.dateOfBirth)}`
    : '';

  // Body HTML — GeneratedLetter stores the text in `content`
  const sanitizedBody = stripLetterBodyPreamble(letter.content ?? '');
  const bodyHtml = bodyTextToHtml(sanitizedBody);

  // Enclosures block
  const enclosuresHtml = options.enclosures && options.enclosures.length > 0
    ? `<div class="enclosures"><strong>Enclosures:</strong><ul>${options.enclosures.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul></div>`
    : '';

  // DNA hash footer (hidden on print)
  const dnaFooter = letter.dnaHash
    ? `<div class="dna-footer">Letter DNA: ${escapeHtml(letter.dnaHash)}</div>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(subject)}</title>
  <style>${LETTER_CSS}</style>
</head>
<body>

  <div class="sender-block">
    <p>${escapeHtml(options.senderName)}</p>
    <p>${escapeHtml(options.senderAddress)}</p>
    <p>${escapeHtml(options.senderCity)}, ${escapeHtml(options.senderState)} ${escapeHtml(options.senderZip)}</p>
    ${options.senderPhone ? `<p>Phone: ${escapeHtml(options.senderPhone)}</p>` : ''}
    ${options.senderEmail ? `<p>Email: ${escapeHtml(options.senderEmail)}</p>` : ''}
    ${senderIdLine ? `<p>${escapeHtml(senderIdLine)}</p>` : ''}
    ${dobLine ? `<p>${escapeHtml(dobLine)}</p>` : ''}
  </div>

  <div class="date-block">
    <p>${date}</p>
  </div>

  ${options.showCertifiedMailBlock !== false ? `
  <div class="certified-block">
    VIA CERTIFIED MAIL, RETURN RECEIPT REQUESTED${
      options.certifiedMailNumber ? `<br />CMRRR # ${escapeHtml(options.certifiedMailNumber)}` : ''
    }
  </div>
  ` : ''}

  <div class="recipient-block">
    ${recipientName ? `<p><strong>${escapeHtml(recipientName)}</strong></p>` : ''}
    ${recipientAddress ? recipientAddress.split('\n').map(l => `<p>${escapeHtml(l)}</p>`).join('') : ''}
  </div>

  <div class="re-line">
    <p><strong>RE: ${escapeHtml(subject.replace(/^Re: /i, ''))}</strong></p>
  </div>

  <div class="salutation">
    <p>To Whom It May Concern:</p>
  </div>

  <div class="body-content">
    ${bodyHtml}
  </div>

  <div class="closing-block">
    <p>Sincerely,</p>
    <div class="signature-space"></div>
    <p class="printed-name">${escapeHtml(options.senderName)}</p>
  </div>

  ${enclosuresHtml}
  ${dnaFooter}

</body>
</html>`;

  // Build plain text version
  const plainText = [
    options.senderName,
    options.senderAddress,
    `${options.senderCity}, ${options.senderState} ${options.senderZip}`,
    options.senderPhone ? `Phone: ${options.senderPhone}` : '',
    options.senderEmail ? `Email: ${options.senderEmail}` : '',
    senderIdLine,
    dobLine,
    '',
    date,
    '',
    'VIA CERTIFIED MAIL, RETURN RECEIPT REQUESTED',
    options.certifiedMailNumber ? `CMRRR # ${options.certifiedMailNumber}` : '',
    '',
    recipientName,
    recipientAddress,
    '',
    subject,
    '',
    'To Whom It May Concern:',
    '',
    sanitizedBody,
    '',
    'Sincerely,',
    '',
    '',
    options.senderName,
    '',
    ...(options.enclosures?.length ? ['Enclosures:', ...options.enclosures.map(e => `  - ${e}`)] : []),
  ].filter(l => l !== undefined).join('\n');

  const wordCount = sanitizedBody.split(/\s+/).filter(Boolean).length;

  return { html, plainText, recipientName: recipientName ?? '', subject, wordCount };
}

/**
 * Format multiple letters into a combined print binder.
 * Useful for the "Export Dispute Binder" feature.
 */
export function formatLetterBinder(
  letters: LetterFormatInput[],
  options: LetterFormattingOptions,
  binderTitle = 'Dispute Binder'
): string {
  const letterPages = letters.map(letter => {
    const { html } = formatLetterToHtml(letter, options);
    // Extract just the body content between <body> tags
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    return bodyMatch ? bodyMatch[1] : html;
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(binderTitle)}</title>
  <style>
    ${LETTER_CSS}
    .page-break { page-break-after: always; border-bottom: 2px dashed #ccc; margin: 2em 0; }
    .cover-page { text-align: center; padding: 2in 1in; }
    .cover-page h1 { font-size: 24pt; margin-bottom: 0.5em; }
    .cover-page p { font-size: 12pt; color: #333; }
  </style>
</head>
<body>
  <div class="cover-page">
    <h1>${escapeHtml(binderTitle)}</h1>
    <p>Prepared by: ${escapeHtml(options.senderName)}</p>
    <p>Date: ${formatDate()}</p>
    <p>Total Letters: ${letters.length}</p>
  </div>
  ${letterPages.map((page, i) =>
    `<div class="page-break"></div>\n<!-- Letter ${i + 1} -->\n${page}`
  ).join('\n')}
</body>
</html>`;
}

/**
 * Trigger browser print dialog (web/PWA fallback when no Electron/FS available).
 */
export function printLetterInBrowser(html: string): void {
  const printWindow = window.open('', '_blank', 'width=900,height=700');
  if (!printWindow) {
    console.warn('[LetterFormatter] Could not open print window — popup blocked?');
    return;
  }
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 500);
}
