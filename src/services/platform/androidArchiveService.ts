// src/services/platform/androidArchiveService.ts
// Android archive service using SecureVault native plugin + AndroidSecurityService

import { registerPlugin } from '@capacitor/core';
import { AndroidSecurityService } from './androidSecurityService';

interface SecureVaultFileInterface {
  writeVaultFile(options: { path: string; content: string }): Promise<{ success: boolean; path: string; size: number }>;
  readVaultFile(options: { path: string }): Promise<{ content: string; size: number; lastModified: number }>;
  listVaultDirectory(options: { path: string }): Promise<{ files: Array<{ name: string; isDirectory: boolean; size: number; lastModified: number }> }>;
  deleteVaultFile(options: { path: string }): Promise<{ success: boolean; softDeleted: boolean }>;
  appendAuditLog(options: { profileId: string; entry: string }): Promise<{ success: boolean }>;
  getVaultBasePath(): Promise<{ path: string }>;
}

const SecureVaultNative = registerPlugin<SecureVaultFileInterface>('SecureVault');

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export type AuditEventType =
  | 'REPORT_STORED'
  | 'LETTER_ARCHIVED'
  | 'RESPONSE_STORED'
  | 'STATE_BACKUP'
  | 'DISPUTE_EVENT'
  | 'FILE_DELETED'
  | 'INTEGRITY_CHECK';

interface AuditEntry {
  id: string;
  timestamp: string;
  eventType: AuditEventType;
  data: Record<string, unknown>;
  previousHash: string;
  hash?: string;
}

export interface ResponseMetadata {
  dateReceived: Date;
  dateStored?: Date;
  sourceType: string;
  sourceName: string;
  relatedItemId: string;
  relatedCycleId: string;
  relatedPassNumber: number;
  outcome: string;
  aiAnalysis?: string;
}

export interface StoredResponse {
  responseId: string;
  hash: string;
  path: string;
}

export interface ArchiveSummary {
  cycleCount: number;
  responseCount: number;
  reportCount: number;
  cycles: string[];
}

interface DispatchLogEntry {
  letterId: string;
  itemId: string;
  passNumber: number;
  targetType: string;
  targetName: string;
  generatedAt: string;
  archivedAt: string;
  filePath: string;
  letterType: string;
  status: string;
}

interface DisputeLetter {
  id: string;
  itemId: string;
  passNumber: number;
  targetType: string;
  targetName: string;
  generatedAt: string;
  letterType: string;
  content: string;
}

export class AndroidArchiveService {
  private security: AndroidSecurityService;
  private lastAuditHash = '0';

  constructor() {
    this.security = AndroidSecurityService.getInstance();
  }

  // Store credit report (encrypted)
  async storeReport(
    profileId: string,
    reportBlob: ArrayBuffer,
    reportMeta: { source: string; uploadedAt: string }
  ): Promise<{ reportId: string; hash: string }> {
    const hash = await this.sha256(reportBlob);
    const encrypted = await this.security.encryptBlob(reportBlob);

    const reportId = generateId();
    const path = `profiles/${profileId}/reports/${reportId}.enc`;

    await SecureVaultNative.writeVaultFile({
      path,
      content: encrypted,
    });

    const metaJson = JSON.stringify({
      reportId,
      profileId,
      source: reportMeta.source,
      uploadedAt: reportMeta.uploadedAt,
      storedAt: new Date().toISOString(),
      sha256Hash: hash,
    });

    await SecureVaultNative.writeVaultFile({
      path: `profiles/${profileId}/reports/${reportId}.meta`,
      content: metaJson,
    });

    await this.auditLog('REPORT_STORED', { profileId, reportId, hash });
    return { reportId, hash };
  }

  // Archive dispute letters for a cycle
  async archiveLetter(
    profileId: string,
    cycleId: string,
    letter: DisputeLetter
  ): Promise<void> {
    const encrypted = await this.security.encryptBlob(
      new TextEncoder().encode(letter.content).buffer
    );

    const suffix = letter.targetType === 'bureau'
      ? letter.targetName.slice(0, 2).toLowerCase()
      : 'cr';
    const path = `profiles/${profileId}/disputes/${cycleId}/item_${letter.itemId}_p${letter.passNumber}_${suffix}.enc`;

    await SecureVaultNative.writeVaultFile({ path, content: encrypted });

    await this.appendToDispatchLog(profileId, cycleId, {
      letterId: letter.id,
      itemId: letter.itemId,
      passNumber: letter.passNumber,
      targetType: letter.targetType,
      targetName: letter.targetName,
      generatedAt: letter.generatedAt,
      archivedAt: new Date().toISOString(),
      filePath: path,
      letterType: letter.letterType,
      status: 'generated',
    });

    await this.auditLog('LETTER_ARCHIVED', {
      profileId, cycleId,
      letterId: letter.id,
      itemId: letter.itemId,
      passNumber: letter.passNumber,
    });
  }

  // Store bureau/creditor response
  async storeResponse(
    profileId: string,
    responseBlob: ArrayBuffer,
    metadata: ResponseMetadata
  ): Promise<StoredResponse> {
    const hash = await this.sha256(responseBlob);
    const encrypted = await this.security.encryptBlob(responseBlob);

    const responseId = generateId();
    const path = `profiles/${profileId}/responses/${responseId}.enc`;

    await SecureVaultNative.writeVaultFile({ path, content: encrypted });

    const metaJson = JSON.stringify({
      responseId,
      profileId,
      dateReceived: metadata.dateReceived.toISOString(),
      dateStored: new Date().toISOString(),
      sourceType: metadata.sourceType,
      sourceName: metadata.sourceName,
      relatedItemId: metadata.relatedItemId,
      relatedCycleId: metadata.relatedCycleId,
      relatedPassNumber: metadata.relatedPassNumber,
      outcome: metadata.outcome,
      sha256Hash: hash,
      aiAnalysis: metadata.aiAnalysis,
    });

    await SecureVaultNative.writeVaultFile({
      path: `profiles/${profileId}/responses/${responseId}.meta`,
      content: metaJson,
    });

    await this.auditLog('RESPONSE_STORED', {
      profileId, responseId, outcome: metadata.outcome, relatedItemId: metadata.relatedItemId,
    });

    return { responseId, hash, path };
  }

  // Backup profile state before cycle
  async backupProfileState(
    profileId: string,
    state: Record<string, unknown>
  ): Promise<string> {
    const stateBytes = new TextEncoder().encode(JSON.stringify(state));
    const encrypted = await this.security.encryptBlob(stateBytes.buffer);
    const backupPath = `profiles/${profileId}/backups/pre_cycle_${Date.now()}.enc`;

    await SecureVaultNative.writeVaultFile({ path: backupPath, content: encrypted });
    await this.auditLog('STATE_BACKUP', { profileId, backupPath });
    return backupPath;
  }

  // Tamper-evident audit log (hash-chained)
  async auditLog(
    eventType: AuditEventType,
    data: Record<string, unknown>
  ): Promise<void> {
    const entry: AuditEntry = {
      id: generateId(),
      timestamp: new Date().toISOString(),
      eventType,
      data,
      previousHash: this.lastAuditHash,
    };

    const entryStr = JSON.stringify(entry);
    const hash = await this.sha256(new TextEncoder().encode(entryStr).buffer);
    entry.hash = hash;
    this.lastAuditHash = hash;

    await SecureVaultNative.appendAuditLog({
      profileId: (data.profileId as string) || 'system',
      entry: JSON.stringify(entry),
    });
  }

  // List profile archive summary
  async listProfileArchive(profileId: string): Promise<ArchiveSummary> {
    const disputes = await SecureVaultNative.listVaultDirectory({
      path: `profiles/${profileId}/disputes`,
    });
    const responses = await SecureVaultNative.listVaultDirectory({
      path: `profiles/${profileId}/responses`,
    });
    const reports = await SecureVaultNative.listVaultDirectory({
      path: `profiles/${profileId}/reports`,
    });

    return {
      cycleCount: disputes.files.filter(e => e.isDirectory).length,
      responseCount: Math.floor(responses.files.filter(e => !e.isDirectory).length / 2),
      reportCount: reports.files.filter(e => e.name.endsWith('.meta')).length,
      cycles: disputes.files.filter(e => e.isDirectory).map(e => e.name),
    };
  }

  // Verify file integrity
  async verifyFileIntegrity(path: string, expectedHash: string): Promise<boolean> {
    const result = await SecureVaultNative.readVaultFile({ path });
    const data = new TextEncoder().encode(result.content).buffer;
    const actualHash = await this.sha256(data);
    return actualHash === expectedHash;
  }

  // SHA-256 hash
  private async sha256(data: ArrayBuffer): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Dispatch log for cycle letters
  private async appendToDispatchLog(
    profileId: string,
    cycleId: string,
    entry: DispatchLogEntry
  ): Promise<void> {
    const logPath = `profiles/${profileId}/disputes/${cycleId}/dispatch_log.json`;
    let existing: DispatchLogEntry[] = [];

    try {
      const result = await SecureVaultNative.readVaultFile({ path: logPath });
      existing = JSON.parse(result.content);
    } catch { /* file doesn't exist yet */ }

    existing.push(entry);

    await SecureVaultNative.writeVaultFile({
      path: logPath,
      content: JSON.stringify(existing, null, 2),
    });
  }
}
