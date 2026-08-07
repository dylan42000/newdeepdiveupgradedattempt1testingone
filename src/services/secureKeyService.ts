/**
 * Secure Key Service — Unified secure storage for API keys
 * Android: Capacitor Secure Storage (AES/GCM via Android Keystore)
 * Windows: Electron safeStorage (Windows DPAPI)
 * Web fallback: sessionStorage (in-memory, not persisted)
 *
 * Install for Android: npm install @aparajita/capacitor-secure-storage && npx cap sync android
 */

import { PlatformService } from './platformService';

// Key name constants
export const KEY_NAMES = {
  GROQ: 'dylandos_groq_api_key',
  GROQ_2: 'dylandos_groq_api_key_2',
  GEMINI: 'dylandos_gemini_api_key',
  GEMINI_2: 'dylandos_gemini_api_key_2',
  OPENAI: 'dylandos_openai_api_key',
  HUGGINGFACE: 'dylandos_huggingface_api_key',
  CLOUDFLARE: 'dylandos_cloudflare_api_key',
  CLOUDFLARE_ACCOUNT_ID: 'dylandos_cloudflare_account_id',
  DEEPSEEK: 'dylandos_deepseek_api_key',
  TOGETHER: 'dylandos_together_api_key',
  MISTRAL: 'dylandos_mistral_api_key',
  LOB: 'dylandos_lob_api_key',
  POSTGRID: 'dylandos_postgrid_api_key',
  STANNP: 'dylandos_stannp_api_key',
} as const;

export type SecureKeyName = typeof KEY_NAMES[keyof typeof KEY_NAMES];

// In-memory session cache to avoid repeated IPC calls
const _cache: Record<string, string> = {};

export interface EncryptedLocalRecord {
  __encrypted: true;
  version: 1;
  salt: string;
  iv: string;
  ciphertext: string;
}

let localDataPassphrase: string | null = null;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => entry instanceof ArrayBuffer
    ? { __arrayBuffer: toBase64(new Uint8Array(entry)) }
    : entry);
}

function deserialize<T>(value: string): T {
  return JSON.parse(value, (_key, entry) => entry?.__arrayBuffer
    ? fromBase64(entry.__arrayBuffer).buffer
    : entry) as T;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * In-memory unlock for records encrypted in IndexedDB. The passphrase is never
 * persisted. Call this after the user unlocks the local vault, before reading or
 * writing vault documents, profiles, or generated letters.
 */
export const LocalDataEncryption = {
  unlock(passphrase: string): void {
    if (passphrase.trim().length < 12) throw new Error('Use a local-data passphrase of at least 12 characters.');
    localDataPassphrase = passphrase;
  },
  lock(): void { localDataPassphrase = null; },
  isUnlocked(): boolean { return Boolean(localDataPassphrase); },
  async encrypt<T>(record: T): Promise<EncryptedLocalRecord> {
    if (!localDataPassphrase) throw new Error('Local encrypted storage is locked. Unlock it before saving sensitive data.');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(localDataPassphrase, salt);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(serialize(record)));
    return { __encrypted: true, version: 1, salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(encrypted)) };
  },
  async decrypt<T>(record: EncryptedLocalRecord): Promise<T> {
    if (!localDataPassphrase) throw new Error('Local encrypted storage is locked. Unlock it before reading sensitive data.');
    const salt = fromBase64(record.salt);
    const iv = fromBase64(record.iv);
    const key = await deriveKey(localDataPassphrase, salt);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, fromBase64(record.ciphertext));
    return deserialize<T>(decoder.decode(plain));
  },
};

function getCapacitorStorage(): any | null {
  const cap = (window as any)?.Capacitor;
  return cap?.Plugins?.SecureStorage ?? null;
}

export const SecureKeyService = {
  async setKey(keyName: SecureKeyName, value: string): Promise<void> {
    const trimmed = value.trim();
    _cache[keyName] = trimmed;

    if (PlatformService.isElectron()) {
      try {
        const api = (window as any).electronAPI;
        if (api?.storeApiKey) {
          // Preferred signature
          await api.storeApiKey(keyName, trimmed);
        } else {
          // Legacy fallback
          await api?.storeApiKey?.({ keyName, keyValue: trimmed });
        }
        return;
      } catch (e) {
        console.error('[SecureKeyService] Electron IPC failed — refusing plaintext localStorage fallback', e);
        throw new Error('Secure key storage unavailable. API keys cannot be saved in plaintext.');
      }
    }

    if (PlatformService.isAndroid()) {
      const storage = getCapacitorStorage();
      if (storage) {
        try {
          await storage.set({ key: keyName, value: trimmed });
          return;
        } catch (e) {
          console.error('[SecureKeyService] Capacitor SecureStorage failed — refusing plaintext localStorage fallback', e);
          throw new Error('Secure key storage unavailable. API keys cannot be saved in plaintext.');
        }
      }
    }

    // Web / insecure fallback — keep in-memory session cache only (never localStorage)
    _cache[keyName] = trimmed;
    console.warn('[SecureKeyService] No secure backend — key held in memory for this session only');
  },

  async getKey(keyName: SecureKeyName): Promise<string> {
    if (_cache[keyName]) return _cache[keyName];

    if (PlatformService.isElectron()) {
      try {
        const api = (window as any).electronAPI;
        const value = api?.getApiKey
          ? await api.getApiKey(keyName)
          : await api?.getApiKey?.({ keyName });

        const normalized = typeof value === 'string' ? value : '';
        if (normalized) {
          _cache[keyName] = normalized;
          return normalized;
        }
      } catch (e) {
        console.warn('[SecureKeyService] Electron IPC failed, falling back to localStorage', e);
      }
    }

    if (PlatformService.isAndroid()) {
      const storage = getCapacitorStorage();
      if (storage) {
        try {
          const result = await storage.get({ key: keyName });
          const value = result?.value ?? '';
          if (value) {
            _cache[keyName] = value;
            return value;
          }
        } catch (e) {
          console.warn('[SecureKeyService] Capacitor SecureStorage failed, falling back to localStorage', e);
        }
      }
    }

    // Web / fallback
    const val = localStorage.getItem(keyName) ?? '';
    if (val) _cache[keyName] = val;
    return val;
  },

  async removeKey(keyName: SecureKeyName): Promise<void> {
    delete _cache[keyName];

    if (PlatformService.isElectron()) {
      try {
        const api = (window as any).electronAPI;
        if (api?.removeApiKey) {
          await api.removeApiKey(keyName);
        } else {
          await api?.removeApiKey?.({ keyName });
        }
        return;
      } catch { /* fallback */ }
    }

    if (PlatformService.isAndroid()) {
      const storage = getCapacitorStorage();
      if (storage) {
        try {
          await storage.remove({ key: keyName });
          return;
        } catch { /* fallback */ }
      }
    }

    localStorage.removeItem(keyName);
  },

  clearCache(): void {
    Object.keys(_cache).forEach((k) => delete _cache[k]);
  },
};

// ─── SSN Secure Storage Helpers ─────────────────────────────────────────────
//
// SSNs never touch localStorage or IndexedDB. They go through Electron
// safeStorage (DPAPI) on Windows only. On web/Android: not stored at all.

export const SSNSecureService = {
  /** Store encrypted SSN for a profile (Electron only — DPAPI) */
  async storeSSN(profileId: string, ssnFull: string): Promise<boolean> {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.secureStoreSSN) {
      try {
        await (window as any).electronAPI.secureStoreSSN(profileId, ssnFull);
        return true;
      } catch (e) {
        console.warn('[SSNSecureService] Failed to store SSN via Electron safeStorage', e);
        return false;
      }
    }
    // Non-Electron: refuse to store SSN in unencrypted storage
    console.warn('[SSNSecureService] SSN storage not available outside Electron — not stored.');
    return false;
  },

  /** Retrieve SSN for a profile (Electron only). Returns null if unavailable. */
  async getSSN(profileId: string): Promise<string | null> {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.secureGetSSN) {
      try {
        const res = await (window as any).electronAPI.secureGetSSN(profileId);
        if (typeof res === 'string') return res;
        if (res && typeof res === 'object' && 'encryptedSSN' in res) {
          return res.encryptedSSN ?? null;
        }
        return null;
      } catch (e) {
        console.warn('[SSNSecureService] Failed to retrieve SSN via Electron safeStorage', e);
        return null;
      }
    }
    return null;
  },

  /** Remove SSN for a profile from secure store */
  async clearSSN(profileId: string): Promise<void> {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.secureClearSSN) {
      try {
        await (window as any).electronAPI.secureClearSSN(profileId);
      } catch (e) {
        console.warn('[SSNSecureService] Failed to clear SSN', e);
      }
    }
  },

  /** Check if SSN secure storage is available */
  isAvailable(): boolean {
    return typeof window !== 'undefined' && !!(window as any).electronAPI?.secureStoreSSN;
  },
};

// ─── Vault Key Path Helper ─────────────────────────────────────────────────
//
// Helper to get the vault base path via IPC (Electron only).

export const VaultPathService = {
  async getBasePath(): Promise<string | null> {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.vaultGetBasePath) {
      try {
        return await (window as any).electronAPI.vaultGetBasePath();
      } catch {
        return null;
      }
    }
    return null;
  },

  async getMasterKey(): Promise<ArrayBuffer | null> {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.vaultGetMasterKey) {
      try {
        return await (window as any).electronAPI.vaultGetMasterKey();
      } catch {
        return null;
      }
    }
    return null;
  },
};

/**
 * One-time migration: moves API keys from localStorage to secure storage.
 * Call this once on app startup (e.g., in App.tsx useEffect).
 */
export async function migrateApiKeysFromLocalStorage(): Promise<void> {
  const legacyKeys: Array<{ legacyKey: string; secureKey: SecureKeyName }> = [
    { legacyKey: 'groq_api_key', secureKey: KEY_NAMES.GROQ },
    { legacyKey: 'groq_api_key_2', secureKey: KEY_NAMES.GROQ_2 },
    { legacyKey: 'gemini_api_key', secureKey: KEY_NAMES.GEMINI },
    { legacyKey: 'gemini_api_key_2', secureKey: KEY_NAMES.GEMINI_2 },
    { legacyKey: 'openai_api_key', secureKey: KEY_NAMES.OPENAI },
  ];

  let migrated = false;
  for (const { legacyKey, secureKey } of legacyKeys) {
    const value = localStorage.getItem(legacyKey);
    if (value) {
      await SecureKeyService.setKey(secureKey, value);
      localStorage.removeItem(legacyKey);
      migrated = true;
    }
  }

  if (migrated) {
    console.info('[SecureKeyService] API keys migrated from localStorage to secure storage.');
  }
}
