/// <reference types="vite/client" />

/**
 * AI Router — Cascading Multi-Provider Failover Engine
 * Priority: Groq (speed) → Gemini (capacity) → Cloudflare (free fallback) → OpenAI (quality fallback)
 * Features: per-provider rate-limit tracking, 60-second cooldowns on HTTP 429,
 *           automatic provider promotion/demotion, unified message interface.
 * 
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

type ProviderName = "groq" | "gemini" | "cloudflare" | "openai";

const _state: Record<ProviderName, ProviderState> = {
  groq: { rateLimitedUntil: 0, consecutiveFailures: 0 },
  gemini: { rateLimitedUntil: 0, consecutiveFailures: 0 },
  cloudflare: { rateLimitedUntil: 0, consecutiveFailures: 0 },
  openai: { rateLimitedUntil: 0, consecutiveFailures: 0 },
};

const COOLDOWN_MS = 60_000; // default when a provider omits Retry-After
const MAX_FAILURES_BEFORE_SKIP = 15;

/**
 * Default Groq chat model (matches the pre–multi-cascade “single model” setup).
 * Keep the chain small: 70B first for reliability, 8B instant as fallback on model errors.
 */
export const GROQ_PRIMARY_MODEL = "llama-3.3-70b-versatile" as const;
/** Gemini model chain — tried in order on 400/404 (model-not-found). */
export const GEMINI_MODEL_CHAIN: readonly string[] = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
] as const;
/** Deprecations: try fallbacks on 400/404/empty body — never treat those as “bad key.” */
export const GROQ_MODEL_CHAIN: readonly string[] = [
  GROQ_PRIMARY_MODEL,
  "llama-3.1-8b-instant",
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

export const OPENAI_DEFAULT_MODEL = 'gpt-5.6-luna' as const;

// ─── Key accessors ────────────────────────────────────────────────────────────
// Keys are kept in an in-memory cache and persisted via SecureKeyService.
// No direct localStorage usage in this router.

export interface AIProviderSettings {
  groqApiKey: string;
  groqApiKey2: string;
  geminiApiKey: string;
  geminiApiKey2: string;
}

export type AIProviderMode =
  | 'primary-stack'
  | 'gemini-heavy'
  | 'backup-quality'
  | 'experimental-openai-first';

const PROVIDER_MODE_KEY = 'dylandos_ai_provider_mode';

const VALID_PROVIDER_MODES: readonly AIProviderMode[] = [
  'primary-stack',
  'gemini-heavy',
  'backup-quality',
  'experimental-openai-first',
] as const;

function migrateStoredProviderMode(raw: string | null): AIProviderMode {
  if (raw === 'quality-first') return 'backup-quality';
  if (raw === 'free-first' || !raw) return 'primary-stack';
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

const _keyCache: Record<"groq" | "groq2" | "gemini" | "gemini2" | "openai" | "cloudflare" | "cloudflareAccountId", string> = {
  groq: "",
  groq2: "",
  gemini: "",
  gemini2: "",
  openai: "",
  cloudflare: "",
  cloudflareAccountId: "",
};

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

/**
 * Alternates Key 1 → Key 2 for consecutive requests. A key that returns 429 is
 * skipped for 60 seconds, and the other key is tried immediately in the same request.
 */
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
    const [groq, groq2, gemini, gemini2, openai, cloudflare, cloudflareAccountId] = await Promise.all([
      SecureKeyService.getKey(KEY_NAMES.GROQ),
      SecureKeyService.getKey(KEY_NAMES.GROQ_2),
      SecureKeyService.getKey(KEY_NAMES.GEMINI),
      SecureKeyService.getKey(KEY_NAMES.GEMINI_2),
      SecureKeyService.getKey(KEY_NAMES.OPENAI),
      SecureKeyService.getKey(KEY_NAMES.CLOUDFLARE),
      SecureKeyService.getKey(KEY_NAMES.CLOUDFLARE_ACCOUNT_ID),
    ]);
    if (groq) _keyCache.groq = groq;
    if (groq2) _keyCache.groq2 = groq2;
    if (gemini) _keyCache.gemini = gemini;
    if (gemini2) _keyCache.gemini2 = gemini2;
    if (openai) _keyCache.openai = openai;
    if (cloudflare) _keyCache.cloudflare = cloudflare;
    if (cloudflareAccountId) _keyCache.cloudflareAccountId = cloudflareAccountId;
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

/**
 * The queue uses the larger configured Groq/Gemini key pool. This lets a
 * Gemini-only dual-key setup generate two letters in parallel instead of being
 * silently throttled by the old Groq-only capacity check.
 */
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
          // Do not spend half of every batch retrying an invalid/revoked key.
          // Saving a changed key clears this state immediately.
          _groqRejectedKeys.add(apiKey);
        }
        console.warn(`[AIRouter] ${lastErr} — trying next configured key.`);
        break;
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

  // Use OpenAI-compatible endpoint — supports full message array, no conversion needed.
  // Try each model in the chain — 400/404 usually means model unavailable, not bad key.
  let lastErr = "";
  for (const apiKey of apiKeys) {
    for (const model of GEMINI_MODEL_CHAIN) {
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
    if (res.status === 401 || res.status === 403) {
      lastErr = 'Gemini key rejected';
      // Continue with Key 2, but do not waste future generation attempts on
      // a revoked or invalid credential until the user replaces it.
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
      lastErr = "empty response";
      continue;
    }
    const text = await res.text().catch(() => "");
    lastErr = `Gemini error ${res.status}: ${text.slice(0, 120)}`;
    if ([400, 403, 404, 413, 429, 500, 502, 503, 504].includes(res.status)) {
      console.warn(`[AIRouter] Gemini model ${model} failed (${res.status}) — trying next.`);
      continue;
    }
    throw new Error(lastErr);
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
  const input = messages.map(message => ({ role: message.role, content: message.content }));
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: options.model?.startsWith('gpt-') ? options.model : OPENAI_DEFAULT_MODEL,
      input,
      max_output_tokens: options.maxTokens ?? 4096,
    }),
  });
  if (res.status === 429) throw new Error('RATE_LIMIT');
  if (res.status === 401 || res.status === 403) throw new Error('Invalid OpenAI API key. Please update it in Settings.');
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`);
  const data = await res.json();
  const outputText = typeof data.output_text === 'string'
    ? data.output_text
    : (data.output || []).flatMap((item: any) => item.content || []).map((part: any) => part.text || '').join('');
  if (!outputText.trim()) throw new Error('OpenAI returned an empty response');
  return outputText.trim();
}

async function callCloudflare(
  messages: AIMessage[],
  options: AIRequestOptions
): Promise<string> {
  const token = getCloudflareApiKey() || (import.meta.env.VITE_CF_AI_TOKEN as string | undefined);
  const accountId = getCloudflareAccountId() || (import.meta.env.VITE_CF_ACCOUNT_ID as string | undefined);
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
    { name: "openai", isAvailable: isAvailable("openai"), fn: callOpenAI },
  ];
}

/**
 * Determines the ordered provider list for a given task type and user mode.
 *
 * MODE CASCADE MAP (see AIProviderMode):
 *   primary-stack:        Groq → Gemini → Cloudflare → OpenAI
 *   gemini-heavy:         Gemini → Groq → Cloudflare → OpenAI
 *   backup-quality:       Gemini → Groq → OpenAI → Cloudflare
 *   experimental-openai-first: OpenAI → Gemini → Groq → Cloudflare
 *
 * TASK OVERRIDES:
 *   parse / cfpb_narrative / legal_demand → always Gemini-first (or OpenAI-first
 *   only in experimental-openai-first). OpenAI is never first for Autopilot letters
 *   in primary-stack, gemini-heavy, or backup-quality.
 */
const GEMINI_FIRST_TASKS = new Set<NonNullable<AIRequestOptions['taskType']>>([
  'parse', 'cfpb_narrative', 'legal_demand',
]);

const GROQ_FIRST_TASKS = new Set<NonNullable<AIRequestOptions['taskType']>>([
  'classify', 'letter', 'analyze', 'metro2_audit', 'variation',
  'score_impact', 'goodwill', 'cross_bureau_diff',
]);

type ProviderOrder = readonly ProviderName[];

function providerOrderForMode(mode: AIProviderMode, geminiFirstTask: boolean): ProviderOrder {
  if (geminiFirstTask) {
    switch (mode) {
      case 'experimental-openai-first':
        return ['openai', 'gemini', 'groq', 'cloudflare'];
      case 'backup-quality':
        return ['gemini', 'groq', 'openai', 'cloudflare'];
      case 'primary-stack':
      case 'gemini-heavy':
        return ['gemini', 'groq', 'cloudflare', 'openai'];
      default: {
        const _exhaustive: never = mode;
        return _exhaustive;
      }
    }
  }

  switch (mode) {
    case 'primary-stack':
      return ['groq', 'gemini', 'cloudflare', 'openai'];
    case 'gemini-heavy':
      return ['gemini', 'groq', 'cloudflare', 'openai'];
    case 'backup-quality':
      return ['gemini', 'groq', 'openai', 'cloudflare'];
    case 'experimental-openai-first':
      return ['openai', 'gemini', 'groq', 'cloudflare'];
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

  // Unknown task types fall back to primary-stack Groq-first cascade
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

/**
 * Route an AI request through providers in priority order (see AIProviderMode).
 * Parse / CFPB / legal tasks: Gemini-first cascade (OpenAI-first only in experimental mode).
 * Letter / analyze tasks: mode-specific cascade; Autopilot letters never use OpenAI first.
 * Skips rate-limited or failing providers automatically.
 */
export async function routeAIRequest(
  messages: AIMessage[],
  options: AIRequestOptions = {}
): Promise<string> {
  const allProviders = buildProviders();
  const letterOnly = options.providerScope === 'groq-gemini-only' || options.taskType === 'letter' || options.taskType === 'legal_demand';
  const ordered = selectProvider(options.taskType, allProviders)
    .filter(provider => !letterOnly || provider.name === 'groq' || provider.name === 'gemini');

  let lastError: Error | null = null;

  for (const provider of ordered) {
    // Re-check availability at call time (may have changed since buildProviders)
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
        continue; // Provider not configured — skip silently
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

  // All ordered providers exhausted
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

/**
 * Convenience wrapper for single-turn system+user requests.
 * taskType strictly controls provider routing — see AIRequestOptions for full map.
 */
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

/**
 * Variant for fast/cheap calls that prefer smaller models.
 */
export async function routeAIRequestFast(
  messages: AIMessage[],
  options: Omit<AIRequestOptions, "model"> = {}
): Promise<string> {
  return routeAIRequest(messages, {
    ...options,
    model: GROQ_PRIMARY_MODEL, // same primary as full requests; only maxTokens differs
    maxTokens: options.maxTokens ?? 512,
    taskType: options.taskType, // forward task type for proper provider selection
  });
}

/**
 * Live health check — pings each provider with a tiny request.
 * Call from Settings to display provider availability.
 */
export async function checkProviderHealth(): Promise<
  Record<string, { available: boolean; model: string; error?: string }>
> {
  const results: Record<string, { available: boolean; model: string; error?: string }> = {};
  const ping: AIMessage[] = [
    { role: 'system', content: 'You are a test.' },
    { role: 'user', content: 'Reply with exactly: OK' },
  ];

  try {
    await callGroq(ping, { maxTokens: 10 });
    results.groq = { available: true, model: GROQ_PRIMARY_MODEL };
  } catch (e: any) {
    results.groq = { available: false, model: GROQ_PRIMARY_MODEL, error: e.message };
  }

  try {
    await callGemini(ping, { maxTokens: 10 });
    results.gemini = { available: true, model: GEMINI_MODEL_CHAIN[0] as string };
  } catch (e: any) {
    results.gemini = { available: false, model: GEMINI_MODEL_CHAIN[0] as string, error: e.message };
  }

  try {
    await callCloudflare(ping, { maxTokens: 10 });
    results.cloudflare = { available: true, model: '@cf/meta/llama-3.3-70b-instruct-fp8' };
  } catch (e: any) {
    results.cloudflare = { available: false, model: '@cf/meta/llama-3.3-70b-instruct-fp8', error: e.message };
  }

  try {
    await callOpenAI(ping, { maxTokens: 16 });
    results.openai = { available: true, model: OPENAI_DEFAULT_MODEL };
  } catch (e: any) {
    results.openai = { available: false, model: OPENAI_DEFAULT_MODEL, error: e.message };
  }

  return results;
}

/**
 * Streaming letter generation — Groq SSE stream first, non-stream fallback.
 * onChunk is called incrementally with each text delta.
 */
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

  // Non-streaming fallback via full cascade
  const result = await aiComplete(systemPrompt, userPrompt, taskType);
  onChunk(result);
}

/**
 * Returns a human-readable provider status summary for display in Settings.
 */
export function getProviderStatus(): Array<{
  name: string;
  available: boolean;
  configured: boolean;
  cooldownRemaining: number; // seconds, 0 if none
}> {
  const now = Date.now();
  return [
    {
      name: "Groq (Primary)",
      available: isAvailable("groq"),
      configured: getGroqApiKeys().length > 0,
      cooldownRemaining: Math.max(0, Math.ceil((_state.groq.rateLimitedUntil - now) / 1000)),
    },
    {
      name: "Gemini (Secondary)",
      available: isAvailable("gemini"),
      configured: getGeminiApiKeys().length > 0,
      cooldownRemaining: Math.max(0, Math.ceil((_state.gemini.rateLimitedUntil - now) / 1000)),
    },
    {
      name: "Cloudflare Workers AI (Slot 3)",
      available: isAvailable("cloudflare"),
      configured: !!((getCloudflareApiKey() && getCloudflareAccountId()) || (import.meta.env.VITE_CF_AI_TOKEN && import.meta.env.VITE_CF_ACCOUNT_ID)),
      cooldownRemaining: Math.max(0, Math.ceil((_state.cloudflare.rateLimitedUntil - now) / 1000)),
    },
    {
      name: "OpenAI (Backup Quality)",
      available: isAvailable("openai"),
      configured: !!getOpenAIApiKey(),
      cooldownRemaining: Math.max(0, Math.ceil((_state.openai.rateLimitedUntil - now) / 1000)),
    },
  ];
}
