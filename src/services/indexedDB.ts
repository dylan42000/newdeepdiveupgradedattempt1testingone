/**
 * IndexedDB service — replaces localStorage for all persistent app data.
 * Supports 1GB+ storage, binary blobs, and structured queries.
 * Database: DYLANDOS_DB  version: 6
 * v4 changes: Added autopilot-state stores (holdQueue, fcraTimeline, autopilotState, cycleAudit)
 *             to eliminate localStorage dependency for AutoPilot (BUG-08 fix).
 * v5 changes: Canonical AutoPilot case stores (cases, caseFacts, caseSnapshots, casePlans,
 *             autopilotTasks, autopilotJobs, packetApprovals, responseMatches, learningAggregates,
 *             autopilotEvents, dispatchPackets) per FINAL-WORLD-CLASS overhaul §13.
 * v6 changes: Create disputeLettersV2 (declared in StoreNames / used by priorLetterReader but
 *             missing from the v5 upgrade path — uniqueness persistence was silently failing).
 */
import type { DisputeItem, GeneratedLetter, BureauResponse } from './disputeEngine';
import { LocalDataEncryption, type EncryptedLocalRecord } from './secureKeyService';

const DB_NAME = "DYLANDOS_DB";
const DB_VERSION = 6;

export interface VaultDocRecord {
  id: string;
  name: string;
  type: string;
  size: number;
  uploadDate: string;
  category: string;
  tags: string[];
  data: ArrayBuffer | string; // ArrayBuffer preferred for large files
  // legacy optional fields retained for backward compatibility
  date?: string;
  mimeType?: string;
}

export type StoreNames =
  | "appState"
  | "vaultDocs"
  | "historyEvents"
  | "autopilotLogs"
  | "scoreEntries"
  | "disputeItems"
  | "disputeLettersV2"
  | "generatedLetters"
  | "bureauResponses"
  | "disputeOutcomes"
  | "userProfiles"
  // v4 AutoPilot state stores (BUG-08 fix)
  | "autopilotState"
  | "holdQueue"
  | "fcraTimeline"
  | "cycleAudit"
  // v5 Canonical AutoPilot case model
  | "cases"
  | "caseFacts"
  | "caseSnapshots"
  | "casePlans"
  | "autopilotTasks"
  | "autopilotJobs"
  | "packetApprovals"
  | "responseMatches"
  | "learningAggregates"
  | "autopilotEvents"
  | "dispatchPackets";

let dbInstance: IDBDatabase | null = null;

type EncryptedStoredRecord = { id: string; encrypted: EncryptedLocalRecord; disputeItemId?: string };

async function encryptRecord<T extends { id: string }>(record: T, metadata: Pick<EncryptedStoredRecord, 'disputeItemId'> = {}): Promise<EncryptedStoredRecord> {
  return { id: record.id, ...metadata, encrypted: await LocalDataEncryption.encrypt(record) };
}

async function decryptRecord<T>(record: T | EncryptedStoredRecord | undefined): Promise<T | undefined> {
  if (!record) return undefined;
  if (typeof record === 'object' && record !== null && 'encrypted' in record) {
    return LocalDataEncryption.decrypt<T>((record as EncryptedStoredRecord).encrypted);
  }
  // Supports an explicit migration path for legacy records written before encryption.
  return record as T;
}

export function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Single key-value store for main app state (replaces localStorage)
      if (!db.objectStoreNames.contains("appState")) {
        db.createObjectStore("appState", { keyPath: "key" });
      }

      // Vault documents — stored as binary/base64
      if (!db.objectStoreNames.contains("vaultDocs")) {
        const store = db.createObjectStore("vaultDocs", { keyPath: "id" });
        store.createIndex("byType", "type", { unique: false });
        store.createIndex("byDate", "date", { unique: false });
      }

      // Immutable history event log — append-only
      if (!db.objectStoreNames.contains("historyEvents")) {
        const store = db.createObjectStore("historyEvents", { keyPath: "id" });
        store.createIndex("byTimestamp", "timestamp", { unique: false });
        store.createIndex("byType", "type", { unique: false });
        store.createIndex("byItemId", "itemId", { unique: false });
      }

      // Autopilot real-time log stream
      if (!db.objectStoreNames.contains("autopilotLogs")) {
        const store = db.createObjectStore("autopilotLogs", { keyPath: "id" });
        store.createIndex("byTimestamp", "timestamp", { unique: false });
      }

      // Credit score history
      if (!db.objectStoreNames.contains("scoreEntries")) {
        const store = db.createObjectStore("scoreEntries", { keyPath: "id" });
        store.createIndex("byDate", "date", { unique: false });
      }

      // ── Version 3: Dispute Engine Stores ──────────────────────────────────

      // Full dispute items (engine-level, links to NegativeItem via negativeItemId)
      if (!db.objectStoreNames.contains("disputeItems")) {
        const store = db.createObjectStore("disputeItems", { keyPath: "id" });
        store.createIndex("byNegativeItemId", "negativeItemId", { unique: false });
        store.createIndex("byUserId", "userId", { unique: false });
        store.createIndex("byPriority", "priorityScore", { unique: false });
      }

      // Generated letters (v2 — richer schema with DNA hash)
      if (!db.objectStoreNames.contains("generatedLetters")) {
        const store = db.createObjectStore("generatedLetters", { keyPath: "id" });
        store.createIndex("byDisputeItemId", "disputeItemId", { unique: false });
        store.createIndex("byBureau", "bureauName", { unique: false });
        store.createIndex("byRound", "round", { unique: false });
      }

      // Bureau responses
      if (!db.objectStoreNames.contains("bureauResponses")) {
        const store = db.createObjectStore("bureauResponses", { keyPath: "id" });
        store.createIndex("byDisputeItemId", "disputeItemId", { unique: false });
        store.createIndex("byBureau", "bureauName", { unique: false });
      }

      // Dispute outcome records (for AI learning)
      if (!db.objectStoreNames.contains("disputeOutcomes")) {
        const store = db.createObjectStore("disputeOutcomes", { keyPath: "id" });
        store.createIndex("byAccountType", "accountType", { unique: false });
        store.createIndex("byBureau", "bureau", { unique: false });
        store.createIndex("byOutcome", "outcome", { unique: false });
        store.createIndex("byStrategy", "strategy", { unique: false });
      }

      // User profiles (multi-profile support — you + fiancée)
      if (!db.objectStoreNames.contains("userProfiles")) {
        const store = db.createObjectStore("userProfiles", { keyPath: "id" });
        store.createIndex("byName", "name", { unique: false });
      }

      // ── Version 4: AutoPilot State Stores (BUG-08 fix: move from localStorage) ──────

      // Pass numbers per profile — keyed by "passes_{profileId}"
      if (!db.objectStoreNames.contains("autopilotState")) {
        db.createObjectStore("autopilotState", { keyPath: "key" });
      }

      // Hold queue entries — items waiting for pass-response window to expire
      if (!db.objectStoreNames.contains("holdQueue")) {
        const store = db.createObjectStore("holdQueue", { keyPath: "id" });
        store.createIndex("byProfile", "profileId", { unique: false });
        store.createIndex("byItem", "itemId", { unique: false });
        store.createIndex("byExpiry", "holdExpiryDate", { unique: false });
      }

      // FCRA deadline entries — 30-day (bureau) / 45-day (furnisher) tracked per letter
      if (!db.objectStoreNames.contains("fcraTimeline")) {
        const store = db.createObjectStore("fcraTimeline", { keyPath: "id" });
        store.createIndex("byProfile", "profileId", { unique: false });
        store.createIndex("byItem", "itemId", { unique: false });
        store.createIndex("byDeadline", "deadlineDate", { unique: false });
        store.createIndex("byStatus", "status", { unique: false });
      }

      // Cycle audit records — full snapshot of every AutoPilot cycle run
      if (!db.objectStoreNames.contains("cycleAudit")) {
        const store = db.createObjectStore("cycleAudit", { keyPath: "cycleId" });
        store.createIndex("byProfile", "profileId", { unique: false });
        store.createIndex("byRunAt", "runAt", { unique: false });
      }

      // ── Version 5: Canonical AutoPilot case model ───────────────────────────

      if (!db.objectStoreNames.contains("cases")) {
        const store = db.createObjectStore("cases", { keyPath: "id" });
        store.createIndex("byProfile", "profileId", { unique: false });
        store.createIndex("byState", "state", { unique: false });
        store.createIndex("byCanonicalKey", "canonicalAccountKey", { unique: false });
        store.createIndex("byNegativeItem", "negativeItemId", { unique: false });
        store.createIndex("byProfileState", ["profileId", "state"], { unique: false });
      }

      if (!db.objectStoreNames.contains("caseFacts")) {
        const store = db.createObjectStore("caseFacts", { keyPath: "id" });
        store.createIndex("byCase", "caseId", { unique: false });
        store.createIndex("byProfile", "profileId", { unique: false });
        store.createIndex("byField", "field", { unique: false });
      }

      if (!db.objectStoreNames.contains("caseSnapshots")) {
        const store = db.createObjectStore("caseSnapshots", { keyPath: "id" });
        store.createIndex("byCase", "caseId", { unique: false });
        store.createIndex("byProfile", "profileId", { unique: false });
      }

      if (!db.objectStoreNames.contains("casePlans")) {
        const store = db.createObjectStore("casePlans", { keyPath: "id" });
        store.createIndex("byCase", "caseId", { unique: false });
        store.createIndex("byProfile", "profileId", { unique: false });
      }

      if (!db.objectStoreNames.contains("autopilotTasks")) {
        const store = db.createObjectStore("autopilotTasks", { keyPath: "id" });
        store.createIndex("byProfile", "profileId", { unique: false });
        store.createIndex("byStatus", "status", { unique: false });
        store.createIndex("byType", "type", { unique: false });
        store.createIndex("byCase", "caseId", { unique: false });
      }

      if (!db.objectStoreNames.contains("autopilotJobs")) {
        const store = db.createObjectStore("autopilotJobs", { keyPath: "id" });
        store.createIndex("byProfile", "profileId", { unique: false });
        store.createIndex("byStatus", "status", { unique: false });
        store.createIndex("byScheduled", "scheduledAt", { unique: false });
      }

      if (!db.objectStoreNames.contains("packetApprovals")) {
        const store = db.createObjectStore("packetApprovals", { keyPath: "id" });
        store.createIndex("byPacket", "packetId", { unique: false });
        store.createIndex("byProfile", "profileId", { unique: false });
        store.createIndex("byCase", "caseId", { unique: false });
      }

      if (!db.objectStoreNames.contains("responseMatches")) {
        const store = db.createObjectStore("responseMatches", { keyPath: "id" });
        store.createIndex("byProfile", "profileId", { unique: false });
        store.createIndex("byCase", "caseId", { unique: false });
        store.createIndex("byOutcome", "outcome", { unique: false });
      }

      if (!db.objectStoreNames.contains("learningAggregates")) {
        const store = db.createObjectStore("learningAggregates", { keyPath: "id" });
        store.createIndex("byProfile", "profileId", { unique: false });
        store.createIndex("byKey", "key", { unique: false });
      }

      if (!db.objectStoreNames.contains("autopilotEvents")) {
        const store = db.createObjectStore("autopilotEvents", { keyPath: "id" });
        store.createIndex("byProfile", "profileId", { unique: false });
        store.createIndex("byCase", "caseId", { unique: false });
        store.createIndex("byOccurred", "occurredAt", { unique: false });
        store.createIndex("byType", "type", { unique: false });
      }

      if (!db.objectStoreNames.contains("dispatchPackets")) {
        const store = db.createObjectStore("dispatchPackets", { keyPath: "id" });
        store.createIndex("byProfile", "profileId", { unique: false });
        store.createIndex("byCase", "caseId", { unique: false });
        store.createIndex("byHash", "contentHash", { unique: false });
      }

      // ── Version 6: disputeLettersV2 (uniqueness / prior-letter store) ──────
      // Declared in StoreNames since earlier revisions but never created — fresh
      // installs and existing v5 DBs both need this store.
      if (!db.objectStoreNames.contains("disputeLettersV2")) {
        const store = db.createObjectStore("disputeLettersV2", { keyPath: "id" });
        store.createIndex("byItemId", "itemId", { unique: false });
        store.createIndex("byProfile", "profileId", { unique: false });
        store.createIndex("byCycle", "cycleId", { unique: false });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = (event.target as IDBOpenDBRequest).result;
      resolve(dbInstance);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

// ─── Generic helpers ───────────────────────────────────────────────────────────

export async function idbGet<T>(store: StoreNames, key: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function idbSet<T extends object>(store: StoreNames, value: T): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbDelete(store: StoreNames, key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbGetAll<T>(store: StoreNames): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

export async function idbAdd<T extends object>(store: StoreNames, value: T): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).add(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbBulkAdd<T extends object>(store: StoreNames, values: T[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const objStore = tx.objectStore(store);
    values.forEach((v) => objStore.add(v));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbClear(store: StoreNames): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── App state helpers (key-value) ────────────────────────────────────────────

export async function loadAppState<T>(key: string): Promise<T | null> {
  const record = await idbGet<{ key: string; value: T }>("appState", key);
  return record ? record.value : null;
}

export async function saveAppState<T>(key: string, value: T): Promise<void> {
  await idbSet("appState", { key, value });
}

// ─── Vault doc helpers ────────────────────────────────────────────────────────

export async function getAllVaultDocs(): Promise<VaultDocRecord[]> {
  const records = await idbGetAll<VaultDocRecord | EncryptedStoredRecord>("vaultDocs");
  return (await Promise.all(records.map(record => decryptRecord<VaultDocRecord>(record)))).filter((record): record is VaultDocRecord => Boolean(record));
}

export async function addVaultDocRecord(doc: VaultDocRecord): Promise<void> {
  return idbSet("vaultDocs", await encryptRecord(doc));
}

export async function removeVaultDocRecord(id: string): Promise<void> {
  return idbDelete("vaultDocs", id);
}

export async function getTotalVaultSize(): Promise<number> {
  const docs = await getAllVaultDocs();
  return docs.reduce((acc, d) => acc + d.size, 0);
}

// ─── History event helpers ─────────────────────────────────────────────────────

export async function appendHistoryEvent(event: {
  id: string;
  timestamp: string;
  type: string;
  title: string;
  detail: string;
  itemId?: string;
  letterId?: string;
  bureau?: string;
  round?: number;
  outcome?: string;
}): Promise<void> {
  return idbAdd("historyEvents", event);
}

export async function getAllHistoryEvents(): Promise<any[]> {
  const all = await idbGetAll<any>("historyEvents");
  return all.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

// ─── Autopilot log helpers ─────────────────────────────────────────────────────

export async function appendAutopilotLog(entry: {
  id: string;
  timestamp: string;
  message: string;
  level: string;
  itemId?: string;
  batchId?: string;
}): Promise<void> {
  return idbAdd("autopilotLogs", entry);
}

export async function getAutopilotLogs(limit = 100): Promise<any[]> {
  const all = await idbGetAll<any>("autopilotLogs");
  return all
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
}

// ─── Score entry helpers ───────────────────────────────────────────────────────

export async function addScoreEntry(entry: {
  id: string;
  date: string;
  score: number;
  bureau: string;
  notes?: string;
  // legacy fields retained for backward compatibility
  equifax?: number | null;
  experian?: number | null;
  transunion?: number | null;
}): Promise<void> {
  return idbSet("scoreEntries", entry);
}

export async function getAllScoreEntries(): Promise<any[]> {
  const all = await idbGetAll<any>("scoreEntries");
  return all.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

export async function deleteScoreEntry(id: string): Promise<void> {
  return idbDelete("scoreEntries", id);
}

export async function migrateFromLocalStorage(): Promise<void> {
  try {
    const OLD_KEY = "DYLANDOS_CREDIT_DATA";
    const old = localStorage.getItem(OLD_KEY);
    if (!old) return;

    const parsed = JSON.parse(old);
    const existingState = await loadAppState("main");
    if (existingState) return; // already migrated

    await saveAppState("main", parsed);

    // Migrate vault docs if stored as base64 strings
    if (parsed.vaultDocs && Array.isArray(parsed.vaultDocs)) {
      for (const doc of parsed.vaultDocs) {
        await addVaultDocRecord({
          ...doc,
          mimeType: doc.type || "application/octet-stream",
        });
      }
    }

    console.log("[IndexedDB] Migrated from localStorage successfully.");
  } catch (e) {
    console.warn("[IndexedDB] Migration from localStorage failed:", e);
  }
}

// ─── V3: Dispute Engine Helpers ────────────────────────────────────────────────

export async function saveDisputeItem(item: DisputeItem): Promise<void> {
  return idbSet("disputeItems", item as unknown as object);
}

export async function getDisputeItem(id: string): Promise<DisputeItem | undefined> {
  return idbGet<DisputeItem>("disputeItems", id);
}

export async function getAllDisputeItems(userId?: string): Promise<DisputeItem[]> {
  const all = await idbGetAll<DisputeItem>("disputeItems");
  if (userId) return all.filter((d) => d.userId === userId);
  return all;
}

export async function getDisputesByPriority(userId?: string): Promise<DisputeItem[]> {
  const all = await getAllDisputeItems(userId);
  return all.sort((a, b) => b.priorityScore - a.priorityScore);
}

export async function getDisputesNeedingAction(userId?: string): Promise<DisputeItem[]> {
  const all = await getAllDisputeItems(userId);
  const now = Date.now();
  return all.filter((item) => {
    const tracks = Object.values(item.bureauTracks);
    return tracks.some((t) => {
      if (!t) return false;
      const state = t.currentState;
      // Ready to generate or already past deadline
      if (state.includes('_READY') || state.includes('_DEADLINE_MISSED')) return true;
      // Awaiting — check if deadline passed
      if (state.includes('_AWAITING') && t.nextActionDate) {
        return new Date(t.nextActionDate).getTime() < now;
      }
      return false;
    });
  });
}

export async function deleteDisputeItem(id: string): Promise<void> {
  return idbDelete("disputeItems", id);
}

// ── Generated Letters ──────────────────────────────────────────────────────────

export async function saveGeneratedLetter(letter: GeneratedLetter): Promise<void> {
  return idbSet("generatedLetters", await encryptRecord(letter, { disputeItemId: letter.disputeItemId }));
}

export async function getLettersForDispute(disputeItemId: string): Promise<GeneratedLetter[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("generatedLetters", "readonly");
    const index = tx.objectStore("generatedLetters").index("byDisputeItemId");
    const req = index.getAll(disputeItemId);
    req.onsuccess = () => Promise.all((req.result as EncryptedStoredRecord[]).map(record => decryptRecord<GeneratedLetter>(record)))
      .then(records => resolve(records.filter((record): record is GeneratedLetter => Boolean(record))))
      .catch(reject);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllGeneratedLetters(): Promise<GeneratedLetter[]> {
  const records = await idbGetAll<GeneratedLetter | EncryptedStoredRecord>("generatedLetters");
  return (await Promise.all(records.map(record => decryptRecord<GeneratedLetter>(record)))).filter((record): record is GeneratedLetter => Boolean(record));
}

// ── Bureau Responses ───────────────────────────────────────────────────────────

export async function saveBureauResponse(response: BureauResponse & { disputeItemId: string }): Promise<void> {
  return idbSet("bureauResponses", response as unknown as object);
}

export async function getResponsesForDispute(disputeItemId: string): Promise<BureauResponse[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("bureauResponses", "readonly");
    const index = tx.objectStore("bureauResponses").index("byDisputeItemId");
    const req = index.getAll(disputeItemId);
    req.onsuccess = () => resolve(req.result as BureauResponse[]);
    req.onerror = () => reject(req.error);
  });
}

// ── Dispute Outcomes (AI Learning) ────────────────────────────────────────────

export interface DisputeOutcomeRecord {
  id: string;
  disputeItemId: string;
  accountType: string;
  bureau: string;
  strategy: string;
  roundNumber: number;
  outcome: 'success' | 'failure' | 'partial';
  daysToResolve: number;
  recordedAt: string;
}

export async function recordDisputeOutcome(record: DisputeOutcomeRecord): Promise<void> {
  return idbSet("disputeOutcomes", record);
}

export async function getSuccessfulStrategiesFor(
  accountType: string,
  bureau: string
): Promise<{ strategy: string; successRate: number; count: number }[]> {
  const all = await idbGetAll<DisputeOutcomeRecord>("disputeOutcomes");
  const relevant = all.filter((r) => r.accountType === accountType && r.bureau === bureau);

  const byStrategy = new Map<string, { success: number; total: number }>();
  relevant.forEach((r) => {
    const curr = byStrategy.get(r.strategy) || { success: 0, total: 0 };
    byStrategy.set(r.strategy, {
      success: curr.success + (r.outcome === 'success' ? 1 : 0),
      total: curr.total + 1,
    });
  });

  return Array.from(byStrategy.entries())
    .map(([strategy, { success, total }]) => ({
      strategy,
      successRate: total > 0 ? success / total : 0,
      count: total,
    }))
    .sort((a, b) => b.successRate - a.successRate);
}

// ── User Profiles ─────────────────────────────────────────────────────────────

export interface UserProfileRecord {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  ssn_last4: string;
  dob: string;
  isDefault: boolean;
  createdAt: string;
}

export async function saveUserProfile(profile: UserProfileRecord): Promise<void> {
  return idbSet("userProfiles", await encryptRecord(profile));
}

export async function getAllUserProfiles(): Promise<UserProfileRecord[]> {
  const records = await idbGetAll<UserProfileRecord | EncryptedStoredRecord>("userProfiles");
  return (await Promise.all(records.map(record => decryptRecord<UserProfileRecord>(record)))).filter((record): record is UserProfileRecord => Boolean(record));
}

export async function getUserProfile(id: string): Promise<UserProfileRecord | undefined> {
  return decryptRecord<UserProfileRecord>(await idbGet<UserProfileRecord | EncryptedStoredRecord>("userProfiles", id));
}

export async function getDefaultProfile(): Promise<UserProfileRecord | undefined> {
  const all = await getAllUserProfiles();
  return all.find((p) => p.isDefault) ?? all[0];
}

export async function deleteUserProfile(id: string): Promise<void> {
  return idbDelete("userProfiles", id);
}
