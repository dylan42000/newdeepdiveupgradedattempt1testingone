// ============================================================
// UploadReport.tsx — WORLD CLASS UPLOAD PAGE v4.2
// Three input methods. Real-time progress via Web Worker.
// Non-blocking parsing — the UI never freezes on large 3-bureau reports.
// ============================================================

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import type { ParseCreditReportResult } from '../services/creditReportParser';
import type {
  WorkerOutboundMessage,
  WorkerParseOptions,
} from '../workers/creditReportParserWorker';
import ParserWorker from '../workers/creditReportParserWorker.ts?worker';

// Local alias so the body of this file matches the deepdive spec
type ParseResult = ParseCreditReportResult;

type InputMethod = 'paste' | 'pdf' | 'file';
type PageState = 'input' | 'parsing' | 'review' | 'complete';

interface ProgressState {
  pct: number;
  msg: string;
}

export default function UploadReport({ onNavigate }: { onNavigate: (page: string) => void }) {
  const { addNegativeItems, logEvent, addXP, personalInfo, smartMergeAccounts } = useAppContext();

  const [method, setMethod] = useState<InputMethod>('paste');
  const [pageState, setPageState] = useState<PageState>('input');
  const [pasteText, setPasteText] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<ProgressState>({ pct: 0, msg: '' });
  const [result, setResult] = useState<ParseResult | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Web Worker ref — persisted across renders, terminated on unmount
  const workerRef = useRef<Worker | null>(null);

  const updateReviewDofd = (itemId: string, value: string) => {
    setResult(current => {
      if (!current) return current;
      return {
        ...current,
        items: current.items.map(item => item.id === itemId ? {
          ...item,
          dateOfFirstDelinquency: value || null,
          originalDateOfDelinquency: value || null,
        } : item),
      };
    });
  };

  // ── Terminate worker on page unmount to prevent memory leaks ────────────────
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  // ── PARSE HANDLER (Web Worker) ────────────────────────────────────────
  // Spawns (or reuses) a dedicated Web Worker so that the heavy heuristic +
  // golden parser + pdfjs extraction never blocks the React render thread.
  // Progress updates arrive via postMessage and are applied to state normally.
  const handleParse = useCallback(() => {
    // ── Input validation (sync, safe to do on main thread) ──────────────────
    if (method === 'paste' && pasteText.trim().length < 100) {
      alert('Please paste at least 100 characters of credit report text.');
      return;
    }
    if (method === 'pdf' && !pdfFile) {
      alert('Please provide a credit report.');
      return;
    }

    setPageState('parsing');
    setProgress({ pct: 0, msg: 'Starting...' });

    // ── Terminate any previous parse in-flight ────────────────────────────
    workerRef.current?.terminate();

    // ── Spawn fresh worker using Vite's native module worker syntax ────────
    const worker = new ParserWorker();
    workerRef.current = worker;

    // ── Wire up message handler ───────────────────────────────────────
    worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => {
      const msg = event.data;

      if (msg.type === 'PROGRESS') {
        // Smooth real-time progress bar updates — serialized from worker thread
        setProgress({ pct: msg.pct, msg: msg.msg });
        return;
      }

      if (msg.type === 'RESULT') {
        const parseResult = msg.result;
        setResult(parseResult);

        if (parseResult.items.length === 0) {
          setPageState('input');
          if (parseResult.warnings.length > 0) {
            alert(`No negative items found.\n\n${parseResult.warnings.join('\n')}`);
          } else {
            alert(
              'No negative items were found in this report. ' +
              'The report may contain only positive accounts, or the text may not be formatted as a credit report.'
            );
          }
        } else {
          setSelectedItems(new Set(parseResult.items.map(i => i.id)));
          setPageState('review');
        }

        worker.terminate();
        workerRef.current = null;
        return;
      }

      if (msg.type === 'ERROR') {
        setPageState('input');
        alert(`Parse failed: ${msg.error}\n\nPlease try pasting the text manually or check your AI API keys.`);
        worker.terminate();
        workerRef.current = null;
      }
    };

    worker.onerror = (err: ErrorEvent) => {
      setPageState('input');
      alert(`Parser worker error: ${err.message || 'Unknown error'}`);
      worker.terminate();
      workerRef.current = null;
    };

    // ── Dispatch parse message to worker ──────────────────────────────
    if (method === 'paste') {
      const opts: WorkerParseOptions = { source: 'paste', pasteText };
      worker.postMessage({ type: 'PARSE', options: opts });
    } else if (method === 'pdf' && pdfFile) {
      // Read the ArrayBuffer on the main thread, then TRANSFER it (zero-copy)
      // to the worker so we don't duplicate a potentially massive buffer.
      pdfFile.arrayBuffer().then((buffer) => {
        const opts: WorkerParseOptions = { source: 'pdf_buffer', pdfBuffer: buffer };
        // Transfer the ArrayBuffer ownership to the worker (zero-copy)
        worker.postMessage({ type: 'PARSE', options: opts }, [buffer]);
      }).catch((err) => {
        setPageState('input');
        alert(`Failed to read PDF file: ${err}`);
        worker.terminate();
        workerRef.current = null;
      });
    }
  }, [method, pasteText, pdfFile]);

  // ── ACCEPT ITEMS ─────────────────────────────────────────────
  const handleAcceptItems = () => {
    if (!result) return;

    const toAdd = result.items.filter(i => selectedItems.has(i.id));
    if (toAdd.length === 0) {
      alert('Please select at least one item to add.');
      return;
    }

    addNegativeItems(toAdd);
    // Aggressive cross-bureau link-groups (same resolver as Negative Items / Autopilot)
    smartMergeAccounts();
    const acceptedIds = new Set(toAdd.map(i => i.id));
    const reviewCandidates = [...(result.pendingSuggestedMerges ?? []), ...(result.pendingManualReviewMerges ?? [])]
      .filter(c => acceptedIds.has(c.itemA.id) && acceptedIds.has(c.itemB.id))
      .map(c => ({ leftId:c.itemA.id, rightId:c.itemB.id, left:c.itemA, right:c.itemB, confidence:c.score/100, reasons:c.factors.filter(f=>f.score>0).map(f=>`${f.name}: ${Math.round(f.score)}%`) }));
    if (reviewCandidates.length) window.dispatchEvent(new CustomEvent('account-match-review',{detail:reviewCandidates}));
    logEvent({
      type: 'items_parsed',
      title: 'Credit Report Parsed',
      detail: `Parsed ${toAdd.length} negative items via ${result.parseMethod} — ${result.consumerName || 'Unknown consumer'}`,
    });
    addXP(100 + (toAdd.length * 10));
    setPageState('complete');
  };

  // ── DROP HANDLER ─────────────────────────────────────────────
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
      setPdfFile(file);
      setMethod('pdf');
    }
  }, []);

  // ── RENDER ───────────────────────────────────────────────────
  if (pageState === 'complete') {
    return (
      <div style={{ padding: '40px', maxWidth: '700px', margin: '0 auto', textAlign: 'center' }}>
        <div style={{ fontSize: '64px', marginBottom: '20px' }}>🎉</div>
        <h1 style={{ fontSize: '28px', fontWeight: 'bold', marginBottom: '12px', color: '#22c55e' }}>
          Report Processed Successfully!
        </h1>
        <p style={{ color: '#888', marginBottom: '8px', fontSize: '15px' }}>
          {selectedItems.size} negative item{selectedItems.size !== 1 ? 's' : ''} added to your dispute queue
        </p>
        {result?.consumerName && (
          <p style={{ color: '#666', fontSize: '13px', marginBottom: '24px' }}>
            Consumer: {result.consumerName}
          </p>
        )}
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => onNavigate('negative-items')}
            style={{
              padding: '12px 28px',
              background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
              color: '#fff',
              border: 'none',
              borderRadius: '10px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 'bold',
            }}
          >
            📋 View Negative Items
          </button>
          <button
            onClick={() => onNavigate('autopilot')}
            style={{
              padding: '12px 28px',
              background: 'linear-gradient(135deg, #22c55e, #16a34a)',
              color: '#fff',
              border: 'none',
              borderRadius: '10px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 'bold',
            }}
          >
            🚀 Run AutoPilot
          </button>
          <button
            onClick={() => {
              setPageState('input');
              setResult(null);
              setPasteText('');
              setPdfFile(null);
              setSelectedItems(new Set());
            }}
            style={{
              padding: '12px 28px',
              background: 'rgba(255,255,255,0.1)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '10px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            ➕ Add Another Report
          </button>
        </div>
      </div>
    );
  }

  if (pageState === 'review' && result) {
    return (
      <div style={{ padding: '24px', maxWidth: '900px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '24px' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '8px' }}>
            ✅ Review Extracted Items
          </h1>
          <p style={{ color: '#888', fontSize: '14px' }}>
            Found <strong style={{ color: '#fff' }}>{result.items.length} negative item{result.items.length !== 1 ? 's' : ''}</strong>
            {result.consumerName && ` for ${result.consumerName}`}
            {' '}&nbsp;•&nbsp;
            Method: <span style={{ color: '#60a5fa' }}>{result.parseMethod.replace(/_/g, ' ')}</span>
            &nbsp;•&nbsp;
            {result.processingTimeMs}ms
          </p>
          {result.items.some(item => !item.dateOfFirstDelinquency && !item.originalDateOfDelinquency) && (
            <div style={{
              marginTop: '10px', padding: '10px 14px',
              background: 'rgba(245,158,11,0.1)', borderRadius: '8px',
              border: '1px solid rgba(245,158,11,0.35)', fontSize: '12px', color: '#fbbf24',
            }}>
              ⚠ Some accounts are missing the Date of First Delinquency (DOFD). Enter it below while verifying each item so AutoPilot can generate letters without stopping at pre-flight.
            </div>
          )}
          {result.warnings.length > 0 && (
            <div style={{
              marginTop: '8px', padding: '10px 14px',
              background: 'rgba(245,158,11,0.1)', borderRadius: '8px',
              border: '1px solid rgba(245,158,11,0.3)', fontSize: '13px', color: '#fbbf24',
            }}>
              ⚠️ {result.warnings.join(' | ')}
            </div>
          )}
        </div>

        {/* Summary Stats */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '10px', marginBottom: '20px',
        }}>
          {[
            { label: 'Total Found', value: result.totalFound, color: '#60a5fa' },
            { label: 'Final Items', value: result.items.length, color: '#22c55e' },
            { label: 'Needs Review', value: result.needsReviewCount, color: '#fbbf24' },
            { label: 'Selected', value: selectedItems.size, color: '#a78bfa' },
          ].map(s => (
            <div key={s.label} style={{
              padding: '12px', background: 'rgba(0,0,0,0.4)',
              borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: s.color }}>{s.value}</div>
              <div style={{ fontSize: '11px', color: '#888' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Controls */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: '14px',
        }}>
          <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
            <input
              type="checkbox"
              checked={selectedItems.size === result.items.length}
              onChange={e => {
                if (e.target.checked) setSelectedItems(new Set(result.items.map(i => i.id)));
                else setSelectedItems(new Set());
              }}
            />
            Select All ({result.items.length})
          </label>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => setPageState('input')}
              style={{
                padding: '8px 16px', background: 'rgba(255,255,255,0.1)',
                color: '#fff', border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: '8px', cursor: 'pointer', fontSize: '13px',
              }}
            >
              ← Back
            </button>
            <button
              onClick={handleAcceptItems}
              disabled={selectedItems.size === 0}
              style={{
                padding: '8px 20px',
                background: selectedItems.size > 0
                  ? 'linear-gradient(135deg, #22c55e, #16a34a)'
                  : 'rgba(255,255,255,0.1)',
                color: '#fff', border: 'none', borderRadius: '8px',
                cursor: selectedItems.size > 0 ? 'pointer' : 'not-allowed',
                fontSize: '13px', fontWeight: 'bold',
              }}
            >
              ✅ Add {selectedItems.size} Selected Item{selectedItems.size !== 1 ? 's' : ''}
            </button>
          </div>
        </div>

        {/* Items List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {result.items.map(item => {
            const isSelected = selectedItems.has(item.id);
            const needsReview = (item.parseConfidence ?? 1) < 0.70;
            const confidence = Math.round((item.parseConfidence ?? 0.7) * 100);

            return (
              <div
                key={item.id}
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest('input')) return;
                  const next = new Set(selectedItems);
                  if (isSelected) next.delete(item.id);
                  else next.add(item.id);
                  setSelectedItems(next);
                }}
                style={{
                  padding: '14px 16px', cursor: 'pointer',
                  background: isSelected ? 'rgba(59,130,246,0.08)' : 'rgba(0,0,0,0.3)',
                  border: `1px solid ${isSelected ? 'rgba(59,130,246,0.3)' : 'rgba(255,255,255,0.07)'}`,
                  borderRadius: '8px',
                  display: 'flex', alignItems: 'center', gap: '14px',
                  transition: 'all 0.15s',
                }}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => { }}
                  style={{ flexShrink: 0 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                    <span style={{ fontWeight: 'bold', fontSize: '14px' }}>
                      {item.creditorName}
                    </span>
                    <span style={{
                      fontSize: '11px', padding: '1px 8px', borderRadius: '12px',
                      background: getTypeColor(item.typeOfNegative) + '22',
                      color: getTypeColor(item.typeOfNegative),
                    }}>
                      {item.typeOfNegative}
                    </span>
                    {item.creditBureau?.map(b => (
                      <span key={b} style={{
                        fontSize: '10px', padding: '1px 6px', borderRadius: '10px',
                        background: 'rgba(255,255,255,0.08)', color: '#aaa',
                      }}>
                        {b.slice(0, 2).toUpperCase()}
                      </span>
                    ))}
                    {needsReview && (
                      <span style={{
                        fontSize: '10px', padding: '1px 8px', borderRadius: '10px',
                        background: 'rgba(245,158,11,0.15)', color: '#fbbf24',
                      }}>
                        ⚠ Review
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '12px', color: '#777', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    {item.accountNumber && <span>Acct: {item.accountNumber}</span>}
                    {item.balance !== null && <span>Balance: ${item.balance?.toLocaleString()}</span>}
                    {item.originalDateOfDelinquency && <span>DOFD: {item.originalDateOfDelinquency}</span>}
                    {item.autoRemovalDate && <span>Removal: {item.autoRemovalDate}</span>}
                  </div>
                  <div style={{ marginTop: '9px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <label htmlFor={`dofd-${item.id}`} style={{
                      fontSize: '11px',
                      color: item.dateOfFirstDelinquency || item.originalDateOfDelinquency ? '#888' : '#fbbf24',
                      fontWeight: item.dateOfFirstDelinquency || item.originalDateOfDelinquency ? 'normal' : 'bold',
                    }}>
                      {item.dateOfFirstDelinquency || item.originalDateOfDelinquency ? 'Verify DOFD' : 'DOFD missing — add it now'}
                    </label>
                    <input
                      id={`dofd-${item.id}`}
                      value={item.dateOfFirstDelinquency ?? item.originalDateOfDelinquency ?? ''}
                      onChange={event => updateReviewDofd(item.id, event.target.value)}
                      onClick={event => event.stopPropagation()}
                      placeholder="MM/YYYY or YYYY-MM-DD"
                      aria-label={`Date of First Delinquency for ${item.creditorName}`}
                      style={{
                        width: '180px', padding: '5px 8px', borderRadius: '6px', fontSize: '12px',
                        color: '#eee', background: 'rgba(0,0,0,0.45)', outline: 'none',
                        border: `1px solid ${item.dateOfFirstDelinquency || item.originalDateOfDelinquency ? 'rgba(255,255,255,0.18)' : 'rgba(245,158,11,0.65)'}`,
                      }}
                    />
                  </div>
                </div>
                <div style={{ flexShrink: 0, textAlign: 'right' }}>
                  <div style={{ fontSize: '12px', color: confidence >= 80 ? '#22c55e' : confidence >= 60 ? '#fbbf24' : '#f87171' }}>
                    {confidence}%
                  </div>
                  <div style={{ fontSize: '10px', color: '#555' }}>confidence</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (pageState === 'parsing') {
    return (
      <div style={{
        padding: '60px 40px', maxWidth: '600px', margin: '0 auto', textAlign: 'center',
      }}>
        <div style={{ fontSize: '48px', marginBottom: '24px' }}>⚙️</div>
        <h2 style={{ fontSize: '22px', fontWeight: 'bold', marginBottom: '8px' }}>
          Analyzing Your Credit Report
        </h2>
        <p style={{ color: '#888', marginBottom: '32px', fontSize: '14px' }}>
          {progress.msg || 'Processing...'}
        </p>
        {/* Progress Bar */}
        <div style={{
          width: '100%', height: '8px', background: 'rgba(255,255,255,0.1)',
          borderRadius: '4px', overflow: 'hidden', marginBottom: '12px',
        }}>
          <div style={{
            width: `${progress.pct}%`, height: '100%',
            background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)',
            transition: 'width 0.4s ease',
            borderRadius: '4px',
          }} />
        </div>
        <p style={{ color: '#555', fontSize: '13px' }}>{progress.pct}%</p>
        <div style={{ marginTop: '32px', fontSize: '12px', color: '#444' }}>
          Heuristic parsing → AI enhancement → Validation → Deduplication
        </div>
      </div>
    );
  }

  // ── INPUT STATE ───────────────────────────────────────────────
  return (
    <div style={{ padding: '24px', maxWidth: '800px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontSize: '26px', fontWeight: 'bold', marginBottom: '6px' }}>
          📄 Upload Credit Report
        </h1>
        <p style={{ color: '#888', fontSize: '14px' }}>
          Add your credit report to automatically extract all negative items for dispute
        </p>
      </div>

      {/* Method Tabs */}
      <div style={{
        display: 'flex', gap: '2px', marginBottom: '24px',
        background: 'rgba(0,0,0,0.4)', borderRadius: '10px', padding: '4px',
      }}>
        {([
          { id: 'paste', label: '📋 Paste Text', desc: 'Copy/paste from browser or PDF' },
          { id: 'pdf', label: '📎 Upload PDF', desc: 'Drag & drop PDF file' },
        ] as const).map(m => (
          <button
            key={m.id}
            onClick={() => setMethod(m.id)}
            style={{
              flex: 1, padding: '10px 16px',
              background: method === m.id ? 'rgba(59,130,246,0.2)' : 'transparent',
              border: method === m.id ? '1px solid rgba(59,130,246,0.4)' : '1px solid transparent',
              borderRadius: '8px', cursor: 'pointer', color: method === m.id ? '#60a5fa' : '#888',
              fontSize: '14px', fontWeight: method === m.id ? 'bold' : 'normal',
              transition: 'all 0.15s',
            }}
          >
            {m.label}
            <div style={{ fontSize: '11px', color: '#555', marginTop: '2px' }}>{m.desc}</div>
          </button>
        ))}
      </div>

      {/* PASTE METHOD */}
      {method === 'paste' && (
        <div>
          <div style={{ marginBottom: '12px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '6px' }}>
              How to get your report text:
            </h3>
            <ol style={{ color: '#777', fontSize: '13px', lineHeight: '1.8', paddingLeft: '20px' }}>
              <li>Visit <strong style={{ color: '#60a5fa' }}>AnnualCreditReport.com</strong> (free)</li>
              <li>View your report in the browser</li>
              <li>Press <kbd style={{ background: '#333', padding: '1px 5px', borderRadius: '3px' }}>Ctrl+A</kbd> then <kbd style={{ background: '#333', padding: '1px 5px', borderRadius: '3px' }}>Ctrl+C</kbd></li>
              <li>Paste below — all three bureaus at once work!</li>
            </ol>
          </div>
          <textarea
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            placeholder="Paste your complete credit report text here...

The parser will automatically:
• Find all negative accounts (collections, charge-offs, late payments, etc.)
• Extract from all 3 bureaus simultaneously
• Remove false positives and phantom lines
• Calculate FCRA removal dates
• Ready for dispute letters immediately after"
            style={{
              width: '100%', height: '300px',
              background: 'rgba(0,0,0,0.4)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '10px', padding: '16px',
              color: '#fff', fontSize: '13px',
              fontFamily: 'monospace', lineHeight: '1.5',
              resize: 'vertical',
            }}
          />
          <div style={{ marginTop: '6px', color: '#555', fontSize: '12px' }}>
            {pasteText.length > 0 && `${pasteText.length.toLocaleString()} characters pasted`}
          </div>
        </div>
      )}

      {/* PDF METHOD */}
      {method === 'pdf' && (
        <div
          onDrop={handleDrop}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => fileRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? 'rgba(59,130,246,0.6)' : pdfFile ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.15)'}`,
            borderRadius: '12px',
            padding: '48px 24px',
            textAlign: 'center',
            cursor: 'pointer',
            background: dragOver ? 'rgba(59,130,246,0.05)' : 'rgba(0,0,0,0.3)',
            transition: 'all 0.2s',
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".pdf"
            style={{ display: 'none' }}
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) setPdfFile(f);
            }}
          />
          {pdfFile ? (
            <>
              <div style={{ fontSize: '36px', marginBottom: '12px' }}>✅</div>
              <p style={{ color: '#22c55e', fontWeight: 'bold', marginBottom: '4px' }}>
                {pdfFile.name}
              </p>
              <p style={{ color: '#666', fontSize: '13px' }}>
                {(pdfFile.size / 1024).toFixed(0)} KB • Click to change
              </p>
            </>
          ) : (
            <>
              <div style={{ fontSize: '36px', marginBottom: '12px' }}>📎</div>
              <p style={{ color: '#888', fontWeight: 'bold', marginBottom: '4px' }}>
                Drop your PDF here or click to browse
              </p>
              <p style={{ color: '#555', fontSize: '13px' }}>
                Supports credit report PDFs from all three bureaus
              </p>
            </>
          )}
        </div>
      )}

      {/* PARSE BUTTON */}
      <button
        onClick={handleParse}
        disabled={
          (method === 'paste' && pasteText.trim().length < 100) ||
          (method === 'pdf' && !pdfFile)
        }
        style={{
          marginTop: '20px',
          width: '100%',
          padding: '16px',
          background:
            (method === 'paste' && pasteText.trim().length >= 100) ||
              (method === 'pdf' && pdfFile)
              ? 'linear-gradient(135deg, #3b82f6, #8b5cf6)'
              : 'rgba(255,255,255,0.1)',
          color: '#fff',
          border: 'none',
          borderRadius: '10px',
          cursor:
            (method === 'paste' && pasteText.trim().length >= 100) ||
              (method === 'pdf' && pdfFile)
              ? 'pointer'
              : 'not-allowed',
          fontSize: '16px',
          fontWeight: 'bold',
          transition: 'all 0.2s',
        }}
      >
        🔍 Analyze Credit Report
      </button>

      {/* Tips */}
      <div style={{
        marginTop: '24px', padding: '16px',
        background: 'rgba(0,0,0,0.3)', borderRadius: '10px',
        border: '1px solid rgba(255,255,255,0.06)',
      }}>
        <h4 style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '8px', color: '#60a5fa' }}>
          💡 Pro Tips for Best Results
        </h4>
        <ul style={{ color: '#666', fontSize: '12px', lineHeight: '1.8', paddingLeft: '18px' }}>
          <li>Get your free report at <strong>AnnualCreditReport.com</strong> — shows all 3 bureaus</li>
          <li>Paste the complete report — the more text, the better the extraction</li>
          <li>The AI + heuristic engine handles all bureau formats automatically</li>
          <li>You'll review all found items before they're added — you have full control</li>
          <li>Set up your profile in Settings first so letters can be personalized</li>
        </ul>
      </div>
    </div>
  );
}

function getTypeColor(type: string): string {
  const colors: Record<string, string> = {
    'Collection': '#f87171',
    'Charge-Off': '#f43f5e',
    'Late Payment': '#fbbf24',
    'Late Payment 30': '#fbbf24',
    'Late Payment 60': '#fb923c',
    'Late Payment 90': '#f87171',
    'Late Payment 120+': '#f43f5e',
    'Repossession': '#c084fc',
    'Foreclosure': '#f43f5e',
    'Judgment': '#f43f5e',
    'Bankruptcy': '#f43f5e',
    'Other Derogatory': '#94a3b8',
  };
  return colors[type] ?? '#94a3b8';
}
