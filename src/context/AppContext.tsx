import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  ReactNode,
} from "react";
import {
  NegativeItem,
  DisputeLetter,
  CreditReport,
  HistoryEvent,
  AutopilotCampaign,
  AutopilotBatch,
  ScoreEntry,
  AutopilotLogEvent,
  DisputeItemStatus,
  DisputeRound,
  ItemNote,
  PersonalizationVars,
  CreditCard,
  HardInquiry,
  AuthorizedUserAccount,
  BoostProgram,
  MailDeliveryProvider,
} from "../types";
import {
  openDB,
  migrateFromLocalStorage,
  loadAppState,
  saveAppState,
  appendHistoryEvent,
  getAllHistoryEvents,
  getAutopilotLogs,
  appendAutopilotLog,
  getAllVaultDocs,
  addVaultDocRecord,
  removeVaultDocRecord,
  addScoreEntry,
  getAllScoreEntries,
  deleteScoreEntry,
  idbClear,
  VaultDocRecord,
} from "../services/indexedDB";
import { v4 as uuidv4 } from "uuid";
import { VaultEncryptionService } from "../services/vaultEncryptionService";
import { LocalDataEncryption } from "../services/secureKeyService";
import { syncKeysFromSecureStorage } from "../services/aiRouter";
import type { CreditProfile } from "../types/creditRepair";
import {
  detectOutcomesFromNewReport,
  applyDetectedOutcomesToSink,
} from "../services/deletionOutcomeEngine";
import { AutoPilotEngineV2, DEFAULT_SETTINGS_V3 } from "../services/autoPilotEngineV2";
import { buildTradelineMergePlan, stitchAccountNumbers } from "../services/tradelineMerger";

export interface PersonalInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  ssn: string;
  dob: string;
}

export interface Contact {
  id: string;
  name: string;
  type: string;
  address: string;
  phone: string;
  fax?: string;
  disputeEmail?: string;
}

export interface AutopilotSettings {
  enabled: boolean;
  strategy: string;
  autoDispute: boolean;
  batchFraction: number;
  bureauStagger: boolean;
  activeCampaignId: string | null;
  // Upgrade 2 — Dual Dispute
  dualDispute: boolean;
  // Upgrade 3 — Aggressive+
  aggressivePlus: boolean;
  // Upgrade 1 — Certified Mail
  certifiedMailDefault: boolean;
  // Upgrade 10 — Auto-advance rounds
  autoAdvanceRounds: boolean;
  // Upgrade 18 — SOL pause guard
  solPauseGuard: boolean;
  // Upgrade 4 — Smart letter mode
  smartLetterMode: boolean;
  // Upgrade 19 — Personalization
  personalizationVars: PersonalizationVars;
  // A21 — Smart Follow-Up: auto-generate follow-up if no response by day 25
  smartFollowUp: boolean;
  // A22 — Dispute Calendar: schedule send dates with FCRA deadlines
  showDisputeCalendar: boolean;
  // A24 — Goodwill Post-Win: auto draft goodwill after deletion win
  goodwillPostWin: boolean;
  // A25 — Fatigue Detection: detect repeated bureau verifications, suggest strategy change
  fatigueDetect: boolean;
  // A26 — SOL Calendar: track state statute of limitations, alert before expiry
  showSOLCalendar: boolean;
  // A29 — CFPB Auto-Escalate: auto CFPB complaint after Round 3 failure
  cfpbAutoEscalate: boolean;
  // Upgrade 3 — Print-to-mail API pipeline
  mailDeliveryProvider: MailDeliveryProvider;
  autoMailOnGeneration: boolean;
  // Upgrade 12 — Campaign intelligence digest
  weeklyDigestEnabled: boolean;
  digestCadence: "daily" | "weekly";
  // Android updater — Gist manifest feed
  androidUpdateManifestUrl: string;
  androidUpdateAutoCheck: boolean;
  androidUpdateChannel: "stable" | "beta";
  androidUpdateLastCheckedAt: string | null;
}

export interface SecuritySettings {
  appLock: boolean;
  biometricLogin: boolean;
}

export interface GamificationState {
  xp: number;
  level: number;
}

export type AppTheme = "cyber" | "stealth" | "inferno" | "venom" | "arctic";

export const APP_VERSION = "5.6.1";
export const VAULT_MAX_SIZE_BYTES = 1024 * 1024 * 1024;
export const VAULT_MAX_FILE_BYTES = 60 * 1024 * 1024;

const RESET_LOCAL_STORAGE_KEYS = [
  "dylandos_archive_reports_v1",
  "dylandos_autopilot_v2_state",
  "dylandos_hold_queue_v1",
  "dylandos_fcra_timeline_v1",
  "dylandos_dispute_history_v2",
  "DYLANDOS_LAST_LOGIN",
  "DYLANDOS_STREAK",
];

const RESET_LOCAL_STORAGE_PREFIXES = [
  "dylandos_item_passes_v2_",
  "dylandos_cycle_backup_",
];

function clearRuntimeStorage(includeProfiles: boolean): void {
  try {
    for (const key of RESET_LOCAL_STORAGE_KEYS) {
      localStorage.removeItem(key);
    }

    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (!key) continue;

      if (RESET_LOCAL_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        localStorage.removeItem(key);
      }
    }

    if (includeProfiles) {
      localStorage.removeItem("dylandos_autopilot_v2_settings");
      localStorage.removeItem("dylandos_profiles_v4");
      localStorage.removeItem("dylandos_active_profile_v4");
    }
  } catch {
    // localStorage reset should not block UI reset flow
  }
}

function normalizeContactLookup(value?: string | null): string {
  return (value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeContactPhone(value?: string | null): string {
  return (value || "").replace(/\D/g, "");
}

function isDuplicateContact(existing: Contact, candidate: Contact): boolean {
  const existingName = normalizeContactLookup(existing.name);
  const candidateName = normalizeContactLookup(candidate.name);
  const existingAddress = normalizeContactLookup(existing.address);
  const candidateAddress = normalizeContactLookup(candidate.address);
  const existingPhone = normalizeContactPhone(existing.phone);
  const candidatePhone = normalizeContactPhone(candidate.phone);

  const sameName = existingName && candidateName && (existingName === candidateName || existingName.includes(candidateName) || candidateName.includes(existingName));
  const sameAddress = existingAddress && candidateAddress && (existingAddress === candidateAddress || existingAddress.includes(candidateAddress) || candidateAddress.includes(existingAddress));
  const samePhone = existingPhone.length >= 7 && candidatePhone.length >= 7 && existingPhone === candidatePhone;

  return Boolean(sameName && (sameAddress || samePhone));
}

interface AppState {
  reports: CreditReport[];
  negativeItems: NegativeItem[];
  disputeLetters: DisputeLetter[];
  personalInfo: PersonalInfo;
  isPersonalInfoComplete: boolean;
  vaultDocs: VaultDocRecord[];
  vaultTotalSize: number;
  contacts: Contact[];
  autopilot: AutopilotSettings;
  security: SecuritySettings;
  gamification: GamificationState;
  theme: AppTheme;
  appVersion: string;
  campaigns: AutopilotCampaign[];
  historyEvents: HistoryEvent[];
  autopilotLogs: AutopilotLogEvent[];
  scoreEntries: ScoreEntry[];
  creditCards: CreditCard[];
  hardInquiries: HardInquiry[];
  auAccounts: AuthorizedUserAccount[];
  boostPrograms: BoostProgram[];
  isDbReady: boolean;
  addReport: (report: CreditReport) => void;
  addNegativeItems: (items: NegativeItem[]) => void;
  removeNegativeItem: (id: string) => void;
  removeNegativeItems: (ids: string[]) => void;
  updateNegativeItem: (id: string, updates: Partial<NegativeItem>) => void;
  addItemNote: (itemId: string, note: Omit<ItemNote, "id">) => void;
  updateDisputeItemStatus: (itemId: string, status: DisputeItemStatus, round: DisputeRound, outcome?: string) => void;
  addDisputeLetter: (letter: DisputeLetter) => void;
  removeDisputeLetter: (id: string) => void;
  updateDisputeLetterStatus: (id: string, status: DisputeLetter["status"]) => void;
  updateDisputeLetter: (id: string, updates: Partial<DisputeLetter>) => void;
  updatePersonalInfo: (info: Partial<PersonalInfo>) => void;
  addVaultDoc: (doc: VaultDocRecord) => Promise<void>;
  removeVaultDoc: (id: string) => Promise<void>;
  refreshVaultDocs: () => Promise<void>;
  addContact: (contact: Contact) => void;
  removeContact: (id: string) => void;
  updateContact: (id: string, updates: Partial<Contact>) => void;
  updateAutopilot: (settings: Partial<AutopilotSettings>) => void;
  addCampaign: (campaign: AutopilotCampaign) => void;
  updateCampaign: (id: string, updates: Partial<AutopilotCampaign>) => void;
  addBatchToCampaign: (campaignId: string, batch: AutopilotBatch) => void;
  updateBatch: (campaignId: string, batchId: string, updates: Partial<AutopilotBatch>) => void;
  logEvent: (event: Omit<HistoryEvent, "id" | "timestamp">) => void;
  clearHistoryEvents: () => void;
  addAutopilotLog: (entry: Omit<AutopilotLogEvent, "id" | "timestamp">) => void;
  refreshHistoryEvents: () => Promise<void>;
  refreshAutopilotLogs: () => Promise<void>;
  addScoreEntry: (entry: Omit<ScoreEntry, "id">) => Promise<void>;
  removeScoreEntry: (id: string) => Promise<void>;
  refreshScoreEntries: () => Promise<void>;
  updateSecurity: (settings: Partial<SecuritySettings>) => void;
  addXP: (amount: number) => void;
  setTheme: (theme: AppTheme) => void;
  exportAllData: () => Promise<string>;
  importAllData: (jsonStr: string) => Promise<void>;
  clearData: () => Promise<void>;
  clearNegativeItems: () => void | Promise<void>;
  // Credit Builder
  addCreditCard: (card: CreditCard) => void;
  updateCreditCard: (id: string, updates: Partial<CreditCard>) => void;
  removeCreditCard: (id: string) => void;
  addHardInquiry: (inq: HardInquiry) => void;
  removeHardInquiry: (id: string) => void;
  addAUAccount: (account: AuthorizedUserAccount) => void;
  updateAUAccount: (id: string, updates: Partial<AuthorizedUserAccount>) => void;
  removeAUAccount: (id: string) => void;
  updateBoostProgram: (id: string, updates: Partial<BoostProgram>) => void;
  smartMergeAccounts: () => { mergedAccounts: number; linkedAccounts: number; reviewCandidates: number };
  // ─── V4: Multi-Profile ────────────────────────────────────────────────────
  profiles: CreditProfile[];
  activeProfileId: string | null;
  vaultEncryptionReady: boolean;
  switchProfile: (profileId: string) => void;
  addProfile: (profile: Omit<CreditProfile, 'id' | 'createdAt' | 'updatedAt'>) => CreditProfile;
  updateProfile: (id: string, updates: Partial<CreditProfile>) => void;
  removeProfile: (id: string) => void;
  // ─── Parser Debug Log ─────────────────────────────────────────────────────
  lastParseDebugLog: string[];
  setLastParseDebugLog: (log: string[]) => void;
}

const AppContext = createContext<AppState | undefined>(undefined);

const defaultPersonalInfo: PersonalInfo = {
  firstName: "Dylan",
  lastName: "Doe",
  email: "dylan@example.com",
  phone: "(555) 123-4567",
  address: "123 Cyber St",
  city: "Neon City",
  state: "CA",
  zip: "90210",
  ssn: "***-**-1234",
  dob: "01/01/1990",
};

const defaultAutopilot: AutopilotSettings = {
  enabled: false,
  strategy: "item_verify",
  autoDispute: false,
  batchFraction: 0.33,
  bureauStagger: true,
  activeCampaignId: null,
  dualDispute: false,
  aggressivePlus: false,
  certifiedMailDefault: false,
  autoAdvanceRounds: false,
  solPauseGuard: true,
  smartLetterMode: false,
  personalizationVars: {
    hardshipReason: "",
    preferredName: "",
    specialInstructions: "",
  },
  smartFollowUp: true,
  showDisputeCalendar: true,
  goodwillPostWin: true,
  fatigueDetect: true,
  showSOLCalendar: true,
  cfpbAutoEscalate: false,
  mailDeliveryProvider: "manual",
  autoMailOnGeneration: false,
  weeklyDigestEnabled: true,
  digestCadence: "weekly",
  androidUpdateManifestUrl: "",
  androidUpdateAutoCheck: true,
  androidUpdateChannel: "stable",
  androidUpdateLastCheckedAt: null,
};

const defaultSecurity: SecuritySettings = { appLock: false, biometricLogin: false };
const defaultGamification: GamificationState = { xp: 0, level: 1 };

function runMigrations(saved: any): any {
  if (!saved) return null;
  const savedVersion = saved.appVersion || "1.0.0";
  if (savedVersion === APP_VERSION) return saved;
  if (saved.negativeItems && Array.isArray(saved.negativeItems)) {
    saved.negativeItems = saved.negativeItems.map((item: any) => ({
      dataSource: item.dataSource || "parser",
      accuracyConfirmedByUser: Boolean(item.accuracyConfirmedByUser),
      accuracyConfirmedAt: item.accuracyConfirmedAt || null,
      accuracyConfirmationNote: item.accuracyConfirmationNote || null,
      ...item,
    }));
  }
  if (savedVersion.startsWith("1.") && saved.negativeItems && Array.isArray(saved.negativeItems)) {
    saved.negativeItems = saved.negativeItems.map((item: any) => ({
      disputeRound: 1, disputeStatus: "Undisputed", lastDisputeDate: null,
      disputeDeadline: null, priorityScore: 50, estimatedScoreImpact: null,
      notes: [], solDropDate: null,
      dataSource: item.dataSource || "parser",
      accuracyConfirmedByUser: Boolean(item.accuracyConfirmedByUser),
      accuracyConfirmedAt: item.accuracyConfirmedAt || null,
      accuracyConfirmationNote: item.accuracyConfirmationNote || null,
      ...item,
    }));
    if (saved.disputeLetters && Array.isArray(saved.disputeLetters)) {
      saved.disputeLetters = saved.disputeLetters.map((l: any) => ({
        bureau: "All Bureaus", round: 1, batchId: null,
        templateType: "611-Reinvestigation", ...l,
      }));
    }
  }
  saved.appVersion = APP_VERSION;
  return saved;
}

export function calcPriorityScore(item: Partial<NegativeItem>): number {
  let score = 0;
  const type = (item.typeOfNegative || "").toLowerCase();
  if (type.includes("bankruptcy")) score += 45;
  else if (type.includes("foreclosure")) score += 43;
  else if (type.includes("repossession")) score += 40;
  else if (type.includes("collection")) score += 40;
  else if (type.includes("charge-off") || type.includes("chargeoff")) score += 38;
  else if (type.includes("90")) score += 30;
  else if (type.includes("60")) score += 22;
  else if (type.includes("30") || type.includes("late")) score += 15;
  else if (type.includes("inquiry")) score += 5;
  else score += 20;
  if (item.dateOfLastReporting) {
    const months = (Date.now() - new Date(item.dateOfLastReporting).getTime()) / (1000 * 60 * 60 * 24 * 30);
    if (months < 12) score += 10;
    else if (months < 36) score += 5;
  }
  if (item.balance && item.balance > 5000) score += 10;
  else if (item.balance && item.balance > 1000) score += 5;
  return Math.min(score, 100);
}

export function calcSOLDropDate(item: Partial<NegativeItem>): string | null {
  const anchor = item.originalDateOfDelinquency || item.originalOpeningDate;
  if (!anchor) return null;
  try {
    const d = new Date(anchor);
    if (isNaN(d.getTime())) return null;
    d.setFullYear(d.getFullYear() + 7);
    return d.toISOString().split("T")[0];
  } catch { return null; }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [isDbReady, setIsDbReady] = useState(false);
  const [reports, setReports] = useState<CreditReport[]>([]);
  const [negativeItems, setNegativeItems] = useState<NegativeItem[]>([]);
  const [disputeLetters, setDisputeLetters] = useState<DisputeLetter[]>([]);
  const [personalInfo, setPersonalInfo] = useState<PersonalInfo>(defaultPersonalInfo);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [autopilot, setAutopilot] = useState<AutopilotSettings>(defaultAutopilot);
  const [security, setSecurity] = useState<SecuritySettings>(defaultSecurity);
  const [gamification, setGamification] = useState<GamificationState>(defaultGamification);
  const [themeState, setThemeState] = useState<AppTheme>("cyber");
  const [campaigns, setCampaigns] = useState<AutopilotCampaign[]>([]);
  const [vaultDocs, setVaultDocs] = useState<VaultDocRecord[]>([]);
  const [vaultTotalSize, setVaultTotalSize] = useState(0);
  const [historyEvents, setHistoryEvents] = useState<HistoryEvent[]>([]);
  const [autopilotLogs, setAutopilotLogs] = useState<AutopilotLogEvent[]>([]);
  const [scoreEntries, setScoreEntries] = useState<ScoreEntry[]>([]);
  const [creditCards, setCreditCards] = useState<CreditCard[]>([]);
  const [hardInquiries, setHardInquiries] = useState<HardInquiry[]>([]);
  const [auAccounts, setAUAccounts] = useState<AuthorizedUserAccount[]>([]);
  const DEFAULT_BOOST_PROGRAMS: BoostProgram[] = [
    { id: "experian-boost", name: "Experian Boost", bureau: "Experian", enrolled: false, estimatedPoints: 0, notes: "Link utility/streaming bills" },
    { id: "ultrafisco", name: "UltraFICO", bureau: "Experian", enrolled: false, estimatedPoints: 0, notes: "Link checking/savings accounts" },
    { id: "equifax-worknum", name: "Equifax Work Number", bureau: "Equifax", enrolled: false, estimatedPoints: 0, notes: "Add income/employment data" },
  ];
  const [boostPrograms, setBoostPrograms] = useState<BoostProgram[]>(DEFAULT_BOOST_PROGRAMS);
  // ─── Parser Debug Log (for Ctrl+Shift+D overlay) ─────────────────────────
  const [lastParseDebugLog, setLastParseDebugLog] = useState<string[]>([]);

  const isPersonalInfoComplete = useMemo((): boolean => {
    return Boolean(
      personalInfo?.firstName?.trim() &&
      personalInfo?.lastName?.trim() &&
      personalInfo?.address?.trim() &&
      personalInfo?.city?.trim() &&
      personalInfo?.state?.trim() &&
      personalInfo?.zip?.trim()
    );
  }, [personalInfo]);

  // ─── V4 Multi-Profile & Vault ──────────────────────────────────────────────
  const [profiles, setProfiles] = useState<CreditProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [vaultEncryptionReady, setVaultEncryptionReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        await openDB();
        await migrateFromLocalStorage();
        // IndexedDB records are encrypted with LocalDataEncryption. On Windows,
        // use the per-install DPAPI-protected vault key so this is available in
        // both the installed and portable Electron builds before reading/saving.
        try {
          if (window.electronAPI?.vaultGetMasterKey) {
            const keyResult = await window.electronAPI.vaultGetMasterKey();
            if (keyResult.success && keyResult.keyHex) {
              LocalDataEncryption.unlock(keyResult.keyHex);
              await VaultEncryptionService.initWithMasterKey(keyResult.keyHex);
              setVaultEncryptionReady(true);
            }
          }
        } catch (vaultError) {
          console.warn("[AppContext] Vault encryption init failed:", vaultError);
        }
        const saved = runMigrations(await loadAppState<any>("main"));
        if (saved) {
          if (saved.reports) setReports(saved.reports);
          if (saved.negativeItems) setNegativeItems(saved.negativeItems);
          if (saved.disputeLetters) setDisputeLetters(saved.disputeLetters);
          if (saved.personalInfo) setPersonalInfo(saved.personalInfo);
          if (saved.contacts) setContacts(saved.contacts);
          if (saved.autopilot) setAutopilot({ ...defaultAutopilot, ...saved.autopilot });
          if (saved.security) setSecurity(saved.security);
          if (saved.gamification) setGamification(saved.gamification);
          if (saved.theme) setThemeState(saved.theme);
          if (saved.campaigns) setCampaigns(saved.campaigns);
          if (saved.creditCards) setCreditCards(saved.creditCards);
          if (saved.hardInquiries) setHardInquiries(saved.hardInquiries);
          if (saved.auAccounts) setAUAccounts(saved.auAccounts);
          if (saved.boostPrograms) setBoostPrograms((prev) => saved.boostPrograms.map((b: BoostProgram) => ({ ...(prev.find((p) => p.id === b.id) || {}), ...b })));
        }
        const [docs, history, logs, scores] = await Promise.all([
          getAllVaultDocs(), getAllHistoryEvents(), getAutopilotLogs(200), getAllScoreEntries(),
        ]);
        setVaultDocs(docs);
        setVaultTotalSize(docs.reduce((a: number, d: any) => a + d.size, 0));
        setHistoryEvents(history as HistoryEvent[]);
        setAutopilotLogs(logs as AutopilotLogEvent[]);
        setScoreEntries(scores as ScoreEntry[]);
        setIsDbReady(true);

        // Sync API keys from SecureKeyService → localStorage cache
        syncKeysFromSecureStorage().catch(() => { /* non-critical */ });
        // Load V4 profiles from localStorage
        try {
          const storedProfiles = localStorage.getItem("dylandos_profiles_v4");
          if (storedProfiles) {
            const parsed: CreditProfile[] = JSON.parse(storedProfiles);
            setProfiles(parsed);
            const activeStored = localStorage.getItem("dylandos_active_profile_v4");
            if (activeStored && parsed.find(p => p.id === activeStored)) {
              setActiveProfileId(activeStored);
            } else if (parsed.length > 0) {
              setActiveProfileId(parsed[0].id);
            }
          }
        } catch { /* ignore */ }
      } catch (error) {
        console.error("Failed to initialize IndexedDB:", error);
        setIsDbReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (isDbReady && !isPersonalInfoComplete) {
      console.warn(
        "[AppContext] personalInfo is incomplete. AutoPilot sender blocks will be incomplete until name/address fields are set in Profile."
      );
    }
  }, [isDbReady, isPersonalInfoComplete]);

  useEffect(() => {
    if (!isDbReady) return;
    // Redact full SSN from IndexedDB — last-4 only (full SSN lives in secure store)
    const safePersonalInfo = personalInfo
      ? {
          ...personalInfo,
          ssn: personalInfo.ssn
            ? `***-**-${String(personalInfo.ssn).replace(/\D/g, "").slice(-4)}`
            : personalInfo.ssn,
        }
      : personalInfo;
    saveAppState("main", {
      reports, negativeItems, disputeLetters, personalInfo: safePersonalInfo, contacts,
      autopilot, security, gamification, theme: themeState, campaigns, appVersion: APP_VERSION,
      creditCards, hardInquiries, auAccounts, boostPrograms,
    }).catch(console.error);
  }, [isDbReady, reports, negativeItems, disputeLetters, personalInfo, contacts, autopilot, security, gamification, themeState, campaigns, creditCards, hardInquiries, auAccounts, boostPrograms]);

  const logEvent = useCallback((event: Omit<HistoryEvent, "id" | "timestamp">) => {
    const fullEvent: HistoryEvent = { id: uuidv4(), timestamp: new Date().toISOString(), ...event };
    appendHistoryEvent(fullEvent).catch(console.error);
    setHistoryEvents((prev) => [fullEvent, ...prev].slice(0, 5000));
  }, []);

  const addReport = useCallback((report: CreditReport) => setReports((prev) => [...prev, report]), []);

  const addNegativeItems = useCallback((items: NegativeItem[]) => {
    const enriched = items.map((item) => ({
      disputeRound: 1 as DisputeRound, disputeStatus: "Undisputed" as DisputeItemStatus,
      lastDisputeDate: null, disputeDeadline: null, notes: [], estimatedScoreImpact: null,
      solDropDate: calcSOLDropDate(item),
      priorityScore: calcPriorityScore(item),
      dataSource: item.dataSource || (item.parseConfidence != null ? "parser" : "manual"),
      accuracyConfirmedByUser: item.accuracyConfirmedByUser ?? false,
      accuracyConfirmedAt: item.accuracyConfirmedAt ?? null,
      accuracyConfirmationNote: item.accuracyConfirmationNote ?? null,
      ...item,
    }));
    setNegativeItems((prev) => {
      // Upload → outcome learning: compare new report items against active disputes
      const activeDisputed = prev.filter(
        (i) =>
          i.disputeStatus !== 'Undisputed' &&
          i.disputeStatus !== 'Deleted' &&
          i.disputeStatus !== 'Won',
      );
      if (activeDisputed.length > 0) {
        void detectOutcomesFromNewReport(enriched, activeDisputed, disputeLetters).then(async (detected) => {
          if (!detected.length) return;
          await applyDetectedOutcomesToSink(detected, async (payload) => {
            await AutoPilotEngineV2.handleResponse({
              profileId: activeProfileId || 'default',
              itemId: payload.itemId,
              bureau: payload.bureau,
              outcome: payload.outcome,
              passNumber: 1,
              letterId: '',
              settings: DEFAULT_SETTINGS_V3,
            });
            if (payload.outcome === 'deleted') {
              setNegativeItems((cur) =>
                cur.map((i) =>
                  i.id === payload.itemId
                    ? { ...i, disputeStatus: 'Deleted' as DisputeItemStatus }
                    : i,
                ),
              );
            }
          });
        }).catch((e) => console.warn('[AppContext] Outcome detection failed', e));
      }
      return [...prev, ...enriched];
    });
  }, [disputeLetters, activeProfileId]);

  const removeNegativeItem = useCallback((id: string) => setNegativeItems((prev) => prev.filter((i) => i.id !== id)), []);
  const removeNegativeItems = useCallback((ids: string[]) => setNegativeItems((prev) => prev.filter((i) => !ids.includes(i.id))), []);
  const updateNegativeItem = useCallback((id: string, updates: Partial<NegativeItem>) =>
    setNegativeItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...updates } : i))), []);

  const addItemNote = useCallback((itemId: string, note: Omit<ItemNote, "id">) => {
    setNegativeItems((prev) => prev.map((i) =>
      i.id === itemId ? { ...i, notes: [...(i.notes || []), { ...note, id: uuidv4() }] } : i
    ));
  }, []);

  const updateDisputeItemStatus = useCallback((itemId: string, status: DisputeItemStatus, round: DisputeRound, outcome?: string) => {
    setNegativeItems((prev) => prev.map((i) => {
      if (i.id !== itemId) return i;
      const deadline = new Date(); deadline.setDate(deadline.getDate() + 30);
      return { ...i, disputeStatus: status, disputeRound: round, lastDisputeDate: new Date().toISOString(), disputeDeadline: deadline.toISOString() };
    }));
  }, []);

  const addDisputeLetter = useCallback((letter: DisputeLetter) => {
    setDisputeLetters((prev) => [...prev, letter]);
    logEvent({ type: "letter_generated", title: "Dispute Letter Generated", detail: `${letter.bureau || "All Bureaus"} — Round ${letter.round || 1}`, letterId: letter.id, bureau: letter.bureau, round: letter.round });
  }, [logEvent]);

  const removeDisputeLetter = useCallback((id: string) => {
    setDisputeLetters((prev) => prev.filter((l) => l.id !== id));
  }, []);

  const updateDisputeLetterStatus = useCallback((id: string, status: DisputeLetter["status"]) => {
    setDisputeLetters((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)));
    if (status === "Sent") logEvent({ type: "letter_sent", title: "Dispute Letter Marked Sent", detail: `Letter ID: ${id.slice(0, 8)}`, letterId: id });
  }, [logEvent]);

  const updateDisputeLetter = useCallback((id: string, updates: Partial<DisputeLetter>) => {
    setDisputeLetters((prev) => prev.map((l) => (l.id === id ? { ...l, ...updates } : l)));
    if (updates.mailed && !disputeLetters.find(l => l.id === id)?.mailed) {
      logEvent({ type: "letter_sent", title: "Letter Marked Mailed", detail: `${disputeLetters.find(l => l.id === id)?.bureau} — ${updates.trackingNumber || "No tracking"}`, letterId: id });
    }
  }, [logEvent, disputeLetters]);

  const updatePersonalInfo = useCallback((info: Partial<PersonalInfo>) =>
    setPersonalInfo((prev) => ({ ...prev, ...info })), []);

  const addVaultDoc = useCallback(async (doc: VaultDocRecord) => {
    await addVaultDocRecord(doc);
    setVaultDocs((prev) => [...prev, doc]);
    setVaultTotalSize((prev) => prev + doc.size);
    logEvent({ type: "vault_upload", title: "Document Added to Vault", detail: `${doc.name} (${(doc.size / 1024 / 1024).toFixed(2)} MB)` });
  }, [logEvent]);

  const removeVaultDoc = useCallback(async (id: string) => {
    const doc = vaultDocs.find((d) => d.id === id);
    await removeVaultDocRecord(id);
    setVaultDocs((prev) => prev.filter((d) => d.id !== id));
    setVaultTotalSize((prev) => prev - (doc?.size || 0));
  }, [vaultDocs]);

  const refreshVaultDocs = useCallback(async () => {
    const docs = await getAllVaultDocs();
    setVaultDocs(docs);
    setVaultTotalSize(docs.reduce((a, d) => a + d.size, 0));
  }, []);

  const addContact = useCallback((contact: Contact) => {
    setContacts((prev) => {
      if (prev.some((existing) => isDuplicateContact(existing, contact))) {
        return prev;
      }
      return [...prev, contact];
    });
  }, []);
  const removeContact = useCallback((id: string) => setContacts((prev) => prev.filter((c) => c.id !== id)), []);
  const updateContact = useCallback((id: string, updates: Partial<Contact>) =>
    setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c))), []);

  const updateAutopilot = useCallback((settings: Partial<AutopilotSettings>) =>
    setAutopilot((prev) => ({ ...prev, ...settings })), []);

  const addCampaign = useCallback((campaign: AutopilotCampaign) =>
    setCampaigns((prev) => [...prev, campaign]), []);

  const updateCampaign = useCallback((id: string, updates: Partial<AutopilotCampaign>) =>
    setCampaigns((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c))), []);

  const addBatchToCampaign = useCallback((campaignId: string, batch: AutopilotBatch) =>
    setCampaigns((prev) => prev.map((c) => c.id === campaignId ? { ...c, batches: [...c.batches, batch] } : c)), []);

  const updateBatch = useCallback((campaignId: string, batchId: string, updates: Partial<AutopilotBatch>) =>
    setCampaigns((prev) => prev.map((c) => c.id === campaignId
      ? { ...c, batches: c.batches.map((b) => (b.id === batchId ? { ...b, ...updates } : b)) }
      : c
    )), []);

  const addAutopilotLog = useCallback((entry: Omit<AutopilotLogEvent, "id" | "timestamp">) => {
    const fullEntry: AutopilotLogEvent = { id: uuidv4(), timestamp: new Date().toISOString(), ...entry };
    appendAutopilotLog(fullEntry).catch(console.error);
    setAutopilotLogs((prev) => [fullEntry, ...prev].slice(0, 500));
  }, []);

  const refreshHistoryEvents = useCallback(async () => {
    const events = await getAllHistoryEvents();
    setHistoryEvents(events as HistoryEvent[]);
  }, []);

  const refreshAutopilotLogs = useCallback(async () => {
    const logs = await getAutopilotLogs(200);
    setAutopilotLogs(logs as AutopilotLogEvent[]);
  }, []);

  const addScoreEntryAction = useCallback(async (entry: Omit<ScoreEntry, "id">) => {
    const full: ScoreEntry = { id: uuidv4(), ...entry };
    await addScoreEntry(full);
    setScoreEntries((prev) => [...prev, full].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()));
    logEvent({ type: "score_entry_added", title: "Credit Score Entry Recorded", detail: `${full.bureau || ""} — ${full.score ?? "--"}` });
  }, [logEvent]);

  const removeScoreEntryAction = useCallback(async (id: string) => {
    await deleteScoreEntry(id);
    setScoreEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const clearHistoryEvents = useCallback(() => {
    setHistoryEvents([]);
    // Note: history in IndexedDB is append-only; clear only the in-memory view
  }, []);

  const refreshScoreEntries = useCallback(async () => {
    const entries = await getAllScoreEntries();
    setScoreEntries(entries as ScoreEntry[]);
  }, []);

  const updateSecurity = useCallback((settings: Partial<SecuritySettings>) =>
    setSecurity((prev) => ({ ...prev, ...settings })), []);

  const addXP = useCallback((amount: number) => {
    setGamification((prev) => { const newXp = prev.xp + amount; return { xp: newXp, level: Math.floor(newXp / 1000) + 1 }; });
  }, []);

  const setTheme = useCallback((t: AppTheme) => setThemeState(t), []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", themeState);
  }, [themeState]);

  // Credit Builder CRUD
  const addCreditCard = useCallback((card: CreditCard) => setCreditCards((p) => [...p, card]), []);
  const updateCreditCard = useCallback((id: string, updates: Partial<CreditCard>) =>
    setCreditCards((p) => p.map((c) => (c.id === id ? { ...c, ...updates } : c))), []);
  const removeCreditCard = useCallback((id: string) => setCreditCards((p) => p.filter((c) => c.id !== id)), []);
  const addHardInquiry = useCallback((inq: HardInquiry) => setHardInquiries((p) => [...p, inq]), []);
  const removeHardInquiry = useCallback((id: string) => setHardInquiries((p) => p.filter((i) => i.id !== id)), []);
  const addAUAccount = useCallback((acc: AuthorizedUserAccount) => setAUAccounts((p) => [...p, acc]), []);
  const updateAUAccount = useCallback((id: string, updates: Partial<AuthorizedUserAccount>) =>
    setAUAccounts((p) => p.map((a) => (a.id === id ? { ...a, ...updates } : a))), []);
  const removeAUAccount = useCallback((id: string) => setAUAccounts((p) => p.filter((a) => a.id !== id)), []);
  const updateBoostProgram = useCallback((id: string, updates: Partial<BoostProgram>) =>
    setBoostPrograms((p) => p.map((b) => (b.id === id ? { ...b, ...updates } : b))), []);

  const smartMergeAccounts = useCallback(() => {
    // Build the plan before updating state so the UI can report exactly what
    // happened. Source rows are retained for audit/dispute evidence; matching
    // rows receive one group id plus the best reconstructed account token.
    const items = [...negativeItems];
    const plan = buildTradelineMergePlan(items);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('account-match-review', {
        detail: {
          pendingReviewMerges: plan.pendingReviewMerges,
          linkOnlyPairs: plan.linkOnlyPairs,
        },
      }));
    }
    if (plan.autoMerged.length === 0 && plan.linkOnlyPairs.length === 0) {
      return { mergedAccounts: 0, linkedAccounts: 0, reviewCandidates: plan.pendingReviewMerges.length };
    }

    const updatesMap = new Map<string, Partial<NegativeItem>>();
    for (const tradeline of plan.autoMerged) {
      const group = tradeline.sourceItems;
      const existingGroupId = group.find(i => i.crossBureauGroupId)?.crossBureauGroupId;
      const groupId = existingGroupId || uuidv4();
      const stitched = tradeline.accountNumber || stitchAccountNumbers(group).accountNumber;

      for (const item of group) {
        updatesMap.set(item.id, {
          crossBureauGroupId: groupId,
          campaignGroupId: groupId,
          fullAccountNumber: stitched || item.fullAccountNumber || item.accountNumber || null,
        });
      }
    }

    // LINK_ONLY: share campaign identity without collapsing rows
    for (const link of plan.linkOnlyPairs) {
      const campaignId = link.campaignGroupId || [link.leftId, link.rightId].sort().join(':');
      for (const side of [link.left, link.right]) {
        const existing = updatesMap.get(side.id) ?? {};
        updatesMap.set(side.id, {
          ...existing,
          campaignGroupId: existing.campaignGroupId ?? campaignId,
          crossBureauGroupId: existing.crossBureauGroupId ?? side.crossBureauGroupId ?? campaignId,
        });
      }
    }

    setNegativeItems((prev) => prev.map((item) => {
        const update = updatesMap.get(item.id);
        return update ? { ...item, ...update } : item;
      }));
    return {
      mergedAccounts: plan.autoMerged.reduce((count, group) => count + group.sourceItems.length - 1, 0),
      linkedAccounts: plan.linkOnlyPairs.length,
      reviewCandidates: plan.pendingReviewMerges.length,
    };
  }, [negativeItems]);

  // ─── V4 Profile Management ──────────────────────────────────────────────────
  const switchProfile = useCallback((profileId: string) => {
    setActiveProfileId(profileId);
    localStorage.setItem("dylandos_active_profile_v4", profileId);
  }, []);

  const addProfile = useCallback((profileData: Omit<CreditProfile, 'id' | 'createdAt' | 'updatedAt'>): CreditProfile => {
    const now = new Date().toISOString();
    const profile: CreditProfile = {
      ...profileData,
      id: uuidv4(),
      createdAt: now,
      updatedAt: now,
    };
    setProfiles(prev => {
      const updated = [...prev, profile];
      localStorage.setItem("dylandos_profiles_v4", JSON.stringify(updated));
      return updated;
    });
    return profile;
  }, []);

  const updateProfile = useCallback((id: string, updates: Partial<CreditProfile>) => {
    setProfiles(prev => {
      const updated = prev.map(p => p.id === id ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p);
      localStorage.setItem("dylandos_profiles_v4", JSON.stringify(updated));
      return updated;
    });
  }, []);

  const removeProfile = useCallback((id: string) => {
    setProfiles(prev => {
      const updated = prev.filter(p => p.id !== id);
      localStorage.setItem("dylandos_profiles_v4", JSON.stringify(updated));
      return updated;
    });
    setActiveProfileId(prev => prev === id ? null : prev);
  }, []);

  const exportAllData = useCallback(async (): Promise<string> => {
    const mainState = await loadAppState("main");
    const history = await getAllHistoryEvents();
    const scores = await getAllScoreEntries();
    const vault = await getAllVaultDocs();
    const backup = {
      exportedAt: new Date().toISOString(), appVersion: APP_VERSION,
      main: mainState, historyEvents: history, scoreEntries: scores,
      vaultDocMeta: vault.map(({ data: _data, ...rest }: any) => rest),
    };
    logEvent({ type: "data_backup", title: "Data Backup Exported", detail: `Exported at ${new Date().toLocaleString()}` });
    return JSON.stringify(backup, null, 2);
  }, [logEvent]);

  const importAllData = useCallback(async (jsonStr: string) => {
    try {
      const parsed = JSON.parse(jsonStr);
      const main = runMigrations(parsed.main);
      if (main) {
        await saveAppState("main", main);
        if (main.reports) setReports(main.reports);
        if (main.negativeItems) setNegativeItems(main.negativeItems);
        if (main.disputeLetters) setDisputeLetters(main.disputeLetters);
        if (main.personalInfo) setPersonalInfo(main.personalInfo);
        if (main.contacts) setContacts(main.contacts);
        if (main.autopilot) setAutopilot({ ...defaultAutopilot, ...main.autopilot });
        if (main.security) setSecurity(main.security);
        if (main.gamification) setGamification(main.gamification);
        if (main.campaigns) setCampaigns(main.campaigns);
      }
    } catch (e) { throw new Error("Invalid backup file. Import failed."); }
  }, []);

  const clearData = useCallback(async () => {
    setReports([]); setNegativeItems([]); setDisputeLetters([]); setPersonalInfo(defaultPersonalInfo);
    setContacts([]); setAutopilot(defaultAutopilot); setSecurity(defaultSecurity);
    setGamification(defaultGamification); setCampaigns([]); setVaultDocs([]); setVaultTotalSize(0);
    setHistoryEvents([]); setAutopilotLogs([]); setScoreEntries([]);
    setCreditCards([]); setHardInquiries([]); setAUAccounts([]);
    setProfiles([]); setActiveProfileId(null);
    setBoostPrograms(DEFAULT_BOOST_PROGRAMS);
    clearRuntimeStorage(true);

    await Promise.allSettled([
      idbClear("appState"),
      idbClear("vaultDocs"),
      idbClear("historyEvents"),
      idbClear("autopilotLogs"),
      idbClear("scoreEntries"),
      idbClear("disputeItems"),
      idbClear("generatedLetters"),
      idbClear("bureauResponses"),
      idbClear("disputeOutcomes"),
      idbClear("userProfiles"),
      idbClear("autopilotState"),
      idbClear("holdQueue"),
      idbClear("fcraTimeline"),
      idbClear("cycleAudit"),
    ]);
  }, []);

  // Clears only the negative items dedup state so the parser can re-detect
  // previously parsed accounts. Does NOT touch letters, campaigns, or settings.
  const clearNegativeItems = useCallback(async () => {
    setNegativeItems([]);
    clearRuntimeStorage(false);
    try {
      const main = await loadAppState<Record<string, unknown>>("main");
      if (main && typeof main === "object") {
        await saveAppState("main", { ...main, negativeItems: [] });
      }
    } catch (e) {
      console.warn("[AppContext] Parser cache IDB write failed (UI still cleared):", e);
    }
  }, []);

  return (
    <AppContext.Provider value={{
      reports, negativeItems, disputeLetters, personalInfo, isPersonalInfoComplete, vaultDocs, vaultTotalSize,
      contacts, autopilot, security, gamification, theme: themeState, appVersion: APP_VERSION,
      campaigns, historyEvents, autopilotLogs, scoreEntries, isDbReady,
      addReport, addNegativeItems, removeNegativeItem, removeNegativeItems, updateNegativeItem,
      addItemNote, updateDisputeItemStatus, addDisputeLetter, removeDisputeLetter, updateDisputeLetterStatus, updateDisputeLetter, updatePersonalInfo,
      addVaultDoc, removeVaultDoc, refreshVaultDocs,
      addContact, removeContact, updateContact, updateAutopilot,
      addCampaign, updateCampaign, addBatchToCampaign, updateBatch,
      logEvent, clearHistoryEvents, addAutopilotLog, refreshHistoryEvents, refreshAutopilotLogs,
      addScoreEntry: addScoreEntryAction, removeScoreEntry: removeScoreEntryAction, refreshScoreEntries,
      updateSecurity, addXP, setTheme, exportAllData, importAllData, clearData, clearNegativeItems,
      creditCards, hardInquiries, auAccounts, boostPrograms,
      addCreditCard, updateCreditCard, removeCreditCard,
      addHardInquiry, removeHardInquiry,
      addAUAccount, updateAUAccount, removeAUAccount,
      updateBoostProgram,
      smartMergeAccounts,
      // V4 Multi-Profile
      profiles,
      activeProfileId,
      vaultEncryptionReady,
      switchProfile,
      addProfile,
      updateProfile,
      removeProfile,
      // Parser Debug Log
      lastParseDebugLog,
      setLastParseDebugLog,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (context === undefined) throw new Error("useAppContext must be used within an AppProvider");
  return context;
}
