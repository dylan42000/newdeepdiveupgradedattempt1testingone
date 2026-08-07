import type { jsPDF } from 'jspdf';

export interface CanvasPaginationOptions {
  pageWidthIn?: number;
  pageHeightIn?: number;
  marginCssPx?: number;
  addPageBefore?: boolean;
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
 * Appends a rendered HTML canvas to jsPDF using lossless PNG page slices.
 * Page boundaries are moved to nearby blank rows so text is never cut in half.
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

  return pageCount;
}
