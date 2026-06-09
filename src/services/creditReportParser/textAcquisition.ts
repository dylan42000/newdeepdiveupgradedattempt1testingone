import * as pdfjs from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import pdfWorkerRaw from 'pdfjs-dist/build/pdf.worker.mjs?raw';
import { AcquiredText } from "./types";

export async function acquireFromPDFBuffer(buffer: ArrayBuffer): Promise<AcquiredText> {
  const warnings: string[] = [];

  const workerBlob = new Blob([pdfWorkerRaw], { type: 'text/javascript' });
  const workerUrl = URL.createObjectURL(workerBlob);
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
    rangeChunkSize: 65536,
  }).promise;

  const rawPages: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    try {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent({
        includeMarkedContent: false,
        disableNormalization: false,
      });

      const items = textContent.items as TextItem[];
      const lineMap = new Map<number, TextItem[]>();

      for (const item of items) {
        if (!item.str.trim()) continue;
        // 4px bucket — matches extractor.ts tolerance for consistent grouping
        const y = Math.round(item.transform[5] / 4) * 4;
        if (!lineMap.has(y)) lineMap.set(y, []);
        lineMap.get(y)!.push(item);
      }

      const sortedYs = Array.from(lineMap.keys()).sort((a, b) => b - a);
      const lines: string[] = [];

      for (const y of sortedYs) {
        const lineItems = lineMap.get(y)!.sort((a, b) => a.transform[4] - b.transform[4]);
        // Smart spacing: use actual x-gap to decide space vs. direct join vs. tab
        let lineStr = lineItems[0]?.str ?? '';
        for (let i = 1; i < lineItems.length; i++) {
          const prev = lineItems[i - 1];
          const curr = lineItems[i];
          const gap = curr.transform[4] - (prev.transform[4] + (prev.width ?? 0));
          if (gap > 40) {
            lineStr += '\t' + curr.str;
          } else if (gap > -1) {
            lineStr += ' ' + curr.str;
          } else {
            lineStr += curr.str;
          }
        }
        const trimmed = lineStr.trim();
        if (trimmed) lines.push(trimmed);
      }

      rawPages.push(lines.join("\n"));
    } catch (err) {
      warnings.push(`Page ${pageNum} extraction failed: ${(err as Error).message}`);
      rawPages.push("");
    }
  }

  return {
    source: "pdf",
    rawPages,
    // Double-newline separator keeps cross-page account blocks intact.
    // The old \f caused goldenParser to see garbled text at every page boundary.
    fullText: rawPages.join("\n\n"),
    pageCount: pdf.numPages,
    warnings,
  };
}

export async function acquireFromPaste(rawPaste: string): Promise<AcquiredText> {
  if (!rawPaste || rawPaste.trim().length === 0) {
    throw new Error("Pasted text is empty. Please paste your credit report text.");
  }

  const pages = rawPaste
    .split(/\f|\r?\n{3,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  return {
    source: "paste",
    rawPages: pages.length > 0 ? pages : [rawPaste],
    fullText: rawPaste,
    pageCount: Math.max(1, pages.length),
    warnings: [],
  };
}

export async function acquireFromFilePath(filePath: string): Promise<AcquiredText> {
  if (!window.electronAPI?.readFileAsBase64) {
    throw new Error("Desktop file APIs unavailable in this runtime.");
  }

  const payload = await window.electronAPI.readFileAsBase64(filePath);
  const base64 = typeof payload === "string"
    ? payload
    : payload?.base64 ?? "";

  if (!base64) {
    throw new Error("File could not be read or is empty.");
  }

  const headerBytes = Uint8Array.from(atob(base64.substring(0, 100)), (c) => c.charCodeAt(0));
  const isPDF = headerBytes[0] === 0x25 && headerBytes[1] === 0x50 && headerBytes[2] === 0x44 && headerBytes[3] === 0x46;

  if (isPDF) {
    const binary = atob(base64);
    const buffer = new ArrayBuffer(binary.length);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
    return acquireFromPDFBuffer(buffer);
  }

  return acquireFromPaste(atob(base64));
}
