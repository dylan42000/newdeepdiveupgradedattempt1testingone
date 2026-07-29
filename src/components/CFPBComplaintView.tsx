/**
 * CFPBComplaintView.tsx — Pass 5 CFPB Complaint Pack Viewer
 * Displays the generated CFPB complaint, state AG info, and submission guidance.
 */

import React, { useState } from 'react';
import { ExternalLink, Copy, CheckCircle, FileText, AlertTriangle, Building2, Globe } from 'lucide-react';
import type { CFPBComplaintPack } from '../types/creditRepair';

interface CFPBComplaintViewProps {
  pack: CFPBComplaintPack;
  onCopyNarrative?: () => void;
  onOpenCFPB?: () => void;
}

export const CFPBComplaintView: React.FC<CFPBComplaintViewProps> = ({
  pack,
  onCopyNarrative,
  onOpenCFPB,
}) => {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'cfpb' | 'state'>('cfpb');
  const complaintText = (pack.bureauComplaintDraft || pack.furnisherComplaintDraft || '').trim();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(complaintText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      onCopyNarrative?.();
    } catch {
      // fallback — select text manually
    }
  };

  const handleOpenCFPB = () => {
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(pack.cfpbSubmissionUrl);
    } else {
      window.open(pack.cfpbSubmissionUrl, '_blank', 'noopener,noreferrer');
    }
    onOpenCFPB?.();
  };

  return (
    <div className="space-y-4">
      {/* Header alert */}
      <div className="rounded-xl border border-red-900 bg-red-950/30 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-300">Pass 5 — Final Escalation</p>
            <p className="text-xs text-red-400/80 mt-1">
              This dispute has reached its final pass. The CFPB complaint pack below should be filed
              at consumerfinance.gov. This triggers a formal federal investigation requiring a written
              response from the company.
            </p>
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-3">
          <p className="text-gray-500 text-xs mb-1">Respondent</p>
          <p className="text-gray-200 font-medium">Credit Bureau / Furnisher</p>
          <p className="text-gray-500 text-xs mt-0.5">Item ID: {pack.itemId}</p>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-3">
          <p className="text-gray-500 text-xs mb-1">Submission Links</p>
          <p className="text-gray-200 text-xs leading-relaxed">CFPB + FTC complaint drafts included</p>
        </div>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 rounded-lg border border-gray-800 bg-gray-900/30 p-1 text-xs">
        <button
          onClick={() => setActiveTab('cfpb')}
          className={`flex-1 py-1.5 px-3 rounded-md transition-colors ${
            activeTab === 'cfpb' ? 'bg-cyan-900/50 text-cyan-400' : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          <Globe className="w-3.5 h-3.5 inline mr-1" />
          CFPB Complaint
        </button>
        <button
          onClick={() => setActiveTab('state')}
          className={`flex-1 py-1.5 px-3 rounded-md transition-colors ${
            activeTab === 'state' ? 'bg-purple-900/50 text-purple-400' : 'text-gray-500 hover:text-gray-300'
          } ${!pack.stateAGInfo ? 'opacity-50' : ''}`}
          disabled={!pack.stateAGInfo}
        >
          <Building2 className="w-3.5 h-3.5 inline mr-1" />
          State AG
        </button>
      </div>

      {activeTab === 'cfpb' && (
        <div className="space-y-3">
          {/* Narrative */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-cyan-400" />
                <span className="text-sm text-gray-200 font-medium">Complaint Narrative</span>
              </div>
              <button
                onClick={handleCopy}
                className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border transition-all ${
                  copied
                    ? 'text-green-400 border-green-700 bg-green-900/20'
                    : 'text-gray-400 border-gray-700 hover:text-gray-200 hover:border-gray-600'
                }`}
              >
                {copied ? <CheckCircle className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div className="p-4">
              <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-line">
                {complaintText}
              </p>
            </div>
          </div>

          {/* How to file */}
          <div className="rounded-xl border border-cyan-900/50 bg-cyan-950/20 p-4 space-y-3">
            <p className="text-sm font-medium text-cyan-300">How to File with CFPB</p>
            <ol className="space-y-2 text-xs text-gray-400">
              {[
                'Click "Open CFPB Portal" below — this takes you to consumerfinance.gov',
                'Select "Credit reporting, credit repair services, or other personal consumer reports"',
                'Choose "Incorrect information on your report"',
                'Paste the complaint narrative above into the description field',
                'Upload copies of your dispute letters as supporting documents',
                'Submit — you will receive a case number within 24 hours',
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="flex-shrink-0 w-4 h-4 rounded-full bg-cyan-900/50 border border-cyan-800 text-cyan-400 text-[10px] flex items-center justify-center font-medium">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>

            <button
              onClick={handleOpenCFPB}
              className="flex items-center gap-2 text-xs text-cyan-400 hover:text-cyan-300 px-3 py-2 rounded-lg border border-cyan-800 hover:border-cyan-600 transition-colors w-full justify-center mt-2"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open CFPB Portal (consumerfinance.gov)
            </button>
          </div>
        </div>
      )}

      {activeTab === 'state' && pack.stateAGInfo && (
        <div className="space-y-3">
          <div className="rounded-xl border border-purple-900/50 bg-purple-950/20 p-4">
            <p className="text-sm font-medium text-purple-300 mb-2">State Attorney General Office</p>
            <p className="text-gray-200 text-sm">{pack.stateAGInfo.state}</p>
            <p className="text-gray-400 text-xs mt-1 whitespace-pre-line">{pack.stateAGInfo.address}</p>
            <a
              href={pack.stateAGInfo.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-2 text-xs text-purple-300 hover:text-purple-200"
            >
              <ExternalLink className="w-3 h-3" />
              Open State AG Complaint Portal
            </a>
          </div>

          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
            <p className="text-xs text-gray-400 leading-relaxed">
              Send a certified mail complaint to your State AG office along with copies of all dispute
              letters and bureau responses. State AG offices can investigate consumer protection
              violations under state law, which often provides additional remedies beyond the FCRA.
              Include your CFPB case number once received for maximum effect.
            </p>
          </div>
        </div>
      )}

      <p className="text-xs text-gray-600 text-center">
        Generated {new Date(pack.generatedAt).toLocaleDateString()} · Complaint pack ID {pack.id.slice(0, 8)}
      </p>
    </div>
  );
};
