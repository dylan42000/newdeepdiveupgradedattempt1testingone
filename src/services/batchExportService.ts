/**
 * batchExportService.ts — Batch PDF Letter Export
 * SINGLE CANVAS KILLSHOT: Uses html2canvas + jsPDF directly.
 * html2pdf.js is intentionally NOT used here. Its pagination
 * algorithm sliced letters across multiple pages. By feeding one
 * static image per letter into jsPDF we physically eliminate
 * the possibility of a letter being cut across page boundaries.
 *
 * Each letter becomes its own separate PDF page via canvas screenshot.
 */

import type { GeneratedLetterV2 } from '../types/creditRepair';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { appendCanvasPagesToPdf } from './pdfCanvasService';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PersonalInfoForExport {
  firstName: string;
  lastName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone?: string;
  email?: string;
}

export interface BatchExportOptions {
  /** Include a certified mail tracking cover sheet as the first page */
  includeCertifiedMailCoverSheet?: boolean;
  /** Custom filename (without .pdf extension). Defaults to DylandOs_DisputeLetters_{date} */
  filename?: string;
  /** Page margin in mm. Defaults to 15. */
  marginMm?: number;
  /** Paper format. Defaults to 'letter' */
  format?: 'letter' | 'a4';
}

export interface BatchExportResult {
  success: boolean;
  filename: string;
  letterCount: number;
  pageCount: number;
  error?: string;
}

// ─── Certified mail cover sheet generator ─────────────────────────────────────

function buildCertifiedMailCoverSheet(
  letters: GeneratedLetterV2[],
  personalInfo: PersonalInfoForExport
): string {
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const letterRows = letters.map((letter, i) => `
    <tr>
      <td style="padding:6px 8px; border:1px solid #ccc;">${i + 1}</td>
      <td style="padding:6px 8px; border:1px solid #ccc;">${escapeHtml(letter.itemName ?? 'Unknown')}</td>
      <td style="padding:6px 8px; border:1px solid #ccc;">${escapeHtml(letter.targetName ?? '')}</td>
      <td style="padding:6px 8px; border:1px solid #ccc;">Pass ${letter.passNumber ?? 1}</td>
      <td style="padding:6px 8px; border:1px solid #ccc;">___________________</td>
    </tr>
  `).join('');

  return `
    <div style="font-family: 'Times New Roman', Times, serif; max-width: 680px; margin: 0 auto; padding: 24px;">
      <h1 style="text-align:center; font-size:18pt; margin-bottom:4px;">CERTIFIED MAIL DISPATCH LOG</h1>
      <h2 style="text-align:center; font-size:12pt; font-weight:normal; margin-top:0;">
        Consumer Credit Dispute Package — DylandOs Credit Repair Suite
      </h2>
      <hr style="border-top:2px solid #000; margin:16px 0;">

      <table style="width:100%; border-collapse:collapse; font-size:10pt; margin-bottom:16px;">
        <tr>
          <td style="padding:4px 0; width:50%"><strong>Consumer Name:</strong> ${escapeHtml(personalInfo.firstName)} ${escapeHtml(personalInfo.lastName)}</td>
          <td style="padding:4px 0"><strong>Dispatch Date:</strong> ${today}</td>
        </tr>
        <tr>
          <td style="padding:4px 0"><strong>Address:</strong> ${escapeHtml(personalInfo.address)}</td>
          <td style="padding:4px 0"><strong>Total Letters:</strong> ${letters.length}</td>
        </tr>
        <tr>
          <td style="padding:4px 0"><strong>City/State/ZIP:</strong> ${escapeHtml(personalInfo.city)}, ${escapeHtml(personalInfo.state)} ${escapeHtml(personalInfo.zip)}</td>
          <td style="padding:4px 0"><strong>Sent Via:</strong> USPS Certified Mail</td>
        </tr>
      </table>

      <h3 style="font-size:11pt; margin-bottom:8px;">Mailing Log</h3>
      <table style="width:100%; border-collapse:collapse; font-size:9pt;">
        <thead>
          <tr style="background:#f0f0f0;">
            <th style="padding:6px 8px; border:1px solid #ccc; text-align:left;">#</th>
            <th style="padding:6px 8px; border:1px solid #ccc; text-align:left;">Creditor / Target</th>
            <th style="padding:6px 8px; border:1px solid #ccc; text-align:left;">Bureau</th>
            <th style="padding:6px 8px; border:1px solid #ccc; text-align:left;">Pass</th>
            <th style="padding:6px 8px; border:1px solid #ccc; text-align:left;">Tracking Number</th>
          </tr>
        </thead>
        <tbody>
          ${letterRows}
        </tbody>
      </table>

      <div style="margin-top:24px; font-size:9pt; color:#555;">
        <p><strong>Instructions:</strong></p>
        <ol style="margin-top:4px; line-height:1.6;">
          <li>Print this cover sheet and all letters that follow.</li>
          <li>Send each letter via USPS Certified Mail with Return Receipt Requested.</li>
          <li>Write the certified mail tracking number in the "Tracking Number" column above.</li>
          <li>Keep this log and all green return receipt cards. They are evidence of mailing.</li>
          <li>Log the response in DylandOs when you receive a reply (or if no response after 30 days).</li>
        </ol>
        <p style="margin-top:12px;">
          <strong>Legal Note:</strong> Under FCRA §611, credit bureaus must investigate disputes within 30 calendar days
          of receipt. Keep your certified mail proof as evidence in case of non-compliance. If no response
          is received by the deadline, immediately log "No Response" in DylandOs to trigger auto-escalation.
        </p>
      </div>
    </div>
  `;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildPageBreakDiv(): string {
  return '<div style="page-break-after: always; height:0; margin:0; padding:0;"></div>';
}

function buildLetterPage(letter: GeneratedLetterV2, index: number, total: number): string {
  const content = letter.htmlContent ?? letter.letterContent ?? '';
  const heading = `
    <div style="font-family:monospace; font-size:8pt; color:#888; text-align:right; margin-bottom:8px; border-bottom:1px solid #eee; padding-bottom:4px;">
      Letter ${index + 1} of ${total} &nbsp;|&nbsp; ${escapeHtml(letter.itemName ?? 'Unknown')} &nbsp;|&nbsp; Pass ${letter.passNumber ?? 1}
    </div>
  `;
  return heading + content;
}

// ─── Core batch export ────────────────────────────────────────────────────────

/**
 * Export multiple dispute letters as a single PDF.
 *
 * Requires html2pdf.js to be available on window.
 * In Electron/Vite it is imported via vendor.d.ts or dynamic import.
 *
 * @param letters - Letters to export (sorted by creditor/bureau)
 * @param personalInfo - Consumer personal info for the cover sheet
 * @param options - Export options
 */
export async function exportBatchPDF(
  letters: GeneratedLetterV2[],
  personalInfo: PersonalInfoForExport,
  options: BatchExportOptions = {}
): Promise<BatchExportResult> {
  if (letters.length === 0) {
    return { success: false, filename: '', letterCount: 0, pageCount: 0, error: 'No letters provided for export.' };
  }

  const {
    includeCertifiedMailCoverSheet = true,
    format = 'letter',
  } = options;

  const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const filename = (options.filename ?? `DylandOs_DisputeLetters_${dateStr}`) + '.pdf';

  try {
    // Create a single jsPDF instance; we’ll add pages to it
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'in', format });
    let firstPage = true;

    /**
     * Renders an HTML string into a hidden div, screenshots it with
     * html2canvas at 2x, and appends the result as a new PDF page.
     */
    const appendPageFromHtml = async (htmlContent: string): Promise<void> => {
      const cloneDiv = document.createElement('div');
      cloneDiv.innerHTML = htmlContent;
      cloneDiv.style.cssText = [
        'position:fixed',
        'top:0',
        'left:0',
        'width:816px',
        'background:#fff',
        'z-index:-9999',
        'overflow:visible',
        'pointer-events:none',
      ].join(';');
      document.body.appendChild(cloneDiv);

      try {
        const canvas = await html2canvas(cloneDiv, {
          scale: 2,
          useCORS: true,
          scrollY: 0,
          windowWidth: 816,
        });

        const pdfWidth = format === 'letter' ? 8.5 : 8.27; // letter vs A4 width in inches
        const pageHeight = format === 'letter' ? 11 : 11.69; // US Letter vs A4 height in inches
        const addPageBefore = !firstPage;
        firstPage = false;
        appendCanvasPagesToPdf(pdf, canvas, {
          pageWidthIn: pdfWidth,
          pageHeightIn: pageHeight,
          addPageBefore,
        });
      } finally {
        document.body.removeChild(cloneDiv);
      }
    };

    // ── Certified mail cover sheet (optional) ──────────────────────────────
    if (includeCertifiedMailCoverSheet) {
      const coverHtml = `<div style="font-family:'Times New Roman',Times,serif;font-size:11pt;line-height:1.5;color:#000;">${buildCertifiedMailCoverSheet(letters, personalInfo)}</div>`;
      await appendPageFromHtml(coverHtml);
    }

    // ── One page per letter ─────────────────────────────────────────
    for (let i = 0; i < letters.length; i++) {
      const letterHtml = `<div style="font-family:'Times New Roman',Times,serif;font-size:11pt;line-height:1.5;color:#000;padding:48px;">${buildLetterPage(letters[i], i, letters.length)}</div>`;
      await appendPageFromHtml(letterHtml);
    }

    // ── Save the final PDF ─────────────────────────────────────────
    pdf.save(filename);

    const pageCount = letters.length + (includeCertifiedMailCoverSheet ? 1 : 0);

    return {
      success: true,
      filename,
      letterCount: letters.length,
      pageCount,
    };

  } catch (e) {
    console.error('[BatchExportService] PDF export failed:', e);
    return {
      success: false,
      filename,
      letterCount: letters.length,
      pageCount: 0,
      error: String(e),
    };
  }
}

/**
 * Export letters grouped by bureau as separate PDF files.
 * Useful for preparing separate certified mail envelopes per bureau.
 */
export async function exportByBureau(
  letters: GeneratedLetterV2[],
  personalInfo: PersonalInfoForExport,
  options: BatchExportOptions = {}
): Promise<{ bureau: string; result: BatchExportResult }[]> {
  const bureauGroups = new Map<string, GeneratedLetterV2[]>();
  for (const letter of letters) {
    const bureau = letter.targetName ?? 'Unknown';
    if (!bureauGroups.has(bureau)) bureauGroups.set(bureau, []);
    bureauGroups.get(bureau)!.push(letter);
  }

  const results: { bureau: string; result: BatchExportResult }[] = [];
  for (const [bureau, bureauLetters] of bureauGroups) {
    const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const result = await exportBatchPDF(bureauLetters, personalInfo, {
      ...options,
      filename: options.filename ?? `DylandOs_${bureau}_Letters_${dateStr}`,
    });
    results.push({ bureau, result });
  }

  return results;
}
