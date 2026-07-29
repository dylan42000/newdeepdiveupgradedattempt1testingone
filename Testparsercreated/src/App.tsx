import { useMemo, useState } from "react";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { parseNegativeItems, type NegativeItem, type ParseInput } from "./utils/creditParser";

GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

const STRATEGIES = [
  {
    rank: "1",
    title: "Hybrid parser (best for production)",
    detail:
      "Rule-based extraction for known bureau fields + OCR fallback for scanned pages + confidence scoring. Most stable for bureau format drift."
  },
  {
    rank: "2",
    title: "Managed document AI",
    detail:
      "Google Document AI or Amazon Textract for difficult scans and handwriting, then a post-parser for bureau-specific normalization."
  },
  {
    rank: "3",
    title: "Pure regex/text parser",
    detail:
      "Fast and private for text-native PDFs, but can miss fields when formatting changes or reports are image-only."
  }
];

const RESEARCH_NOTES = [
  "AnnualCreditReport is federally authorized for consumer report retrieval; use it to download your own reports and parse local copies.",
  "Tesseract.js is useful for OCR in-browser, but its own repo notes that PDF handling is outside core scope without additional tooling.",
  "Google Document AI and Amazon Textract support OCR + structure extraction, including forms and tables, which helps on scanned credit reports.",
  "Credit bureau formats change often, so resilient systems combine deterministic rules with confidence scoring and a human review queue."
];

const SAMPLE_TEXT = `Experian credit report prepared for JOHN Q CONSUMER
Potentially Negative Items
MAIN COLL AGENCIES
Account Number: 0123456789
Status: Collection account. $95 past due as of 04/2005.
Date Opened: 01/2005
Last Reported: 04/2005
Recent Balance: $95 as of 04/2005`;

async function extractTextFromPdf(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await getDocument({ data: bytes }).promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const text = await page.getTextContent();

    const textItems = text.items
      .map((item) => {
        if (!("str" in item) || !item.str.trim()) return null;
        const transform = "transform" in item ? item.transform : [0, 0, 0, 0, 0, 0];
        return {
          str: item.str,
          x: Number(transform[4] ?? 0),
          y: Number(transform[5] ?? 0)
        };
      })
      .filter((item): item is { str: string; x: number; y: number } => item !== null);

    // Group by visual row so PDF uploads resemble pasted report text structure.
    const rows = new Map<number, Array<{ str: string; x: number }>>();
    for (const item of textItems) {
      const rowKey = Math.round(item.y * 2) / 2;
      const row = rows.get(rowKey) ?? [];
      row.push({ str: item.str, x: item.x });
      rows.set(rowKey, row);
    }

    const orderedRows = [...rows.entries()].sort((a, b) => b[0] - a[0]);
    const pageLines = orderedRows.map(([, row]) => row.sort((a, b) => a.x - b.x).map((chunk) => chunk.str).join(" ").trim());

    const layoutText = pageLines.filter(Boolean).join("\n");
    pages.push(layoutText);
  }

  return pages.join("\n\n");
}

async function readFileText(file: File): Promise<string> {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".pdf") || file.type.includes("pdf")) {
    return extractTextFromPdf(file);
  }

  return file.text();
}

export default function App() {
  const [manualText, setManualText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [results, setResults] = useState<NegativeItem[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  const summary = useMemo(() => {
    const byBureau = {
      Experian: 0,
      Equifax: 0,
      TransUnion: 0,
      Unknown: 0
    };

    for (const item of results) {
      byBureau[item.bureau] += 1;
    }

    return byBureau;
  }, [results]);

  const onParse = async (): Promise<void> => {
    setIsParsing(true);
    setErrors([]);

    try {
      const inputs: ParseInput[] = [];

      if (manualText.trim()) {
        inputs.push({ sourceName: "Pasted text", text: manualText });
      }

      if (files.length > 0) {
        const parsedFiles = await Promise.all(
          files.map(async (file) => {
            try {
              const text = await readFileText(file);
              return { ok: true as const, sourceName: file.name, text };
            } catch (error) {
              const message = error instanceof Error ? error.message : "Unknown parser error";
              return { ok: false as const, sourceName: file.name, message };
            }
          })
        );

        parsedFiles.forEach((entry) => {
          if (entry.ok) {
            inputs.push({ sourceName: entry.sourceName, text: entry.text });
          } else {
            setErrors((current) => [...current, `${entry.sourceName}: ${entry.message}`]);
          }
        });
      }

      setResults(parseNegativeItems(inputs));
    } finally {
      setIsParsing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <main className="mx-auto w-full max-w-6xl px-6 py-10">
        <section className="space-y-4 border-b border-slate-800 pb-8 animate-[fade-up_500ms_ease-out]">
          <p className="text-xs uppercase tracking-[0.22em] text-cyan-300">BureauParse Lab</p>
          <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Credit Report Negative Item Parser for Experian, Equifax, and TransUnion
          </h1>
          <p className="max-w-3xl text-slate-300">
            Upload your report files from AnnualCreditReport or direct bureau downloads. This parser extracts likely
            negative items, labels type, and shows confidence so you can review faster.
          </p>
          <p className="max-w-4xl text-sm text-slate-400">
            Security scope: this app parses files you upload locally in the browser and does not automate login,
            credential use, or scraping behind account walls.
          </p>
        </section>

        <section className="grid gap-8 py-8 lg:grid-cols-[1.35fr_1fr]">
          <div className="space-y-5 animate-[fade-up_700ms_ease-out]">
            <label className="block space-y-2">
              <span className="text-sm text-slate-300">Paste report text (optional)</span>
              <textarea
                value={manualText}
                onChange={(event) => setManualText(event.target.value)}
                placeholder="Paste bureau report text here"
                className="h-44 w-full resize-y border border-slate-700 bg-slate-900/80 p-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm text-slate-300">Upload files (.pdf, .txt, .html)</span>
              <input
                type="file"
                multiple
                onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
                className="w-full border border-dashed border-slate-700 bg-slate-900/80 p-3 text-sm text-slate-200"
              />
            </label>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={onParse}
                disabled={isParsing}
                className="bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-cyan-600"
              >
                {isParsing ? "Parsing reports..." : "Parse negative items"}
              </button>
              <button
                type="button"
                onClick={() => setManualText(SAMPLE_TEXT)}
                className="border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500"
              >
                Load sample text
              </button>
              <button
                type="button"
                onClick={() => {
                  setManualText("");
                  setFiles([]);
                  setResults([]);
                  setErrors([]);
                }}
                className="border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500"
              >
                Reset
              </button>
            </div>

            {files.length > 0 && (
              <p className="text-sm text-slate-400">Loaded files: {files.map((file) => file.name).join(", ")}</p>
            )}

            {errors.length > 0 && (
              <div className="space-y-1 border border-rose-400/40 bg-rose-950/30 p-3 text-sm text-rose-200">
                {errors.map((error) => (
                  <p key={error}>{error}</p>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-4 border border-slate-800 bg-slate-900/60 p-4 animate-[fade-up_900ms_ease-out]">
            <h2 className="text-lg font-semibold text-white">Deep Dive Findings</h2>
            <p className="text-sm text-slate-300">
              Best real-world accuracy comes from a hybrid parser: deterministic bureau rules for known labels and
              section names, plus OCR for scanned pages, with confidence scoring and manual review.
            </p>
            <div className="space-y-3">
              {STRATEGIES.map((strategy) => (
                <div key={strategy.rank} className="border-l-2 border-cyan-300 pl-3">
                  <p className="text-sm font-medium text-cyan-200">
                    {strategy.rank}. {strategy.title}
                  </p>
                  <p className="text-sm text-slate-300">{strategy.detail}</p>
                </div>
              ))}
            </div>
            <div className="space-y-2 border-t border-slate-800 pt-3 text-sm text-slate-300">
              {RESEARCH_NOTES.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
          </div>
        </section>

        <section className="space-y-4 border-t border-slate-800 py-8">
          <div className="flex flex-wrap items-end gap-5">
            <h2 className="text-2xl font-semibold text-white">Parser Output</h2>
            <p className="text-sm text-slate-400">{results.length} negative items detected</p>
            <p className="text-xs text-slate-500">
              EXP: {summary.Experian} | EQX: {summary.Equifax} | TU: {summary.TransUnion} | Unknown: {summary.Unknown}
            </p>
          </div>

          <div className="overflow-x-auto border border-slate-800">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-900 text-slate-300">
                <tr>
                  <th className="px-3 py-2 font-medium">Bureau</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium">Creditor</th>
                  <th className="px-3 py-2 font-medium">Account</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Balance</th>
                  <th className="px-3 py-2 font-medium">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {results.map((item) => (
                  <tr key={item.id} className="border-t border-slate-800 align-top text-slate-200 animate-[fade-in_400ms_ease-out]">
                    <td className="px-3 py-2">{item.bureau}</td>
                    <td className="px-3 py-2">{item.category}</td>
                    <td className="px-3 py-2">{item.creditor}</td>
                    <td className="px-3 py-2">{item.accountNumber}</td>
                    <td className="px-3 py-2">{item.status}</td>
                    <td className="px-3 py-2">{item.balance}</td>
                    <td className="px-3 py-2">{item.confidence}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {results.length > 0 && (
            <div className="space-y-2 text-sm text-slate-300">
              <h3 className="font-medium text-slate-100">Evidence snippets</h3>
              {results.slice(0, 8).map((item) => (
                <p key={`${item.id}-snippet`} className="border-l border-slate-700 pl-3 text-slate-400">
                  [{item.bureau}] {item.rawSnippet}
                </p>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
