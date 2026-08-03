// src/services/pdfGeneratorAndroid.ts
// Android PDF generation using html2pdf.js — preserves full CSS layout,
// margins, and typography. Mirrors the desktop print service output exactly.

import { PDF_EXPORT_OPTIONS } from './letterTemplateService';

/**
 * Generates a PDF Blob from an HTML string using html2pdf.js.
 * This preserves all CSS layout, typography, margins, and page breaks
 * identically to the desktop Electron print service.
 *
 * @param htmlContent   Full HTML document string (as produced by renderLetter / renderLetterBatch)
 * @param fileName      Desired output filename (used as the html2pdf filename option)
 * @returns             A Blob containing the binary PDF data
 */
export async function generateLetterPDFAndroid(
  htmlContent: string,
  fileName: string,
): Promise<Blob> {
  // Dynamic import keeps html2pdf.js out of the main Electron bundle
  // and only loads it in the Capacitor/Android context where it is needed.
  const html2pdf = (await import('html2pdf.js')).default;

  // Build a temporary off-screen container that html2pdf can render from.
  // We must attach it to the DOM briefly so html2canvas can read layout/styles.
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-9999px;top:0;width:8.5in;background:#fff;z-index:-1;';
  container.innerHTML = htmlContent;
  document.body.appendChild(container);

  try {
    const options = {
      ...PDF_EXPORT_OPTIONS,
      filename: fileName || 'dispute-letter.pdf',
      // html2canvas must target the container we just built, not window.
      html2canvas: {
        ...PDF_EXPORT_OPTIONS.html2canvas,
        // Allow cross-origin resources (fonts, images) in the sandboxed Android WebView
        useCORS: true,
        // Disable scrolling so full letter renders without clipping
        scrollX: 0,
        scrollY: 0,
      },
    };

    // html2pdf returns a Worker instance. Calling .outputPdf('blob') resolves with a Blob.
    const blob: Blob = await html2pdf()
      .set(options)
      .from(container)
      .outputPdf('blob');

    return blob;
  } finally {
    // Always remove the temporary container, even on error
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  }
}
