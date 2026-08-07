/// <reference types="vite/client" />

/**
 * AI Router — Cascading Multi-Provider Failover Engine
 * Priority: Groq (speed) → Gemini (capacity) → Cloudflare (keyed fallback) → Pollinations (FREE no-key fallback)
 * Features: per-provider rate-limit tracking, 60-second cooldowns on HTTP 429,
 *           automatic provider promotion/demotion, unified message interface.
 *
 * NOTE: OpenAI has been REMOVED from the routing chain (API dead / requires paid credits).
 * Key storage: SecureKeyService (Electron/Android secure stores + web fallback)
 */

import { SecureKeyService, KEY_NAMES } from './secureKeyService';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AIRole = "system" | "user" | "assistant";

export interface AIMessage {
  role: AIRole;
  content: string;
}

export interface AIRequestOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  /**
   * Controls provider priority order:
   *   'parse'            → Gemini first (large context) → Groq → Cloudflare → OpenAI
   *   'classify'         → Groq (fast) → Gemini → Cloudflare → OpenAI
   *   'letter'           → Groq (low-latency) → Gemini → Cloudflare → OpenAI
   *   'analyze'          → Groq → Gemini → Cloudflare → OpenAI
   *   'metro2_audit'     → Groq → Gemini → Cloudflare → OpenAI
   *   'variation'        → Groq (fast variation) → Gemini → Cloudflare → OpenAI
   *   'cfpb_narrative'   → Gemini (long-form) → Groq → Cloudflare → OpenAI
   *   'legal_demand'     → Gemini (precision) → Groq → Cloudflare → OpenAI
   *   'score_impact'     → Groq → Gemini → Cloudflare → OpenAI
   *   'goodwill'         → Groq → Gemini → Cloudflare → OpenAI
   *   'cross_bureau_diff'→ Groq → Gemini → Cloudflare → OpenAI
   */
  taskType?: 'parse' | 'classify' | 'letter' | 'analyze' | 'metro2_audit' |
  'variation' | 'cfpb_narrative' | 'legal_demand' | 'score_impact' |
  'goodwill' | 'cross_bureau_diff';
  /** Dispute letters must use the user's configured Groq/Gemini providers. */
  providerScope?: 'all' | 'groq-gemini-only';
}

export class AIProviderCooldownError extends Error {
  constructor(public readonly retryAfterMs: number, message: string) {
    super(message);
    this.name = 'AIProviderCooldownError';
  }
}

/**
 * Per-task temperature resolver.
 * High-variance tasks (letter writing, persona-driven narrative) get 0.85 to
 * force structural diversity across accounts and defeat e-OSCAR pattern matching.
 * Precision tasks (parse, classify, JSON) keep low temps for accuracy.
 */
function resolveTemperature(options: AIRequestOptions): number {
  if (options.temperature !== undefined) return options.temperature;
  switch (options.taskType) {
    case 'legal_demand':
    case 'letter':
    case 'variation':
      return 0.85; // Maximum persona expression — forces unique letter structure every call
    case 'cfpb_narrative':
    case 'goodwill':
      return 0.80; // High creativity, softer tone variance
    case 'analyze':
    case 'metro2_audit':
    case 'cross_bureau_diff':
    case 'score_impact':
      return 0.30; // Some reasoning variance but grounded output
    case 'parse':
    case 'classify':
      return 0.15; // Near-deterministic for JSON extraction
    default:
      return 0.45; // Safe middle ground for unclassified tasks
  }
}

interface ProviderState {
  rateLimitedUntil: number; // epoch ms — 0 means available
  consecutiveFailures: number;
}

// ─── Provider state (module-level singleton, resets on page reload) ──────────

type ProviderName = "groq" | "gemini" | "cloudflare" | "huggingface" | "deepseek" | "together" | "mistral" | "openai";

const _state: Record<ProviderName, ProviderState> = {
  groq: { rateLimitedUntil: 0, consecutiveFailures: 0 },
  gemini: { rateLimitedUntil: 0, consecutiveFailures: 0 },
  cloudflare: { rateLimitedUntil: 0, consecutiveFailures: 0 },
  huggingface: { rateLimitedUntil: 0, consecutiveFailures: 0 },
  deepseek: { rateLimitedUntil: 0, consecutiveFailures: 0 },
  together: { rateLimitedUntil: 0, consecutiveFailures: 0 },
  mistral: { rateLimitedUntil: 0, consecutiveFailures: 0 },
  openai: { rateLimitedUntil: 0, consecutiveFailures: 0 }, // retained for backward-compat accessors only; never routed
};

const COOLDOWN_MS = 60_000; // default when a provider omits Retry-After
const MAX_FAILURES_BEFORE_SKIP = 15;

/**
 * Default Groq chat model.
 * Uses 70B versatile first, 8B instant fallback on 429 rate limit or capacity errors.
 */
export const GROQ_PRIMARY_MODEL = "llama-3.3-70b-versatile" as const;
/** Gemini model chain — tried in order for high context and reliability on Google AI Studio. */
export const GEMINI_MODEL_CHAIN: readonly string[] = [
  // The older 2.0/1.5 endpoints have been retired by Google. Using current
  // stable models avoids an otherwise confusing HTTP 400 during key checks.
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro",
] as const;
/** Groq model chain — tries 70B then high-capacity 8B instant fallback on 429/TPM limits. */
export const GROQ_MODEL_CHAIN: readonly string[] = [
  GROQ_PRIMARY_MODEL,
  "llama-3.1-8b-instant",
  "mixtral-8x7b-32768",
  "gemma2-9b-it",
] as const;

function buildGroqModelList(requested?: string): string[] {
  const r = (requested || "").trim();
  const out: string[] = [];
  if (r) out.push(r);
  for (const m of GROQ_MODEL_CHAIN) {
    if (!out.includes(m)) out.push(m);
  }
  return out;
}

export const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini' as const;

// ─── Key accessors ────────────────────────────────────────────────────────────

export interface AIProviderSettings {
  groqApiKey: string;
  groqApiKey2: string;
  geminiApiKey: string;
  geminiApiKey2: string;
}

export type AIProviderMode =
  | 'primary-stack'
  | 'gemini-heavy'
  | 'free-first'
  | 'backup-quality'
  | 'experimental-openai-first';

const PROVIDER_MODE_KEY = 'dylandos_ai_provider_mode';

const VALID_PROVIDER_MODES: readonly AIProviderMode[] = [
  'primary-stack',
  'gemini-heavy',
  'free-first',
  'backup-quality',
  'experimental-openai-first',
] as const;

function migrateStoredProviderMode(raw: string | null): AIProviderMode {
  if (raw === 'quality-first') return 'backup-quality';
  if (!raw) return 'primary-stack';
  if ((VALID_PROVIDER_MODES as readonly string[]).includes(raw)) return raw as AIProviderMode;
  return 'primary-stack';
}

export function getAIProviderMode(): AIProviderMode {
  try { return migrateStoredProviderMode(localStorage.getItem(PROVIDER_MODE_KEY)); }
  catch { return 'primary-stack'; }
}
export function setAIProviderMode(mode: AIProviderMode): void {
  try { localStorage.setItem(PROVIDER_MODE_KEY, mode); } catch { /* non-critical */ }
}

const _keyCache: Record<"groq" | "groq2" | "gemini" | "gemini2" | "openai" | "cloudflare" | "cloudflareAccountId" | "huggingface" | "deepseek" | "together" | "mistral", string> = {
  groq: "",
  groq2: "",
  gemini: "",
  gemini2: "",
  openai: "",
  cloudflare: "",
  cloudflareAccountId: "",
  huggingface: "",
  deepseek: "",
  together: "",
  mistral: "",
};

/** Safe accessor for Vite env vars — undefined outside Vite (tests, Node scripts). */
function viteEnv(key: string): string | undefined {
  try {
    const env = (import.meta as any)?.env;
    return env?.[key];
  } catch {
    return undefined;
  }
}

function getSavedAISettings(): AIProviderSettings {
  return {
    groqApiKey: _keyCache.groq,
    groqApiKey2: _keyCache.groq2,
    geminiApiKey: _keyCache.gemini,
    geminiApiKey2: _keyCache.gemini2,
  };
}

function getGroqApiKeys(): string[] {
  const settings = getSavedAISettings();
  return [settings.groqApiKey, settings.groqApiKey2]
    .map((key) => key?.trim() ?? "")
    .filter((key, index, keys) => Boolean(key) && keys.indexOf(key) === index);
}

export function getConfiguredGroqKeyCount(): number {
  return getGroqApiKeys().length;
}

let _groqRoundRobinIndex = 0;
const _groqKeyRateLimitedUntil = new Map<string, number>();
const _groqRejectedKeys = new Set<string>();

function getGroqRequestKeyOrder(): string[] {
  const now = Date.now();
  const availableKeys = getGroqApiKeys().filter(
    (key) => !_groqRejectedKeys.has(key) && (_groqKeyRateLimitedUntil.get(key) ?? 0) <= now,
  );
  if (availableKeys.length === 0) return [];
  const startIndex = _groqRoundRobinIndex % availableKeys.length;
  _groqRoundRobinIndex = (_groqRoundRobinIndex + 1) % availableKeys.length;
  return [
    ...availableKeys.slice(startIndex),
    ...availableKeys.slice(0, startIndex),
  ];
}

export function getGroqApiKey(): string {
  return _keyCache.groq;
}

export function setGroqApiKey(key: string): void {
  const trimmed = key.trim();
  if (_keyCache.groq !== trimmed) {
    _groqRejectedKeys.delete(_keyCache.groq);
    _groqRejectedKeys.delete(trimmed);
    _groqKeyRateLimitedUntil.delete(_keyCache.groq);
    _groqKeyRateLimitedUntil.delete(trimmed);
  }
  _keyCache.groq = trimmed;
  if (!trimmed) {
    SecureKeyService.removeKey(KEY_NAMES.GROQ).catch(() => { /* non-critical */ });
    return;
  }
  SecureKeyService.setKey(KEY_NAMES.GROQ, trimmed).catch(() => { /* non-critical */ });
}

export function getGroqApiKey2(): string {
  return _keyCache.groq2;
}

export function setGroqApiKey2(key: string): void {
  const trimmed = key.trim();
  if (_keyCache.groq2 !== trimmed) {
    _groqRejectedKeys.delete(_keyCache.groq2);
    _groqRejectedKeys.delete(trimmed);
    _groqKeyRateLimitedUntil.delete(_keyCache.groq2);
    _groqKeyRateLimitedUntil.delete(trimmed);
  }
  _keyCache.groq2 = trimmed;
  if (!trimmed) {
    SecureKeyService.removeKey(KEY_NAMES.GROQ_2).catch(() => { /* non-critical */ });
    return;
  }
  SecureKeyService.setKey(KEY_NAMES.GROQ_2, trimmed).catch(() => { /* non-critical */ });
}

export function getGeminiApiKey(): string {
  return _keyCache.gemini;
}

export function setGeminiApiKey(key: string): void {
  const trimmed = key.trim();
  if (_keyCache.gemini !== trimmed) {
    _geminiRejectedKeys.delete(_keyCache.gemini);
    _geminiRejectedKeys.delete(trimmed);
    _geminiKeyRateLimitedUntil.delete(_keyCache.gemini);
    _geminiKeyRateLimitedUntil.delete(trimmed);
  }
  _keyCache.gemini = trimmed;
  if (!trimmed) {
    SecureKeyService.removeKey(KEY_NAMES.GEMINI).catch(() => { /* non-critical */ });
    return;
  }
  SecureKeyService.setKey(KEY_NAMES.GEMINI, trimmed).catch(() => { /* non-critical */ });
}

export function getGeminiApiKey2(): string { return _keyCache.gemini2; }
export function setGeminiApiKey2(key: string): void {
  const trimmed = key.trim();
  if (_keyCache.gemini2 !== trimmed) {
    _geminiRejectedKeys.delete(_keyCache.gemini2);
    _geminiRejectedKeys.delete(trimmed);
    _geminiKeyRateLimitedUntil.delete(_keyCache.gemini2);
    _geminiKeyRateLimitedUntil.delete(trimmed);
  }
  _keyCache.gemini2 = trimmed;
  if (!trimmed) {
    SecureKeyService.removeKey(KEY_NAMES.GEMINI_2).catch(() => { /* non-critical */ });
    return;
  }
  SecureKeyService.setKey(KEY_NAMES.GEMINI_2, trimmed).catch(() => { /* non-critical */ });
}

function getGeminiApiKeys(): string[] {
  return [_keyCache.gemini, _keyCache.gemini2]
    .map(key => key.trim())
    .filter((key, index, keys) => Boolean(key) && keys.indexOf(key) === index);
}
export function getConfiguredGeminiKeyCount(): number { return getGeminiApiKeys().length; }
let _geminiRoundRobinIndex = 0;
const _geminiKeyRateLimitedUntil = new Map<string, number>();
const _geminiRejectedKeys = new Set<string>();
function getGeminiRequestKeyOrder(): string[] {
  const now = Date.now();
  const keys = getGeminiApiKeys().filter(key => !_geminiRejectedKeys.has(key) && (_geminiKeyRateLimitedUntil.get(key) ?? 0) <= now);
  if (!keys.length) return [];
  const start = _geminiRoundRobinIndex % keys.length;
  _geminiRoundRobinIndex = (_geminiRoundRobinIndex + 1) % keys.length;
  return [...keys.slice(start), ...keys.slice(0, start)];
}

export function getHuggingFaceApiKey(): string {
  return _keyCache.huggingface;
}

export function setHuggingFaceApiKey(key: string): void {
  const trimmed = key.trim();
  _keyCache.huggingface = trimmed;
  if (!trimmed) {
    SecureKeyService.removeKey(KEY_NAMES.HUGGINGFACE).catch(() => {});
    return;
  }
  SecureKeyService.setKey(KEY_NAMES.HUGGINGFACE, trimmed).catch(() => {});
}

// ── DeepSeek (free key from platform.deepseek.com/api_keys — OpenAI-compatible) ──────

export function getDeepSeekApiKey(): string { return _keyCache.deepseek; }
export function setDeepSeekApiKey(key: string): void {
  _keyCache.deepseek = key.trim();
  if (!key.trim()) { SecureKeyService.removeKey(KEY_NAMES.DEEPSEEK).catch(() => {}); return; }
  SecureKeyService.setKey(KEY_NAMES.DEEPSEEK, key.trim()).catch(() => {});
}

// ── Together AI (free $1 credit, no CC — api.together.xyz) ──────

export function getTogetherApiKey(): string { return _keyCache.together; }
export function setTogetherApiKey(key: string): void {
  _keyCache.together = key.trim();
  if (!key.trim()) { SecureKeyService.removeKey(KEY_NAMES.TOGETHER).catch(() => {}); return; }
  SecureKeyService.setKey(KEY_NAMES.TOGETHER, key.trim()).catch(() => {});
}

// ── Mistral AI (free tier via console.mistral.ai/api-key) ──────

export function getMistralApiKey(): string { return _keyCache.mistral; }
export function setMistralApiKey(key: string): void {
  _keyCache.mistral = key.trim();
  if (!key.trim()) { SecureKeyService.removeKey(KEY_NAMES.MISTRAL).catch(() => {}); return; }
  SecureKeyService.setKey(KEY_NAMES.MISTRAL, key.trim()).catch(() => {});
}

export function getOpenAIApiKey(): string {
  return _keyCache.openai;
}

export function setOpenAIApiKey(key: string): void {
  const trimmed = key.trim();
  _keyCache.openai = trimmed;
  if (!trimmed) {
    SecureKeyService.removeKey(KEY_NAMES.OPENAI).catch(() => { /* non-critical */ });
    return;
  }
  SecureKeyService.setKey(KEY_NAMES.OPENAI, trimmed).catch(() => { /* non-critical */ });
}

export function getCloudflareApiKey(): string {
  return _keyCache.cloudflare;
}

export function setCloudflareApiKey(key: string): void {
  const trimmed = key.trim();
  _keyCache.cloudflare = trimmed;
  if (!trimmed) {
    SecureKeyService.removeKey(KEY_NAMES.CLOUDFLARE).catch(() => { /* non-critical */ });
    return;
  }
  SecureKeyService.setKey(KEY_NAMES.CLOUDFLARE, trimmed).catch(() => { /* non-critical */ });
}

export function getCloudflareAccountId(): string { return _keyCache.cloudflareAccountId; }
export function setCloudflareAccountId(value: string): void {
  const trimmed = value.trim();
  _keyCache.cloudflareAccountId = trimmed;
  if (!trimmed) SecureKeyService.removeKey(KEY_NAMES.CLOUDFLARE_ACCOUNT_ID).catch(() => {});
  else SecureKeyService.setKey(KEY_NAMES.CLOUDFLARE_ACCOUNT_ID, trimmed).catch(() => {});
}

/** Attempt to load keys from SecureKeyService into the in-memory cache.
 *  Call once at app startup (async). */
export async function syncKeysFromSecureStorage(): Promise<void> {
  try {
    const [groq, groq2, gemini, gemini2, openai, cloudflare, cloudflareAccountId, huggingface, deepseek, together, mistral] = await Promise.all([
      SecureKeyService.getKey(KEY_NAMES.GROQ),
      SecureKeyService.getKey(KEY_NAMES.GROQ_2),
      SecureKeyService.getKey(KEY_NAMES.GEMINI),
      SecureKeyService.getKey(KEY_NAMES.GEMINI_2),
      SecureKeyService.getKey(KEY_NAMES.OPENAI),
      SecureKeyService.getKey(KEY_NAMES.CLOUDFLARE),
      SecureKeyService.getKey(KEY_NAMES.CLOUDFLARE_ACCOUNT_ID),
      SecureKeyService.getKey(KEY_NAMES.HUGGINGFACE),
      SecureKeyService.getKey(KEY_NAMES.DEEPSEEK),
      SecureKeyService.getKey(KEY_NAMES.TOGETHER),
      SecureKeyService.getKey(KEY_NAMES.MISTRAL),
    ]);
    if (groq) _keyCache.groq = groq;
    if (groq2) _keyCache.groq2 = groq2;
    if (gemini) _keyCache.gemini = gemini;
    if (gemini2) _keyCache.gemini2 = gemini2;
    if (openai) _keyCache.openai = openai;
    if (cloudflare) _keyCache.cloudflare = cloudflare;
    if (cloudflareAccountId) _keyCache.cloudflareAccountId = cloudflareAccountId;
    if (huggingface) _keyCache.huggingface = huggingface;
    if (deepseek) _keyCache.deepseek = deepseek;
    if (together) _keyCache.together = together;
    if (mistral) _keyCache.mistral = mistral;
  } catch (e) {
    console.warn('[AIRouter] syncKeysFromSecureStorage failed — using in-memory/env cache only:', e);
  }
}

// ─── Provider availability check ─────────────────────────────────────────────

function isAvailable(provider: ProviderName): boolean {
  const s = _state[provider];
  if (s.rateLimitedUntil > Date.now()) return false;
  if (s.consecutiveFailures >= MAX_FAILURES_BEFORE_SKIP) return false;
  return true;
}

function markRateLimited(provider: ProviderName, cooldownMs = COOLDOWN_MS): void {
  _state[provider].rateLimitedUntil = Date.now() + cooldownMs;
  _state[provider].consecutiveFailures += 1;
  console.warn(`[AIRouter] ${provider} rate-limited — cooldown until ${new Date(_state[provider].rateLimitedUntil).toLocaleTimeString()}`);
}

function markFailure(provider: ProviderName): void {
  _state[provider].consecutiveFailures += 1;
}

function markSuccess(provider: ProviderName): void {
  _state[provider].consecutiveFailures = 0;
  _state[provider].rateLimitedUntil = 0;
}

export function getConfiguredLetterKeyCapacity(): number {
  return Math.max(getGroqApiKeys().length, getGeminiApiKeys().length, 1);
}

function retryAfterMs(response: Response): number {
  const raw = response.headers.get('retry-after');
  if (!raw) return COOLDOWN_MS;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1_000, seconds * 1_000);
  const retryDate = Date.parse(raw);
  return Number.isFinite(retryDate) ? Math.max(1_000, retryDate - Date.now()) : COOLDOWN_MS;
}

function rateLimitSentinel(cooldowns: Iterable<number>): string | null {
  const now = Date.now();
  const future = [...cooldowns].filter(until => until > now);
  if (!future.length) return null;
  return `RATE_LIMIT:${Math.max(1_000, Math.min(...future) - now)}`;
}

// ─── Provider-specific fetch implementations ──────────────────────────────────

async function callGroq(
  messages: AIMessage[],
  options: AIRequestOptions
): Promise<string> {
  const configuredKeys = getGroqApiKeys();
  if (configuredKeys.length === 0) throw new Error("NO_KEY");

  const apiKeys = getGroqRequestKeyOrder();
  if (apiKeys.length === 0) {
    const cooldown = rateLimitSentinel(_groqKeyRateLimitedUntil.values());
    if (cooldown) throw new Error(cooldown);
    throw new Error('All configured Groq keys were rejected. Replace the rejected key in Settings.');
  }

  const models = buildGroqModelList(options.model);
  const base: Record<string, unknown> = {
    messages,
    temperature: resolveTemperature(options),
    max_tokens: options.maxTokens ?? 4096,
  };
  if (options.jsonMode) {
    base.response_format = { type: "json_object" };
  }

  let lastErr = "";
  for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex += 1) {
    const apiKey = apiKeys[keyIndex];
    for (const model of models) {
      const body = { ...base, model };
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (res.status === 429 || res.status === 401 || res.status === 403) {
        lastErr = res.status === 429
          ? `Groq key ${keyIndex + 1} rate-limited`
          : `Groq key ${keyIndex + 1} rejected`;
        if (res.status === 429) {
          _groqKeyRateLimitedUntil.set(apiKey, Date.now() + retryAfterMs(res));
        } else {
          _groqRejectedKeys.add(apiKey);
        }
        console.warn(`[AIRouter] ${lastErr} — trying next configured model/key.`);
        continue;
      }
      if (res.ok) {
        const data = await res.json();
        const out = data.choices?.[0]?.message?.content?.trim() || "";
        if (out) {
          _groqKeyRateLimitedUntil.delete(apiKey);
          if (model !== models[0]) console.info(`[AIRouter] Groq used fallback model: ${model}`);
          return out;
        }
        lastErr = "empty response";
        continue;
      }
      const text = await res.text().catch(() => "");
      lastErr = `Groq error ${res.status}: ${text.slice(0, 100)}`;
      if ([400, 403, 404, 413, 500, 502, 503, 504].includes(res.status)) {
        console.warn(`[AIRouter] Groq model ${model} failed (${res.status}) — trying next.`);
        continue;
      }
      throw new Error(lastErr);
    }
  }

  const cooldown = rateLimitSentinel(_groqKeyRateLimitedUntil.values());
  if (cooldown) throw new Error(cooldown);
  throw new Error(`Groq: all ${apiKeys.length} key(s) and ${models.length} model(s) failed. Last: ${lastErr}`);
}

async function callGemini(
  messages: AIMessage[],
  options: AIRequestOptions
): Promise<string> {
  const apiKeys = getGeminiRequestKeyOrder();
  if (!getGeminiApiKeys().length) throw new Error("NO_KEY");
  if (!apiKeys.length) {
    const cooldown = rateLimitSentinel(_geminiKeyRateLimitedUntil.values());
    if (cooldown) throw new Error(cooldown);
    throw new Error('All configured Gemini keys were rejected. Replace the rejected key in Settings.');
  }

  let lastErr = "";
  for (const apiKey of apiKeys) {
    for (const model of GEMINI_MODEL_CHAIN) {
      // 1. Try Native Google AI Studio REST Endpoint first (100% reliable for free tier keys)
      try {
        const systemMsg = messages.find(m => m.role === 'system');
        const contents = messages
          .filter(m => m.role !== 'system')
          .map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          }));

        const nativeBody: Record<string, unknown> = {
          contents,
          generationConfig: {
            temperature: resolveTemperature(options),
            maxOutputTokens: options.maxTokens ?? 8192,
            ...(options.jsonMode ? { responseMimeType: "application/json" } : {}),
          },
        };
        if (systemMsg) {
          nativeBody.systemInstruction = { parts: [{ text: systemMsg.content }] };
        }

        const nativeUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const nativeRes = await fetch(nativeUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(nativeBody),
        });

        if (nativeRes.ok) {
          const data = await nativeRes.json();
          const out = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
          if (out) {
            _geminiKeyRateLimitedUntil.delete(apiKey);
            if (model !== GEMINI_MODEL_CHAIN[0]) console.info(`[AIRouter] Gemini used fallback model: ${model}`);
            return out;
          }
        }

        if (nativeRes.status === 429) {
          _geminiKeyRateLimitedUntil.set(apiKey, Date.now() + retryAfterMs(nativeRes));
          lastErr = 'Gemini key rate-limited (HTTP 429)';
          break;
        }

        const nativeText = await nativeRes.text().catch(() => "");
        if (nativeRes.status === 401 || (nativeRes.status === 403 && nativeText.includes("API_KEY_INVALID"))) {
          lastErr = 'Gemini key invalid/rejected';
          _geminiRejectedKeys.add(apiKey);
          break;
        }

        // 2. Fallback to OpenAI-compatible endpoint if native API fails with 400/404
        const body: Record<string, unknown> = {
          model,
          messages,
          temperature: resolveTemperature(options),
          max_tokens: options.maxTokens ?? 8192,
        };
        if (options.jsonMode) {
          body.response_format = { type: "json_object" };
        }

        const res = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        });

        if (res.status === 429) {
          _geminiKeyRateLimitedUntil.set(apiKey, Date.now() + retryAfterMs(res));
          lastErr = 'Gemini key rate-limited';
          break;
        }
        if (res.status === 401) {
          lastErr = 'Gemini key rejected';
          _geminiRejectedKeys.add(apiKey);
          break;
        }
        if (res.ok) {
          const data = await res.json();
          const out = data.choices?.[0]?.message?.content?.trim() || "";
          if (out) {
            if (model !== GEMINI_MODEL_CHAIN[0]) console.info(`[AIRouter] Gemini used fallback model: ${model}`);
            _geminiKeyRateLimitedUntil.delete(apiKey);
            return out;
          }
        }
        const text = await res.text().catch(() => "");
        lastErr = `Gemini error ${nativeRes.status}/${res.status}: ${text.slice(0, 120)}`;
      } catch (e: any) {
        lastErr = `Gemini request failed: ${e.message}`;
      }
    }
  }

  const cooldown = rateLimitSentinel(_geminiKeyRateLimitedUntil.values());
  if (cooldown) throw new Error(cooldown);
  throw new Error(`Gemini: all ${apiKeys.length} configured key(s) and models failed. Last: ${lastErr}`);
}

async function callOpenAI(
  messages: AIMessage[],
  options: AIRequestOptions
): Promise<string> {
  const apiKey = getOpenAIApiKey();
  if (!apiKey) throw new Error("NO_KEY");

  const body: Record<string, unknown> = {
    model: options.model?.startsWith('gpt-') ? options.model : OPENAI_DEFAULT_MODEL,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    temperature: resolveTemperature(options),
    max_tokens: options.maxTokens ?? 4096,
  };
  if (options.jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });

  if (res.status === 429) throw new Error('RATE_LIMIT');
  if (res.status === 401 || res.status === 403) throw new Error('Invalid OpenAI API key. Please update it in Settings.');
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`);
  
  const data = await res.json();
  const outputText = data.choices?.[0]?.message?.content?.trim() || "";
  if (!outputText) throw new Error('OpenAI returned an empty response');
  return outputText;
}

/**
 * HuggingFace — FREE fallback provider (Inference API).
 *
 * Free token from https://huggingface.co/settings/tokens — no credit card required.
 * Uses the OpenAI-compatible /v1/chat/completions endpoint with a free Llama model.
 * Rate limits are strict on the free tier, so it is used as a LAST-RESORT fallback.
 *
 * NOTE: Pollinations was removed — its API now returns HTTP 402 for everything.
 */
async function callHuggingFace(
  messages: AIMessage[],
  options: AIRequestOptions
): Promise<string> {
  const token = getHuggingFaceApiKey();
  if (!token) throw new Error('NO_KEY');

  const models = [
    options.model && options.model.startsWith('hf:') ? options.model.slice(3) : '',
    'meta-llama/Llama-3.2-3B-Instruct',
  ].filter(Boolean);

  const body: Record<string, unknown> = {
    model: models[0],
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    temperature: resolveTemperature(options),
    max_tokens: options.maxTokens ?? 2048,
  };
  if (options.jsonMode) body.response_format = { type: 'json_object' };

  let lastErr = '';
  for (const model of models) {
    try {
      const res = await fetch(
        `https://api-inference.huggingface.co/models/${model}/v1/chat/completions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ ...body, model }),
        },
      );
      if (res.status === 429) { lastErr = 'HuggingFace rate-limited (HTTP 429)'; continue; }
      if (res.status === 401 || res.status === 403) throw new Error('Invalid HuggingFace token. Get a free one at huggingface.co/settings/tokens');
      if (!res.ok) { lastErr = `HuggingFace error ${res.status}: ${(await res.text().catch(() => '')).slice(0, 100)}`; continue; }
      const data = await res.json();
      const out = data?.choices?.[0]?.message?.content?.trim() || '';
      if (out) return out;
      lastErr = 'HuggingFace returned an empty response';
    } catch (e: any) { lastErr = `HuggingFace request failed: ${e.message}`; }
  }
  throw new Error(lastErr || 'HuggingFace: all models failed');
}

async function callCloudflare(
  messages: AIMessage[],
  options: AIRequestOptions
): Promise<string> {
  const token = getCloudflareApiKey() || viteEnv('VITE_CF_AI_TOKEN');
  const accountId = getCloudflareAccountId() || viteEnv('VITE_CF_ACCOUNT_ID');
  if (!token || !accountId) throw new Error("NO_KEY");

  const body = {
    messages,
    temperature: resolveTemperature(options),
    max_tokens: options.maxTokens ?? 4096,
  };

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    }
  );

  if (res.status === 429) throw new Error("RATE_LIMIT");
  if (res.status === 401 || res.status === 403) throw new Error("Invalid Cloudflare AI credentials. Please update them in Settings.");

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if ([400, 404, 413, 500, 502, 503, 504].includes(res.status)) {
      throw new Error(`Cloudflare AI error ${res.status}: ${text.slice(0, 100)}`);
    }
    throw new Error(`Cloudflare AI error ${res.status}: ${text.slice(0, 100)}`);
  }

  const data = await res.json();
  const out: string = (data?.result?.response ?? data?.response ?? "").trim();
  if (!out) throw new Error("Cloudflare AI returned empty response");
  return out;
}

// ── OpenAI-Compatible Generic Helper (for DeepSeek / Together / Mistral) ──────

const OPENAI_COMPATIBLE_PROVIDERS: Record<string, {
  baseUrl: string;
  defaultModel: string;
  getKey: () => string;
}> = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1/chat/completions',
    defaultModel: 'deepseek-chat',
    getKey: getDeepSeekApiKey,
  },
  together: {
    baseUrl: 'https://api.together.xyz/v1/chat/completions',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free',
    getKey: getTogetherApiKey,
  },
  mistral: {
    baseUrl: 'https://api.mistral.ai/v1/chat/completions',
    defaultModel: 'open-mistral-nemo',
    getKey: getMistralApiKey,
  },
};

async function callOpenAICompatible(
  name: string,
  messages: AIMessage[],
  options: AIRequestOptions
): Promise<string> {
  const cfg = OPENAI_COMPATIBLE_PROVIDERS[name];
  if (!cfg) throw new Error(`Unknown OpenAI-compatible provider: ${name}`);
  const apiKey = cfg.getKey();
  if (!apiKey) throw new Error('NO_KEY');

  const models = [
    options.model && !options.model.startsWith('hf:') ? options.model : '',
    cfg.defaultModel,
  ].filter(Boolean);

  const body: Record<string, unknown> = {
    model: models[0],
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    temperature: resolveTemperature(options),
    max_tokens: options.maxTokens ?? 4096,
  };
  if (options.jsonMode) body.response_format = { type: 'json_object' };

  let lastErr = '';
  for (const model of models) {
    try {
      const res = await fetch(cfg.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ ...body, model }),
      });
      if (res.status === 429) { lastErr = `${name} rate-limited (HTTP 429)`; continue; }
      if (res.status === 401 || res.status === 403) {
        throw new Error(`Invalid ${name} API key. Get a free key from the ${name} console.`);
      }
      if (!res.ok) {
        lastErr = `${name} error ${res.status}: ${(await res.text().catch(() => '')).slice(0, 100)}`;
        continue;
      }
      const data = await res.json();
      const out = data?.choices?.[0]?.message?.content?.trim() || '';
      if (out) return out;
      lastErr = `${name} returned empty response`;
    } catch (e: any) { lastErr = `${name} request failed: ${e.message}`; }
  }
  throw new Error(lastErr || `${name}: all models failed`);
}

async function callDeepSeek(messages: AIMessage[], options: AIRequestOptions): Promise<string> {
  return callOpenAICompatible('deepseek', messages, options);
}

async function callTogether(messages: AIMessage[], options: AIRequestOptions): Promise<string> {
  return callOpenAICompatible('together', messages, options);
}

async function callMistral(messages: AIMessage[], options: AIRequestOptions): Promise<string> {
  return callOpenAICompatible('mistral', messages, options);
}

// ─── Provider definition (used by selectProvider + routeAIRequest) ───────────

interface ProviderDef {
  name: ProviderName;
  isAvailable: boolean;
  fn: (m: AIMessage[], o: AIRequestOptions) => Promise<string>;
}

function buildProviders(): ProviderDef[] {
  return [
    { name: "groq", isAvailable: isAvailable("groq"), fn: callGroq },
    { name: "gemini", isAvailable: isAvailable("gemini"), fn: callGemini },
    { name: "cloudflare", isAvailable: isAvailable("cloudflare"), fn: callCloudflare },
    // Free-key fallbacks (HuggingFace Inference API — free token, no CC needed)
    { name: "huggingface", isAvailable: isAvailable("huggingface"), fn: callHuggingFace },
    // New FREE OpenAI-compatible providers — no CC required
    { name: "deepseek", isAvailable: isAvailable("deepseek"), fn: callDeepSeek },
    { name: "together", isAvailable: isAvailable("together"), fn: callTogether },
    { name: "mistral", isAvailable: isAvailable("mistral"), fn: callMistral },
  ];
}

const GEMINI_FIRST_TASKS = new Set<NonNullable<AIRequestOptions['taskType']>>([
  'parse', 'cfpb_narrative', 'legal_demand',
]);

const GROQ_FIRST_TASKS = new Set<NonNullable<AIRequestOptions['taskType']>>([
  'classify', 'letter', 'analyze', 'metro2_audit', 'variation',
  'score_impact', 'goodwill', 'cross_bureau_diff',
]);

const FREE_FIRST_TASKS = new Set<NonNullable<AIRequestOptions['taskType']>>([
  'classify', 'analyze', 'metro2_audit', 'goodwill', 'cross_bureau_diff',
]);

type ProviderOrder = readonly ProviderName[];

function providerOrderForMode(mode: AIProviderMode, geminiFirstTask: boolean): ProviderOrder {
  // All chains now include deepseek, together, mistral as deep fallbacks
  if (geminiFirstTask) {
    switch (mode) {
      case 'experimental-openai-first':
      case 'free-first':
        // FREE-FIRST: Try free/no-CC providers before keyed
        return ['deepseek', 'together', 'mistral', 'huggingface', 'gemini', 'groq', 'cloudflare'];
      case 'backup-quality':
        return ['gemini', 'groq', 'deepseek', 'together', 'mistral', 'cloudflare', 'huggingface'];
      case 'primary-stack':
      case 'gemini-heavy':
        return ['gemini', 'groq', 'cloudflare', 'huggingface', 'deepseek', 'together', 'mistral'];
      default: {
        const _exhaustive: never = mode;
        return _exhaustive;
      }
    }
  }

  switch (mode) {
    case 'primary-stack':
      return ['groq', 'gemini', 'cloudflare', 'huggingface', 'deepseek', 'together', 'mistral'];
    case 'free-first':
      return ['deepseek', 'together', 'mistral', 'huggingface', 'groq', 'gemini', 'cloudflare'];
    case 'gemini-heavy':
      return ['gemini', 'groq', 'cloudflare', 'huggingface', 'deepseek', 'together', 'mistral'];
    case 'backup-quality':
      return ['gemini', 'groq', 'deepseek', 'together', 'mistral', 'cloudflare', 'huggingface'];
    case 'experimental-openai-first':
      // Legacy label — now FREE-FIRST (same as free-first but keeps label for stored-user compat)
      return ['deepseek', 'together', 'mistral', 'huggingface', 'groq', 'gemini', 'cloudflare'];
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

function selectProvider(
  taskType: AIRequestOptions['taskType'],
  providers: ProviderDef[]
): ProviderDef[] {
  const byName = (n: ProviderName) => providers.find(p => p.name === n);
  const mode = getAIProviderMode();
  const geminiFirst = taskType !== undefined && GEMINI_FIRST_TASKS.has(taskType);
  const order = providerOrderForMode(mode, geminiFirst);

  if (taskType === undefined || (!geminiFirst && !GROQ_FIRST_TASKS.has(taskType))) {
    return providerOrderForMode('primary-stack', false)
      .map(n => byName(n))
      .filter((p): p is ProviderDef => !!p);
  }

  return order
    .map(n => byName(n))
    .filter((p): p is ProviderDef => !!p);
}

// ─── Public router: cascading failover ────────────────────────────────────────

export async function routeAIRequest(
  messages: AIMessage[],
  options: AIRequestOptions = {}
): Promise<string> {
  const allProviders = buildProviders();
  // Letter tasks use Groq/Gemini primarily, but also permit DeepSeek and Mistral
  // as quality fallbacks (they produce excellent letter-quality output).
  const letterOnly = options.providerScope === 'groq-gemini-only' || options.taskType === 'letter' || options.taskType === 'legal_demand';
  const ordered = selectProvider(options.taskType, allProviders)
    .filter(provider => !letterOnly || provider.name === 'groq' || provider.name === 'gemini' || provider.name === 'deepseek' || provider.name === 'mistral');

  let lastError: Error | null = null;

  for (const provider of ordered) {
    if (!isAvailable(provider.name)) {
      const until = _state[provider.name].rateLimitedUntil;
      const reason = until > Date.now()
        ? `rate-limited until ${new Date(until).toLocaleTimeString()}`
        : `too many consecutive failures`;
      console.info(`[AIRouter] Skipping ${provider.name}: ${reason}`);
      continue;
    }

    try {
      const result = await provider.fn(messages, options);
      markSuccess(provider.name);
      console.info(`[AIRouter] Success via ${provider.name} (task: ${options.taskType || 'default'})`);
      return result;
    } catch (err: any) {
      if (err.message === "NO_KEY") {
        continue;
      }
      if (err.message === "RATE_LIMIT" || err.message.startsWith("RATE_LIMIT:")) {
        const requestedCooldown = Number(err.message.split(':')[1]);
        markRateLimited(
          provider.name,
          Number.isFinite(requestedCooldown) ? Math.max(1_000, requestedCooldown) : COOLDOWN_MS,
        );
        lastError = new Error(`${provider.name} rate limit hit — failing over`);
        continue;
      }
      markFailure(provider.name);
      lastError = err;
      console.warn(`[AIRouter] ${provider.name} failed: ${err.message}`);
    }
  }

  const names = ordered.map(p => p.name);
  const cooldowns = names.map(n => _state[n].rateLimitedUntil).filter(until => until > Date.now());
  const soonMs = cooldowns.length ? Math.min(...cooldowns) - Date.now() : 0;
  if (soonMs > 0) {
    const sec = Math.ceil(soonMs / 1000);
    throw new AIProviderCooldownError(
      Math.max(1_000, soonMs),
      `AI_RATE_LIMIT: Groq/Gemini are cooling down. Automatic retry in ${sec}s.`,
    );
  }

  throw lastError || new Error("All AI providers failed. Check your API keys in Settings → AI Configuration.");
}

export async function aiComplete(
  systemPrompt: string,
  userContent: string,
  taskType: NonNullable<AIRequestOptions['taskType']>
): Promise<string> {
  const jsonModeTasks: NonNullable<AIRequestOptions['taskType']>[] = [
    'parse', 'classify', 'metro2_audit', 'score_impact', 'cross_bureau_diff',
  ];
  return routeAIRequest(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    { taskType, jsonMode: jsonModeTasks.includes(taskType), maxTokens: 8192 }
  );
}

export async function routeAIRequestFast(
  messages: AIMessage[],
  options: Omit<AIRequestOptions, "model"> = {}
): Promise<string> {
  return routeAIRequest(messages, {
    ...options,
    model: GROQ_PRIMARY_MODEL,
    maxTokens: options.maxTokens ?? 512,
    taskType: options.taskType,
  });
}

export async function checkProviderHealth(): Promise<
  Record<string, { available: boolean; model: string; error?: string }>
> {
  const results: Record<string, { available: boolean; model: string; error?: string }> = {};
  const ping: AIMessage[] = [
    { role: 'system', content: 'You are a test.' },
    { role: 'user', content: 'Reply with exactly: OK' },
  ];

  for (const [name, fn, model] of [
    ['groq', callGroq, GROQ_PRIMARY_MODEL],
    ['gemini', callGemini, GEMINI_MODEL_CHAIN[0] as string],
    ['cloudflare', callCloudflare, '@cf/meta/llama-3.3-70b-instruct-fp8'],
    ['huggingface', callHuggingFace, 'meta-llama/Llama-3.2-3B-Instruct'],
    ['deepseek', callDeepSeek, 'deepseek-chat'],
    ['together', callTogether, 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free'],
    ['mistral', callMistral, 'open-mistral-nemo'],
  ] as const) {
    try {
      await fn(ping, { maxTokens: 10 });
      results[name] = { available: true, model };
    } catch (e: any) {
      results[name] = { available: false, model, error: e.message };
    }
  }

  return results;
}

export async function aiStream(
  systemPrompt: string,
  userPrompt: string,
  onChunk: (chunk: string) => void,
  taskType: NonNullable<AIRequestOptions['taskType']> = 'letter'
): Promise<void> {
  const [apiKey] = getGroqRequestKeyOrder();

  if (apiKey && isAvailable('groq')) {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: GROQ_PRIMARY_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          stream: true,
          temperature: resolveTemperature({ taskType }),
          max_tokens: 4096,
        }),
      });

      if (response.ok && response.body) {
        _groqKeyRateLimitedUntil.delete(apiKey);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const raw = decoder.decode(value);
          for (const line of raw.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const json = line.slice('data: '.length).trim();
            if (json === '[DONE]') continue;
            try {
              const parsed = JSON.parse(json);
              const delta = parsed?.choices?.[0]?.delta?.content;
              if (delta) onChunk(delta);
            } catch { /* skip malformed SSE line */ }
          }
        }
        markSuccess('groq');
        return;
      }
      if (response.status === 429) {
        _groqKeyRateLimitedUntil.set(apiKey, Date.now() + COOLDOWN_MS);
      }
    } catch (e) {
      console.warn('[AIRouter] Groq streaming failed — falling back to non-stream');
    }
  }

  const result = await aiComplete(systemPrompt, userPrompt, taskType);
  onChunk(result);
}

export function getProviderStatus(): Array<{
  name: string;
  available: boolean;
  configured: boolean;
  cooldownRemaining: number;
  keyLink?: string;
}> {
  const now = Date.now();
  return [
    {
      name: "Groq (Primary)",
      available: isAvailable("groq"),
      configured: getGroqApiKeys().length > 0,
      cooldownRemaining: Math.max(0, Math.ceil((_state.groq.rateLimitedUntil - now) / 1000)),
      keyLink: 'https://console.groq.com/keys',
    },
    {
      name: "Gemini (Secondary)",
      available: isAvailable("gemini"),
      configured: getGeminiApiKeys().length > 0,
      cooldownRemaining: Math.max(0, Math.ceil((_state.gemini.rateLimitedUntil - now) / 1000)),
      keyLink: 'https://aistudio.google.com/app/apikey',
    },
    {
      name: "Cloudflare Workers AI",
      available: isAvailable("cloudflare"),
      configured: !!((getCloudflareApiKey() && getCloudflareAccountId()) || (viteEnv('VITE_CF_AI_TOKEN') && viteEnv('VITE_CF_ACCOUNT_ID'))),
      cooldownRemaining: Math.max(0, Math.ceil((_state.cloudflare.rateLimitedUntil - now) / 1000)),
      keyLink: 'https://dash.cloudflare.com/?to=/:account/ai/workers-ai',
    },
    {
      name: "HuggingFace (FREE — free token)",
      available: isAvailable("huggingface"),
      configured: !!getHuggingFaceApiKey(),
      cooldownRemaining: Math.max(0, Math.ceil((_state.huggingface.rateLimitedUntil - now) / 1000)),
      keyLink: 'https://huggingface.co/settings/tokens',
    },
    {
      name: "DeepSeek (FREE — no CC needed)",
      available: isAvailable("deepseek"),
      configured: !!getDeepSeekApiKey(),
      cooldownRemaining: Math.max(0, Math.ceil((_state.deepseek.rateLimitedUntil - now) / 1000)),
      keyLink: 'https://platform.deepseek.com/api_keys',
    },
    {
      name: "Together AI (FREE — $1 free credit)",
      available: isAvailable("together"),
      configured: !!getTogetherApiKey(),
      cooldownRemaining: Math.max(0, Math.ceil((_state.together.rateLimitedUntil - now) / 1000)),
      keyLink: 'https://api.together.xyz/settings/api-keys',
    },
    {
      name: "Mistral AI (FREE — free tier)",
      available: isAvailable("mistral"),
      configured: !!getMistralApiKey(),
      cooldownRemaining: Math.max(0, Math.ceil((_state.mistral.rateLimitedUntil - now) / 1000)),
      keyLink: 'https://console.mistral.ai/api-key/',
    },
  ];
}
