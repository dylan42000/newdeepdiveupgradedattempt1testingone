/**
 * Platform Detection + Abstraction Service
 * Detects whether we're running in Electron (Windows) or Capacitor (Android)
 * and exposes a unified API surface for platform-specific operations.
 */

export type AppPlatform = 'electron' | 'capacitor-android' | 'web';

// Detect the current runtime platform
function detectPlatform(): AppPlatform {
  // Check for Electron — window.electronAPI is exposed by preload.cjs
  if (typeof window !== 'undefined' && (window as any).electronAPI) {
    return 'electron';
  }
  // Check for Capacitor Android
  if (typeof window !== 'undefined' && (window as any).Capacitor?.getPlatform?.() === 'android') {
    return 'capacitor-android';
  }
  return 'web';
}

export const PlatformService = {
  platform: detectPlatform(),

  isElectron(): boolean {
    return this.platform === 'electron';
  },

  isAndroid(): boolean {
    return this.platform === 'capacitor-android';
  },

  isNative(): boolean {
    return this.platform !== 'web';
  },

  // Unified notification: delegates to platform-specific handler
  async showNotification(title: string, body: string): Promise<void> {
    if (this.isElectron()) {
      try {
        await (window as any).electronAPI?.showNotification?.(title, body, 'normal');
        return;
      } catch { /* fallback */ }
    }
    // Web / PWA fallback
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  },

  // Unified file save: electron uses dialog, android/web creates a download link
  async saveFile(filename: string, content: string, mimeType = 'text/plain'): Promise<boolean> {
    if (this.isElectron()) {
      try {
        const result = await (window as any).electronAPI?.saveFile?.({ filename, content });
        return result?.success ?? false;
      } catch { return false; }
    }
    // Web / Android fallback — trigger browser download
    try {
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      return true;
    } catch { return false; }
  },

  // Open file picker — returns file paths (electron) or File objects (web/android)
  async openFilePicker(accept?: string[]): Promise<string[] | File[]> {
    if (this.isElectron()) {
      try {
        const result = await (window as any).electronAPI?.openFileDialog?.();
        if (!result) return [];
        if (Array.isArray(result)) return result;
        if (typeof result === 'string') return [result];
        return [];
      } catch { return []; }
    }
    // Web / Android — use input[type=file]
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      if (accept?.length) input.accept = accept.join(',');
      input.onchange = (e) => {
        const files = Array.from((e.target as HTMLInputElement).files ?? []);
        resolve(files);
      };
      input.click();
    });
  },

  // Print to PDF — electron only (uses webContents.printToPDF)
  async printToPDF(htmlContent: string, filename: string): Promise<boolean> {
    if (this.isElectron()) {
      try {
        const result = await (window as any).electronAPI?.printToPDF?.(htmlContent, filename);
        return result?.success ?? false;
      } catch { return false; }
    }
    // Fallback: open print dialog
    window.print();
    return true;
  },

  // Check if daily deadline check is needed (runs on Electron startup)
  async checkDeadlines(): Promise<void> {
    if (this.isElectron()) {
      await (window as any).electronAPI?.checkDeadlines?.();
    }
  },

  /** Open an HTTPS URL in the system browser (Electron) or window.open (web/Android). */
  async openExternal(url: string): Promise<void> {
    if (this.isElectron()) {
      try {
        await (window as any).electronAPI?.openExternal?.(url);
        return;
      } catch { /* fall through */ }
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  },

  /** Share plain text via Android share sheet when available; otherwise copy/save. */
  async shareText(title: string, text: string): Promise<boolean> {
    if (this.isAndroid()) {
      try {
        const cap = (window as any).Capacitor?.Plugins?.PlatformApex;
        if (cap?.shareText) {
          await cap.shareText({ title, text });
          return true;
        }
      } catch { /* fall through */ }
    }
    try {
      if (navigator.share) {
        await navigator.share({ title, text });
        return true;
      }
    } catch { /* fall through */ }
    return this.saveFile(`${title.replace(/\s+/g, '-').toLowerCase()}.txt`, text, 'text/plain');
  },
};
