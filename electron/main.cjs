"use strict";

const {
  app,
  BrowserWindow,
  shell,
  Menu,
  dialog,
  ipcMain,
  safeStorage,
  Notification,
  clipboard,
  Tray,
  nativeImage,
  screen,
} = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = require("fs").promises;
const crypto = require("crypto");
const AdmZip = require("adm-zip");

const isDev = process.env.ELECTRON_IS_DEV === "true";

// ── GPU / RENDERING STABILITY ────────────────────────────────────────────────
// Keep hardware acceleration disabled for compatibility with older/onboard GPU drivers.
app.disableHardwareAcceleration();
// Also disable the GPU software rasterizer which can cause black screens on
// systems where both HW acceleration AND software rasterizer are unsupported.
app.commandLine.appendSwitch('disable-software-rasterizer');
// Suppress GPU sandbox errors common in packaged apps running on Windows VMs/WINE
app.commandLine.appendSwitch('no-sandbox');

const USER_DATA = app.getPath("userData");
const KEY_STORE_PATH = path.join(USER_DATA, "dylandos-keys.enc");
const VAULT_MASTER_KEY_FILE = path.join(USER_DATA, "vault-master.enc");
const VAULT_BASE = path.join(USER_DATA, "vault");
const AUDIT_LOG_FILE = path.join(VAULT_BASE, "audit", "audit_log.enc");
const SSN_STORE_PATH = path.join(USER_DATA, "ssn-store.enc");
const SCHED_PATH = path.join(USER_DATA, "autopilot", "scheduler.json");

function ensureDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizePasteText(raw) {
  let text = String(raw ?? "");
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  text = text.normalize("NFKC");
  text = text.replace(/\p{Cf}/gu, "");
  return text;
}

function safeRelativePath(rel) {
  if (!rel || typeof rel !== "string") {
    throw new Error("Path must be a non-empty string");
  }

  const normalized = rel.normalize("NFC");
  const resolved = path.resolve(VAULT_BASE, normalized);

  if (!resolved.startsWith(VAULT_BASE + path.sep) && resolved !== VAULT_BASE) {
    throw new Error(`Path traversal attempt blocked: ${rel}`);
  }

  return resolved;
}

function readEncryptedJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    const buf = fs.readFileSync(filePath);
    if (!safeStorage.isEncryptionAvailable()) {
      console.error("[main] safeStorage unavailable — refusing to read secrets from", filePath);
      return {};
    }
    return JSON.parse(safeStorage.decryptString(buf));
  } catch {
    return {};
  }
}

function writeEncryptedJson(filePath, data) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("OS encryption (safeStorage/DPAPI) is unavailable. Refusing to write secrets in plaintext.");
  }
  ensureDirSync(path.dirname(filePath));
  const json = JSON.stringify(data);
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, safeStorage.encryptString(json));
  fs.renameSync(tmp, filePath);
}

/** Paths the renderer may read — only those returned by open-file-dialog. */
const allowedReadPaths = new Set();

/** Max setTimeout delay (2^31-1 ms ≈ 24.8 days). Longer delays overflow to 1ms. */
const MAX_TIMER_MS = 2147483647;
const DAY_MS = 86400000;

function isSafeExternalUrl(url) {
  return typeof url === "string" && /^https:\/\//i.test(url);
}

function openExternalSafe(url) {
  if (!isSafeExternalUrl(url)) {
    console.warn("[main] Blocked non-HTTPS openExternal:", String(url).slice(0, 80));
    return false;
  }
  shell.openExternal(url);
  return true;
}

let mainWindow = null;
let letterReviewWindow = null;
let tray = null;
let isQuitting = false;

function getTrayIcon() {
  const iconPath = path.join(__dirname, "icon.ico");
  try {
    if (fs.existsSync(iconPath)) return nativeImage.createFromPath(iconPath);
  } catch {
    /* fall through */
  }
  return nativeImage.createEmpty();
}

function sendToMain(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: "Show DylandOs",
      click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) createWindow();
        else {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: "Run Cycle Now",
      click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) createWindow();
        else mainWindow.show();
        sendToMain("tray:run-cycle");
      },
    },
    {
      label: "View Audit",
      click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) createWindow();
        else mainWindow.show();
        sendToMain("tray:navigate", { page: "history" });
      },
    },
    {
      label: "Export Letters",
      click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) createWindow();
        else mainWindow.show();
        sendToMain("tray:navigate", { page: "dispute-letters" });
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function setupTray() {
  if (tray) return;
  tray = new Tray(getTrayIcon());
  tray.setToolTip("DylandOs Ultimate Credit Repair Suite");
  tray.setContextMenu(buildTrayMenu());
  tray.on("double-click", () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function updateTrayTooltip(info = {}) {
  if (!tray) return;
  const campaigns = info.activeCampaigns ?? 0;
  const next = info.nextCycleDate ? String(info.nextCycleDate).slice(0, 10) : "—";
  const fraud = info.fraudAlerts ?? 0;
  tray.setToolTip(
    `DylandOs — ${campaigns} campaign(s) · next cycle ${next}` +
      (fraud > 0 ? ` · ${fraud} fraud alert(s)` : "")
  );
  try {
    tray.setContextMenu(buildTrayMenu());
  } catch {
    /* ignore */
  }
}

function pickSecondaryDisplay() {
  const displays = screen.getAllDisplays();
  if (!displays || displays.length < 2) return null;
  const primary = screen.getPrimaryDisplay();
  return displays.find((d) => d.id !== primary.id) || displays[1] || null;
}

let schedulerTimer = null;
let schedulerState = { active: false, nextTriggerDate: null, cycleIntervalMs: null };

function clearSchedulerTimer() {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
}

/**
 * Arm Autopilot scheduler with overflow-safe chunked timers.
 * Wakes at most every ~24h and compares wall clock to the target date.
 */
function armScheduler(targetMs) {
  clearSchedulerTimer();
  if (!Number.isFinite(targetMs)) return;

  const tick = () => {
    const now = Date.now();
    if (now >= targetMs) {
      // Prefer focused renderer; if closed, raise a native notification that deep-links on click.
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
        } catch { /* non-fatal */ }
        mainWindow.webContents.send("autopilot:trigger");
      } else {
        try {
          const { Notification } = require("electron");
          if (Notification.isSupported()) {
            const n = new Notification({
              title: "AutoPilot needs you",
              body: "A scheduled cycle is ready. Open Dylando to continue — no mail is sent without approval.",
              urgency: "normal",
            });
            n.on("click", () => {
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.show();
                mainWindow.webContents.send("autopilot:trigger");
              } else {
                // Will be picked up on next launch via disk state
              }
            });
            n.show();
          }
        } catch { /* non-fatal */ }
      }
      schedulerState.active = false;
      schedulerTimer = null;
      // Mark disk as fired so status matches reality until renderer reschedules.
      try {
        ensureDirSync(path.dirname(SCHED_PATH));
        fs.writeFileSync(
          SCHED_PATH,
          JSON.stringify({ enabled: true, nextCycleDate: new Date(targetMs).toISOString(), fired: true, awaitingAck: true }, null, 2),
          "utf8"
        );
      } catch { /* non-fatal */ }
      return;
    }

    const remaining = targetMs - now;
    const delay = Math.min(Math.max(remaining, 1000), MAX_TIMER_MS);
    schedulerTimer = setTimeout(tick, delay);
  };

  schedulerState = {
    active: true,
    nextTriggerDate: new Date(targetMs).toISOString(),
    cycleIntervalMs: Math.max(0, targetMs - Date.now()),
  };
  tick();
}

function restoreSchedulerFromDisk() {
  try {
    if (!fs.existsSync(SCHED_PATH)) return;
    const sched = JSON.parse(fs.readFileSync(SCHED_PATH, "utf8"));
    if (!sched.enabled || !sched.nextCycleDate || sched.fired) return;
    const target = new Date(sched.nextCycleDate).getTime();
    if (Number.isNaN(target)) return;
    armScheduler(target);
  } catch {
    // Non-fatal
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: "Dylandos Ultimate Credit Repair Ultimate",
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    icon: path.join(__dirname, "icon.ico"),
    backgroundColor: "#0a0a0a",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      sandbox: true,
      allowRunningInsecureContent: false,
      devTools: isDev,
    },
  });

  Menu.setApplicationMenu(null);

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: "detach" });
  });

  // Harden external navigation — HTTPS only (never open dangerous schemes).
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const isAllowed = url.startsWith("file://") || url.startsWith("http://localhost") || url.startsWith("http://127.0.0.1");
    if (!isAllowed) {
      event.preventDefault();
      openExternalSafe(url);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: "deny" };
  });

  // Apex — close to tray (Quit from tray menu exits fully)
  mainWindow.on("close", (event) => {
    if (!isQuitting && process.platform === "win32" && tray) {
      event.preventDefault();
      mainWindow.hide();
      if (Notification.isSupported()) {
        new Notification({
          title: "DylandOs still running",
          body: "App minimized to tray. Use tray menu to Run Cycle, View Audit, or Quit.",
        }).show();
      }
    }
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    // ── PRODUCTION PATH RESOLVER ────────────────────────────────────────────
    // In a packaged Electron .exe, __dirname points to the asar-extracted
    // electron/ directory. We try several candidate paths in order so that
    // both dev-builds (dist/index.html relative to project root) and packaged
    // builds (resources/app/dist/index.html inside the ASAR) work correctly.
    const candidatePaths = [
      // Standard: electron/ sibling to dist/
      path.join(__dirname, "..", "dist", "index.html"),
      // Inside ASAR package (electron-builder default)
      path.join(process.resourcesPath || "", "app", "dist", "index.html"),
      // Alternative ASAR structure
      path.join(process.resourcesPath || "", "app.asar", "dist", "index.html"),
      // Same directory fallback
      path.join(__dirname, "dist", "index.html"),
    ];

    const resolvedPath = candidatePaths.find((p) => {
      try { return fs.existsSync(p); } catch { return false; }
    });

    if (resolvedPath) {
      mainWindow.loadFile(resolvedPath).catch((err) => {
        console.error("[main] loadFile failed:", resolvedPath, err);
        // Last resort: try loading from data URI to show an error page instead of black screen
        mainWindow.loadURL(
          `data:text/html,<h2 style="font-family:sans-serif;color:#c00;padding:2rem">` +
          `App failed to load.<br>Expected: ${resolvedPath}<br>Error: ${err.message}</h2>`
        );
      });
    } else {
      // None of the candidate paths exist — log all tried paths and show error page
      const tried = candidatePaths.join("<br>");
      console.error("[main] Could not find dist/index.html. Tried:", candidatePaths);
      mainWindow.loadURL(
        `data:text/html,<h2 style="font-family:sans-serif;color:#c00;padding:2rem">` +
        `App failed to load — dist/index.html not found.<br><small>Tried:<br>${tried}</small></h2>`
      );
    }
  }

  return mainWindow;
}

function setupOverdueCycleNotice() {
  try {
    if (!fs.existsSync(SCHED_PATH)) return;
    const sched = JSON.parse(fs.readFileSync(SCHED_PATH, "utf8"));
    if (!sched.enabled || !sched.nextCycleDate) return;

    const next = new Date(sched.nextCycleDate);
    if (Number.isNaN(next.getTime())) return;

    if (new Date() >= next) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("autopilot:cycle-overdue");
        }
        if (Notification.isSupported()) {
          new Notification({
            title: "AutoPilot Cycle Ready",
            body: "A scheduled dispute cycle is ready for review.",
          }).show();
        }
      }, 2000);
    }
  } catch {
    // Non-fatal
  }
}

app.whenReady().then(async () => {
  ensureDirSync(VAULT_BASE);
  ensureDirSync(path.join(VAULT_BASE, "audit"));
  ensureDirSync(path.join(VAULT_BASE, "_deleted"));
  ensureDirSync(path.join(USER_DATA, "autopilot"));
  ensureDirSync(path.join(USER_DATA, "logs"));

  createWindow();
  setupTray();
  setupOverdueCycleNotice();
  restoreSchedulerFromDisk();
}).catch((err) => {
  console.error("[main] Startup failed:", err);
  try {
    dialog.showErrorBox("Dylandos failed to start", String(err?.message || err));
  } catch { /* ignore */ }
  app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  if (process.platform === "darwin") return;
  // Keep process alive only when tray close-to-tray is active.
  if (tray && !isQuitting) return;
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// API keys
ipcMain.handle("store-api-key", async (_event, keyName, value) => {
  if (typeof keyName !== "string" || keyName.length > 64 || !/^[\w-]+$/.test(keyName)) {
    return { success: false, error: "Invalid key name" };
  }
  if (typeof value !== "string" || value.length > 2048) {
    return { success: false, error: "Invalid key value" };
  }

  try {
    const store = readEncryptedJson(KEY_STORE_PATH);
    store[keyName] = value;
    writeEncryptedJson(KEY_STORE_PATH, store);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle("get-api-key", async (_event, keyName) => {
  if (typeof keyName !== "string" || keyName.length > 64) return null;
  const store = readEncryptedJson(KEY_STORE_PATH);
  return store[keyName] ?? null;
});

ipcMain.handle("remove-api-key", async (_event, keyName) => {
  if (typeof keyName !== "string") return { success: false };
  const store = readEncryptedJson(KEY_STORE_PATH);
  delete store[keyName];
  writeEncryptedJson(KEY_STORE_PATH, store);
  return { success: true };
});

// File dialogs
ipcMain.handle("open-file-dialog", async (_event, options = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: options.properties ?? ["openFile"],
    filters: options.filters ?? [
      { name: "Credit Reports", extensions: ["pdf", "txt", "csv", "html", "htm"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });

  if (result.canceled) return [];
  for (const p of result.filePaths) {
    allowedReadPaths.add(path.resolve(p));
  }
  return result.filePaths;
});

ipcMain.handle("read-file-as-base64", async (_event, filePath) => {
  if (typeof filePath !== "string") return { success: false, error: "Invalid file path" };

  try {
    const resolved = path.resolve(filePath);
    if (resolved.startsWith("\\\\")) return { success: false, error: "UNC paths are blocked" };
    if (!allowedReadPaths.has(resolved)) {
      return { success: false, error: "Path not allowed. Select the file via the open dialog first." };
    }

    const stat = await fsp.stat(resolved);
    if (stat.size > 50 * 1024 * 1024) {
      return { success: false, error: "File too large (max 50MB)" };
    }

    const data = await fsp.readFile(resolved);
    return { success: true, base64: data.toString("base64") };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle("save-file", async (_event, options = {}) => {
  const defaultName = options.defaultName || options.defaultPath || options.filename || "dispute-letter.pdf";
  const data = options.data ?? options.content ?? options.textData ?? options.base64Data;
  const encoding = options.encoding || (options.base64Data ? "base64" : "utf8");

  const saveResult = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: options.filters ?? [
      { name: "PDF Files", extensions: ["pdf"] },
      { name: "Text Files", extensions: ["txt"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });

  if (saveResult.canceled || !saveResult.filePath) return { success: false };

  try {
    const buf = encoding === "base64"
      ? Buffer.from(String(data || ""), "base64")
      : Buffer.from(String(data || ""), "utf8");

    const tmp = `${saveResult.filePath}.tmp`;
    await fsp.writeFile(tmp, buf);
    await fsp.rename(tmp, saveResult.filePath);

    return { success: true, filePath: saveResult.filePath };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

// PDF generation with render-ready sentinel
// SECURITY: Never trust renderer-supplied outputPath — always use save dialog.
ipcMain.handle("print-to-pdf", async (_event, htmlContent, _ignoredOutputPath) => {
  return new Promise((resolve) => {
    let pdfWindow = null;
    const RENDER_TIMEOUT_MS = 15000;
    let timeoutHandle = null;
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (pdfWindow && !pdfWindow.isDestroyed()) pdfWindow.close();
      pdfWindow = null;
      resolve(result);
    };

    try {
      pdfWindow = new BrowserWindow({
        show: false,
        width: 816,
        height: 1056,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          javascript: true,
        },
      });

      const SENTINEL = "__dylandos_render_ready__";
      const wrappedHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<style>
  @page { size: letter; margin: 1in; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; }
  body { font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 1.6; color: #000; margin: 0; padding: 0; }
</style>
</head>
<body>
${htmlContent || ""}
<script>
  document.fonts.ready.then(function () {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        window.${SENTINEL} = true;
      });
    });
  });
</script>
</body>
</html>`;

      pdfWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(wrappedHtml)}`);

      timeoutHandle = setTimeout(() => {
        finish({ success: false, error: "PDF generation timed out after 15 seconds." });
      }, RENDER_TIMEOUT_MS);

      pdfWindow.webContents.on("did-finish-load", async () => {
        try {
          const sentinelReady = await pdfWindow.webContents.executeJavaScript(`
            new Promise((resolve) => {
              const start = Date.now();
              const check = () => {
                if (window.${SENTINEL} === true) resolve(true);
                else if (Date.now() - start > 5000) resolve(false);
                else requestAnimationFrame(check);
              };
              check();
            });
          `);

          if (!sentinelReady) {
            // Continue best-effort print
          }

          const pdfData = await pdfWindow.webContents.printToPDF({
            pageSize: "Letter",
            printBackground: false,
            landscape: false,
            marginsType: 0,
            preferCSSPageSize: true,
          });

          const saveResult = await dialog.showSaveDialog(mainWindow, {
            defaultPath: "dispute-letter.pdf",
            filters: [{ name: "PDF", extensions: ["pdf"] }],
          });

          if (saveResult.canceled || !saveResult.filePath) {
            finish({ success: false, reason: "canceled" });
            return;
          }

          await fsp.writeFile(saveResult.filePath, pdfData);
          finish({ success: true, filePath: saveResult.filePath });
        } catch (err) {
          finish({ success: false, error: `PDF generation failed: ${String(err)}` });
        }
      });

      pdfWindow.webContents.on("did-fail-load", (_e, code, desc) => {
        finish({ success: false, error: `PDF load failed: ${desc} (${code})` });
      });
    } catch (err) {
      finish({ success: false, error: `PDF setup failed: ${String(err)}` });
    }
  });
});

// Notifications
ipcMain.handle("show-notification", (_event, title, body) => {
  if (!Notification.isSupported()) return { success: false };
  new Notification({
    title: String(title || "Dylandos Credit Repair").substring(0, 100),
    body: String(body || "").substring(0, 300),
    icon: path.join(__dirname, "icon.ico"),
  }).show();
  return { success: true };
});

ipcMain.handle("get-app-version", () => app.getVersion());
ipcMain.handle("check-encryption", () => ({ dpapi: safeStorage.isEncryptionAvailable(), platform: process.platform }));

ipcMain.handle("open-external", (_event, url) => {
  if (!openExternalSafe(url)) {
    return { success: false, reason: "Only HTTPS URLs are allowed." };
  }
  return { success: true };
});

// Clipboard channels
ipcMain.handle("clipboard:readText", () => {
  try {
    return { success: true, text: sanitizePasteText(clipboard.readText("clipboard") || "") };
  } catch (err) {
    return { success: false, text: "", error: String(err) };
  }
});

ipcMain.handle("clipboard:readHTML", () => {
  try {
    const html = clipboard.readHTML() || "";
    const text = sanitizePasteText(
      html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<\/div>/gi, "\n")
        .replace(/<\/tr>/gi, "\n")
        .replace(/<\/td>/gi, "\t")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .trim()
    );
    return { success: true, text };
  } catch (err) {
    return { success: false, text: "", error: String(err) };
  }
});

ipcMain.handle("read-clipboard", () => {
  try {
    const text = sanitizePasteText(clipboard.readText("clipboard") || "");
    if (!text.trim()) return { success: false, text: "", error: "Clipboard is empty" };
    return { success: true, text };
  } catch (err) {
    return { success: false, text: "", error: String(err) };
  }
});

// Vault
ipcMain.handle("vault:getBasePath", () => VAULT_BASE);

ipcMain.handle("vault:writeFile", async (_event, relativePath, data) => {
  try {
    const fullPath = safeRelativePath(relativePath);
    await fsp.mkdir(path.dirname(fullPath), { recursive: true });

    const payload = Array.isArray(data)
      ? Buffer.from(data)
      : Buffer.isBuffer(data)
        ? data
        : typeof data === "string"
          ? Buffer.from(data, "utf8")
          : Buffer.from(data || []);

    const tmpPath = `${fullPath}.tmp`;
    await fsp.writeFile(tmpPath, payload);
    await fsp.rename(tmpPath, fullPath);

    return { success: true, filePath: fullPath };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle("vault:readFile", async (_event, relativePath) => {
  try {
    const fullPath = safeRelativePath(relativePath);
    const data = await fsp.readFile(fullPath);
    return Array.from(data);
  } catch {
    return null;
  }
});

ipcMain.handle("vault:listDirectory", async (_event, relativePath = "") => {
  try {
    const fullPath = safeRelativePath(relativePath || ".");
    const entries = await fsp.readdir(fullPath, { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory(),
      path: path.join(relativePath || "", e.name).replace(/\\/g, "/"),
    }));
  } catch {
    return [];
  }
});

ipcMain.handle("vault:deleteFile", async (_event, relativePath) => {
  try {
    const fullPath = safeRelativePath(relativePath);
    const deletedDir = path.join(VAULT_BASE, "_deleted");
    await fsp.mkdir(deletedDir, { recursive: true });
    const dest = path.join(deletedDir, `${Date.now()}_${path.basename(fullPath)}`);
    await fsp.rename(fullPath, dest);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle("vault:appendAuditLog", async (_event, entry) => {
  try {
    await fsp.mkdir(path.dirname(AUDIT_LOG_FILE), { recursive: true });
    await fsp.appendFile(AUDIT_LOG_FILE, `${String(entry)}\n`, "utf8");
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle("vault:createExportPackage", async (_event, profileId) => {
  try {
    if (typeof profileId !== "string" || !/^[\w-]+$/.test(profileId)) return null;

    const profileDir = path.join(VAULT_BASE, "profiles", profileId);
    const exportDir = path.join(profileDir, "export");
    await fsp.mkdir(exportDir, { recursive: true });

    const exportDate = new Date().toISOString().split("T")[0];
    const exportPath = path.join(exportDir, `${exportDate}_export.zip`);

    const zip = new AdmZip();
    for (const subDir of ["disputes", "responses", "timeline", "reports"]) {
      const dir = path.join(profileDir, subDir);
      if (fs.existsSync(dir)) zip.addLocalFolder(dir, subDir);
    }

    zip.writeZip(exportPath);
    return exportPath;
  } catch {
    return null;
  }
});

ipcMain.handle("vault:getMasterKey", async () => {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      return { success: false, error: "OS encryption unavailable. Vault master key cannot be stored securely." };
    }
    if (fs.existsSync(VAULT_MASTER_KEY_FILE)) {
      const raw = fs.readFileSync(VAULT_MASTER_KEY_FILE);
      const keyHex = safeStorage.decryptString(raw);
      return { success: true, keyHex };
    }

    const keyHex = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(VAULT_MASTER_KEY_FILE, safeStorage.encryptString(keyHex));
    return { success: true, keyHex };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

// SSN secure storage
ipcMain.handle("secure:storeSSN", async (_event, profileId, encryptedSSN) => {
  if (!profileId || typeof profileId !== "string" || !/^[\w-]+$/.test(profileId)) {
    return { success: false, error: "Invalid profileId" };
  }
  try {
    const store = readEncryptedJson(SSN_STORE_PATH);
    store[profileId] = encryptedSSN;
    writeEncryptedJson(SSN_STORE_PATH, store);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle("secure:getSSN", async (_event, profileId) => {
  if (!profileId || typeof profileId !== "string") return { success: false, encryptedSSN: null };
  const store = readEncryptedJson(SSN_STORE_PATH);
  return { success: true, encryptedSSN: store[profileId] ?? null };
});

ipcMain.handle("secure:clearSSN", async (_event, profileId) => {
  if (!profileId || typeof profileId !== "string") return { success: false };
  try {
    const store = readEncryptedJson(SSN_STORE_PATH);
    delete store[profileId];
    writeEncryptedJson(SSN_STORE_PATH, store);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

// AutoPilot scheduler — overflow-safe chunked timers + disk persistence
ipcMain.handle("autopilot:schedule", async (_event, settings = {}) => {
  const now = Date.now();
  const target = settings.nextCycleDate
    ? new Date(settings.nextCycleDate).getTime()
    : now + ((settings.cycleIntervalDays || 32) * DAY_MS);

  if (!Number.isFinite(target)) {
    return { success: false, error: "Invalid nextCycleDate" };
  }

  ensureDirSync(path.dirname(SCHED_PATH));
  fs.writeFileSync(
    SCHED_PATH,
    JSON.stringify({ enabled: true, nextCycleDate: new Date(target).toISOString(), fired: false }, null, 2),
    "utf8"
  );

  armScheduler(target);

  return { success: true, scheduledFor: schedulerState.nextTriggerDate };
});

ipcMain.handle("autopilot:cancel", async () => {
  clearSchedulerTimer();
  schedulerState = { active: false, nextTriggerDate: null, cycleIntervalMs: null };

  ensureDirSync(path.dirname(SCHED_PATH));
  fs.writeFileSync(SCHED_PATH, JSON.stringify({ enabled: false }, null, 2), "utf8");
  return { success: true };
});

ipcMain.handle("autopilot:status", async () => ({ success: true, ...schedulerState }));

// Apex — tray status badge/tooltip
ipcMain.handle("tray:updateStatus", async (_event, info = {}) => {
  updateTrayTooltip(info || {});
  return { success: true };
});

// Apex — multi-monitor letter review
ipcMain.handle("window:openLetterReview", async (_event, htmlContent) => {
  try {
    const secondary = pickSecondaryDisplay();
    const workArea = secondary
      ? secondary.workArea
      : (screen.getPrimaryDisplay()?.workArea || { x: 80, y: 80, width: 1100, height: 800 });

    if (letterReviewWindow && !letterReviewWindow.isDestroyed()) {
      letterReviewWindow.close();
    }

    letterReviewWindow = new BrowserWindow({
      title: "DylandOs Letter Review",
      x: workArea.x + 40,
      y: workArea.y + 40,
      width: Math.min(1100, workArea.width - 80),
      height: Math.min(900, workArea.height - 80),
      backgroundColor: "#0a0a0a",
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    const safeHtml = String(htmlContent || "").replace(/<\/script/gi, "<\\/script");
    const page = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Letter Review</title>
<style>body{margin:0;background:#0a0a0a;color:#e5e5e5;font-family:Segoe UI,sans-serif}
.wrap{padding:24px;max-width:900px;margin:0 auto;line-height:1.5}</style></head>
<body><div class="wrap">${safeHtml}</div></body></html>`;

    await letterReviewWindow.loadURL(
      "data:text/html;charset=utf-8," + encodeURIComponent(page)
    );
    letterReviewWindow.show();
    return {
      success: true,
      multiMonitor: !!secondary,
      displayId: secondary?.id ?? screen.getPrimaryDisplay()?.id ?? null,
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle("window:getDisplayInfo", async () => {
  const displays = screen.getAllDisplays().map((d) => ({
    id: d.id,
    bounds: d.bounds,
    workArea: d.workArea,
    primary: d.id === screen.getPrimaryDisplay().id,
  }));
  return { success: true, count: displays.length, displays };
});

