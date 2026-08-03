import React, { useEffect, useRef, useState } from "react";
import {
  Settings,
  Download,
  Upload,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Palette,
  Database,
  RefreshCw,
  Key,
  Eye,
  EyeOff,
  Wifi,
  WifiOff,
  Zap,
  Shield,
  Calendar,
  Activity,
  Siren,
  Lock,
  Archive,
  Bot,
  BrainCircuit,
  Mail,
  Send,
  Smartphone,
  ExternalLink,
} from "lucide-react";
import { APP_VERSION, AppTheme, useAppContext } from "../context/AppContext";
import {
  getGroqApiKey, setGroqApiKey, getGroqApiKey2, setGroqApiKey2,
  getGeminiApiKey, setGeminiApiKey, getGeminiApiKey2, setGeminiApiKey2,
  getOpenAIApiKey, setOpenAIApiKey, OPENAI_DEFAULT_MODEL,
  getCloudflareApiKey, setCloudflareApiKey, getCloudflareAccountId, setCloudflareAccountId,
  getAIProviderMode, setAIProviderMode, type AIProviderMode,
  GROQ_MODEL_CHAIN, GEMINI_MODEL_CHAIN,
} from "../services/aiRouter";
import type { MailDeliveryProvider } from "../types";
import { getMailProviderApiKey, setMailProviderApiKey } from "../services/mailDeliveryService";
import {
  checkForAndroidUpdate,
  isAndroidPlatform,
  openAndroidUpdateUrl,
} from "../services/androidUpdateService";

const THEMES: Array<{
  id: AppTheme;
  name: string;
  colors: [string, string, string];
  description: string;
}> = [
  { id: "inferno", name: "INFERNO", colors: ["#ff2d78", "#ff9900", "#87ceeb"], description: "Neon hot pink + lambo orange + smoke-steel blue text" },
  { id: "cyber", name: "CYBER", colors: ["#ff00ff", "#ff9900", "#00ffff"], description: "Original DYLANDOS cyberpunk palette" },
  { id: "stealth", name: "STEALTH", colors: ["#5eead4", "#7dd3fc", "#9cb3c5"], description: "Cold tactical slate and cyan" },
  { id: "venom", name: "VENOM", colors: ["#9d00ff", "#00ff88", "#e0e0ff"], description: "Electric violet + toxic green" },
  { id: "arctic", name: "ARCTIC", colors: ["#58a6ff", "#3fb950", "#c9d1d9"], description: "Pro-grade navy and clean contrast" },
];

const PROVIDER_MODE_STORAGE_KEY = 'dylandos_ai_provider_mode';
const PROVIDER_MODE_MIGRATION_BANNER_KEY = 'dylandos_ai_provider_mode_migration_banner_shown';

function KeyStatusPill({ configured, label }: { configured: boolean; label?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border ${
        configured
          ? 'text-[#00ff00] border-[#00ff00]/40 bg-[#00ff00]/5'
          : 'text-yellow-500 border-yellow-500/40 bg-yellow-500/5'
      }`}
    >
      {configured ? <Wifi size={10} /> : <WifiOff size={10} />}
      {label ?? (configured ? 'Configured' : 'Not configured')}
    </span>
  );
}

function APIStatusAdvice({ message }: { message: string }) {
  const normalized = message.toLowerCase();
  if (normalized.includes('429') || normalized.includes('rate-limited') || normalized.includes('quota')) {
    return <p className="mt-1 text-[10px] leading-relaxed text-amber-300">HTTP 429 means the key/project has temporarily reached a request limit or quota. AutoPilot keeps the failed letter in Recovery for safe resubmission; wait for the provider window to reset or use another configured provider.</p>;
  }
  if (normalized.includes('400')) {
    return <p className="mt-1 text-[10px] leading-relaxed text-amber-300">HTTP 400 is a provider request/model issue, not proof that your key is bad. The app now tests current Gemini 2.5 models; save the key and test again.</p>;
  }
  if (normalized.includes('401') || normalized.includes('403') || normalized.includes('rejected')) {
    return <p className="mt-1 text-[10px] leading-relaxed text-red-300">This key was rejected. Create or copy a key from the provider dashboard, then save it here.</p>;
  }
  return null;
}

export function SettingsPage() {
  const {
    exportAllData,
    importAllData,
    clearData,
    clearNegativeItems,
    theme,
    setTheme,
    autopilot,
    updateAutopilot,
    vaultEncryptionReady,
  } = useAppContext();

  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmParserReset, setConfirmParserReset] = useState(false);
  const [parserResetDone, setParserResetDone] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importSuccess, setImportSuccess] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [groqKeyInput, setGroqKeyInput] = useState(() => getGroqApiKey());
  const [groqKey2Input, setGroqKey2Input] = useState(() => getGroqApiKey2());
  const [showKey, setShowKey] = useState(false);
  const [showKey2, setShowKey2] = useState(false);
  const [keySaveStatus, setKeySaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const [keyTestStatus, setKeyTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [keyTestMsg, setKeyTestMsg] = useState("");

  const [geminiKeyInput, setGeminiKeyInput] = useState(() => getGeminiApiKey());
  const [geminiKey2Input, setGeminiKey2Input] = useState(() => getGeminiApiKey2());
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showGeminiKey2, setShowGeminiKey2] = useState(false);
  const [geminiSaveStatus, setGeminiSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const [geminiTestStatus, setGeminiTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [geminiTestMsg, setGeminiTestMsg] = useState("");

  const [openAIKeyInput, setOpenAIKeyInput] = useState(() => getOpenAIApiKey());
  const [showOpenAIKey, setShowOpenAIKey] = useState(false);
  const [openAISaveStatus, setOpenAISaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const [openAITestStatus, setOpenAITestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [openAITestMsg, setOpenAITestMsg] = useState("");
  const [cloudflareTokenInput, setCloudflareTokenInput] = useState(() => getCloudflareApiKey());
  const [cloudflareAccountInput, setCloudflareAccountInput] = useState(() => getCloudflareAccountId());
  const [cloudflareStatus, setCloudflareStatus] = useState<"idle" | "saved">("idle");
  const [providerMode, setProviderModeState] = useState<AIProviderMode>(() => getAIProviderMode());
  const [showModeMigrationBanner, setShowModeMigrationBanner] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PROVIDER_MODE_STORAGE_KEY);
      if (raw === 'quality-first') {
        setAIProviderMode('backup-quality');
        setProviderModeState('backup-quality');
        if (!localStorage.getItem(PROVIDER_MODE_MIGRATION_BANNER_KEY)) {
          setShowModeMigrationBanner(true);
          localStorage.setItem(PROVIDER_MODE_MIGRATION_BANNER_KEY, '1');
        }
      }
    } catch {
      /* non-critical */
    }
  }, []);

  const [mailKeys, setMailKeys] = useState<Record<Exclude<MailDeliveryProvider, "manual">, string>>({
    lob: "",
    postgrid: "",
    stannp: "",
  });
  const [mailKeysVisible, setMailKeysVisible] = useState(false);
  const [mailSaveStatus, setMailSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const [updateFeedUrlInput, setUpdateFeedUrlInput] = useState(autopilot.androidUpdateManifestUrl || "");
  const [updateFeedSaveStatus, setUpdateFeedSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const [updateCheckStatus, setUpdateCheckStatus] = useState<"idle" | "checking" | "ok" | "fail">("idle");
  const [updateCheckMessage, setUpdateCheckMessage] = useState("");
  const [availableApkUrl, setAvailableApkUrl] = useState<string | null>(null);

  useEffect(() => {
    setUpdateFeedUrlInput(autopilot.androidUpdateManifestUrl || "");
  }, [autopilot.androidUpdateManifestUrl]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [lob, postgrid, stannp] = await Promise.all([
        getMailProviderApiKey("lob"),
        getMailProviderApiKey("postgrid"),
        getMailProviderApiKey("stannp"),
      ]);

      if (cancelled) return;
      setMailKeys({ lob, postgrid, stannp });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSaveKey = () => {
    if (!groqKeyInput.trim() && !groqKey2Input.trim()) {
      setKeySaveStatus("error");
      setTimeout(() => setKeySaveStatus("idle"), 2000);
      return;
    }
    setGroqApiKey(groqKeyInput.trim());
    setGroqApiKey2(groqKey2Input.trim());
    setKeySaveStatus("saved");
    setTimeout(() => setKeySaveStatus("idle"), 2500);
  };

  const handleTestKey = async () => {
    setKeyTestStatus("testing");
    setKeyTestMsg("");
    try {
      const configuredKeys = [groqKeyInput.trim() || getGroqApiKey(), groqKey2Input.trim() || getGroqApiKey2()]
        .filter((key, index, all) => Boolean(key) && all.indexOf(key) === index);
      if (!configuredKeys.length) {
        setKeyTestStatus("fail");
        setKeyTestMsg("No API key entered.");
        setTimeout(() => setKeyTestStatus("idle"), 4000);
        return;
      }
      const attempts = await Promise.allSettled(configuredKeys.map(async (key, index) => {
        let lastErr = "";
        for (const model of GROQ_MODEL_CHAIN) {
          const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
            body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 8 }),
          });
          if (res.ok) return `Key ${index + 1}: ready (${model})`;
          const errText = await res.text().catch(() => "");
          lastErr = res.status === 401 || res.status === 403
            ? `HTTP ${res.status} — rejected`
            : `HTTP ${res.status}${errText ? ` — ${errText.slice(0, 100)}` : ""}`;
          if (![400, 404].includes(res.status)) break;
        }
        throw new Error(`Key ${index + 1}: ${lastErr || 'test failed'}`);
      }));
      const results = attempts.map(result => result.status === 'fulfilled' ? result.value : result.reason?.message || 'Key test failed');
      setKeyTestStatus(attempts.every(result => result.status === 'fulfilled') ? "ok" : "fail");
      setKeyTestMsg(results.join(" • "));
    } catch (e: any) {
      setKeyTestStatus("fail");
      setKeyTestMsg(e.message || "One or more Groq keys failed their test.");
    }
    setTimeout(() => setKeyTestStatus("idle"), 5000);
  };

  const handleSaveGeminiKey = () => {
    if (!geminiKeyInput.trim() && !geminiKey2Input.trim()) { setGeminiSaveStatus("error"); setTimeout(() => setGeminiSaveStatus("idle"), 2000); return; }
    setGeminiApiKey(geminiKeyInput.trim());
    setGeminiApiKey2(geminiKey2Input.trim());
    setGeminiSaveStatus("saved");
    setTimeout(() => setGeminiSaveStatus("idle"), 2500);
  };

  const handleTestGeminiKey = async () => {
    setGeminiTestStatus("testing");
    setGeminiTestMsg("");
    try {
      const configuredKeys = [geminiKeyInput.trim() || getGeminiApiKey(), geminiKey2Input.trim() || getGeminiApiKey2()]
        .filter((key, index, all) => Boolean(key) && all.indexOf(key) === index);
      if (!configuredKeys.length) { setGeminiTestStatus("fail"); setGeminiTestMsg("No API key entered."); setTimeout(() => setGeminiTestStatus("idle"), 4000); return; }

      const attempts = await Promise.allSettled(configuredKeys.map(async (key, index) => {
        let lastErr = "";
        for (const model of GEMINI_MODEL_CHAIN) {
          // Native REST endpoint test
          const nativeRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "ping" }] }] }),
          });
          if (nativeRes.ok) return `Key ${index + 1}: ready (${model})`;
          if (nativeRes.status === 429) {
            const detail = await nativeRes.text().catch(() => "");
            throw new Error(`Key ${index + 1}: rate-limited or project quota exhausted (HTTP 429)${detail ? ` — ${detail.slice(0, 100)}` : ''}`);
          }
          
          // OpenAI endpoint fallback test
          const res = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
            body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }] }),
          });
          if (res.ok) return `Key ${index + 1}: ready (${model})`;
          const data = await res.json().catch(() => ({}));
          lastErr = res.status === 429
            ? 'rate-limited or project quota exhausted (HTTP 429)'
            : res.status === 401 || res.status === 403
              ? `HTTP ${res.status} — rejected`
              : data?.error?.message || `HTTP ${res.status}`;
          if (![400, 404].includes(res.status)) break;
        }
        throw new Error(`Key ${index + 1}: ${lastErr || 'test failed'}`);
      }));
      const results = attempts.map(result => result.status === 'fulfilled' ? result.value : result.reason?.message || 'Key test failed');
      setGeminiTestStatus(attempts.every(result => result.status === 'fulfilled') ? "ok" : "fail");
      setGeminiTestMsg(results.join(" • "));
    } catch (e: any) { setGeminiTestStatus("fail"); setGeminiTestMsg(e.message || "One or more Gemini keys failed their test."); }
    setTimeout(() => setGeminiTestStatus("idle"), 5000);
  };

  const handleSaveOpenAIKey = () => {
    if (!openAIKeyInput.trim()) { setOpenAISaveStatus("error"); setTimeout(() => setOpenAISaveStatus("idle"), 2000); return; }
    setOpenAIApiKey(openAIKeyInput.trim());
    setOpenAISaveStatus("saved");
    setTimeout(() => setOpenAISaveStatus("idle"), 2500);
  };

  const handleTestOpenAIKey = async () => {
    setOpenAITestStatus("testing");
    setOpenAITestMsg("");
    try {
      const key = openAIKeyInput.trim() || getOpenAIApiKey();
      if (!key) { setOpenAITestStatus("fail"); setOpenAITestMsg("No API key entered."); setTimeout(() => setOpenAITestStatus("idle"), 4000); return; }

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: OPENAI_DEFAULT_MODEL, messages: [{ role: "user", content: "Reply with OK" }], max_tokens: 16 }),
      });
      if (res.ok) {
        setOpenAITestStatus("ok");
        setOpenAITestMsg(`Connected. OpenAI ready (${OPENAI_DEFAULT_MODEL}).`);
      } else {
        const lastOrErr = await res.text().catch(() => "");
        setOpenAITestStatus("fail");
        if (res.status === 429 && /quota|billing|exceeded/i.test(lastOrErr)) {
          setOpenAITestMsg("OpenAI API quota unavailable (HTTP 429). A ChatGPT Free/Plus subscription does not include API credits; add API billing/credits at platform.openai.com or leave OpenAI as an optional backup.");
        } else {
          setOpenAITestMsg(`OpenAI test failed: HTTP ${res.status} ${lastOrErr.slice(0, 120)}`);
        }
      }
    } catch (e: any) { setOpenAITestStatus("fail"); setOpenAITestMsg(e.message || "Connection failed."); }
    setTimeout(() => setOpenAITestStatus("idle"), 5000);
  };

  const handleSaveCloudflare = () => {
    setCloudflareApiKey(cloudflareTokenInput);
    setCloudflareAccountId(cloudflareAccountInput);
    setCloudflareStatus('saved');
    setTimeout(() => setCloudflareStatus('idle'), 2500);
  };

  const handleSaveMailKeys = async () => {
    try {
      await Promise.all([
        setMailProviderApiKey("lob", mailKeys.lob),
        setMailProviderApiKey("postgrid", mailKeys.postgrid),
        setMailProviderApiKey("stannp", mailKeys.stannp),
      ]);
      setMailSaveStatus("saved");
    } catch {
      setMailSaveStatus("error");
    }

    setTimeout(() => setMailSaveStatus("idle"), 3000);
  };

  const handleSaveUpdateFeed = () => {
    const nextUrl = updateFeedUrlInput.trim();
    if (!nextUrl) {
      setUpdateFeedSaveStatus("error");
      setTimeout(() => setUpdateFeedSaveStatus("idle"), 2000);
      return;
    }

    updateAutopilot({ androidUpdateManifestUrl: nextUrl });
    setUpdateFeedSaveStatus("saved");
    setTimeout(() => setUpdateFeedSaveStatus("idle"), 2500);
  };

  const handleCheckAndroidUpdate = async () => {
    const sourceUrl = updateFeedUrlInput.trim() || (autopilot.androidUpdateManifestUrl || "").trim();
    if (!sourceUrl) {
      setUpdateCheckStatus("fail");
      setUpdateCheckMessage("Add a Gist raw JSON URL first.");
      setTimeout(() => setUpdateCheckStatus("idle"), 3500);
      return;
    }

    setUpdateCheckStatus("checking");
    setUpdateCheckMessage("");
    setAvailableApkUrl(null);

    try {
      const result = await checkForAndroidUpdate(
        sourceUrl,
        APP_VERSION,
        autopilot.androidUpdateChannel,
      );
      const checkedAt = new Date().toISOString();
      updateAutopilot({
        androidUpdateManifestUrl: sourceUrl,
        androidUpdateLastCheckedAt: checkedAt,
      });

      if (result.updateAvailable) {
        setUpdateCheckStatus("ok");
        setUpdateCheckMessage(`Update available: v${result.manifest.latestVersion}`);
        setAvailableApkUrl(result.manifest.apkUrl);
      } else {
        setUpdateCheckStatus("ok");
        setUpdateCheckMessage(`You are up to date on v${APP_VERSION}.`);
      }
    } catch (error: any) {
      setUpdateCheckStatus("fail");
      setUpdateCheckMessage(error?.message || "Update check failed.");
    }

    setTimeout(() => setUpdateCheckStatus("idle"), 6000);
  };

  const handleExport = async () => {
    const data = await exportAllData();
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dylandos-ultimate-backup-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportError(null);
    setImportSuccess(false);
    try {
      const text = await file.text();
      await importAllData(text);
      setImportSuccess(true);
      setTimeout(() => setImportSuccess(false), 3000);
    } catch (err: any) {
      setImportError(err.message || "Invalid backup file.");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <Settings className="text-[#00ffff]" /> SETTINGS
        </h2>
        <p className="text-zinc-400 font-mono text-xs mt-1">DYLANDO ULTIMATE CREDIT REPAIR SUITE v{APP_VERSION}</p>
      </div>

      <div className="cyber-panel p-6">
        <h3 className="text-sm font-bold text-zinc-300 mb-4 font-mono flex items-center gap-2"><Palette size={14} /> THEME COMMAND</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {THEMES.map((item) => (
            <button
              key={item.id}
              onClick={() => setTheme(item.id)}
              className={`text-left rounded-lg border p-3 transition-all ${theme === item.id ? "border-[#00ffff] bg-[#00ffff]/5" : "border-zinc-800 hover:border-zinc-700"}`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className={`text-xs font-bold font-mono ${theme === item.id ? "text-[#00ffff]" : "text-zinc-300"}`}>{item.name}</span>
                {theme === item.id && <CheckCircle2 size={12} className="text-[#00ff00]" />}
              </div>
              <div className="flex gap-1.5 mb-2">
                {item.colors.map((color, colorIdx) => (
                  <span
                    key={colorIdx}
                    className="w-4 h-4 rounded-full border border-black/40"
                    data-color={color}
                    style={{ backgroundColor: color } as React.CSSProperties}
                  />
                ))}
              </div>
              <p className="text-[10px] text-zinc-500 font-mono leading-snug">{item.description}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="cyber-panel p-6">
        <h3 className="text-sm font-bold text-zinc-300 mb-4 font-mono flex items-center gap-2"><Zap size={14} /> AUTOPILOT INTEL SWITCHES</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] font-mono">
          <ToggleRow label="Smart Follow-Up" icon={<Activity size={12} />} enabled={autopilot.smartFollowUp} onClick={() => updateAutopilot({ smartFollowUp: !autopilot.smartFollowUp })} />
          <ToggleRow label="Dispute Calendar" icon={<Calendar size={12} />} enabled={autopilot.showDisputeCalendar} onClick={() => updateAutopilot({ showDisputeCalendar: !autopilot.showDisputeCalendar })} />
          <ToggleRow label="Goodwill Post-Win" icon={<Shield size={12} />} enabled={autopilot.goodwillPostWin} onClick={() => updateAutopilot({ goodwillPostWin: !autopilot.goodwillPostWin })} />
          <ToggleRow label="Fatigue Detection" icon={<Siren size={12} />} enabled={autopilot.fatigueDetect} onClick={() => updateAutopilot({ fatigueDetect: !autopilot.fatigueDetect })} />
          <ToggleRow label="SOL Calendar" icon={<Calendar size={12} />} enabled={autopilot.showSOLCalendar} onClick={() => updateAutopilot({ showSOLCalendar: !autopilot.showSOLCalendar })} />
          <ToggleRow label="CFPB Auto-Escalate" icon={<AlertTriangle size={12} />} enabled={autopilot.cfpbAutoEscalate} onClick={() => updateAutopilot({ cfpbAutoEscalate: !autopilot.cfpbAutoEscalate })} />
        </div>
      </div>

      <div className="cyber-panel p-6">
        <h3 className="text-sm font-bold text-zinc-300 mb-4 font-mono flex items-center gap-2"><Mail size={14} /> MAIL DELIVERY + DIGEST AUTOMATION</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] font-mono mb-4">
          <ToggleRow
            label="Auto-Mail On Letter Generation"
            icon={<Send size={12} />}
            enabled={autopilot.autoMailOnGeneration}
            onClick={() => updateAutopilot({ autoMailOnGeneration: !autopilot.autoMailOnGeneration })}
          />
          <ToggleRow
            label="Weekly Intelligence Digest"
            icon={<Bot size={12} />}
            enabled={autopilot.weeklyDigestEnabled}
            onClick={() => updateAutopilot({ weeklyDigestEnabled: !autopilot.weeklyDigestEnabled })}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          <div>
            <div className="text-[10px] font-mono text-zinc-500 mb-1">DEFAULT MAIL PROVIDER</div>
            <select
              value={autopilot.mailDeliveryProvider}
              onChange={(e) => updateAutopilot({ mailDeliveryProvider: e.target.value as MailDeliveryProvider })}
              title="Select default mail delivery provider"
              aria-label="Default mail delivery provider"
              className="w-full bg-black/60 border border-zinc-700 rounded px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-[#00ffff]"
            >
              <option value="manual">Manual (Print + Mail)</option>
              <option value="lob">Lob API</option>
              <option value="postgrid">PostGrid API</option>
              <option value="stannp">Stannp API</option>
            </select>
          </div>
          <div>
            <div className="text-[10px] font-mono text-zinc-500 mb-1">DIGEST CADENCE</div>
            <select
              value={autopilot.digestCadence}
              onChange={(e) => updateAutopilot({ digestCadence: e.target.value as "daily" | "weekly" })}
              title="Select digest cadence"
              aria-label="Digest cadence"
              className="w-full bg-black/60 border border-zinc-700 rounded px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-[#00ffff]"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>
        </div>

        <div className="border border-zinc-800 rounded-lg p-4 space-y-3 bg-black/30">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-zinc-300 font-mono">PRINT-TO-MAIL API KEYS</span>
            <button
              type="button"
              onClick={() => setMailKeysVisible((v) => !v)}
              className="text-zinc-500 hover:text-zinc-300"
            >
              {mailKeysVisible ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>

          {(["lob", "postgrid", "stannp"] as const).map((provider) => (
            <div key={provider}>
              <div className="text-[10px] font-mono text-zinc-500 mb-1">{provider.toUpperCase()} KEY</div>
              <input
                type={mailKeysVisible ? "text" : "password"}
                value={mailKeys[provider]}
                onChange={(e) => setMailKeys((prev) => ({ ...prev, [provider]: e.target.value }))}
                placeholder={`${provider}-api-key`}
                className="w-full bg-black/60 border border-zinc-700 rounded px-3 py-2 text-sm font-mono text-white placeholder:text-zinc-700 focus:outline-none focus:border-[#00ffff]"
              />
            </div>
          ))}

          <button
            onClick={handleSaveMailKeys}
            className={`cyber-button px-4 py-2 text-xs font-bold ${
              mailSaveStatus === "saved"
                ? "border-[#00ff00] text-[#00ff00] bg-[#00ff00]/10"
                : mailSaveStatus === "error"
                  ? "border-red-500 text-red-400"
                  : "border-[#00ffff] text-[#00ffff] hover:bg-[#00ffff]/10"
            }`}
          >
            {mailSaveStatus === "saved" ? "SAVED" : mailSaveStatus === "error" ? "SAVE FAILED" : "SAVE MAIL KEYS"}
          </button>
        </div>
      </div>

      <div className="cyber-panel p-6">
        <h3 className="text-sm font-bold text-zinc-300 mb-2 font-mono flex items-center gap-2"><Smartphone size={14} /> ANDROID UPDATE FEED (GIST)</h3>
        <p className="text-xs text-zinc-500 font-mono mb-4">
          Use a public raw Gist JSON manifest. Update only the apkUrl in your Gist to ship a new build link without publishing a full app update.
        </p>

        {!isAndroidPlatform() && (
          <div className="mb-4 rounded border border-yellow-500/30 bg-yellow-500/5 p-3 text-[11px] font-mono text-yellow-300">
            Running on non-Android platform. Feed checks still work here for validation, but APK install opens in external browser.
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] font-mono mb-4">
          <ToggleRow
            label="Auto-Check On App Start"
            icon={<RefreshCw size={12} />}
            enabled={autopilot.androidUpdateAutoCheck}
            onClick={() => updateAutopilot({ androidUpdateAutoCheck: !autopilot.androidUpdateAutoCheck })}
          />
          <div>
            <div className="text-[10px] font-mono text-zinc-500 mb-1">UPDATE CHANNEL</div>
            <select
              value={autopilot.androidUpdateChannel}
              onChange={(event) => updateAutopilot({ androidUpdateChannel: event.target.value as "stable" | "beta" })}
              className="w-full bg-black/60 border border-zinc-700 rounded px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-[#00ffff]"
              title="Select Android update channel"
              aria-label="Select Android update channel"
            >
              <option value="stable">Stable</option>
              <option value="beta">Beta</option>
            </select>
          </div>
        </div>

        <div className="space-y-2 mb-4">
          <div className="text-[10px] font-mono text-zinc-500">GIST RAW MANIFEST URL</div>
          <input
            type="url"
            value={updateFeedUrlInput}
            onChange={(event) => setUpdateFeedUrlInput(event.target.value)}
            placeholder="https://gist.githubusercontent.com/.../raw/dylandos-android-update.json"
            className="w-full bg-black/60 border border-zinc-700 rounded px-3 py-2 text-sm font-mono text-white placeholder:text-zinc-700 focus:outline-none focus:border-[#00ffff]"
          />
          <div className="text-[10px] text-zinc-600 font-mono">
            Last checked: {autopilot.androidUpdateLastCheckedAt ? new Date(autopilot.androidUpdateLastCheckedAt).toLocaleString() : "never"}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleSaveUpdateFeed}
            className={`cyber-button px-3 py-1.5 text-xs font-bold ${
              updateFeedSaveStatus === "saved"
                ? "border-[#00ff00] text-[#00ff00]"
                : updateFeedSaveStatus === "error"
                  ? "border-red-500 text-red-400"
                  : "border-[#00ffff] text-[#00ffff] hover:bg-[#00ffff]/10"
            }`}
          >
            {updateFeedSaveStatus === "saved" ? "FEED SAVED" : updateFeedSaveStatus === "error" ? "URL REQUIRED" : "SAVE FEED URL"}
          </button>
          <button
            onClick={handleCheckAndroidUpdate}
            className="cyber-button px-3 py-1.5 text-xs font-bold border-[#ff9900] text-[#ff9900] hover:bg-[#ff9900]/10"
            disabled={updateCheckStatus === "checking"}
          >
            {updateCheckStatus === "checking" ? "CHECKING..." : "CHECK NOW"}
          </button>
          {availableApkUrl && (
            <button
              onClick={() => openAndroidUpdateUrl(availableApkUrl)}
              className="cyber-button px-3 py-1.5 text-xs font-bold border-[#00ff00] text-[#00ff00] hover:bg-[#00ff00]/10 flex items-center gap-1"
            >
              <ExternalLink size={12} /> OPEN DOWNLOAD
            </button>
          )}
          {updateCheckMessage && (
            <span className={`text-xs font-mono self-center ${updateCheckStatus === "fail" ? "text-red-400" : "text-zinc-300"}`}>
              {updateCheckMessage}
            </span>
          )}
        </div>
      </div>

      <div className="cyber-panel p-6">
        <h3 className="text-sm font-bold text-zinc-300 mb-4 font-mono flex items-center gap-2"><Database size={14} /> DATA BACKUP & RESTORE</h3>
        <div className="space-y-4">
          <div className="flex items-start gap-4">
            <div className="flex-1">
              <div className="text-sm font-bold text-white">Export All Data</div>
              <div className="text-xs text-zinc-500 mt-0.5">Download full encrypted-state backup JSON.</div>
            </div>
            <button onClick={handleExport} className="cyber-button border-[#00ff00] text-[#00ff00] hover:bg-[#00ff00]/10 px-4 py-2 flex items-center gap-2 text-sm font-bold shrink-0">
              <Download size={16} /> EXPORT
            </button>
          </div>

          <div className="border-t border-zinc-800 pt-4 flex items-start gap-4">
            <div className="flex-1">
              <div className="text-sm font-bold text-white">Restore from Backup</div>
              <div className="text-xs text-zinc-500 mt-0.5">Restore from .json and overwrite current state.</div>
              {importSuccess && <div className="text-xs text-[#00ff00] mt-1 flex items-center gap-1"><CheckCircle2 size={12} /> Restored successfully.</div>}
              {importError && <div className="text-xs text-red-400 mt-1 flex items-center gap-1"><AlertTriangle size={12} /> {importError}</div>}
            </div>
            <div>
              <input ref={fileRef} type="file" accept=".json" onChange={handleImport} className="hidden" id="import-file" />
              <label htmlFor="import-file" className={`cyber-button border-[#ff9900] text-[#ff9900] hover:bg-[#ff9900]/10 px-4 py-2 flex items-center gap-2 text-sm font-bold cursor-pointer shrink-0 ${importing ? "opacity-50 pointer-events-none" : ""}`}>
                {importing ? <RefreshCw size={16} className="animate-spin" /> : <Upload size={16} />}
                {importing ? "LOADING..." : "RESTORE"}
              </label>
            </div>
          </div>
        </div>
      </div>

      <div className="cyber-panel p-6">
        <h3 className="text-sm font-bold text-zinc-300 mb-1 font-mono flex items-center gap-2"><Key size={14} /> AI CONFIGURATION — VERIFIED PROVIDER ROUTING</h3>
        <p className="text-xs text-zinc-600 font-mono mb-4">
          Autopilot dispute letters use <span className="text-[#00ffff]">Groq×2</span> and <span className="text-[#ff9900]">Gemini</span> only — never OpenAI first. If both primary providers are rate-limited, letter jobs wait and resume automatically. Backup providers (OpenAI, Cloudflare) serve non-letter tools per your routing mode below.
        </p>
        <div className="mb-5">
          <label className="block text-[10px] font-bold text-zinc-500 font-mono mb-1">PROVIDER MODE</label>
          <select
            value={providerMode}
            onChange={(event) => { const mode = event.target.value as AIProviderMode; setProviderModeState(mode); setAIProviderMode(mode); }}
            className="w-full bg-black/60 border border-zinc-700 rounded px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-cyan-500"
            aria-label="AI provider mode"
          >
            <option value="primary-stack">PRIMARY STACK — Groq×2 → Gemini → Cloudflare → OpenAI</option>
            <option value="gemini-heavy">GEMINI-HEAVY — Gemini first (parse/long CFPB)</option>
            <option value="backup-quality">MAX QUALITY BACKUPS — Gemini → Groq → OpenAI → CF (OpenAI after Gemini)</option>
            <option value="experimental-openai-first">ADVANCED — OpenAI first (experimental)</option>
          </select>
        </div>

        {showModeMigrationBanner && (
          <div className="mb-5 rounded border border-[#ff9900]/40 bg-[#ff9900]/5 p-3 text-[11px] font-mono text-[#ff9900] flex items-start justify-between gap-3">
            <span>
              Provider mode updated: Quality-First is now Max Quality Backups (OpenAI after Gemini).
            </span>
            <button
              type="button"
              onClick={() => setShowModeMigrationBanner(false)}
              className="text-zinc-400 hover:text-white shrink-0"
              aria-label="Dismiss provider mode migration notice"
            >
              ✕
            </button>
          </div>
        )}

        <h4 className="text-xs font-bold text-[#00ffff] font-mono mb-3 flex items-center gap-2 border-b border-zinc-800 pb-2">
          <Zap size={12} /> PRIMARY AI
        </h4>

        {/* ── Groq ── */}
        <div className="space-y-3 mb-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#00ffff] font-mono">GROQ KEY 1 — PRIMARY</span>
            <KeyStatusPill configured={!!(getGroqApiKey() || groqKeyInput.trim())} label={getGroqApiKey() || groqKeyInput.trim() ? 'Key 1 configured' : 'Key 1 missing'} />
          </div>
          <div className="relative">
            <input type={showKey ? "text" : "password"} value={groqKeyInput} onChange={(e) => setGroqKeyInput(e.target.value)} placeholder="gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" className="w-full bg-black/60 border border-zinc-700 rounded px-3 py-2 pr-10 text-sm font-mono text-white placeholder:text-zinc-700 focus:outline-none focus:border-[#00ffff]" autoComplete="off" spellCheck={false} />
            <button type="button" onClick={() => setShowKey(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400">{showKey ? <EyeOff size={14} /> : <Eye size={14} />}</button>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label htmlFor="groq-api-key-2" className="block text-[10px] font-bold text-zinc-500 font-mono">
                GROQ KEY 2 — LOAD BALANCER
              </label>
              <KeyStatusPill configured={!!(getGroqApiKey2() || groqKey2Input.trim())} label={getGroqApiKey2() || groqKey2Input.trim() ? 'Key 2 configured' : 'Key 2 optional'} />
            </div>
            <div className="relative">
              <input id="groq-api-key-2" type={showKey2 ? "text" : "password"} value={groqKey2Input} onChange={(e) => setGroqKey2Input(e.target.value)} placeholder="Optional second gsk_ key" className="w-full bg-black/60 border border-zinc-700 rounded px-3 py-2 pr-10 text-sm font-mono text-white placeholder:text-zinc-700 focus:outline-none focus:border-[#00ffff]" autoComplete="off" spellCheck={false} />
              <button type="button" onClick={() => setShowKey2(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400">{showKey2 ? <EyeOff size={14} /> : <Eye size={14} />}</button>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSaveKey} className={`cyber-button px-3 py-1.5 text-xs font-bold flex items-center gap-1.5 ${keySaveStatus === "saved" ? "border-[#00ff00] text-[#00ff00] bg-[#00ff00]/10" : keySaveStatus === "error" ? "border-red-500 text-red-400" : "border-[#00ffff] text-[#00ffff] hover:bg-[#00ffff]/10"}`}>
              {keySaveStatus === "saved" ? <><CheckCircle2 size={12} /> SAVED</> : keySaveStatus === "error" ? <><AlertTriangle size={12} /> EMPTY</> : <><Key size={12} /> SAVE</>}
            </button>
            <button onClick={handleTestKey} disabled={keyTestStatus === "testing"} className={`cyber-button px-3 py-1.5 text-xs font-bold flex items-center gap-1.5 ${keyTestStatus === "ok" ? "border-[#00ff00] text-[#00ff00]" : keyTestStatus === "fail" ? "border-red-500 text-red-400" : "border-zinc-600 text-zinc-400"} disabled:opacity-50`}>
              {keyTestStatus === "testing" ? <><RefreshCw size={12} className="animate-spin" /> TESTING...</> : keyTestStatus === "ok" ? <><Wifi size={12} /> OK</> : keyTestStatus === "fail" ? <><WifiOff size={12} /> FAILED</> : <><Wifi size={12} /> TEST</>}
            </button>
            {keyTestMsg && <span className={`text-xs font-mono self-center ${keyTestStatus === "ok" ? "text-[#00ff00]" : "text-red-400"}`}>{keyTestMsg}</span>}
          </div>
        </div>

        {/* ── Gemini ── */}
        <div className="space-y-3 mb-5 border-t border-zinc-800 pt-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#ff9900] font-mono">GEMINI KEYS — LARGE CONTEXT / PARSING</span>
            <KeyStatusPill configured={!!(getGeminiApiKey() || geminiKeyInput.trim())} label={getGeminiApiKey() || geminiKeyInput.trim() ? 'Gemini configured' : 'Gemini missing'} />
          </div>
          <p className="text-[10px] text-zinc-600 font-mono">Get key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-[#ff9900] hover:underline">aistudio.google.com/apikey</a></p>
          <div className="relative">
            <input type={showGeminiKey ? "text" : "password"} value={geminiKeyInput} onChange={(e) => setGeminiKeyInput(e.target.value)} placeholder="AIzaSy..." className="w-full bg-black/60 border border-zinc-700 rounded px-3 py-2 pr-10 text-sm font-mono text-white placeholder:text-zinc-700 focus:outline-none focus:border-[#ff9900]" autoComplete="off" spellCheck={false} />
            <button type="button" onClick={() => setShowGeminiKey(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400">{showGeminiKey ? <EyeOff size={14} /> : <Eye size={14} />}</button>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label htmlFor="gemini-api-key-2" className="block text-[10px] font-bold text-zinc-500 font-mono">GEMINI KEY 2 — LOAD BALANCER</label>
              <KeyStatusPill configured={!!(getGeminiApiKey2() || geminiKey2Input.trim())} label={getGeminiApiKey2() || geminiKey2Input.trim() ? 'Key 2 configured' : 'Key 2 optional'} />
            </div>
            <div className="relative">
              <input id="gemini-api-key-2" type={showGeminiKey2 ? "text" : "password"} value={geminiKey2Input} onChange={(e) => setGeminiKey2Input(e.target.value)} placeholder="Optional second AIzaSy key" className="w-full bg-black/60 border border-zinc-700 rounded px-3 py-2 pr-10 text-sm font-mono text-white placeholder:text-zinc-700 focus:outline-none focus:border-[#ff9900]" autoComplete="off" spellCheck={false} />
              <button type="button" onClick={() => setShowGeminiKey2(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400">{showGeminiKey2 ? <EyeOff size={14} /> : <Eye size={14} />}</button>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSaveGeminiKey} className={`cyber-button px-3 py-1.5 text-xs font-bold flex items-center gap-1.5 ${geminiSaveStatus === "saved" ? "border-[#00ff00] text-[#00ff00] bg-[#00ff00]/10" : geminiSaveStatus === "error" ? "border-red-500 text-red-400" : "border-[#ff9900] text-[#ff9900] hover:bg-[#ff9900]/10"}`}>
              {geminiSaveStatus === "saved" ? <><CheckCircle2 size={12} /> SAVED</> : geminiSaveStatus === "error" ? <><AlertTriangle size={12} /> EMPTY</> : <><Key size={12} /> SAVE</>}
            </button>
            <button onClick={handleTestGeminiKey} disabled={geminiTestStatus === "testing"} className={`cyber-button px-3 py-1.5 text-xs font-bold flex items-center gap-1.5 ${geminiTestStatus === "ok" ? "border-[#00ff00] text-[#00ff00]" : geminiTestStatus === "fail" ? "border-red-500 text-red-400" : "border-zinc-600 text-zinc-400"} disabled:opacity-50`}>
              {geminiTestStatus === "testing" ? <><RefreshCw size={12} className="animate-spin" /> TESTING...</> : geminiTestStatus === "ok" ? <><Wifi size={12} /> OK</> : geminiTestStatus === "fail" ? <><WifiOff size={12} /> FAILED</> : <><Wifi size={12} /> TEST</>}
            </button>
            {geminiTestMsg && <span className={`text-xs font-mono self-center ${geminiTestStatus === "ok" ? "text-[#00ff00]" : "text-red-400"}`}>{geminiTestMsg}</span>}
          </div>
          {geminiTestMsg && <APIStatusAdvice message={geminiTestMsg} />}
        </div>

        <h4 className="text-xs font-bold text-emerald-400 font-mono mb-3 flex items-center gap-2 border-b border-zinc-800 pb-2 mt-6">
          <Shield size={12} /> BACKUP AI
        </h4>

        {/* ── OpenAI ── */}
        <div className="space-y-3 border-t border-zinc-800 pt-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-400 font-mono">OPENAI — BACKUP QUALITY</span>
            <KeyStatusPill configured={!!(getOpenAIApiKey() || openAIKeyInput.trim())} label={getOpenAIApiKey() || openAIKeyInput.trim() ? 'OpenAI configured' : 'OpenAI optional'} />
          </div>
          <p className="text-[10px] text-zinc-500 font-mono">OpenAI API billing is separate from a ChatGPT subscription. Used after Gemini/Groq in Max Quality Backups mode — never first for Autopilot letters.</p>
          <p className="text-[10px] text-zinc-600 font-mono">Get key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">platform.openai.com/api-keys</a></p>
          <div className="relative">
            <input type={showOpenAIKey ? "text" : "password"} value={openAIKeyInput} onChange={(e) => setOpenAIKeyInput(e.target.value)} placeholder="sk-proj-..." className="w-full bg-black/60 border border-zinc-700 rounded px-3 py-2 pr-10 text-sm font-mono text-white placeholder:text-zinc-700 focus:outline-none focus:border-emerald-400" autoComplete="off" spellCheck={false} />
            <button type="button" onClick={() => setShowOpenAIKey(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400">{showOpenAIKey ? <EyeOff size={14} /> : <Eye size={14} />}</button>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSaveOpenAIKey} className={`cyber-button px-3 py-1.5 text-xs font-bold flex items-center gap-1.5 ${openAISaveStatus === "saved" ? "border-[#00ff00] text-[#00ff00] bg-[#00ff00]/10" : openAISaveStatus === "error" ? "border-red-500 text-red-400" : "border-emerald-400 text-emerald-400 hover:bg-emerald-400/10"}`}>
              {openAISaveStatus === "saved" ? <><CheckCircle2 size={12} /> SAVED</> : openAISaveStatus === "error" ? <><AlertTriangle size={12} /> EMPTY</> : <><Key size={12} /> SAVE</>}
            </button>
            <button onClick={handleTestOpenAIKey} disabled={openAITestStatus === "testing"} className={`cyber-button px-3 py-1.5 text-xs font-bold flex items-center gap-1.5 ${openAITestStatus === "ok" ? "border-[#00ff00] text-[#00ff00]" : openAITestStatus === "fail" ? "border-red-500 text-red-400" : "border-zinc-600 text-zinc-400"} disabled:opacity-50`}>
              {openAITestStatus === "testing" ? <><RefreshCw size={12} className="animate-spin" /> TESTING...</> : openAITestStatus === "ok" ? <><Wifi size={12} /> OK</> : openAITestStatus === "fail" ? <><WifiOff size={12} /> FAILED</> : <><Wifi size={12} /> TEST</>}
            </button>
            {openAITestMsg && <span className={`text-xs font-mono self-center ${openAITestStatus === "ok" ? "text-[#00ff00]" : "text-red-400"}`}>{openAITestMsg}</span>}
          </div>
          {openAITestMsg && <APIStatusAdvice message={openAITestMsg} />}
        </div>

        {/* ── Cloudflare Workers AI ── */}
        <div className="space-y-3 border-t border-zinc-800 pt-4 mt-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-orange-400 font-mono">CLOUDFLARE WORKERS AI — FREE BACKUP</span>
            <KeyStatusPill
              configured={!!((getCloudflareApiKey() && getCloudflareAccountId()) || (cloudflareTokenInput.trim() && cloudflareAccountInput.trim()))}
              label={(getCloudflareApiKey() && getCloudflareAccountId()) || (cloudflareTokenInput.trim() && cloudflareAccountInput.trim()) ? 'Cloudflare configured' : 'Cloudflare optional'}
            />
          </div>
          <input type="password" value={cloudflareTokenInput} onChange={(e) => setCloudflareTokenInput(e.target.value)} placeholder="Cloudflare API Token" className="w-full bg-black/60 border border-zinc-700 rounded px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-orange-400" autoComplete="off" />
          <input value={cloudflareAccountInput} onChange={(e) => setCloudflareAccountInput(e.target.value)} placeholder="Cloudflare Account ID" className="w-full bg-black/60 border border-zinc-700 rounded px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-orange-400" autoComplete="off" />
          <button onClick={handleSaveCloudflare} className="cyber-button px-3 py-1.5 text-xs font-bold border-orange-400 text-orange-400">
            {cloudflareStatus === 'saved' ? 'SAVED' : 'SAVE CLOUDFLARE'}
          </button>
        </div>
      </div>

      {/* ─── V4: AutoPilot V2 ───────────────────────────────────────────────── */}
      <div className="cyber-panel p-6">
        <h3 className="text-sm font-bold text-zinc-300 mb-4 font-mono flex items-center gap-2"><Bot size={14} /> AUTOPILOT V2 — 6-ROUND ENGINE</h3>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
            <ToggleRow label="Dual-Target Mode" icon={<Zap size={12} />} enabled={autopilot.dualDispute} onClick={() => updateAutopilot({ dualDispute: !autopilot.dualDispute })} />
            <ToggleRow label="Auto-Approve Letters" icon={<CheckCircle2 size={12} />} enabled={false} onClick={() => {}} />
            <ToggleRow label="Auto-Generate CFPB Pack (Pass 5)" icon={<Shield size={12} />} enabled={autopilot.cfpbAutoEscalate} onClick={() => updateAutopilot({ cfpbAutoEscalate: !autopilot.cfpbAutoEscalate })} />
            <ToggleRow label="Backup Before Each Cycle" icon={<Archive size={12} />} enabled={true} onClick={() => {}} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Pass 1 Hold", days: "60d", pass: 1, color: "text-blue-400" },
              { label: "Pass 2 Hold", days: "60d", pass: 2, color: "text-yellow-400" },
              { label: "Pass 3 Hold", days: "45d", pass: 3, color: "text-orange-400" },
              { label: "Pass 4 Hold", days: "30d", pass: 4, color: "text-red-400" },
              { label: "Pass 5 Hold", days: "14d", pass: 5, color: "text-purple-400" },
              { label: "Cycle Interval", days: "32d", pass: 0, color: "text-cyan-400" },
              { label: "Max Items/Cycle", days: "8", pass: 0, color: "text-gray-400" },
              { label: "Batch Fraction", days: "33%", pass: 0, color: "text-teal-400" },
            ].map(item => (
              <div key={item.label} className="rounded border border-zinc-800 bg-black/30 p-2 text-center">
                <p className={`text-sm font-bold font-mono ${item.color}`}>{item.days}</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">{item.label}</p>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-zinc-600 font-mono">Use the AutoPilot Dashboard to modify per-cycle settings. These values show defaults for v4.0 engine.</p>
        </div>
      </div>

      {/* ─── V4: Security Status ─────────────────────────────────────────────── */}
      <div className="cyber-panel p-6">
        <h3 className="text-sm font-bold text-zinc-300 mb-4 font-mono flex items-center gap-2"><Lock size={14} /> SECURITY STATUS</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <SecurityStatusRow
            label="Vault Encryption (AES-256-GCM)"
            status={vaultEncryptionReady ? "active" : "inactive"}
            detail={vaultEncryptionReady ? "Initialized — DPAPI key loaded" : "Not initialized — run on desktop only"}
          />
          <SecurityStatusRow
            label="DPAPI Key Storage"
            status={typeof window !== "undefined" && window.electronAPI ? "active" : "inactive"}
            detail={window.electronAPI ? "Electron safeStorage available" : "Not running in Electron"}
          />
          <SecurityStatusRow
            label="SSN Secure Store"
            status={typeof window !== "undefined" && window.electronAPI?.secureStoreSSN ? "active" : "inactive"}
            detail="SSN encrypted at rest, never in logs"
          />
          <SecurityStatusRow
            label="API Key Storage — Groq"
            status={getGroqApiKey() || getGroqApiKey2() ? "active" : "warning"}
            detail={getGroqApiKey() || getGroqApiKey2()
              ? `${getGroqApiKey() ? "Primary Groq key stored" : "Load-balancer Groq key stored"}${getGroqApiKey() && getGroqApiKey2() ? " + load-balancer key stored" : ""}`
              : "No key — AI features limited"}
          />
          <SecurityStatusRow
            label="API Key Storage — Gemini"
            status={getGeminiApiKey() ? "active" : "warning"}
            detail={getGeminiApiKey() ? "Gemini API key stored (large-context parsing)" : "No key — parsing falls back to Groq"}
          />
          <SecurityStatusRow
            label="API Key Storage — OpenAI"
            status={getOpenAIApiKey() ? "active" : "warning"}
            detail={getOpenAIApiKey() ? "OpenAI API key stored (backup quality slot)" : "Optional — primary-stack Groq×2 + Gemini remain available"}
          />
        </div>
      </div>

      {/* ─── V4: Archive / Vault ─────────────────────────────────────────────── */}
      <div className="cyber-panel p-6">
        <h3 className="text-sm font-bold text-zinc-300 mb-4 font-mono flex items-center gap-2"><Archive size={14} /> ENCRYPTED VAULT</h3>
        <div className="space-y-3">
          <p className="text-xs text-zinc-500 font-mono">
            All dispute letters, bureau responses, and credit reports are stored in an AES-256-GCM encrypted vault on your local device.
            The vault is located in your application user data folder.
          </p>
          <div className="flex gap-3 flex-wrap">
            <button
              onClick={async () => {
                if (window.electronAPI?.vaultGetBasePath) {
                  const path = await window.electronAPI.vaultGetBasePath();
                  if (window.electronAPI?.openExternal) {
                    // Try to explore folder — open it in shell
                    alert(`Vault location:\n${path}`);
                  }
                }
              }}
              className="cyber-button border-zinc-600 text-zinc-400 hover:border-zinc-400 px-4 py-2 flex items-center gap-2 text-xs font-bold"
            >
              <Archive size={14} /> VIEW VAULT PATH
            </button>
            <button
              onClick={() => {
                // Trigger export via AutoPilot V2 archiveService — users use AutoPilot Dashboard
                alert("Use the Archive Browser in the AutoPilot Dashboard (pass 5 section) to export vault contents.");
              }}
              className="cyber-button border-[#00ff00] text-[#00ff00] hover:bg-[#00ff00]/10 px-4 py-2 flex items-center gap-2 text-xs font-bold"
            >
              <Download size={14} /> EXPORT VAULT
            </button>
          </div>
        </div>
      </div>

      <div className="cyber-panel p-6 border-[#00ffff]/10">
        <h3 className="text-sm font-bold text-[#00ffff] mb-1 font-mono flex items-center gap-2">
          <BrainCircuit size={14} /> PARSER CACHE RESET
        </h3>
        <p className="text-xs text-zinc-500 mb-4">
          Clears the deduplication memory so the parser can detect accounts that were previously imported.
          Use this when testing or re-parsing a report you already processed. Does <strong className="text-zinc-300">not</strong> delete letters, campaigns, or settings.
        </p>
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <div className="text-sm font-bold text-white">Reset Parser Brain</div>
            <div className="text-xs text-zinc-500 mt-0.5">
              Removes all <span className="text-[#00ffff] font-mono">{"{N}"}</span> negative items from memory. Re-upload your report to re-detect them fresh.
            </div>
            {parserResetDone && (
              <div className="flex items-center gap-1.5 text-[11px] text-[#00ff00] mt-2 font-mono">
                <CheckCircle2 size={11} /> Parser cache cleared — re-upload your report to re-parse.
              </div>
            )}
          </div>
          {!confirmParserReset ? (
            <button
              onClick={() => setConfirmParserReset(true)}
              className="cyber-button border-[#00ffff]/50 text-[#00ffff] hover:bg-[#00ffff]/10 px-4 py-2 flex items-center gap-2 text-sm shrink-0"
            >
              <RefreshCw size={14} /> RESET PARSER
            </button>
          ) : (
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => {
                  clearNegativeItems();
                  setConfirmParserReset(false);
                  setParserResetDone(true);
                  setTimeout(() => setParserResetDone(false), 6000);
                }}
                className="cyber-button border-[#00ffff] text-[#00ffff] bg-[#00ffff]/10 px-4 py-2 text-sm font-bold"
              >
                CONFIRM RESET
              </button>
              <button
                onClick={() => setConfirmParserReset(false)}
                className="cyber-button border-zinc-700 text-zinc-500 px-4 py-2 text-sm"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="cyber-panel p-6 border-red-500/20">
        <h3 className="text-sm font-bold text-red-400 mb-4 font-mono flex items-center gap-2"><AlertTriangle size={14} /> DANGER ZONE</h3>        <div className="flex items-start gap-4">
          <div className="flex-1">
            <div className="text-sm font-bold text-white">Clear All Data</div>
            <div className="text-xs text-zinc-500 mt-0.5">Permanently deletes all reports, items, letters, campaigns, and stored app data.</div>
          </div>
          {!confirmClear ? (
            <button onClick={() => setConfirmClear(true)} className="cyber-button border-red-500/50 text-red-400 hover:bg-red-500/10 px-4 py-2 flex items-center gap-2 text-sm shrink-0">
              <Trash2 size={16} /> CLEAR ALL
            </button>
          ) : (
            <div className="flex gap-2 shrink-0">
              <button onClick={async () => { await clearData(); setConfirmClear(false); }} className="cyber-button border-red-500 text-red-500 bg-red-500/10 px-4 py-2 text-sm font-bold">CONFIRM DELETE</button>
              <button onClick={() => setConfirmClear(false)} className="cyber-button border-zinc-700 text-zinc-500 px-4 py-2 text-sm">Cancel</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  enabled,
  onClick,
  icon,
}: {
  label: string;
  enabled: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button onClick={onClick} className={`w-full flex items-center justify-between rounded border px-3 py-2 ${enabled ? "border-[#00ffff]/40 bg-[#00ffff]/5" : "border-zinc-800"}`}>
      <span className="text-zinc-300 flex items-center gap-2">
        <span className="text-[#00ffff]">{icon}</span>
        {label}
      </span>
      <span className={`text-[10px] px-2 py-0.5 rounded border ${enabled ? "text-[#00ff00] border-[#00ff00]/40" : "text-zinc-500 border-zinc-700"}`}>{enabled ? "ON" : "OFF"}</span>
    </button>
  );
}

function SecurityStatusRow({ label, status, detail }: { label: string; status: "active" | "inactive" | "warning"; detail: string }) {
  const colors: Record<string, string> = {
    active: "text-[#00ff00] border-[#00ff00]/30 bg-[#00ff00]/5",
    inactive: "text-zinc-500 border-zinc-700",
    warning: "text-yellow-400 border-yellow-400/30 bg-yellow-400/5",
  };
  const badges: Record<string, string> = { active: "SECURE", inactive: "N/A", warning: "WARN" };
  return (
    <div className={`rounded border px-3 py-2 flex items-center justify-between gap-2 ${colors[status]}`}>
      <div>
        <p className="text-xs font-bold font-mono">{label}</p>
        <p className="text-[10px] text-zinc-500 mt-0.5">{detail}</p>
      </div>
      <span className={`text-[10px] px-2 py-0.5 rounded border shrink-0 ${colors[status]}`}>{badges[status]}</span>
    </div>
  );
}
