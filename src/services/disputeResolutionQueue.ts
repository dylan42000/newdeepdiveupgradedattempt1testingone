/**
 * Durable, user-visible recovery queue for dispute work that could not safely
 * become a draft. This deliberately records no report body, SSN, or API key.
 */
export type DisputeResolutionReason =
  | 'address_verification'
  | 'missing_facts'
  | 'ai_capacity'
  | 'generation_failure'
  | 'validation_failure'
  | 'intentional_hold';

export interface DisputeResolutionTask {
  id: string;
  profileId: string;
  itemId: string;
  creditorName: string;
  targetName?: string;
  targetType?: 'bureau' | 'furnisher';
  reason: DisputeResolutionReason;
  message: string;
  retryable: boolean;
  retryAfter?: string;
  status: 'open' | 'resolved';
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = 'dylandos_dispute_resolution_queue_v1';
function read(): DisputeResolutionTask[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}
function write(tasks: DisputeResolutionTask[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks.slice(-250)));
    window.dispatchEvent(new CustomEvent('dispute-resolution-queue:changed'));
  } catch { /* queue visibility must not interrupt a dispute cycle */ }
}

export function queueDisputeResolutionTask(input: Omit<DisputeResolutionTask, 'id' | 'status' | 'createdAt' | 'updatedAt'>): DisputeResolutionTask {
  const now = new Date().toISOString();
  const tasks = read();
  const existing = tasks.find(task => task.status === 'open' && task.profileId === input.profileId && task.itemId === input.itemId && task.targetName === input.targetName && task.reason === input.reason);
  if (existing) {
    Object.assign(existing, input, { updatedAt: now });
    write(tasks);
    return existing;
  }
  const task: DisputeResolutionTask = { ...input, id: crypto.randomUUID(), status: 'open', createdAt: now, updatedAt: now };
  tasks.push(task);
  write(tasks);
  return task;
}

export function getOpenDisputeResolutionTasks(profileId?: string): DisputeResolutionTask[] {
  return read().filter(task => task.status === 'open' && (!profileId || task.profileId === profileId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function resolveDisputeResolutionTasks(profileId: string, itemId: string, targetName?: string): void {
  const now = new Date().toISOString();
  const tasks = read();
  let changed = false;
  for (const task of tasks) {
    if (task.status === 'open' && task.profileId === profileId && task.itemId === itemId && (!targetName || task.targetName === targetName)) {
      task.status = 'resolved'; task.updatedAt = now; changed = true;
    }
  }
  if (changed) write(tasks);
}
