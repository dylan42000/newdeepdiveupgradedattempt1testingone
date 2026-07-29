/**
 * vaultEncryptionService.ts — AES-256-GCM Encrypted Vault
 * Uses Electron safeStorage DPAPI key for master key,
 * then AES-GCM for all vault file encryption.
 * Rule: Zero plaintext sensitive data on disk.
 */

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;  // 96-bit IV for AES-GCM
const TAG_LENGTH = 128; // 128-bit auth tag

let _masterKey: CryptoKey | null = null;
let _rawMasterKeyHex: string | null = null;

export const VaultEncryptionService = {
  /**
   * Initialize with master key from Electron main (DPAPI-protected).
   * Must be called once on app start.
   */
  async initWithMasterKey(hexKey: string): Promise<void> {
    _rawMasterKeyHex = hexKey;
    const keyBytes = hexToBytes(hexKey);
    _masterKey = await window.crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: ALGORITHM },
      false,
      ['encrypt', 'decrypt']
    );
  },

  isInitialized(): boolean {
    return _masterKey !== null;
  },

  /**
   * Encrypt arbitrary data (ArrayBuffer or string) → Uint8Array
   * Format: [IV (12 bytes)] [ciphertext + auth tag]
   */
  async encrypt(data: ArrayBuffer | string): Promise<Uint8Array> {
    if (!_masterKey) throw new Error('[VaultEncryption] Not initialized — call initWithMasterKey first');

    const iv = window.crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const plaintext = typeof data === 'string'
      ? new TextEncoder().encode(data)
      : new Uint8Array(data);

    const ciphertext = await window.crypto.subtle.encrypt(
      { name: ALGORITHM, iv, tagLength: TAG_LENGTH },
      _masterKey,
      plaintext
    );

    // Prepend IV to ciphertext
    const result = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
    result.set(iv, 0);
    result.set(new Uint8Array(ciphertext), IV_LENGTH);
    return result;
  },

  /**
   * Decrypt vault data → ArrayBuffer
   * Expects [IV (12 bytes)] [ciphertext + auth tag]
   */
  async decrypt(encryptedData: Uint8Array | ArrayBuffer): Promise<ArrayBuffer> {
    if (!_masterKey) throw new Error('[VaultEncryption] Not initialized');

    const bytes = encryptedData instanceof ArrayBuffer
      ? new Uint8Array(encryptedData)
      : encryptedData;

    if (bytes.length <= IV_LENGTH) throw new Error('[VaultEncryption] Data too short to decrypt');

    const iv = bytes.slice(0, IV_LENGTH);
    const ciphertext = bytes.slice(IV_LENGTH);

    return window.crypto.subtle.decrypt(
      { name: ALGORITHM, iv, tagLength: TAG_LENGTH },
      _masterKey,
      ciphertext
    );
  },

  /**
   * Encrypt to JSON-safe base64 string (for metadata storage).
   */
  async encryptToBase64(data: string): Promise<string> {
    const encrypted = await this.encrypt(data);
    return bytesToBase64(encrypted);
  },

  /**
   * Decrypt from base64 string back to original string.
   */
  async decryptFromBase64(base64: string): Promise<string> {
    const bytes = base64ToBytes(base64);
    const decrypted = await this.decrypt(bytes);
    return new TextDecoder().decode(decrypted);
  },

  /**
   * Compute SHA-256 hash of data for integrity verification.
   */
  async sha256(data: ArrayBuffer | Uint8Array | string): Promise<string> {
    let buffer: ArrayBuffer;
    if (typeof data === 'string') {
      buffer = new TextEncoder().encode(data).buffer as ArrayBuffer;
    } else if (data instanceof Uint8Array) {
      buffer = data.buffer as ArrayBuffer;
    } else {
      buffer = data;
    }
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', buffer);
    return bytesToHex(new Uint8Array(hashBuffer));
  },

  /**
   * Clear master key from memory (on app lock).
   */
  clear(): void {
    _masterKey = null;
    _rawMasterKeyHex = null;
  },
};

// ─── Utility Functions ─────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
