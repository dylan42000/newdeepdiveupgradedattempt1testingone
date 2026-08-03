/**
 * creditReportParserWorker.ts — Web Worker for Non-Blocking Credit Report Parsing
 *
 * Runs the heavy parseCreditReport() execution off the main UI thread so that
 * parsing a massive 3-bureau report never freezes the interface.
 *
 * Message protocol:
 *
 *  Main → Worker:
 *    { type: 'PARSE'; options: WorkerParseOptions }
 *
 *  Worker → Main (streaming progress):
 *    { type: 'PROGRESS'; pct: number; msg: string }
 *
 *  Worker → Main (on success):
 *    { type: 'RESULT'; result: ParseResult }
 *
 *  Worker → Main (on failure):
 *    { type: 'ERROR'; error: string }
 *
 * ArrayBuffer transfers: The caller should pass pdfBuffer via the transfer
 * array of postMessage() for zero-copy performance on large PDFs.
 */

import { parseCreditReport, type ParseOptions, type ParseResult } from '../services/creditReportParser';

// ── Narrowed options type safe for cross-thread transfer ─────────────────────
// Omit onProgress — the worker builds its own bridge back to the main thread.

export type WorkerParseOptions = Omit<ParseOptions, 'onProgress'>;

// ── Incoming message types ────────────────────────────────────────────────────

export interface WorkerParseMessage {
  type: 'PARSE';
  options: WorkerParseOptions;
}

// ── Outgoing message types ────────────────────────────────────────────────────

export interface WorkerProgressMessage {
  type: 'PROGRESS';
  pct: number;
  msg: string;
}

export interface WorkerResultMessage {
  type: 'RESULT';
  result: ParseResult;
}

export interface WorkerErrorMessage {
  type: 'ERROR';
  error: string;
}

export type WorkerOutboundMessage =
  | WorkerProgressMessage
  | WorkerResultMessage
  | WorkerErrorMessage;

// ── Worker entry point ────────────────────────────────────────────────────────

self.addEventListener('message', async (event: MessageEvent<WorkerParseMessage>) => {
  const { type, options } = event.data;

  if (type !== 'PARSE') return;

  try {
    const result = await parseCreditReport({
      ...options,
      onProgress: (pct: number, msg: string) => {
        // Serialize progress back to the main thread.
        // This is the only mechanism — no shared state, no callbacks.
        const progressMsg: WorkerProgressMessage = { type: 'PROGRESS', pct, msg };
        (self as unknown as Worker).postMessage(progressMsg);
      },
    });

    const resultMsg: WorkerResultMessage = { type: 'RESULT', result };
    (self as unknown as Worker).postMessage(resultMsg);
  } catch (err) {
    const errMsg: WorkerErrorMessage = {
      type: 'ERROR',
      error: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(errMsg);
  }
});
