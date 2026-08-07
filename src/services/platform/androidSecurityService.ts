// src/services/platform/androidSecurityService.ts
// Wraps the SecureVault native plugin for Android Keystore encryption

import { registerPlugin } from '@capacitor/core';

interface SecureVaultPluginInterface {
  ensureVaultKey(): Promise<{ success: boolean; keyAlias: string }>;
  isHardwareBacked(): Promise<{ hardwareBacked: boolean; keyExists: boolean; provider: string }>;
  encryptData(options: { data: string }): Promise<{ encrypted: string; algorithm: string }>;
  decryptData(options: { data: string }): Promise<{ decrypted: string }>;
  storeSSN(options: { profileId: string; ssn: string }): Promise<{ success: boolean }>;
  retrieveSSN(options: { profileId: string; full?: boolean }): Promise<{ found: boolean; ssn?: string; last4?: string }>;
}

const SecureVaultNative = registerPlugin<SecureVaultPluginInterface>('SecureVault');

export class AndroidSecurityService {
  private static instance: AndroidSecurityService;
  private initialized = false;

  static getInstance(): AndroidSecurityService {
    if (!this.instance) this.instance = new AndroidSecurityService();
    return this.instance;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await SecureVaultNative.ensureVaultKey();
    this.initialized = true;
  }

  async isHardwareBacked(): Promise<boolean> {
    const result = await SecureVaultNative.isHardwareBacked();
    return result.hardwareBacked;
  }

  // Encrypt any ArrayBuffer → base64 string
  async encryptBlob(data: ArrayBuffer): Promise<string> {
    const base64 = btoa(String.fromCharCode(...new Uint8Array(data)));
    const result = await SecureVaultNative.encryptData({ data: base64 });
    return result.encrypted;
  }

  // Decrypt base64 string → ArrayBuffer
  async decryptBlob(encrypted: string): Promise<ArrayBuffer> {
    const result = await SecureVaultNative.decryptData({ data: encrypted });
    const binary = atob(result.decrypted);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  // SSN Management
  async storeSSN(profileId: string, ssn: string): Promise<void> {
    const encrypted = await this.encryptBlob(new TextEncoder().encode(ssn).buffer);
    await SecureVaultNative.storeSSN({ profileId, ssn: encrypted });
  }

  async getSSNLast4(profileId: string): Promise<string> {
    const result = await SecureVaultNative.retrieveSSN({ profileId });
    if (!result.found || !result.last4) return '****';
    return result.last4;
  }

  async getFullSSN(profileId: string): Promise<string | null> {
    const result = await SecureVaultNative.retrieveSSN({ profileId, full: true });
    if (!result.found || !result.ssn) return null;
    try {
      const decrypted = await this.decryptBlob(result.ssn);
      return new TextDecoder().decode(decrypted);
    } catch {
      return null;
    }
  }

  // Sanitize sensitive data before logging
  sanitizeForLog(data: unknown): unknown {
    const json = JSON.stringify(data);
    const sanitized = json
      .replace(/\b\d{3}-?\d{2}-?\d{4}\b/g, '[SSN-REDACTED]')
      .replace(/\b\d{9}\b/g, '[SSN-REDACTED]')
      .replace(/"ssn"\s*:\s*"[^"]+"/g, '"ssn": "[REDACTED]"');
    return JSON.parse(sanitized);
  }
}
