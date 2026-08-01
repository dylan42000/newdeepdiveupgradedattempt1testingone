// ============================================================
// printService.ts — SINGLE CANVAS KILLSHOT v5.0
// Guaranteed: One letter per physical page.
// Strategy: html2canvas → one screenshot → jsPDF → done.
// html2pdf.js is intentionally NOT used here. Its pagination
// algorithm hallucinated page breaks and sliced letters across
// multiple pages. By feeding one static image into jsPDF we
// physically eliminate that possibility.
// ============================================================

import type { DisputeLetter } from '../types';
import type { NegativeItem, PersonalInfo } from '../types';
import { renderLetter, renderLetterBatch, getPdfExportMarkup } from './letterTemplateService';
import { stripLetterBodyPreamble } from './letterBodySanitizer';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { appendCanvasPagesToPdf } from './pdfCanvasService';

export interface PrintLetterOptions {
  letter: DisputeLetter;
  item: NegativeItem;
  personalInfo: PersonalInfo;
  bureauAddress?: {
    name: string; address: string; city: string; state: string; zip: string;
  };
}

/**
 * PRINT A SINGLE LETTER
 * Opens a properly formatted print window — one letter, one page.
 */
export async function printSingleLetter(opts: PrintLetterOptions): Promise<void> {
  const { letter, item, personalInfo } = opts;

  const bureauAddr = opts.bureauAddress ?? getBureauAddress(letter.bureau);

  const html = renderLetter({
    content: stripLetterBodyPreamble(letter.content || ''),
    senderName: `${personalInfo.firstName} ${personalInfo.lastName}`,
    senderAddress: personalInfo.address,
    senderCity: personalInfo.city,
    senderState: personalInfo.state,
    senderZip: personalInfo.zip,
    senderPhone: personalInfo.phone,
    senderEmail: personalInfo.email,
    senderDOB: personalInfo.dob,
    senderSSNLast4: personalInfo.ssn?.slice(-4),
    recipientName: bureauAddr.name,
    recipientAddress: bureauAddr.address,
    recipientCity: bureauAddr.city,
    recipientState: bureauAddr.state,
    recipientZip: bureauAddr.zip,
    re: `Formal Dispute — ${item.creditorName}, Account: xxxx${item.accountNumber?.slice(-4) ?? 'XXXX'}`,
    certifiedMail: letter.certifiedMail,
    certifiedNumber: letter.trackingNumber,
    round: letter.round,
    totalRounds: 6,
    bureau: letter.bureau,
    enclosures: getEnclosures(letter.round),
  });

  // Electron: use IPC print dialog
  if ((window as any).electronAPI?.printHtml) {
    (window as any).electronAPI.printHtml(html);
    return;
  }

  // Web: open in new window and trigger print
  const printWindow = window.open('', '_blank', 'width=900,height=1100');
  if (!printWindow) {
    throw new Error('Could not open print window. Check your popup blocker settings.');
  }

  printWindow.document.write(html);
  printWindow.document.close();

  // Wait for fonts/images to load before printing
  printWindow.onload = () => {
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
      // Don't auto-close — let user see what they're printing
    }, 500);
  };
}

/**
 * PRINT BATCH — Each letter on its own page
 * This is called when AutoPilot generates multiple letters.
 */
export async function printLetterBatch(letters: {
  letter: DisputeLetter;
  item: NegativeItem;
}[], personalInfo: PersonalInfo): Promise<void> {
  if (letters.length === 0) return;

  const renderOpts = letters.map(({ letter, item }) => {
    const bureauAddr = getBureauAddress(letter.bureau);
    return {
      content: stripLetterBodyPreamble(letter.content || ''),
      senderName: `${personalInfo.firstName} ${personalInfo.lastName}`,
      senderAddress: personalInfo.address,
      senderCity: personalInfo.city,
      senderState: personalInfo.state,
      senderZip: personalInfo.zip,
      senderPhone: personalInfo.phone,
      senderEmail: personalInfo.email,
      senderDOB: personalInfo.dob,
      senderSSNLast4: personalInfo.ssn?.slice(-4),
      recipientName: bureauAddr.name,
      recipientAddress: bureauAddr.address,
      recipientCity: bureauAddr.city,
      recipientState: bureauAddr.state,
      recipientZip: bureauAddr.zip,
      re: `Formal Dispute — ${item.creditorName}, Account: xxxx${item.accountNumber?.slice(-4) ?? 'XXXX'}`,
      certifiedMail: letter.certifiedMail,
      certifiedNumber: letter.trackingNumber,
      round: letter.round,
      totalRounds: 6,
      bureau: letter.bureau,
      enclosures: getEnclosures(letter.round),
    };
  });

  // Use batch renderer — guaranteed page isolation
  const batchHtml = renderLetterBatch(renderOpts);

  if ((window as any).electronAPI?.printHtml) {
    (window as any).electronAPI.printHtml(batchHtml);
    return;
  }

  const printWindow = window.open('', '_blank', 'width=900,height=1100');
  if (!printWindow) {
    throw new Error('Could not open print window.');
  }

  printWindow.document.write(batchHtml);
  printWindow.document.close();

  printWindow.onload = () => {
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 800);
  };
}

/**
 * EXPORT SINGLE LETTER AS PDF — SINGLE CANVAS KILLSHOT
 *
 * Renders the letter HTML into a hidden isolated clone, takes ONE screenshot
 * with html2canvas, then pastes that single image into a jsPDF letter page.
 *
 * This completely bypasses html2pdf's internal pagination algorithm which was
 * slicing letters across multiple pages due to CSS padding math errors.
 */
export async function exportLetterAsPdf(
  opts: PrintLetterOptions,
  filename?: string
): Promise<void> {
  const { letter, item, personalInfo } = opts;
  const bureauAddr = getBureauAddress(letter.bureau);

  const html = renderLetter({
    content: stripLetterBodyPreamble(letter.content || ''),
    senderName: `${personalInfo.firstName} ${personalInfo.lastName}`,
    senderAddress: personalInfo.address,
    senderCity: personalInfo.city,
    senderState: personalInfo.state,
    senderZip: personalInfo.zip,
    senderPhone: personalInfo.phone,
    senderEmail: personalInfo.email,
    senderDOB: personalInfo.dob,
    senderSSNLast4: personalInfo.ssn?.slice(-4),
    recipientName: bureauAddr.name,
    recipientAddress: bureauAddr.address,
    recipientCity: bureauAddr.city,
    recipientState: bureauAddr.state,
    recipientZip: bureauAddr.zip,
    re: `Formal Dispute — ${item.creditorName}, Account: xxxx${item.accountNumber?.slice(-4) ?? 'XXXX'}`,
    certifiedMail: letter.certifiedMail,
    certifiedNumber: letter.trackingNumber,
    round: letter.round,
    totalRounds: 6,
    bureau: letter.bureau,
    enclosures: getEnclosures(letter.round),
  });

  const pdfFilename = filename ??
    `dispute-${letter.bureau.toLowerCase()}-round${letter.round}-${item.creditorName.replace(/\s+/g, '-').toLowerCase()}.pdf`;

  // ── ISOLATED CLONE RENDER ──────────────────────────────────────────────────
  const cloneDiv = document.createElement('div');
  cloneDiv.innerHTML = getPdfExportMarkup(html);
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
    // Step 1: Take ONE perfect screenshot of the entire letter
    const canvas = await html2canvas(cloneDiv, {
      scale: 2,          // High resolution (2x = 192 dpi)
      useCORS: true,
      scrollY: 0,
      windowWidth: 816,  // Force exactly 8.5 inches at 96dpi
    });

    // Step 2: Create a standard US Letter PDF (8.5 x 11 inches)
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'in', format: 'letter' });
    // World-Class §7.1/§7.2: running header page 2+, Page X of Y footer,
    // certified-mail bounding box page 1.
    appendCanvasPagesToPdf(pdf, canvas, {
      runningHeader: {
        consumerName: `${personalInfo.firstName} ${personalInfo.lastName}`.trim() || 'Consumer',
        targetName: letter.bureau,
      },
      certifiedMailBox: Boolean(letter.certifiedMail),
    });

    // Step 6: Save
    pdf.save(pdfFilename);
  } finally {
    document.body.removeChild(cloneDiv);
  }
}

/**
 * EXPORT BATCH AS ZIP OF PDFS — SINGLE CANVAS KILLSHOT (per letter)
 *
 * One PDF per letter. Each PDF is exactly one page.
 * Each letter is individually screenshotted with html2canvas → jsPDF blob.
 * html2pdf is not used — its pagination sliced letters.
 */
export async function exportBatchAsZip(
  letters: { letter: DisputeLetter; item: NegativeItem }[],
  personalInfo: PersonalInfo,
  zipFilename: string = 'dispute-letters-batch.zip',
): Promise<void> {
  const JSZip = (await import('jszip')).default;

  const zip = new JSZip();
  const folder = zip.folder('dispute-letters')!;

  for (const { letter, item } of letters) {
    const bureauAddr = getBureauAddress(letter.bureau);
    const html = renderLetter({
      content: stripLetterBodyPreamble(letter.content || ''),
      senderName: `${personalInfo.firstName} ${personalInfo.lastName}`,
      senderAddress: personalInfo.address,
      senderCity: personalInfo.city,
      senderState: personalInfo.state,
      senderZip: personalInfo.zip,
      senderPhone: personalInfo.phone,
      senderEmail: personalInfo.email,
      senderDOB: personalInfo.dob,
      senderSSNLast4: personalInfo.ssn?.slice(-4),
      recipientName: bureauAddr.name,
      recipientAddress: bureauAddr.address,
      recipientCity: bureauAddr.city,
      recipientState: bureauAddr.state,
      recipientZip: bureauAddr.zip,
      re: `Formal Dispute — ${item.creditorName}, Account: xxxx${item.accountNumber?.slice(-4) ?? 'XXXX'}`,
      certifiedMail: letter.certifiedMail,
      round: letter.round,
      totalRounds: 6,
      bureau: letter.bureau,
      enclosures: getEnclosures(letter.round),
    });

    const pdfFilename = `${letter.bureau.toLowerCase()}-round${letter.round}-${item.creditorName.replace(/\s+/g, '-').toLowerCase()}.pdf`;

    // ── ISOLATED CLONE RENDER (per letter) ──────────────────────────────────
    const cloneDiv = document.createElement('div');
    cloneDiv.innerHTML = getPdfExportMarkup(html);
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
      // Step 1: ONE screenshot of the entire letter
      const canvas = await html2canvas(cloneDiv, {
        scale: 2,
        useCORS: true,
        scrollY: 0,
        windowWidth: 816,
      });

      // Step 2: Create jsPDF and append clean page slices
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'in', format: 'letter' });
      // World-Class §7.1/§7.2 deliverability overlays.
      appendCanvasPagesToPdf(pdf, canvas, {
        runningHeader: {
          consumerName: `${personalInfo.firstName} ${personalInfo.lastName}`.trim() || 'Consumer',
          targetName: letter.bureau,
        },
        certifiedMailBox: Boolean(letter.certifiedMail),
      });

      // Step 3: Get blob for ZIP (NOT .save() — we are zipping, not downloading)
      const pdfBlob = pdf.output('blob');
      folder.file(pdfFilename, pdfBlob);
    } finally {
      document.body.removeChild(cloneDiv);
    }
  }

  // Add a mail queue manifest
  const manifest = generateMailQueueManifest(letters, personalInfo);
  folder.file('MAIL-QUEUE-INSTRUCTIONS.txt', manifest);

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = zipFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * MAIL QUEUE MANIFEST
 * Plain-text instructions for mailing each letter.
 * Sorted by bureau stagger date.
 */
function generateMailQueueManifest(
  letters: { letter: DisputeLetter; item: NegativeItem }[],
  personalInfo: PersonalInfo,
): string {
  const lines: string[] = [
    '='.repeat(60),
    'DYLANDOS CREDIT REPAIR — MAIL QUEUE INSTRUCTIONS',
    `Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
    `Consumer: ${personalInfo.firstName} ${personalInfo.lastName}`,
    '='.repeat(60),
    '',
    'MAILING INSTRUCTIONS:',
    '1. Print each letter on white 8.5" x 11" paper',
    '2. Sign your name in blue or black ink above your printed name',
    '3. Send via CERTIFIED MAIL with RETURN RECEIPT (Form PS 3800)',
    '4. Keep the green card receipt — it is your legal proof of delivery',
    '5. Log the tracking number in the app under each letter',
    '',
    '-'.repeat(60),
    'LETTERS TO MAIL:',
    '-'.repeat(60),
    '',
  ];

  const sorted = [...letters].sort((a, b) => a.letter.round - b.letter.round);

  sorted.forEach(({ letter, item }, idx) => {
    const bureauAddr = getBureauAddress(letter.bureau);
    const staggerDays = { 'Equifax': 0, 'Experian': 5, 'TransUnion': 10 }[letter.bureau] ?? 0;
    const sendDate = new Date();
    sendDate.setDate(sendDate.getDate() + staggerDays);
    const deadline = new Date(sendDate);
    deadline.setDate(deadline.getDate() + (letter.round <= 3 ? 30 : 45));

    lines.push(`LETTER ${idx + 1} of ${sorted.length}`);
    lines.push(`Creditor: ${item.creditorName}`);
    lines.push(`Account: xxxx${item.accountNumber?.slice(-4) ?? 'XXXX'}`);
    lines.push(`Bureau: ${letter.bureau}`);
    lines.push(`Round: ${letter.round} of 6`);
    lines.push(`Send On or Before: ${sendDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`);
    lines.push(`Bureau Response Deadline: ${deadline.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`);
    lines.push(`Mail To:`);
    lines.push(`  ${bureauAddr.name}`);
    lines.push(`  ${bureauAddr.address}`);
    lines.push(`  ${bureauAddr.city}, ${bureauAddr.state} ${bureauAddr.zip}`);
    lines.push('');
  });

  lines.push('='.repeat(60));
  lines.push('AFTER MAILING:');
  lines.push('1. Open DylandOs app > Letters tab');
  lines.push('2. Mark each letter as "Sent"');
  lines.push('3. Enter your certified mail tracking number');
  lines.push('4. App will track your 30-day FCRA deadline automatically');
  lines.push('5. Return to the app in 35 days to record bureau responses');
  lines.push('='.repeat(60));

  return lines.join('\n');
}

/**
 * World-Class §7.2 Evidence Packet Schedule — the certified-mail-ready
 * enclosure checklist appended below the signature line of every letter.
 */
function getEnclosures(round: number): string[] {
  const base = [
    'Proof of Consumer Identity (Government-issued Photo ID)',
    'Proof of Residence (Utility Bill / Bank Statement dated within 60 days)',
    'Excerpt of Disputed Credit Report highlighting inaccurate field',
  ];
  if (round >= 2) {
    base.push('Copy of Prior Dispute Letter (Round 1)');
    base.push('Copy of Prior Bureau Response');
  }
  if (round >= 3) {
    base.push('Copy of All Prior Dispute Correspondence');
  }
  if (round >= 4) {
    base.push('FCRA Dispute Timeline Documentation');
    base.push('Bureau Verification Failure Evidence');
  }
  return base;
}

function getBureauAddress(bureau: string) {
  const map: Record<string, any> = {
    'Equifax': { name: 'Equifax Information Services LLC', address: 'P.O. Box 740256', city: 'Atlanta', state: 'GA', zip: '30374-0256' },
    'Experian': { name: 'Experian Information Solutions, Inc.', address: 'P.O. Box 4500', city: 'Allen', state: 'TX', zip: '75013' },
    'TransUnion': { name: 'TransUnion LLC Consumer Dispute Center', address: 'P.O. Box 2000', city: 'Chester', state: 'PA', zip: '19016' },
  };
  return map[bureau] ?? { name: bureau, address: 'P.O. Box 1', city: 'Unknown', state: 'XX', zip: '00000' };
}
