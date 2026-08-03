/**
 * Ambient type declarations for optional native packages.
 * These packages are loaded dynamically at runtime (in try/catch blocks).
 * Install to activate:
 *   npm install @capacitor/local-notifications
 *   npm install @aparajita/capacitor-secure-storage
 *   npx cap sync android
 */

declare module '@capacitor/local-notifications' {
  interface LocalNotificationRequest {
    title: string;
    body: string;
    id: number;
    schedule?: { at: Date };
    sound?: string | undefined;
    attachments?: unknown[] | undefined;
    actionTypeId?: string;
    extra?: unknown;
  }
  interface LocalNotificationsPlugin {
    requestPermissions(): Promise<{ display: 'granted' | 'denied' | 'prompt' }>;
    schedule(options: { notifications: LocalNotificationRequest[] }): Promise<{ notifications: { id: number }[] }>;
    cancel(options: { notifications: { id: number }[] }): Promise<void>;
  }
  const LocalNotifications: LocalNotificationsPlugin;
  export { LocalNotifications };
}

declare module '@aparajita/capacitor-secure-storage' {
  interface SecureStoragePlugin {
    get(options: { key: string }): Promise<{ value: string | null }>;
    set(options: { key: string; value: string }): Promise<void>;
    remove(options: { key: string }): Promise<void>;
    clear(): Promise<void>;
  }
  const SecureStorage: SecureStoragePlugin;
  export { SecureStorage };
}

// ─── Electron IPC Bridge (window.electronAPI) ─────────────────────────────────

interface VaultFileEntry {
  name: string;
  isDirectory: boolean;
  path: string;
}

interface ElectronAPI {
  // API Key storage
  storeApiKey(keyName: string, value: string): Promise<{ success: boolean }>;
  getApiKey(keyName: string): Promise<string | null>;
  removeApiKey(keyName: string): Promise<{ success: boolean }>;

  // File system
  openFileDialog(options?: Record<string, unknown>): Promise<string | string[] | null>;
  saveFile(options?: Record<string, unknown>): Promise<{ success: boolean; filePath?: string }>;
  readFileAsBase64(filePath: string): Promise<string | { success: boolean; base64?: string; error?: string } | null>;

  // PDF / Print
  printToPDF(htmlContent: string, outputPath?: string): Promise<{ success: boolean; filePath?: string; error?: string }>;

  // Notifications
  showNotification(title: string, body: string, urgency?: string): Promise<{ success: boolean }>;

  // App info
  getAppVersion(): Promise<string>;
  getPlatform(): string;

  // Shell
  openExternal(url: string): Promise<{ success: boolean }>;

  // Clipboard helpers
  readClipboard?(): Promise<string | { success: boolean; text?: string; error?: string }>;
  pasteText?(): Promise<{ success: boolean; text: string; source?: string; error?: string }>;

  // Deadline events
  onDeadlineAlert(callback: (data: unknown) => void): void;
  removeDeadlineAlertListener(): void;

  // Vault IPC
  vaultGetBasePath(): Promise<string>;
  vaultWriteFile(relativePath: string, data: string | Uint8Array): Promise<{ success: boolean; filePath?: string; error?: string }>;
  vaultReadFile(relativePath: string): Promise<{ success: boolean; data?: string; error?: string }>;
  vaultListDirectory(relativePath?: string): Promise<{ success: boolean; files?: VaultFileEntry[]; error?: string }>;
  vaultDeleteFile(relativePath: string): Promise<{ success: boolean; error?: string }>;
  vaultAppendAuditLog(entry: Record<string, unknown>): Promise<{ success: boolean }>;
  vaultCreateExportPackage(profileId: string): Promise<{ success: boolean; filePath?: string; note?: string; error?: string }>;
  vaultGetMasterKey(): Promise<{ success: boolean; keyHex?: string; error?: string }>;

  // SSN secure storage
  secureStoreSSN(profileId: string, encryptedSSN: string): Promise<{ success: boolean }>;
  secureGetSSN(profileId: string): Promise<{ success: boolean; encryptedSSN?: string | null }>;
  secureClearSSN(profileId: string): Promise<{ success: boolean }>;

  // AutoPilot scheduler
  autopilotSchedule(settings: { nextCycleDate?: string; cycleIntervalDays?: number }): Promise<{ success: boolean; scheduledFor?: string }>;
  autopilotCancel(): Promise<{ success: boolean }>;
  autopilotStatus(): Promise<{ success: boolean; active: boolean; nextTriggerDate: string | null }>;
  onAutopilotTrigger(callback: () => void): void;
  removeAutopilotTriggerListener(): void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
