import { BoilerplateDetectedException } from './letterValidator';
import { AIProviderCooldownError, getConfiguredLetterKeyCapacity } from './aiRouter';

// ─── WORLD-CLASS QUEUE CONFIGURATION (§6.1) ──────────────────────────────────
// Adaptive token-bucket throttling tuned to eliminate Groq HTTP 429
// rate-limit storms and Gemini 400/404/empty-response failures during batch
// letter generation, without stalling the user's queue.
export const QUEUE_CONFIG = {
  MAX_CONCURRENCY: 2,            // Maximum parallel LLM network requests
  MIN_REQUEST_INTERVAL_MS: 3_500, // 3.5-second mandatory cooldown between requests
  MAX_RATE_LIMIT_RETRIES: 6,     // Cap retries to 6 (with jittered exponential backoff)
  BASE_BACKOFF_MS: 2_000,        // 2s → 4s → 8s → 16s → 32s → 60s
  MAX_BACKOFF_MS: 60_000,        // Maximum backoff ceiling
} as const;

const MAX_CONCURRENCY = QUEUE_CONFIG.MAX_CONCURRENCY;
const MAX_RATE_LIMIT_RETRIES = QUEUE_CONFIG.MAX_RATE_LIMIT_RETRIES;
const MAX_BOILERPLATE_RETRIES = 3;
const MIN_REQUEST_INTERVAL_MS = QUEUE_CONFIG.MIN_REQUEST_INTERVAL_MS;
// ─── TYPES ────────────────────────────────────────────────────────────────────
export type TaskFactory<T> = (attemptNumber: number) => Promise<T>;

export type TaskStatus = 'pending' | 'waiting' | 'active' | 'completed' | 'failed' | 'manual_review';

export interface QueueTask<T> {
  id: string;
  factory: TaskFactory<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  status: TaskStatus;
  rateLimitAttempts: number;
  boilerplateAttempts: number;
  createdAt: number;
  lastAttemptAt?: number;
  failureReasons: string[];
  /**
   * World-Class §6.1 kill-switch removal: when every AI retry is exhausted,
   * resolve `null` instead of rejecting so the LetterGenerationOrchestrator can
   * render the deterministic Metro 2 fallback letter (Net-100% guarantee).
   */
  resolveNullOnExhaustion?: boolean;
}

export interface EnqueueOptions {
  resolveNullOnExhaustion?: boolean;
}

export interface QueueStatus {
  pending: number;
  active: number;
  waiting: number;
  completed: number;
  failed: number;
  manualReview: number;
}

// ─── RATE LIMIT DETECTION ─────────────────────────────────────────────────────
export function isRateLimitError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes('rate limit') ||
      msg.includes('429') ||
      msg.includes('too many requests') ||
      msg.includes('quota exceeded') ||
      msg.includes('resource exhausted') ||
      msg.includes('ai_rate_limit') ||
      msg.includes('temporarily unavailable') ||
      // LLM_EMPTY_RESPONSE is our sentinel for a rate-limit that was silently swallowed
      // by the provider layer (the API returned HTTP 200 with an empty body instead
      // of a proper 429). Treat it as a rate-limit so the backoff machinery kicks in.
      msg.includes('llm_empty_response')
    );
  }
  return false;
}

// ─── ADAPTIVE BACKOFF CALCULATOR (§6.1) ──────────────────────────────────────
// Jittered exponential backoff prevents thundering-herd API retries when a
// batch of letters hits a rate limit at the same moment. Honors the provider's
// Retry-After header when present. Produces: 2s → 4s → 8s → 16s → 32s → 60s cap.
export function computeAdaptiveBackoff(attempt: number, retryAfterHeaderMs?: number): number {
  if (retryAfterHeaderMs && retryAfterHeaderMs > 0) {
    return Math.min(retryAfterHeaderMs + 500, QUEUE_CONFIG.MAX_BACKOFF_MS);
  }
  const exponential = QUEUE_CONFIG.BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
  const jitter = Math.random() * 800;
  return Math.min(exponential + jitter, QUEUE_CONFIG.MAX_BACKOFF_MS);
}

// ─── QUEUE MANAGER CLASS ──────────────────────────────────────────────────────
export class APIQueueManager {
  private queue: QueueTask<unknown>[] = [];
  private activeCount = 0;
  private completedCount = 0;
  private failedCount = 0;
  private manualReviewCount = 0;
  private lastRequestTimestamp = 0;

  // ── Public API ──────────────────────────────────────────────────────────────
  enqueue<T>(id: string, factory: TaskFactory<T>, options: EnqueueOptions = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task: QueueTask<T> = {
        id,
        factory,
        resolve,
        reject,
        status: 'pending',
        rateLimitAttempts: 0,
        boilerplateAttempts: 0,
        createdAt: Date.now(),
        failureReasons: [],
        resolveNullOnExhaustion: options.resolveNullOnExhaustion ?? false,
      };
      this.queue.push(task as QueueTask<unknown>);
      this.drain();
    });
  }

  status(): QueueStatus {
    return {
      pending: this.queue.filter((t) => t.status === 'pending').length,
      active: this.activeCount,
      waiting: this.queue.filter((t) => t.status === 'waiting').length,
      completed: this.completedCount,
      failed: this.failedCount,
      manualReview: this.manualReviewCount,
    };
  }

  // ── Internal Drain ──────────────────────────────────────────────────────────
  private drain(): void {
    const concurrency = getConfiguredLetterKeyCapacity() >= 2 ? MAX_CONCURRENCY : 1;
    while (
      this.activeCount < concurrency &&
      this.queue.some((t) => t.status === 'pending')
    ) {
      const task = this.queue.find((t) => t.status === 'pending');
      if (!task) break;
      task.status = 'active';
      this.activeCount++;
      this.executeTask(task).finally(() => {
        this.activeCount--;
        this.drain();
      });
    }
  }

  // ── Task Execution Engine ───────────────────────────────────────────────────
  private async executeTask(task: QueueTask<unknown>): Promise<void> {
    await this.enforceRequestInterval();
    task.lastAttemptAt = Date.now();
    this.lastRequestTimestamp = Date.now();

    try {
      const result = await task.factory(
        task.rateLimitAttempts + task.boilerplateAttempts + 1,
      );
      task.status = 'completed';
      this.completedCount++;
      task.resolve(result);
    } catch (err: unknown) {
      await this.handleTaskError(task, err);
    }
  }

  private async enforceRequestInterval(): Promise<void> {
    if (getConfiguredLetterKeyCapacity() >= 2) return;
    const now = Date.now();
    const elapsed = now - this.lastRequestTimestamp;
    if (this.lastRequestTimestamp > 0 && elapsed > 0 && elapsed < MIN_REQUEST_INTERVAL_MS) {
      await sleep(MIN_REQUEST_INTERVAL_MS - elapsed);
    }
  }

  // ── Error Classification & Retry Router ────────────────────────────────────
  private async handleTaskError(
    task: QueueTask<unknown>,
    err: unknown,
  ): Promise<void> {
    const errorMessage = err instanceof Error ? err.message : String(err);
    task.failureReasons.push(errorMessage);

    // ── Rate Limit Path ──────────────────────────────────────────────────────
    if (isRateLimitError(err)) {
      if (task.rateLimitAttempts < MAX_RATE_LIMIT_RETRIES) {
        task.rateLimitAttempts++;
        const backoff = err instanceof AIProviderCooldownError
          ? computeAdaptiveBackoff(task.rateLimitAttempts, err.retryAfterMs)
          : computeAdaptiveBackoff(task.rateLimitAttempts);
        console.warn(
          `[Queue:${task.id}] Rate limit hit. Attempt ${task.rateLimitAttempts}/${MAX_RATE_LIMIT_RETRIES}. Backing off ${(backoff / 1000).toFixed(1)}s.`,
        );
        task.status = 'waiting';
        dispatchQueueEvent('waiting', { taskId: task.id, retryAt: Date.now() + backoff, attempt: task.rateLimitAttempts });
        await sleep(backoff);
        task.status = 'pending';
        dispatchQueueEvent('resumed', { taskId: task.id, attempt: task.rateLimitAttempts });
        return this.executeTask(task);
      }
      // World-Class §6.1: NEVER abandon letter creation. Resolve null so the
      // orchestrator renders the deterministic Metro 2 fallback letter.
      return this.markExhaustedFailSafe(task, err,
        'AI providers remained unavailable after the queued retry window; deterministic fallback engaged.');
    }

    // ── Boilerplate Detection Path ───────────────────────────────────────────
    if (err instanceof BoilerplateDetectedException) {
      if (task.boilerplateAttempts < MAX_BOILERPLATE_RETRIES) {
        task.boilerplateAttempts++;
        console.warn(
          `[Queue:${task.id}] Boilerplate detected via [${err.detectionMethod}] at ${(err.similarity * 100).toFixed(1)}%. Retry ${task.boilerplateAttempts}/${MAX_BOILERPLATE_RETRIES}.`,
        );
        task.status = 'pending';
        return this.executeTask(task);
      }

      // ── World-Class §6.1: KILL SWITCH REMOVED ──────────────────────────
      // Boilerplate style loops are non-fatal style findings — never destroy
      // letter creation. Resolve null so the orchestrator's Stage-7
      // deterministic Metro 2 fallback renders a valid consumer letter.
      console.warn(
        `[Queue:${task.id}] AI provider attempts exhausted after ${MAX_BOILERPLATE_RETRIES} style retries. Routing to Deterministic Fallback via Orchestrator.`,
      );
      return this.markExhaustedFailSafe(task, err,
        'Boilerplate style loop exhausted; deterministic fallback engaged.');
    }

    // ── Unclassified Error ───────────────────────────────────────────────────
    console.error(`[Queue:${task.id}] Unclassified failure:`, errorMessage);
    return this.markFailed(task, err, 'Unclassified error.');
  }

  // ── Terminal State Handlers ─────────────────────────────────────────────────
  private markFailed(task: QueueTask<unknown>, err: unknown, reason: string): void {
    task.status = 'failed';
    this.failedCount++;
    console.error(`[Queue:${task.id}] FAILED — ${reason}\nHistory:`, task.failureReasons);
    task.reject(err);
  }

  /**
   * World-Class §6.1 resilient error routing. When AI attempts are exhausted
   * (rate limit OR style loop), the task is RESOLVED with `null` instead of
   * rejected — `orchestrateLetterGeneration` detects the null draft and
   * renders the deterministic Metro 2 fallback letter. For non-letter tasks
   * (no fail-safe option set), the historical rejection behavior is preserved.
   */
  private markExhaustedFailSafe(task: QueueTask<unknown>, err: unknown, reason: string): void {
    if (task.resolveNullOnExhaustion) {
      task.status = 'manual_review';
      this.manualReviewCount++;
      dispatchQueueEvent('manual_review', {
        taskId: task.id,
        failureReasons: task.failureReasons,
        boilerplateAttempts: task.boilerplateAttempts,
        failSafe: 'null_resolution_deterministic_fallback',
      });
      console.warn(`[Queue:${task.id}] FAIL-SAFE — ${reason}`);
      // Do NOT task.reject(err): signal the orchestrator to invoke
      // renderDeterministicDisputeLetter (Net-100% letter guarantee).
      task.resolve(null as unknown);
      return;
    }
    // Legacy behavior for tasks that did not opt into the orchestrator fail-safe.
    task.status = 'failed';
    this.failedCount++;
    console.error(`[Queue:${task.id}] FAILED — ${reason}`, task.failureReasons);
    task.reject(err instanceof Error ? err : new Error(String(err)));
  }

  private markManualReview(task: QueueTask<unknown>, err: unknown): void {
    task.status = 'manual_review';
    this.manualReviewCount++;
    dispatchQueueEvent('manual_review', {
      taskId: task.id,
      failureReasons: task.failureReasons,
      boilerplateAttempts: task.boilerplateAttempts,
    });
    task.reject(
      new Error(`[ManualReview:${task.id}] Letter quality kill switch triggered after ${MAX_BOILERPLATE_RETRIES} boilerplate failures.`),
    );
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dispatchQueueEvent(type: string, detail: object): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(`queue:${type}`, { detail }));
  }
}

// ─── SINGLETON EXPORT ─────────────────────────────────────────────────────────
export const apiQueueManager = new APIQueueManager();
