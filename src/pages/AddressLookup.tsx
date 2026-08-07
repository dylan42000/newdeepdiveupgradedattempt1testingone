import React, { useState, useCallback, useMemo, useEffect } from "react";
import {
  Search, MapPin, Phone, Globe, RefreshCw, AlertCircle, Copy, CheckCircle2,
  Database, Plus, Trash2, Car, GraduationCap,
  Wifi, Home, X, Save, Sparkles, Star, ChevronDown, ChevronUp,
  ExternalLink, Filter, Landmark, ShieldCheck,
} from "lucide-react";
import { lookupDisputeAddress } from "../services/geminiService";
import {
  FURNISHER_DISPUTE_ADDRESSES,
  findFurnisherAddress,
  searchFurnisherAddresses,
  FurnisherAddress,
} from "../data/furnisherAddresses";
import { useAppContext } from "../context/AppContext";
import { v4 as uuidv4 } from "uuid";
import { clearPendingAddressResearch, getAllPendingAddressResearch, type PendingAddressResearch } from "../services/addressResearchAgent";

type ActiveTab = "lookup" | "database";
type TypeFilter =
  | "all" | "bank" | "credit_card" | "auto" | "student"
  | "collection" | "mortgage" | "utility" | "telecom" | "saved";

interface AddressResult {
  name: string;
  legalName?: string;
  disputeAddress: string;
  phone: string;
  fax?: string;
  onlineDisputeUrl: string;
  notes: string;
  source?: "local" | "ai";
  type?: string;
}

interface AddressBookComparable {
  name: string;
  address: string;
  phone?: string;
  fax?: string;
  disputeEmail?: string;
}

// ── Quick queries organized by category ───────────────────────────────────────
const QUICK_CATEGORIES: { label: string; queries: string[] }[] = [
  {
    label: "CREDIT BUREAUS",
    queries: ["Equifax", "Experian", "TransUnion", "ChexSystems", "Innovis", "LexisNexis"],
  },
  {
    label: "MAJOR BANKS & CARDS",
    queries: [
      "Bank of America", "Chase", "Wells Fargo", "Capital One", "Citibank",
      "American Express", "Discover", "Synchrony Bank", "US Bank", "PNC Bank",
      "TD Bank", "Regions Bank", "Truist", "Citizens Bank", "Fifth Third Bank",
      "KeyBank", "Huntington Bank", "Navy Federal", "USAA", "Credit One Bank",
      "Barclays", "First Premier Bank", "Merrick Bank",
    ],
  },
  {
    label: "COLLECTION AGENCIES",
    queries: [
      "LVNV Funding", "Midland Credit Management", "Portfolio Recovery Associates",
      "Cavalry Portfolio", "ERC", "IC System", "Convergent Outsourcing",
      "Jefferson Capital", "AmSher Collection", "National Credit Systems",
      "Crown Asset Management", "Sequium Asset", "Capio Partners",
      "Radius Global Solutions", "Absolute Resolutions", "Caine & Weiner",
      "Paragon Revenue", "Frontline Asset Strategies", "I.Q. Data International",
      "CMRE Financial", "Resurgent Capital", "Encore Capital",
    ],
  },
  {
    label: "AUTO LENDERS",
    queries: [
      "Ally Financial", "Toyota Financial Services", "GM Financial",
      "Ford Motor Credit", "Santander Consumer USA", "Honda Financial Services",
      "Nissan Motor Acceptance", "Hyundai Motor Finance", "CarMax Auto Finance",
      "Westlake Financial", "Credit Acceptance Corp", "DriveTime", "Bridgecrest",
    ],
  },
  {
    label: "STUDENT LOANS",
    queries: [
      "Navient", "Sallie Mae", "Nelnet", "Aidvantage", "MOHELA",
      "Great Lakes", "ECMC Group", "Granite State Management",
    ],
  },
  {
    label: "MORTGAGE SERVICERS",
    queries: [
      "Rocket Mortgage", "Mr. Cooper", "Freedom Mortgage",
      "Specialized Loan Servicing", "LoanCare", "PHH Mortgage",
      "Shellpoint Mortgage", "NewRez",
    ],
  },
  {
    label: "TELECOM & UTILITIES",
    queries: [
      "AT&T", "Verizon", "T-Mobile", "Sprint", "Comcast", "Spectrum",
      "Cox Communications", "DIRECTV", "Duke Energy", "Con Edison",
      "Dominion Energy", "Pacific Gas & Electric",
    ],
  },
];

// ── Type config ───────────────────────────────────────────────────────────────
const TYPE_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  bank:        { label: "BANK",         color: "text-blue-400 border-blue-400/30 bg-blue-400/5",     icon: <Landmark size={10} /> },
  credit_card: { label: "CREDIT CARD",  color: "text-purple-400 border-purple-400/30 bg-purple-400/5", icon: <Globe size={10} /> },
  auto:        { label: "AUTO",         color: "text-orange-400 border-orange-400/30 bg-orange-400/5", icon: <Car size={10} /> },
  student:     { label: "STUDENT LOAN", color: "text-green-400 border-green-400/30 bg-green-400/5",  icon: <GraduationCap size={10} /> },
  collection:  { label: "COLLECTION",   color: "text-red-400 border-red-400/30 bg-red-400/5",        icon: <AlertCircle size={10} /> },
  mortgage:    { label: "MORTGAGE",     color: "text-yellow-400 border-yellow-400/30 bg-yellow-400/5", icon: <Home size={10} /> },
  utility:     { label: "UTILITY",      color: "text-cyan-400 border-cyan-400/30 bg-cyan-400/5",     icon: <Wifi size={10} /> },
  telecom:     { label: "TELECOM",      color: "text-pink-400 border-pink-400/30 bg-pink-400/5",     icon: <Phone size={10} /> },
  saved:       { label: "SAVED",        color: "text-[#00ff00] border-[#00ff00]/30 bg-[#00ff00]/5",  icon: <Star size={10} /> },
};

const TYPE_FILTER_TABS: { key: TypeFilter; label: string }[] = [
  { key: "all",         label: "ALL" },
  { key: "bank",        label: "BANKS" },
  { key: "credit_card", label: "CARDS" },
  { key: "collection",  label: "COLLECTIONS" },
  { key: "auto",        label: "AUTO" },
  { key: "mortgage",    label: "MORTGAGE" },
  { key: "student",     label: "STUDENT" },
  { key: "telecom",     label: "TELECOM" },
  { key: "utility",     label: "UTILITY" },
  { key: "saved",       label: "SAVED" },
];

const SEARCH_PLACEHOLDERS = [
  "e.g. 'LVNV Funding dispute address'",
  "e.g. 'Midland Credit Management mailing address'",
  "e.g. 'Equifax dispute PO box'",
  "e.g. 'Portfolio Recovery Associates address'",
  "e.g. 'Navient dispute contact'",
  "e.g. 'Capital One dispute address'",
  "e.g. 'T-Mobile credit bureau dispute'",
  "e.g. 'Santander Consumer USA dispute'",
  "e.g. 'ChexSystems dispute address'",
  "e.g. 'Rocket Mortgage dispute mailing'",
  "e.g. 'Jefferson Capital Systems address'",
  "e.g. 'Cavalry Portfolio Services PO box'",
];

function normalizeLookupValue(value?: string | null): string {
  return (value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePhone(value?: string | null): string {
  return (value || "").replace(/\D/g, "");
}

function contactsLikelySame(existing: AddressBookComparable, candidate: AddressBookComparable): boolean {
  const existingName = normalizeLookupValue(existing.name);
  const candidateName = normalizeLookupValue(candidate.name);
  const existingAddress = normalizeLookupValue(existing.address);
  const candidateAddress = normalizeLookupValue(candidate.address);
  const existingPhone = normalizePhone(existing.phone);
  const candidatePhone = normalizePhone(candidate.phone);

  const sameName = existingName && candidateName && (existingName === candidateName || existingName.includes(candidateName) || candidateName.includes(existingName));
  const sameAddress = existingAddress && candidateAddress && (existingAddress === candidateAddress || existingAddress.includes(candidateAddress) || candidateAddress.includes(existingAddress));
  const samePhone = existingPhone.length >= 7 && candidatePhone.length >= 7 && existingPhone === candidatePhone;

  return Boolean(sameName && (sameAddress || samePhone));
}

// ── TypeBadge ─────────────────────────────────────────────────────────────────
function TypeBadge({ type }: { type: string }) {
  const cfg = TYPE_CONFIG[type] || TYPE_CONFIG["collection"];
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-mono font-bold border px-1.5 py-0.5 rounded ${cfg.color}`}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

// ── InlineCopyButton ──────────────────────────────────────────────────────────
function CopyBtn({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="inline-flex items-center gap-1 text-[10px] text-zinc-500 hover:text-[#00ffff] transition-colors"
    >
      {copied ? <CheckCircle2 size={12} className="text-[#00ff00]" /> : <Copy size={12} />}
      {copied ? "Copied!" : label}
    </button>
  );
}

// ── FurnisherCard ─────────────────────────────────────────────────────────────
function FurnisherCard({ f }: { f: FurnisherAddress }) {
  const fullAddress = `${f.legalName}\n${f.disputeAddress}\n${f.city}, ${f.state} ${f.zip}`;
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 hover:border-zinc-700 transition-colors flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-bold text-white leading-tight">{f.name}</div>
          <div className="text-[10px] text-zinc-600 font-mono mt-0.5 leading-tight">{f.legalName}</div>
        </div>
        <TypeBadge type={f.type} />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-start gap-2">
          <MapPin size={11} className="text-zinc-600 mt-0.5 shrink-0" />
          <span className="text-xs text-zinc-400 font-mono leading-tight">
            {f.disputeAddress}, {f.city}, {f.state} {f.zip}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Phone size={11} className="text-zinc-600 shrink-0" />
          <span className="text-xs text-zinc-400">{f.phone}</span>
        </div>
        {f.onlineDisputeUrl && (
          <div className="flex items-center gap-2">
            <Globe size={11} className="text-blue-500 shrink-0" />
            <a href={f.onlineDisputeUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 truncate">
              Online Portal <ExternalLink size={10} />
            </a>
          </div>
        )}
      </div>
      <div className="flex gap-3 pt-1 border-t border-zinc-800">
        <CopyBtn text={fullAddress} label="Copy Address" />
        <CopyBtn text={f.phone} label="Copy Phone" />
      </div>
    </div>
  );
}

// ── SavedContactCard ──────────────────────────────────────────────────────────
function SavedContactCard({
  contact, onRemove,
}: { contact: { id: string; name: string; type: string; address: string; phone: string; fax?: string; disputeEmail?: string }; onRemove: () => void }) {
  return (
    <div className="bg-zinc-900 border border-[#00ff00]/20 rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="text-sm font-bold text-white leading-tight">{contact.name}</div>
          <TypeBadge type={contact.type || "saved"} />
        </div>
        <button onClick={onRemove} className="text-zinc-700 hover:text-red-400 transition-colors p-1" title="Remove">
          <Trash2 size={14} />
        </button>
      </div>
      <div className="space-y-1.5">
        {contact.address && (
          <div className="flex items-start gap-2">
            <MapPin size={11} className="text-zinc-600 mt-0.5 shrink-0" />
            <span className="text-xs text-zinc-400 font-mono leading-tight whitespace-pre-wrap">{contact.address}</span>
          </div>
        )}
        {contact.phone && (
          <div className="flex items-center gap-2">
            <Phone size={11} className="text-zinc-600 shrink-0" />
            <span className="text-xs text-zinc-400">{contact.phone}</span>
          </div>
        )}
        {contact.disputeEmail && (
          <div className="flex items-center gap-2">
            <Globe size={11} className="text-blue-500 shrink-0" />
            <span className="text-xs text-blue-400 truncate">{contact.disputeEmail}</span>
          </div>
        )}
      </div>
      <div className="flex gap-3 pt-1 border-t border-zinc-800">
        {contact.address && <CopyBtn text={contact.address} label="Copy Address" />}
        {contact.phone && <CopyBtn text={contact.phone} label="Copy Phone" />}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export function AddressLookup() {
  const ctx = useAppContext();
  const { contacts, addContact, removeContact } = ctx;

  // Lookup state
  const [activeTab, setActiveTab] = useState<ActiveTab>("lookup");
  const [query, setQuery] = useState("");
  const [placeholderIdx] = useState(() => Math.floor(Math.random() * SEARCH_PLACEHOLDERS.length));
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AddressResult | null>(null);
  const [localAlternates, setLocalAlternates] = useState<FurnisherAddress[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savedToBook, setSavedToBook] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<string | null>("CREDIT BUREAUS");
  const [pendingReviews, setPendingReviews] = useState<PendingAddressResearch[]>(() => getAllPendingAddressResearch());

  useEffect(() => {
    const refresh = () => setPendingReviews(getAllPendingAddressResearch());
    window.addEventListener('address-research:review-required', refresh);
    return () => window.removeEventListener('address-research:review-required', refresh);
  }, []);

  const confirmResearchedAddress = useCallback((pending: PendingAddressResearch) => {
    const c = pending.candidate;
    addContact({
      id: uuidv4(),
      name: c.legalName || c.name,
      type: c.type,
      address: `${c.disputeAddress}\n${c.city}, ${c.state} ${c.zip}`,
      phone: c.phone,
      fax: c.fax,
      disputeEmail: c.onlineDisputeUrl,
    });
    clearPendingAddressResearch(pending.creditorName);
    setPendingReviews(getAllPendingAddressResearch());
  }, [addContact]);

  // Database state
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [dbSearch, setDbSearch] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEntry, setNewEntry] = useState({
    name: "", address: "", city: "", state: "", zip: "",
    phone: "", fax: "", website: "", type: "collection",
  });

  // Deduplicated furnisher list
  const uniqueFurnishers = useMemo(() => {
    const seen = new Set<string>();
    return Object.values(FURNISHER_DISPUTE_ADDRESSES).filter((f) => {
      const dedupeKey = normalizeLookupValue(`${f.legalName} ${f.disputeAddress} ${f.city} ${f.state} ${f.zip}`);
      if (seen.has(dedupeKey)) return false;
      seen.add(dedupeKey);
      return true;
    });
  }, []);

  const filteredFurnishers = useMemo(() => {
    let list = uniqueFurnishers;
    if (typeFilter !== "all" && typeFilter !== "saved") {
      list = list.filter((f) => f.type === typeFilter);
    }
    if (dbSearch.trim()) {
      const q = normalizeLookupValue(dbSearch);
      list = list.filter(
        (f) => {
          const searchable = [
            f.name,
            f.legalName,
            f.disputeAddress,
            f.city,
            f.state,
            f.zip,
            f.phone,
            f.fax || "",
            f.onlineDisputeUrl || "",
            f.type,
          ]
            .map((field) => normalizeLookupValue(field))
            .join(" ");
          return searchable.includes(q);
        }
      );
    }
    return list;
  }, [uniqueFurnishers, typeFilter, dbSearch]);

  const filteredSaved = useMemo(() => {
    if (!dbSearch.trim()) return contacts;
    const q = normalizeLookupValue(dbSearch);
    return contacts.filter(
      (c) => {
        const searchable = [
          c.name,
          c.address,
          c.phone,
          c.fax || "",
          c.disputeEmail || "",
          c.type,
        ]
          .map((field) => normalizeLookupValue(field))
          .join(" ");
        return searchable.includes(q);
      }
    );
  }, [contacts, dbSearch]);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: uniqueFurnishers.length, saved: contacts.length };
    uniqueFurnishers.forEach((f) => { counts[f.type] = (counts[f.type] || 0) + 1; });
    return counts;
  }, [uniqueFurnishers, contacts]);

  // Smart lookup: local DB first, then AI fallback
  const handleSearch = useCallback(async (q: string = query) => {
    if (!q.trim()) return;
    setLoading(true); setError(null); setResult(null); setSavedToBook(false);
    setLocalAlternates([]);

    // 1. Check local database instantly
    const localMatches = searchFurnisherAddresses(q.trim(), 6);
    const localMatch = localMatches[0] || findFurnisherAddress(q.trim());
    if (localMatch) {
      setLocalAlternates(localMatches.slice(1));
      setResult({
        name: localMatch.name,
        legalName: localMatch.legalName,
        disputeAddress: `${localMatch.disputeAddress}\n${localMatch.city}, ${localMatch.state} ${localMatch.zip}`,
        phone: localMatch.phone,
        fax: localMatch.fax,
        onlineDisputeUrl: localMatch.onlineDisputeUrl || "",
        notes: localMatches.length > 1
          ? `Found ${localMatches.length} local matches. Review alternates below if this is not the exact furnisher on your report.`
          : "",
        source: "local",
        type: localMatch.type,
      });
      setLoading(false);
      return;
    }

    // 2. AI fallback for unknown furnishers
    try {
      const res = await lookupDisputeAddress(q.trim());
      setResult({ ...res, source: "ai" });
    } catch (err: any) {
      setError(err.message || "Lookup failed. Try a more specific name (e.g. 'LVNV Funding dispute address').");
    } finally {
      setLoading(false);
    }
  }, [query]);

  const handleQuickSearch = (q: string) => { setQuery(q); handleSearch(q); };

  const handleSaveToBook = () => {
    if (!result) return;
    const candidate: AddressBookComparable = {
      name: result.name,
      address: result.disputeAddress,
      phone: result.phone,
      fax: result.fax,
      disputeEmail: result.onlineDisputeUrl || undefined,
    };

    const duplicate = contacts.some((c) => contactsLikelySame(c, candidate));
    if (duplicate) {
      setSavedToBook(true);
      return;
    }

    addContact({
      id: uuidv4(),
      name: result.name,
      type: result.type || "custom",
      address: result.disputeAddress,
      phone: result.phone,
      fax: result.fax,
      disputeEmail: result.onlineDisputeUrl || undefined,
    });
    setSavedToBook(true);
  };

  const handleAddCustom = () => {
    if (!newEntry.name.trim() || !newEntry.address.trim()) return;
    const customAddress = [newEntry.address.trim(), [newEntry.city, newEntry.state, newEntry.zip].filter(Boolean).join(", ")].filter(Boolean).join("\n");
    const candidate: AddressBookComparable = {
      name: newEntry.name.trim(),
      address: customAddress,
      phone: newEntry.phone.trim(),
      fax: newEntry.fax.trim() || undefined,
      disputeEmail: newEntry.website.trim() || undefined,
    };

    const duplicate = contacts.some((c) => contactsLikelySame(c, candidate));
    if (duplicate) {
      setShowAddForm(false);
      setNewEntry({ name: "", address: "", city: "", state: "", zip: "", phone: "", fax: "", website: "", type: "collection" });
      return;
    }

    addContact({
      id: uuidv4(),
      name: newEntry.name.trim(),
      type: newEntry.type,
      address: customAddress,
      phone: newEntry.phone.trim(),
      fax: newEntry.fax.trim() || undefined,
      disputeEmail: newEntry.website.trim() || undefined,
    });
    setNewEntry({ name: "", address: "", city: "", state: "", zip: "", phone: "", fax: "", website: "", type: "collection" });
    setShowAddForm(false);
  };

  const isAlreadySaved = result
    ? contacts.some((c) =>
      contactsLikelySame(c, {
        name: result.name,
        address: result.disputeAddress,
        phone: result.phone,
        fax: result.fax,
        disputeEmail: result.onlineDisputeUrl || undefined,
      })
    )
    : false;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <MapPin className="text-[#00ffff]" /> ADDRESS LOOKUP & DATABASE
        </h2>
        <p className="text-zinc-400 font-mono text-xs mt-1">
          {uniqueFurnishers.length} BUILT-IN ENTRIES · {contacts.length} SAVED · LOCAL-FIRST LOOKUP WITH AI FALLBACK
        </p>
      </div>

      {pendingReviews.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 space-y-3">
          <div className="flex items-center gap-2"><ShieldCheck size={16} className="text-amber-400" /><h3 className="text-sm font-bold text-amber-300">ADDRESS CONFIRMATION REQUIRED</h3></div>
          <p className="text-xs text-zinc-400">AutoPilot researched these missing addresses but will not generate, approve, export, or mail a letter until you verify and save the correct dispute address.</p>
          {pendingReviews.map(pending => (
            <div key={pending.creditorName} className="rounded-lg border border-zinc-800 bg-black/30 p-3 flex items-start justify-between gap-4">
              <div className="text-xs"><p className="font-bold text-white">{pending.candidate.legalName}</p><p className="text-zinc-400 mt-1">{pending.candidate.disputeAddress}<br />{pending.candidate.city}, {pending.candidate.state} {pending.candidate.zip}</p><p className="text-[10px] text-amber-500 mt-1">AI candidate — compare with the creditor website or recent correspondence first.</p></div>
              <button onClick={() => confirmResearchedAddress(pending)} className="text-[10px] whitespace-nowrap border border-emerald-600 text-emerald-400 px-3 py-2 rounded hover:bg-emerald-500/10">I VERIFIED — SAVE</button>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-0 border-b border-zinc-800">
        {([["lookup", "LOOKUP", <Search size={13} />], ["database", "ADDRESS BOOK", <Database size={13} />]] as const).map(([tab, label, icon]) => (
          <button key={tab} onClick={() => setActiveTab(tab as ActiveTab)}
            className={`flex items-center gap-2 px-5 py-2.5 text-xs font-mono font-bold border-b-2 transition-all ${
              activeTab === tab ? "border-[#00ffff] text-[#00ffff]" : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {icon} {label}
            {tab === "database" && (
              <span className="text-[10px] bg-zinc-800 text-zinc-500 rounded-full px-1.5 py-0.5">
                {uniqueFurnishers.length + contacts.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ═══════════════════════ LOOKUP TAB ═══════════════════════════════ */}
      {activeTab === "lookup" && (
        <div className="space-y-5">
          {/* Search bar */}
          <div className="cyber-panel p-5">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  placeholder={SEARCH_PLACEHOLDERS[placeholderIdx]}
                  className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm pl-10 pr-3 py-3 rounded-lg focus:border-[#00ffff] outline-none font-mono"
                />
              </div>
              <button onClick={() => handleSearch()} disabled={loading || !query.trim()}
                className="cyber-button border-[#00ffff] text-[#00ffff] hover:bg-[#00ffff]/10 px-5 py-3 font-bold flex items-center gap-2 disabled:opacity-40">
                {loading ? <RefreshCw size={16} className="animate-spin" /> : <Search size={16} />}
                {loading ? "SEARCHING..." : "LOOKUP"}
              </button>
            </div>
            <div className="mt-3 flex items-center gap-2 text-[10px] font-mono text-zinc-600">
              <ShieldCheck size={11} className="text-[#00ff00]" />
              CHECKS LOCAL DATABASE FIRST (INSTANT) — AI FALLBACK FOR UNKNOWN FURNISHERS
            </div>
          </div>

          {/* Quick queries by category */}
          <div className="cyber-panel p-5 space-y-2">
            <div className="text-[10px] font-mono text-zinc-500 flex items-center gap-2 mb-1">
              <Sparkles size={11} className="text-[#ff9900]" /> QUICK LOOKUP BY CATEGORY
            </div>
            {QUICK_CATEGORIES.map((cat) => (
              <div key={cat.label}>
                <button
                  onClick={() => setExpandedCategory(expandedCategory === cat.label ? null : cat.label)}
                  className="w-full flex items-center justify-between text-[10px] font-mono text-zinc-600 hover:text-zinc-400 py-1.5 transition-colors"
                >
                  <span>{cat.label} <span className="opacity-50">({cat.queries.length})</span></span>
                  {expandedCategory === cat.label ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                </button>
                {expandedCategory === cat.label && (
                  <div className="flex flex-wrap gap-1.5 pb-2">
                    {cat.queries.map((q) => (
                      <button key={q} onClick={() => handleQuickSearch(q)}
                        className="text-[10px] font-mono border border-zinc-800 text-zinc-500 hover:border-[#00ffff]/50 hover:text-[#00ffff] px-2.5 py-1 rounded transition-all">
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Error */}
          {error && (
            <div className="cyber-panel p-4 border-red-500/50 bg-red-500/5">
              <div className="flex items-center gap-2 text-red-400 text-sm"><AlertCircle size={16} /> {error}</div>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="cyber-panel p-6 border-[#00ffff]/30 space-y-4">
              {/* Header row */}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <MapPin size={17} className="text-[#00ffff]" />
                    <h3 className="text-lg font-bold text-white">{result.name}</h3>
                  </div>
                  {result.legalName && result.legalName !== result.name && (
                    <div className="text-xs text-zinc-500 font-mono ml-7">Legal: {result.legalName}</div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  {result.source === "local" ? (
                    <span className="text-[9px] font-mono font-bold border border-[#00ff00]/40 text-[#00ff00] bg-[#00ff00]/5 px-2 py-0.5 rounded flex items-center gap-1">
                      <Database size={9} /> LOCAL DATABASE
                    </span>
                  ) : (
                    <span className="text-[9px] font-mono font-bold border border-[#ff9900]/40 text-[#ff9900] bg-[#ff9900]/5 px-2 py-0.5 rounded flex items-center gap-1">
                      <Sparkles size={9} /> AI LOOKUP
                    </span>
                  )}
                  {result.type && <TypeBadge type={result.type} />}
                </div>
              </div>

              {/* Dispute mailing address */}
              {result.disputeAddress && (
                <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                  <div className="text-[10px] font-mono text-zinc-500 mb-2 flex items-center gap-1">
                    <MapPin size={10} /> DISPUTE MAILING ADDRESS
                  </div>
                  <pre className="text-sm text-zinc-300 whitespace-pre-wrap font-mono leading-relaxed">{result.disputeAddress}</pre>
                  <div className="mt-3 flex gap-3">
                    <CopyBtn text={result.disputeAddress} label="Copy Address" />
                    <CopyBtn text={`${result.name}\n${result.disputeAddress}`} label="Copy Full Block" />
                  </div>
                </div>
              )}

              {/* Phone / Fax row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {result.phone && (
                  <div className="flex items-center gap-3 p-3 bg-zinc-900 border border-zinc-800 rounded-lg">
                    <Phone size={15} className="text-[#ff9900] shrink-0" />
                    <div className="flex-1">
                      <div className="text-[10px] font-mono text-zinc-500">DISPUTE PHONE</div>
                      <div className="text-sm text-white">{result.phone}</div>
                    </div>
                    <CopyBtn text={result.phone} />
                  </div>
                )}
                {result.fax && (
                  <div className="flex items-center gap-3 p-3 bg-zinc-900 border border-zinc-800 rounded-lg">
                    <Phone size={15} className="text-zinc-600 shrink-0" />
                    <div className="flex-1">
                      <div className="text-[10px] font-mono text-zinc-500">FAX</div>
                      <div className="text-sm text-white">{result.fax}</div>
                    </div>
                    <CopyBtn text={result.fax} />
                  </div>
                )}
              </div>

              {/* Online URL */}
              {result.onlineDisputeUrl && (
                <div className="flex items-center gap-3 p-3 bg-zinc-900 border border-zinc-800 rounded-lg">
                  <Globe size={15} className="text-blue-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-mono text-zinc-500">ONLINE DISPUTE PORTAL</div>
                    <a href={result.onlineDisputeUrl} target="_blank" rel="noopener noreferrer"
                      className="text-sm text-blue-400 hover:text-blue-300 break-all flex items-center gap-1">
                      {result.onlineDisputeUrl} <ExternalLink size={11} />
                    </a>
                  </div>
                  <CopyBtn text={result.onlineDisputeUrl} />
                </div>
              )}

              {/* Notes */}
              {result.notes && (
                <div className="bg-[#ff9900]/5 border border-[#ff9900]/20 rounded-lg p-3">
                  <div className="text-[10px] font-mono text-[#ff9900] mb-1">NOTES</div>
                  <div className="text-xs text-zinc-400">{result.notes}</div>
                </div>
              )}

              {result.source === "local" && localAlternates.length > 0 && (
                <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 space-y-2">
                  <div className="text-[10px] font-mono text-zinc-500">OTHER LOCAL MATCHES</div>
                  <div className="flex flex-wrap gap-2">
                    {localAlternates.map((alt) => (
                      <button
                        key={`${alt.legalName}-${alt.zip}`}
                        onClick={() => handleQuickSearch(alt.name)}
                        className="text-[10px] font-mono border border-zinc-700 text-zinc-400 hover:border-[#00ffff]/50 hover:text-[#00ffff] px-2.5 py-1 rounded transition-all"
                      >
                        {alt.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Save / disclaimer row */}
              <div className="pt-2 border-t border-zinc-800 flex items-center justify-between gap-3 flex-wrap">
                <div className="text-[10px] text-zinc-600 font-mono">
                  {result.source === "local"
                    ? "Verified from built-in database — always cross-check before mailing."
                    : "AI-generated — verify independently before sending certified mail."}
                </div>
                {savedToBook || isAlreadySaved ? (
                  <span className="flex items-center gap-1.5 text-xs text-[#00ff00] font-mono">
                    <CheckCircle2 size={13} /> SAVED TO ADDRESS BOOK
                  </span>
                ) : (
                  <button onClick={handleSaveToBook}
                    className="flex items-center gap-2 text-xs font-mono border border-[#00ffff]/40 text-[#00ffff] hover:bg-[#00ffff]/10 px-3 py-1.5 rounded transition-all">
                    <Save size={12} /> SAVE TO ADDRESS BOOK
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Tips */}
          {!result && !loading && !error && (
            <div className="cyber-panel p-4 border-zinc-800">
              <div className="text-[10px] font-mono text-zinc-600 space-y-1">
                <div className="text-zinc-500 mb-2 font-bold">SEARCH TIPS</div>
                <div>• Use the creditor name exactly as it appears on your credit report</div>
                <div>• Include "dispute address" or "mailing address" in your query for AI searches</div>
                <div>• Local results load instantly — AI is only used for unknown furnishers</div>
                <div>• Always send dispute letters via USPS Certified Mail with Return Receipt</div>
                <div>• Save results to your Address Book for quick reuse across dispute rounds</div>
                <div>• Switch to ADDRESS BOOK tab to browse all {uniqueFurnishers.length}+ built-in entries</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════ DATABASE TAB ════════════════════════════ */}
      {activeTab === "database" && (
        <div className="space-y-5">
          {/* Search + Add */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
              <input value={dbSearch} onChange={(e) => setDbSearch(e.target.value)}
                placeholder="Search name, city, address, phone..."
                className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm pl-9 pr-8 py-2.5 rounded-lg focus:border-[#00ffff] outline-none"
              />
              {dbSearch && (
                <button
                  onClick={() => setDbSearch("")}
                  title="Clear search"
                  aria-label="Clear search"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <button onClick={() => setShowAddForm(!showAddForm)}
              className={`flex items-center gap-2 text-xs font-mono border px-4 py-2.5 rounded-lg transition-all ${
                showAddForm ? "border-red-500/50 text-red-400 hover:bg-red-500/5" : "border-[#00ffff]/40 text-[#00ffff] hover:bg-[#00ffff]/10"
              }`}
            >
              {showAddForm ? <X size={13} /> : <Plus size={13} />}
              {showAddForm ? "CANCEL" : "ADD CUSTOM"}
            </button>
          </div>

          {/* Add custom form */}
          {showAddForm && (
            <div className="cyber-panel p-5 border-[#00ffff]/20 space-y-4">
              <div className="text-xs font-mono font-bold text-[#00ffff] flex items-center gap-2">
                <Plus size={13} /> ADD CUSTOM ADDRESS ENTRY
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-mono text-zinc-500 block mb-1">CREDITOR / COLLECTOR NAME *</label>
                  <input value={newEntry.name} onChange={(e) => setNewEntry({ ...newEntry, name: e.target.value })}
                    placeholder="e.g. ABC Collections LLC"
                    className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm px-3 py-2 rounded focus:border-[#00ffff] outline-none" />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-zinc-500 block mb-1">TYPE</label>
                  <select
                    value={newEntry.type}
                    onChange={(e) => setNewEntry({ ...newEntry, type: e.target.value })}
                    title="Select entry type"
                    aria-label="Select entry type"
                    className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm px-3 py-2 rounded focus:border-[#00ffff] outline-none">
                    <option value="bank">Bank</option>
                    <option value="credit_card">Credit Card</option>
                    <option value="auto">Auto Lender</option>
                    <option value="student">Student Loan</option>
                    <option value="collection">Collection Agency</option>
                    <option value="mortgage">Mortgage Servicer</option>
                    <option value="utility">Utility</option>
                    <option value="telecom">Telecom</option>
                    <option value="saved">Other / Custom</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[10px] font-mono text-zinc-500 block mb-1">DISPUTE MAILING ADDRESS *</label>
                  <input value={newEntry.address} onChange={(e) => setNewEntry({ ...newEntry, address: e.target.value })}
                    placeholder="e.g. PO Box 12345 or 123 Main St"
                    className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm px-3 py-2 rounded focus:border-[#00ffff] outline-none" />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-zinc-500 block mb-1">CITY</label>
                  <input value={newEntry.city} onChange={(e) => setNewEntry({ ...newEntry, city: e.target.value })}
                    placeholder="e.g. Atlanta"
                    className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm px-3 py-2 rounded focus:border-[#00ffff] outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-mono text-zinc-500 block mb-1">STATE</label>
                    <input value={newEntry.state} onChange={(e) => setNewEntry({ ...newEntry, state: e.target.value.toUpperCase() })}
                      placeholder="GA" maxLength={2}
                      className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm px-3 py-2 rounded focus:border-[#00ffff] outline-none uppercase" />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-zinc-500 block mb-1">ZIP</label>
                    <input value={newEntry.zip} onChange={(e) => setNewEntry({ ...newEntry, zip: e.target.value })}
                      placeholder="30301"
                      className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm px-3 py-2 rounded focus:border-[#00ffff] outline-none" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-mono text-zinc-500 block mb-1">PHONE</label>
                  <input value={newEntry.phone} onChange={(e) => setNewEntry({ ...newEntry, phone: e.target.value })}
                    placeholder="e.g. 1-800-555-1234"
                    className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm px-3 py-2 rounded focus:border-[#00ffff] outline-none" />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-zinc-500 block mb-1">FAX (optional)</label>
                  <input value={newEntry.fax} onChange={(e) => setNewEntry({ ...newEntry, fax: e.target.value })}
                    placeholder="e.g. 1-800-555-5678"
                    className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm px-3 py-2 rounded focus:border-[#00ffff] outline-none" />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[10px] font-mono text-zinc-500 block mb-1">ONLINE DISPUTE PORTAL URL (optional)</label>
                  <input value={newEntry.website} onChange={(e) => setNewEntry({ ...newEntry, website: e.target.value })}
                    placeholder="e.g. https://www.example.com/disputes"
                    className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm px-3 py-2 rounded focus:border-[#00ffff] outline-none" />
                </div>
              </div>
              <button onClick={handleAddCustom} disabled={!newEntry.name.trim() || !newEntry.address.trim()}
                className="cyber-button border-[#00ffff] text-[#00ffff] hover:bg-[#00ffff]/10 px-5 py-2 font-bold text-sm flex items-center gap-2 disabled:opacity-40">
                <Save size={13} /> SAVE TO ADDRESS BOOK
              </button>
            </div>
          )}

          {/* Type filter tabs */}
          <div className="flex gap-1 flex-wrap">
            {TYPE_FILTER_TABS.map((tab) => (
              <button key={tab.key} onClick={() => setTypeFilter(tab.key)}
                className={`text-[10px] font-mono px-3 py-1.5 rounded border transition-all ${
                  typeFilter === tab.key
                    ? "border-[#00ffff] text-[#00ffff] bg-[#00ffff]/10"
                    : "border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
                }`}
              >
                {tab.label}
                {typeCounts[tab.key] !== undefined && (
                  <span className="ml-1 opacity-50">({typeCounts[tab.key]})</span>
                )}
              </button>
            ))}
          </div>

          {/* Saved contacts */}
          {(typeFilter === "all" || typeFilter === "saved") && (
            <div className="space-y-3">
              <div className="text-[10px] font-mono text-zinc-500 flex items-center gap-2">
                <Star size={11} className="text-[#00ff00]" /> SAVED TO ADDRESS BOOK
                {contacts.length === 0 && (
                  <span className="text-zinc-700">— run a lookup and click "Save to Address Book" to add entries.</span>
                )}
              </div>
              {filteredSaved.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {filteredSaved.map((c) => (
                    <SavedContactCard key={c.id} contact={c} onRemove={() => removeContact(c.id)} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Built-in database */}
          {typeFilter !== "saved" && (
            <div className="space-y-3">
              <div className="text-[10px] font-mono text-zinc-500 flex items-center gap-2">
                <Database size={11} className="text-[#00ffff]" /> BUILT-IN DATABASE
                <span className="text-zinc-700">
                  — {filteredFurnishers.length} {dbSearch ? `matching "${dbSearch}"` : "entries"}
                </span>
              </div>
              {filteredFurnishers.length === 0 ? (
                <div className="cyber-panel p-8 text-center border-zinc-800">
                  <Filter size={24} className="text-zinc-700 mx-auto mb-2" />
                  <div className="text-zinc-600 text-sm">No entries match your search.</div>
                  <div className="text-zinc-700 text-xs mt-1">
                    Switch to the LOOKUP tab to search with AI for unknown furnishers.
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {filteredFurnishers.map((f) => (
                    <FurnisherCard key={f.name} f={f} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
