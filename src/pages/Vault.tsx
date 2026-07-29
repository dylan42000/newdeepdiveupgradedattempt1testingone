import React, { useState, useCallback, useRef } from "react";
import { useDropzone } from "react-dropzone";
import {
  Shield, Upload, FileText, Trash2, Download, Eye, FolderPlus,
  Lock, HardDrive, AlertCircle, Search, Filter, File, Image, Archive,
} from "lucide-react";
import { useAppContext } from "../context/AppContext";
import { VaultDocument } from "../types";
import { v4 as uuidv4 } from "uuid";
import { ArchiveBrowser } from "../components/ArchiveBrowser";
import { evaluateEvidenceReadiness } from "../services/evidenceGateService";

const CATEGORIES = [
  "Dispute Letter", "Bureau Response", "Identity Proof", "Account Statement",
  "Collection Notice", "Credit Report", "Medical Bill", "Legal Document", "Other",
] as const;

function fileToCategory(filename: string, type: string): VaultDocument["category"] {
  const n = filename.toLowerCase();
  if (n.includes("dispute") || n.includes("letter")) return "Dispute Letter";
  if (n.includes("response")) return "Bureau Response";
  if (n.includes("id") || n.includes("passport") || n.includes("license")) return "Identity Proof";
  if (n.includes("statement") || n.includes("account")) return "Account Statement";
  if (n.includes("collection") || n.includes("collector")) return "Collection Notice";
  if (n.includes("report") || n.includes("credit")) return "Credit Report";
  if (n.includes("medical") || n.includes("hospital") || n.includes("bill")) return "Medical Bill";
  if (n.includes("legal") || n.includes("court") || n.includes("lawsuit")) return "Legal Document";
  if (type.startsWith("image/")) return "Identity Proof";
  return "Other";
}

const VAULT_MAX_FILE_BYTES = 62_914_560; // 60 MB
const VAULT_MAX_SIZE_BYTES = 1_073_741_824; // 1 GB

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function Vault() {
  const { vaultDocs, addVaultDoc, removeVaultDoc, vaultTotalSize } = useAppContext();
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState<string>("All");
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [previewDoc, setPreviewDoc] = useState<VaultDocument | null>(null);
  const [identityAcknowledged, setIdentityAcknowledged] = useState(false);
  const [uploadSummary, setUploadSummary] = useState<string | null>(null);
  const licenseInputRef = useRef<HTMLInputElement>(null);

  const evidenceStatus = evaluateEvidenceReadiness(
    vaultDocs.map((doc) => ({ id: doc.id, category: doc.category, tags: doc.tags, name: doc.name })),
    "general",
  );

  const onDrop = useCallback(async (accepted: File[]) => {
    setErrors([]);
    setUploadSummary(null);
    const includesIdentity = accepted.some((file) => fileToCategory(file.name, file.type) === "Identity Proof");
    if (includesIdentity && !identityAcknowledged) {
      setErrors(["Before uploading a driver's license or other ID, acknowledge that it will be stored in this device's encrypted local Vault."]);
      return;
    }
    setUploading(true);
    const errs: string[] = [];
    let uploaded = 0;
    let pendingSize = vaultTotalSize;

    try {
      for (const file of accepted) {
        if (file.size > VAULT_MAX_FILE_BYTES) {
          errs.push(`${file.name}: exceeds 60 MB limit (${formatBytes(file.size)})`);
          continue;
        }
        if (pendingSize + file.size > VAULT_MAX_SIZE_BYTES) {
          errs.push(`Vault full — cannot add ${file.name} (vault ${formatBytes(pendingSize)} / 1 GB)`);
          continue;
        }

        try {
          const arrayBuffer = await file.arrayBuffer();
          const category = fileToCategory(file.name, file.type);
          const tags = category === "Identity Proof"
            ? ["government-id", "photo-id", "identity-proof"]
            : category === "Credit Report"
              ? ["credit-report"]
              : [];
          await addVaultDoc({
            id: uuidv4(), name: file.name, type: file.type, size: file.size,
            category, uploadDate: new Date().toISOString(), data: arrayBuffer, tags,
          });
          pendingSize += file.size;
          uploaded += 1;
        } catch (error) {
          errs.push(`${file.name}: ${error instanceof Error ? error.message : "could not be saved"}`);
        }
      }

      if (errs.length) setErrors(errs);
      if (uploaded > 0) {
        setUploadSummary(`${uploaded} document${uploaded === 1 ? "" : "s"} securely saved to the local Vault.${includesIdentity ? " Your identity evidence is now recognized by the evidence-readiness check." : ""}`);
        if (includesIdentity) setIdentityAcknowledged(false);
      }
    } finally {
      // Never leave the picker disabled if reading, encryption, or IndexedDB fails.
      setUploading(false);
    }
  }, [vaultTotalSize, addVaultDoc, identityAcknowledged]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "image/jpeg": [".jpg", ".jpeg"],
      "image/png": [".png"],
      "image/webp": [".webp"],
      "image/gif": [".gif"],
      "text/plain": [".txt"],
      "application/msword": [".doc"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
      "text/csv": [".csv"],
    },
    maxSize: VAULT_MAX_FILE_BYTES,
    multiple: true,
    onDropRejected: (rejections) => {
      setUploadSummary(null);
      setErrors(rejections.map(({ file, errors: fileErrors }) => `${file.name}: ${fileErrors.map((error) => error.message).join(", ")}`));
    },
  });

  const handleLicenseSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    const invalid = files.filter((file) => !/\.(jpe?g)$/i.test(file.name) && file.type !== "image/jpeg");
    if (invalid.length) {
      setUploadSummary(null);
      setErrors(invalid.map((file) => `${file.name}: driver's license uploads must be JPG or JPEG images.`));
    } else if (files.length) {
      void onDrop(files);
    }
    // Allow selecting the same file again after correcting an issue.
    event.target.value = "";
  };

  const filtered = vaultDocs.filter((d) => {
    const matchSearch = d.name.toLowerCase().includes(search.toLowerCase());
    const matchCat = filterCat === "All" || d.category === filterCat;
    return matchSearch && matchCat;
  });

  const usagePct = Math.round((vaultTotalSize / VAULT_MAX_SIZE_BYTES) * 100);

  const handlePreview = (doc: VaultDocument) => {
    if (!doc.data) return;
    const blob = new Blob([doc.data], { type: doc.type });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  const handleDownload = (doc: VaultDocument) => {
    if (!doc.data) return;
    const blob = new Blob([doc.data], { type: doc.type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = doc.name; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <Shield className="text-[#00ffff]" /> EVIDENCE VAULT
          </h2>
          <p className="text-zinc-400 font-mono text-xs mt-1">
            {vaultDocs.length} FILE(S) — {formatBytes(vaultTotalSize)} / 1 GB
          </p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-600" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search files..."
              className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs pl-7 pr-3 py-2 rounded w-40 focus:border-[#00ffff] outline-none" />
          </div>
          <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)}
            className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs px-3 py-2 rounded focus:border-[#00ffff] outline-none cursor-pointer">
            <option value="All">All Categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* Storage meter */}
      <div className="cyber-panel p-4">
        <div className="flex items-center justify-between mb-2 text-xs">
          <span className="flex items-center gap-1 text-zinc-400 font-mono"><HardDrive size={12} /> VAULT STORAGE</span>
          <span className={`font-mono font-bold ${usagePct > 85 ? "text-red-400" : usagePct > 60 ? "text-[#ff9900]" : "text-[#00ff00]"}`}>
            {usagePct}% USED
          </span>
        </div>
        <div className="w-full bg-zinc-800 rounded-full h-3">
          <div className={`h-3 rounded-full transition-all ${usagePct > 85 ? "bg-red-500" : usagePct > 60 ? "bg-[#ff9900]" : "bg-[#00ff00]"}`}
            style={{ width: `${usagePct}%` }} />
        </div>
        <div className="flex justify-between text-[10px] font-mono text-zinc-600 mt-1">
          <span>{formatBytes(vaultTotalSize)}</span>
          <span>1 GB MAX</span>
        </div>
      </div>

      {/* Upload zone */}
      <div className={`cyber-panel p-4 border ${evidenceStatus.canProceed ? "border-[#00ff00]/30 bg-[#00ff00]/5" : "border-[#ff9900]/30 bg-[#ff9900]/5"}`}>
        <div className="flex items-start gap-3">
          <Shield size={18} className={evidenceStatus.canProceed ? "text-[#00ff00] mt-0.5" : "text-[#ff9900] mt-0.5"} />
          <div>
            <p className="text-xs font-bold text-zinc-200">EVIDENCE STATUS — {evidenceStatus.tier.replace("_", " ")}</p>
            <p className="text-[11px] text-zinc-400 mt-1">{evidenceStatus.rationale}</p>
            {!evidenceStatus.canProceed && <p className="text-[10px] text-[#ff9900] mt-2">Upload a driver's license, passport, or state ID here. It is saved to this device's encrypted local database and counted automatically.</p>}
          </div>
        </div>
      </div>

      <label className="flex items-start gap-2 text-xs text-zinc-400 cursor-pointer select-none">
        <input type="checkbox" checked={identityAcknowledged} onChange={(e) => setIdentityAcknowledged(e.target.checked)} className="mt-0.5 accent-cyan-400" />
        <span>I understand that any driver’s license or identity document I upload is sensitive evidence. Save it only in this device’s encrypted local Vault; it is not sent automatically.</span>
      </label>
      <div className="cyber-panel p-4 border border-cyan-900/50 bg-cyan-950/10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-cyan-200">DRIVER'S LICENSE UPLOAD</p>
            <p className="text-[11px] text-zinc-400 mt-1">Choose the front and back JPG/JPEG images together. They stay in this device's local Vault.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!identityAcknowledged) {
                setErrors(["Check the identity-document acknowledgment above before choosing your license images."]);
                return;
              }
              licenseInputRef.current?.click();
            }}
            className="shrink-0 inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-500/60 bg-cyan-500/10 px-3 py-2 text-xs font-bold text-cyan-200 hover:bg-cyan-500/20"
          >
            <Image size={15} /> Choose front & back JPGs
          </button>
          <input
            ref={licenseInputRef}
            type="file"
            accept="image/jpeg,.jpg,.jpeg"
            multiple
            className="hidden"
            onChange={handleLicenseSelection}
          />
        </div>
      </div>
      <div {...getRootProps()}
        className={`cyber-panel p-8 border-2 border-dashed cursor-pointer transition-all text-center ${isDragActive ? "border-[#00ffff] bg-[#00ffff]/5" : "border-zinc-700 hover:border-zinc-600"} ${uploading ? "opacity-50 pointer-events-none" : ""}`}>
        <input {...getInputProps()} />
        <Upload size={32} className={`mx-auto mb-3 ${isDragActive ? "text-[#00ffff]" : "text-zinc-600"}`} />
        <p className="text-sm font-bold text-zinc-300">
          {uploading ? "UPLOADING..." : isDragActive ? "DROP FILES HERE" : "DRAG & DROP OR CLICK TO UPLOAD"}
        </p>
        <p className="text-[10px] text-zinc-600 mt-1 font-mono">Max 60 MB per file | PDF, Images, DOC, TXT, CSV</p>
      </div>

      {/* Error alerts */}
      {errors.length > 0 && (
        <div className="cyber-panel p-4 border-red-500/50 bg-red-500/5">
          {errors.map((e, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-red-400 font-mono">
              <AlertCircle size={12} className="mt-0.5 shrink-0" />{e}
            </div>
          ))}
        </div>
      )}

      {uploadSummary && (
        <div className="cyber-panel p-3 border-[#00ff00]/40 bg-[#00ff00]/5 text-xs text-[#00ff00] font-mono">
          {uploadSummary}
        </div>
      )}

      {/* File grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-zinc-700">
          <Lock size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">{vaultDocs.length === 0 ? "Vault is empty — upload documents to secure them." : "No files match your filter."}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((doc) => (
            <div key={doc.id} className="cyber-panel p-4 flex flex-col gap-3 hover:border-zinc-700 transition-all">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-zinc-900 rounded border border-zinc-800">
                  {doc.type.startsWith("image/") ? <Image size={20} className="text-[#ff00ff]" /> : <FileText size={20} className="text-[#00ffff]" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-white truncate">{doc.name}</div>
                  <div className="text-[10px] text-zinc-500 font-mono mt-0.5">{formatBytes(doc.size)} • {new Date(doc.uploadDate).toLocaleDateString()}</div>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] border border-[#00ffff]/30 text-[#00ffff] px-2 py-0.5 rounded font-mono">{doc.category}</span>
                <div className="flex gap-1">
                  <button onClick={() => handlePreview(doc)} className="p-1.5 text-zinc-500 hover:text-[#00ffff] transition-colors" title="Preview">
                    <Eye size={14} />
                  </button>
                  <button onClick={() => handleDownload(doc)} className="p-1.5 text-zinc-500 hover:text-[#00ff00] transition-colors" title="Download">
                    <Download size={14} />
                  </button>
                  <button onClick={() => removeVaultDoc(doc.id)} className="p-1.5 text-zinc-500 hover:text-red-400 transition-colors" title="Delete">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* V4 Encrypted Archive */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Archive size={14} className="text-[#00ff00]" />
          <span className="text-xs font-mono font-bold text-zinc-400">V4 ENCRYPTED ARCHIVE</span>
          <span className="text-[9px] font-mono text-zinc-600 ml-1">AES-256-GCM • PARSED REPORTS</span>
        </div>
        <ArchiveBrowser archive={null} />
      </div>
    </div>
  );
}
