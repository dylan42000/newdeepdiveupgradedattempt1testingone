import type { jsPDF } from 'jspdf';

export interface CanvasPaginationOptions {
  pageWidthIn?: number;
  pageHeightIn?: number;
  marginCssPx?: number;
  addPageBefore?: boolean;
  /**
   * World-Class §7.1 deliverability header: printed as a concise running header
   * on page 2 and beyond (suppressed on page 1 so the sender/recipient blocks
   * remain the visual top of the letter).
   */
  runningHeader?: {
    consumerName: string;
    targetName: string;
  };
  /**
   * World-Class §7.2 certified-mail bounding box: reserves a 2.0" × 1.0" box
   * in the top-right corner of page 1 for USPS Certified Mail (Form 3800) /
   * electronic Return Receipt barcodes when the letter is mailed.
   */
  certifiedMailBox?: boolean;
}

function findWhitespaceBreak(
  canvas: HTMLCanvasElement,
  startY: number,
  maxEndY: number,
  minEndY: number,
  horizontalMarginPx: number,
): number {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || maxEndY <= minEndY) return maxEndY;

  const x = Math.max(0, Math.floor(horizontalMarginPx));
  const width = Math.max(1, canvas.width - x * 2);
  const searchStart = Math.max(startY, Math.floor(minEndY));
  const searchEnd = Math.min(canvas.height, Math.floor(maxEndY));
  const searchHeight = Math.max(1, searchEnd - searchStart);
  const pixels = ctx.getImageData(x, searchStart, width, searchHeight).data;
  const blankRows = new Uint8Array(searchHeight);

  for (let row = 0; row < searchHeight; row += 1) {
    let darkPixels = 0;
    const rowStart = row * width * 4;
    for (let col = 0; col < width; col += 2) {
      const offset = rowStart + col * 4;
      const alpha = pixels[offset + 3];
      if (
        alpha > 20 &&
        (pixels[offset] < 245 || pixels[offset + 1] < 245 || pixels[offset + 2] < 245)
      ) {
        darkPixels += 1;
      }
    }
    blankRows[row] = darkPixels <= 2 ? 1 : 0;
  }

  const requiredBlankBand = Math.max(6, Math.round(canvas.width / 200));
  let blankRun = 0;
  for (let row = searchHeight - 1; row >= 0; row -= 1) {
    if (blankRows[row]) {
      blankRun += 1;
      if (blankRun >= requiredBlankBand) {
        return searchStart + row + Math.floor(blankRun / 2);
      }
    } else {
      blankRun = 0;
    }
  }

  return maxEndY;
}

/**
 * World-Class §7.1: post-pagination deliverability overlay.
 *  - Page 1: no running header; optional certified-mail bounding box (§7.2).
 *  - Page 2+: running header top-right "{Consumer} — {Target} Dispute (Page X of Y)".
 *  - All pages: centered footer "Page X of Y — Immutable Consumer Dispute Record —
 *    Retain for 3 years".
 */
function applyDeliverabilityOverlays(
  pdf: jsPDF,
  pageCount: number,
  pageWidthIn: number,
  pageHeightIn: number,
  options: CanvasPaginationOptions,
): void {
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(120, 120, 120);

    if (page >= 2 && options.runningHeader) {
      const headerText =
        `${options.runningHeader.consumerName} — ${options.runningHeader.targetName} Dispute ` +
        `(Page ${page} of ${pageCount})`;
      const textWidth = pdf.getTextWidth(headerText);
      pdf.text(headerText, pageWidthIn - 0.75 - textWidth, 0.45);
    }

    if (page === 1 && options.certifiedMailBox) {
      // 2.0" × 1.0" white-space reservation, top-right, for USPS Form 3800 /
      // electronic Return Receipt barcode labels (§7.2).
      const boxW = 2.0;
      const boxH = 0.82;
      const boxX = pageWidthIn - 0.75 - boxW;
      const boxY = 0.12;
      pdf.setDrawColor(180, 180, 180);
      pdf.setLineWidth(0.01);
      pdf.setFillColor(255, 255, 255);
      pdf.rect(boxX, boxY, boxW, boxH, 'FD');
      pdf.setFontSize(6.5);
      pdf.setTextColor(165, 165, 165);
      pdf.text('USPS CERTIFIED MAIL — FORM 3800', boxX + boxW / 2, boxY + boxH / 2, { align: 'center' });
      pdf.setFontSize(8);
      pdf.setTextColor(120, 120, 120);
    }

    const footerText = `Page ${page} of ${pageCount} — Immutable Consumer Dispute Record — Retain for 3 years`;
    pdf.text(footerText, pageWidthIn / 2, pageHeightIn - 0.32, { align: 'center' });
  }
}

/**
 * Appends a rendered HTML canvas to jsPDF using lossless PNG page slices.
 * Page boundaries are moved to nearby blank rows so text is never cut in half.
 * After all slices are placed, deliverability overlays (running headers,
 * Page X of Y footers, certified-mail box) are drawn in a second pass.
 */
export function appendCanvasPagesToPdf(
  pdf: jsPDF,
  canvas: HTMLCanvasElement,
  options: CanvasPaginationOptions = {},
): number {
  const pageWidthIn = options.pageWidthIn ?? 8.5;
  const pageHeightIn = options.pageHeightIn ?? 11;
  const scale = canvas.width / 816;
  const marginPx = Math.max(0, (options.marginCssPx ?? 96) * scale);
  const pageHeightPx = Math.round(canvas.width * (pageHeightIn / pageWidthIn));
  const usableHeightPx = Math.max(1, pageHeightPx - marginPx * 2);
  const horizontalMarginPx = marginPx;

  let sourceY = 0;
  let pageCount = 0;
  let addPage = options.addPageBefore ?? false;

  while (sourceY < canvas.height - 1) {
    const isFirstSlice = sourceY === 0;
    const targetY = isFirstSlice ? 0 : marginPx;
    const capacity = isFirstSlice ? pageHeightPx - marginPx : usableHeightPx;
    const remaining = canvas.height - sourceY;
    let sourceEnd = canvas.height;

    if (remaining > capacity) {
      const maxEnd = Math.min(canvas.height, Math.floor(sourceY + capacity));
      const minEnd = Math.floor(sourceY + capacity * 0.65);
      sourceEnd = findWhitespaceBreak(
        canvas,
        sourceY,
        maxEnd,
        minEnd,
        horizontalMarginPx,
      );
    }

    const sourceHeight = Math.max(1, sourceEnd - sourceY);
    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = canvas.width;
    pageCanvas.height = pageHeightPx;
    const pageCtx = pageCanvas.getContext('2d');
    if (!pageCtx) throw new Error('Could not create PDF page canvas.');

    pageCtx.fillStyle = '#ffffff';
    pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    pageCtx.drawImage(
      canvas,
      0,
      sourceY,
      canvas.width,
      sourceHeight,
      0,
      targetY,
      canvas.width,
      sourceHeight,
    );

    if (addPage) pdf.addPage();
    addPage = true;
    const imgData = pageCanvas.toDataURL('image/png');
    pdf.addImage(imgData, 'PNG', 0, 0, pageWidthIn, pageHeightIn, undefined, 'FAST');

    pageCount += 1;
    sourceY = sourceEnd;
  }

  applyDeliverabilityOverlays(pdf, pageCount, pageWidthIn, pageHeightIn, options);

  return pageCount;
}
