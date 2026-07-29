import { BoilerplateDetectedException } from './letterValidator';
import { AIProviderCooldownError, getConfiguredLetterKeyCapacity } from './aiRouter';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const MAX_CONCURRENCY = 2;           // Two Groq or Gemini keys can process two letters at once
const MAX_RATE_LIMIT_RETRIES = 12;  // span rolling provider windows; never substitute a generic letter
const MAX_BOILERPLATE_RETRIES = 3;
// Backoff base: 2000ms → attempt 1: 2s, attempt 2: 4s, attempt 3: 8s (2^n * BASE)
const BASE_RATE_LIMIT_BACKOFF_MS = 2_000;
// Mandatory 3-second inter-request cooldown — keeps the provider token bucket stable
const MIN_REQUEST_INTERVAL_MS = 3_000;
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

// ─── ADAPTIVE BACKOFF CALCULATOR ──────────────────────────────────────────────
// Produces: attempt 1 → ~2s, attempt 2 → ~4s, attempt 3 → ~8s (+ up to 500ms jitter)
// Capped at 60s to avoid unbounded waits in the UI.
function computeBackoffMs(attempt: number): number {
  const exponential = BASE_RATE_LIMIT_BACKOFF_MS * Math.pow(2, attempt - 1); // 2000, 4000, 8000
  const jitter = Math.random() * 500; // small jitter to avoid thundering herd
  return Math.min(exponential + jitter, 60_000);
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
  enqueue<T>(id: string, factory: TaskFactory<T>): Promise<T> {
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
          ? Math.max(1_000, err.retryAfterMs + 750)
          : computeBackoffMs(task.rateLimitAttempts);
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
      return this.markFailed(task, err, 'Groq/Gemini remained unavailable after the queued retry window; no fallback letter was created.');
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

      // ── 3-Strike Kill Switch ─────────────────────────────────────────────
      console.error(
        `[Queue:${task.id}] KILL SWITCH: Boilerplate survived ${MAX_BOILERPLATE_RETRIES} retries. Routing to manual review.`,
      );
      return this.markManualReview(task, err);
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
