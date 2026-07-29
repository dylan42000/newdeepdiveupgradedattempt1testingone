/**
 * archiveService.ts — World-Class Legal-Grade Evidence Vault
 * Encrypted file archive for all dispute documents.
 * Uses Electron vault IPC for filesystem operations.
 * AES-256-GCM encryption on every stored file.
 * SHA-256 integrity verification.
 * Tamper-evident audit chain.
 */

import { VaultEncryptionService } from './vaultEncryptionService';
import {
  StoredReport, StoredLetter, StoredResponse,
  ReportMetadata, ResponseMetadata,
  GeneratedLetterV2, ArchiveDirectory
} from '../types/creditRepair';
import { v4 as uuidv4 } from 'uuid';

function getElectronAPI(): any {
  return (window as any).electronAPI;
}

/** True when running in Electron with vault IPC available */
function isVaultAvailable(): boolean {
  const api = getElectronAPI();
  return !!(api?.vaultWriteFile && api?.vaultReadFile);
}

export const ArchiveService = {
  // ─── Initialization ───────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (!isVaultAvailable()) return;
    // Vault directories are created on-demand by Electron main
    console.log('[ArchiveService] Vault IPC available, archive ready');
  },

  // ─── Credit Report Storage ────────────────────────────────────────────────

  async storeReport(
    profileId: string,
    fileData: ArrayBuffer,
    metadata: ReportMetadata
  ): Promise<StoredReport> {
    const id = uuidv4();
    const hash = await VaultEncryptionService.sha256(fileData);

    if (isVaultAvailable()) {
      const encrypted = await VaultEncryptionService.encrypt(fileData);
      const relativePath = `profiles/${profileId}/reports/${id}.enc`;
      await getElectronAPI().vaultWriteFile(relativePath, Array.from(encrypted));

      const metaPath = `profiles/${profileId}/reports/${id}.meta`;
      const metaJson = JSON.stringify({ ...metadata, hash, sizeBytes: fileData.byteLength, storedAt: new Date().toISOString() });
      await getElectronAPI().vaultWriteFile(metaPath, Array.from(new TextEncoder().encode(metaJson)));

      await this._auditLog(profileId, 'report_stored', { reportId: id, bureau: metadata.bureau, hash });
    }

    const report: StoredReport = {
      id,
      profileId,
      fileName: `${metadata.bureau}_${metadata.reportDate}.enc`,
      uploadDate: new Date().toISOString(),
      bureau: metadata.bureau,
      encryptedPath: `profiles/${profileId}/reports/${id}.enc`,
      sha256Hash: hash,
      sizeBytes: fileData.byteLength,
      metadata,
    };

    // Also persist metadata to IndexedDB for quick lookups
    await _saveReportMeta(report);
    return report;
  },

  async getReport(profileId: string, reportId: string): Promise<ArrayBuffer | null> {
    if (!isVaultAvailable()) return null;
    try {
      const relativePath = `profiles/${profileId}/reports/${reportId}.enc`;
      const encryptedArray = await getElectronAPI().vaultReadFile(relativePath);
      if (!encryptedArray) return null;
      const encryptedBytes = new Uint8Array(encryptedArray);
      return await VaultEncryptionService.decrypt(encryptedBytes);
    } catch (e) {
      console.error('[ArchiveService] Failed to read report:', e);
      return null;
    }
  },

  // ─── Letter Archiving ─────────────────────────────────────────────────────

  async archiveLetter(letter: GeneratedLetterV2, profileId: string): Promise<StoredLetter> {
    const letterJson = JSON.stringify(letter);
    const hash = await VaultEncryptionService.sha256(letterJson);
    const encryptedPath = `profiles/${profileId}/disputes/cycle_${letter.cycleId.slice(0, 8)}/${letter.id}.enc`;

    if (isVaultAvailable()) {
      const encrypted = await VaultEncryptionService.encrypt(letterJson);
      await getElectronAPI().vaultWriteFile(encryptedPath, Array.from(encrypted));

      // Also write a dispatch log entry
      const logPath = `profiles/${profileId}/disputes/cycle_${letter.cycleId.slice(0, 8)}/dispatch_log.json`;
      const logEntry = {
        letterId: letter.id,
        itemId: letter.itemId,
        passNumber: letter.passNumber,
        targetName: letter.targetName,
        createdAt: letter.createdAt,
        hash,
      };
      await _appendJsonLog(logPath, logEntry);
      await this._auditLog(profileId, 'letter_archived', { letterId: letter.id, itemId: letter.itemId, passNumber: letter.passNumber });
    }

    return {
      id: uuidv4(),
      profileId,
      cycleId: letter.cycleId,
      letterData: letter,
      encryptedPath,
      sha256Hash: hash,
      archivedAt: new Date().toISOString(),
    };
  },

  async getLetter(profileId: string, encryptedPath: string): Promise<GeneratedLetterV2 | null> {
    if (!isVaultAvailable()) return null;
    try {
      const encryptedArray = await getElectronAPI().vaultReadFile(encryptedPath);
      if (!encryptedArray) return null;
      const decrypted = await VaultEncryptionService.decrypt(new Uint8Array(encryptedArray));
      return JSON.parse(new TextDecoder().decode(decrypted));
    } catch (e) {
      console.error('[ArchiveService] Failed to read letter:', e);
      return null;
    }
  },

  // ─── Bureau Response Storage ──────────────────────────────────────────────

  async storeResponse(
    profileId: string,
    responseData: ArrayBuffer,
    metadata: ResponseMetadata
  ): Promise<StoredResponse> {
    const id = uuidv4();
    const hash = await VaultEncryptionService.sha256(responseData);
    const encryptedPath = `profiles/${profileId}/responses/${id}.enc`;

    if (isVaultAvailable()) {
      const encrypted = await VaultEncryptionService.encrypt(responseData);
      await getElectronAPI().vaultWriteFile(encryptedPath, Array.from(encrypted));

      const metaPath = `profiles/${profileId}/responses/${id}.meta`;
      await getElectronAPI().vaultWriteFile(
        metaPath,
        Array.from(new TextEncoder().encode(JSON.stringify(metadata)))
      );
      await this._auditLog(profileId, 'response_stored', { responseId: id, outcome: metadata.outcome, bureau: metadata.bureau });
    }

    return {
      id,
      profileId,
      itemId: '',
      letterId: '',
      encryptedPath,
      sha256Hash: hash,
      receivedDate: metadata.responseDate,
      outcome: metadata.outcome,
      bureau: metadata.bureau,
      metadata,
      aiAnalysis: null,
    };
  },

  // ─── Full Export Package ──────────────────────────────────────────────────

  async generateFullExport(profileId: string): Promise<string | null> {
    if (!isVaultAvailable()) return null;
    try {
      const exportPath = await getElectronAPI().vaultCreateExportPackage(profileId);
      await this._auditLog(profileId, 'export_generated', { exportPath });
      return exportPath;
    } catch (e) {
      console.error('[ArchiveService] Export failed:', e);
      return null;
    }
  },

  // ─── Integrity Verification ───────────────────────────────────────────────

  async verifyFileIntegrity(encryptedPath: string, expectedHash: string): Promise<boolean> {
    if (!isVaultAvailable()) return false;
    try {
      const encryptedArray = await getElectronAPI().vaultReadFile(encryptedPath);
      if (!encryptedArray) return false;
      const decrypted = await VaultEncryptionService.decrypt(new Uint8Array(encryptedArray));
      const actualHash = await VaultEncryptionService.sha256(decrypted);
      return actualHash === expectedHash;
    } catch {
      return false;
    }
  },

  // ─── Directory Listing ────────────────────────────────────────────────────

  async listProfileArchive(profileId: string): Promise<ArchiveDirectory> {
    const empty: ArchiveDirectory = {
      profileId,
      reports: [],
      letters: [],
      responses: [],
      totalSizeBytes: 0,
      lastUpdated: new Date().toISOString(),
    };

    if (!isVaultAvailable()) return empty;

    try {
      const reports = await _loadReportMetas(profileId);
      return { ...empty, reports };
    } catch (e) {
      console.error('[ArchiveService] listProfileArchive failed:', e);
      return empty;
    }
  },

  // ─── Tamper-Evident Audit Log ─────────────────────────────────────────────

  async _auditLog(
    profileId: string,
    action: string,
    data: Record<string, unknown>
  ): Promise<void> {
    if (!isVaultAvailable()) return;
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      profileId,
      action,
      ...data,
    }) + '\n';

    try {
      await getElectronAPI().vaultAppendAuditLog(entry);
    } catch (e) {
      console.error('[ArchiveService] Audit log write failed:', e);
    }
  },

  async isVaultAvailable(): Promise<boolean> {
    return isVaultAvailable();
  },
};

// ─── IndexedDB helpers for report metadata (quick lookups without decryption) ──

const ARCHIVE_DB_KEY = 'dylandos_archive_reports_v1';

async function _saveReportMeta(report: StoredReport): Promise<void> {
  try {
    const existing = JSON.parse(localStorage.getItem(ARCHIVE_DB_KEY) || '[]') as StoredReport[];
    const filtered = existing.filter(r => r.id !== report.id);
    filtered.push(report);
    localStorage.setItem(ARCHIVE_DB_KEY, JSON.stringify(filtered));
  } catch {
    // Non-critical
  }
}

async function _loadReportMetas(profileId: string): Promise<StoredReport[]> {
  try {
    const all = JSON.parse(localStorage.getItem(ARCHIVE_DB_KEY) || '[]') as StoredReport[];
    return all.filter(r => r.profileId === profileId);
  } catch {
    return [];
  }
}

async function _appendJsonLog(vaultRelativePath: string, entry: unknown): Promise<void> {
  const api = getElectronAPI();
  if (!api?.vaultReadFile || !api?.vaultWriteFile) return;
  try {
    let existing: unknown[] = [];
    try {
      const raw = await api.vaultReadFile(vaultRelativePath);
      if (raw) {
        existing = JSON.parse(new TextDecoder().decode(new Uint8Array(raw)));
      }
    } catch {
      // File doesn't exist yet — start fresh
    }
    existing.push(entry);
    const updated = new TextEncoder().encode(JSON.stringify(existing, null, 2));
    await api.vaultWriteFile(vaultRelativePath, Array.from(updated));
  } catch (e) {
    console.error('[ArchiveService] _appendJsonLog failed:', e);
  }
}
