import React, { useState, useEffect } from 'react';
import { X, Search, Sparkles, Save, Building2, MapPin, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { FURNISHER_DISPUTE_ADDRESSES, saveToFurnisherAddressVault, type FurnisherAddress } from '../data/furnisherAddresses';
import { AddressResearchAgent } from '../services/addressResearchAgent';
import { resolveDisputeResolutionTasks } from '../services/disputeResolutionQueue';

interface FurnisherAddressInputModalProps {
  isOpen: boolean;
  onClose: () => void;
  creditorName: string;
  itemId?: string;
  profileId?: string;
  initialAddress?: string;
  onSaved?: (address: FurnisherAddress) => void;
  onResubmit?: () => void;
}

export const FurnisherAddressInputModal: React.FC<FurnisherAddressInputModalProps> = ({
  isOpen,
  onClose,
  creditorName,
  itemId,
  profileId = 'default',
  initialAddress = '',
  onSaved,
  onResubmit,
}) => {
  const [activeTab, setActiveTab] = useState<'manual' | 'ai' | 'library'>('manual');
  
  // Manual Form State
  const [addressLine, setAddressLine] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');
  const [phone, setPhone] = useState('');

  // AI Research State
  const [aiLoading, setAiLoading] = useState(false);
  const [aiCandidate, setAiCandidate] = useState<FurnisherAddress | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  // Library Search State
  const [searchQuery, setSearchQuery] = useState(creditorName);
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setSavedSuccess(false);
    setSearchQuery(creditorName);

    // Pre-populate if initial address provided
    if (initialAddress) {
      const lines = initialAddress.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length >= 2) {
        const last = lines.at(-1) ?? '';
        const match = last.match(/^(.+),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
        if (match) {
          setAddressLine(lines.slice(0, -1).join(', '));
          setCity(match[1].trim());
          setState(match[2].toUpperCase());
          setZip(match[3]);
          return;
        }
      }
      setAddressLine(initialAddress);
    }
  }, [isOpen, creditorName, initialAddress]);

  if (!isOpen) return null;

  const libraryMatches = Object.entries(FURNISHER_DISPUTE_ADDRESSES)
    .filter(([key, addr]) => {
      const q = searchQuery.toLowerCase().trim();
      if (!q) return true;
      return (
        key.includes(q) ||
        addr.name.toLowerCase().includes(q) ||
        addr.legalName.toLowerCase().includes(q) ||
        addr.city.toLowerCase().includes(q)
      );
    })
    .slice(0, 15);

  const handleSaveAddress = async (candidateAddress: FurnisherAddress) => {
    try {
      await saveToFurnisherAddressVault(candidateAddress);

      // Save to Contacts in localStorage if available
      try {
        const savedContactsRaw = localStorage.getItem('dylandos_contacts_v1') || localStorage.getItem('dylandos_contacts') || '[]';
        const contacts = JSON.parse(savedContactsRaw);
        const fullAddrStr = `${candidateAddress.legalName}\n${candidateAddress.disputeAddress}\n${candidateAddress.city}, ${candidateAddress.state} ${candidateAddress.zip}`;
        const existingIdx = contacts.findIndex((c: any) => c.name?.toLowerCase() === candidateAddress.name.toLowerCase());
        if (existingIdx >= 0) {
          contacts[existingIdx].address = fullAddrStr;
        } else {
          contacts.push({
            id: crypto.randomUUID(),
            name: candidateAddress.name,
            company: candidateAddress.legalName,
            address: fullAddrStr,
            type: 'Furnisher',
          });
        }
        localStorage.setItem('dylandos_contacts_v1', JSON.stringify(contacts));
      } catch { /* non-critical */ }

      // Resolve queue tasks if itemId provided
      if (itemId) {
        resolveDisputeResolutionTasks(profileId, itemId);
      }

      setSavedSuccess(true);
      if (onSaved) onSaved(candidateAddress);

      setTimeout(() => {
        onClose();
        if (onResubmit) onResubmit();
      }, 1000);
    } catch (err: any) {
      console.error('Failed to save address:', err);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!addressLine.trim() || !city.trim() || !state.trim() || !zip.trim()) return;

    const candidate: FurnisherAddress = {
      name: creditorName,
      legalName: creditorName,
      disputeAddress: addressLine.trim(),
      city: city.trim(),
      state: state.trim().toUpperCase(),
      zip: zip.trim(),
      phone: phone.trim(),
      type: 'collection',
    };

    handleSaveAddress(candidate);
  };

  const handleAiFetch = async () => {
    setAiLoading(true);
    setAiError(null);
    setAiCandidate(null);
    try {
      const res = await AddressResearchAgent.searchAndVaultAddress(creditorName);
      if (res) {
        setAiCandidate(res);
      } else {
        setAiError(`Could not automatically find dispute address for "${creditorName}". Please enter manually below.`);
      }
    } catch (err: any) {
      setAiError(err.message || 'AI search failed.');
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative bg-gray-950 border border-cyan-800/80 rounded-2xl w-full max-w-xl p-6 shadow-2xl z-10 text-gray-100 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-800 pb-4 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-950/60 border border-cyan-700/60 text-cyan-400">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-100">Furnisher Address Library</h3>
              <p className="text-xs text-gray-400">Target: <span className="text-cyan-300 font-semibold">{creditorName}</span></p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {savedSuccess ? (
          <div className="py-8 text-center space-y-3">
            <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto animate-bounce" />
            <h4 className="text-lg font-bold text-emerald-300">Address Saved to Library!</h4>
            <p className="text-xs text-gray-400">Address vaulted into system. Resubmitting letter...</p>
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className="flex gap-2 p-1 bg-gray-900 rounded-xl mb-5 border border-gray-800">
              <button
                type="button"
                onClick={() => setActiveTab('manual')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-lg transition-all ${
                  activeTab === 'manual' ? 'bg-cyan-950 text-cyan-300 border border-cyan-700/60' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <MapPin className="w-3.5 h-3.5" /> Input Address
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('ai')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-lg transition-all ${
                  activeTab === 'ai' ? 'bg-cyan-950 text-cyan-300 border border-cyan-700/60' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5 text-yellow-400" /> AI Auto-Fetch
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('library')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-lg transition-all ${
                  activeTab === 'library' ? 'bg-cyan-950 text-cyan-300 border border-cyan-700/60' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <Search className="w-3.5 h-3.5" /> Search Library
              </button>
            </div>

            {/* Tab 1: Manual Form */}
            {activeTab === 'manual' && (
              <form onSubmit={handleManualSubmit} className="space-y-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-400 mb-1">Dispute Street Address / P.O. Box</label>
                  <input
                    type="text"
                    required
                    value={addressLine}
                    onChange={(e) => setAddressLine(e.target.value)}
                    placeholder="e.g. 100 Credit Way, Suite 400 or P.O. Box 9000"
                    className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-1">
                    <label className="block text-[11px] font-semibold text-gray-400 mb-1">City</label>
                    <input
                      type="text"
                      required
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="e.g. Dallas"
                      className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-400 mb-1">State</label>
                    <input
                      type="text"
                      required
                      maxLength={2}
                      value={state}
                      onChange={(e) => setState(e.target.value.toUpperCase())}
                      placeholder="TX"
                      className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500 uppercase"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-400 mb-1">Zip Code</label>
                    <input
                      type="text"
                      required
                      value={zip}
                      onChange={(e) => setZip(e.target.value)}
                      placeholder="75201"
                      className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-gray-400 mb-1">Phone Number (Optional)</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="e.g. 800-555-0199"
                    className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 rounded-xl text-xs font-semibold border border-gray-800 text-gray-400 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white transition-all"
                  >
                    <Save className="w-3.5 h-3.5" /> Save to Library & Resubmit
                  </button>
                </div>
              </form>
            )}

            {/* Tab 2: AI Auto-Fetch */}
            {activeTab === 'ai' && (
              <div className="space-y-4 py-2">
                <p className="text-xs text-gray-400">
                  Click below to let our AI agent query official dispute registries for <strong className="text-cyan-300">{creditorName}</strong>'s consumer dispute mailing address.
                </p>

                <button
                  type="button"
                  onClick={handleAiFetch}
                  disabled={aiLoading}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-bold bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white transition-all disabled:opacity-50"
                >
                  {aiLoading ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Searching official dispute databases...</>
                  ) : (
                    <><Sparkles className="w-4 h-4 text-yellow-300" /> Pull Furnisher Address with AI</>
                  )}
                </button>

                {aiError && (
                  <div className="p-3 rounded-xl border border-red-900/60 bg-red-950/20 text-xs text-red-300 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    <span>{aiError}</span>
                  </div>
                )}

                {aiCandidate && (
                  <div className="p-4 rounded-xl border border-emerald-800 bg-emerald-950/20 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-emerald-300">AI Found Address:</span>
                      <span className="text-[10px] bg-emerald-900/60 text-emerald-200 px-2 py-0.5 rounded font-mono">CONFIRMED</span>
                    </div>
                    <p className="text-xs font-semibold text-white">{aiCandidate.legalName}</p>
                    <p className="text-xs text-gray-300">{aiCandidate.disputeAddress}</p>
                    <p className="text-xs text-gray-300">{aiCandidate.city}, {aiCandidate.state} {aiCandidate.zip}</p>
                    {aiCandidate.phone && <p className="text-[11px] text-gray-400">Phone: {aiCandidate.phone}</p>}

                    <button
                      type="button"
                      onClick={() => handleSaveAddress(aiCandidate)}
                      className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-all"
                    >
                      <CheckCircle className="w-3.5 h-3.5" /> Confirm & Save to Library
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Tab 3: Search Library */}
            {activeTab === 'library' && (
              <div className="space-y-3">
                <div className="relative">
                  <Search className="w-4 h-4 text-gray-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search 1,500+ built-in addresses..."
                    className="w-full bg-gray-900 border border-gray-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {libraryMatches.length === 0 ? (
                    <p className="text-xs text-gray-500 italic text-center py-4">No matching entries in library. Switch to "Input Address" or "AI Auto-Fetch".</p>
                  ) : (
                    libraryMatches.map(([key, addr]) => (
                      <div
                        key={key}
                        className="p-3 rounded-xl border border-gray-800 bg-gray-900/60 hover:border-cyan-800 transition-all flex items-center justify-between gap-3"
                      >
                        <div>
                          <p className="text-xs font-bold text-white">{addr.legalName}</p>
                          <p className="text-[11px] text-gray-400">{addr.disputeAddress}, {addr.city}, {addr.state} {addr.zip}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleSaveAddress(addr)}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-cyan-950 border border-cyan-700/80 text-cyan-300 hover:bg-cyan-900 transition-all whitespace-nowrap"
                        >
                          Use This Address
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
