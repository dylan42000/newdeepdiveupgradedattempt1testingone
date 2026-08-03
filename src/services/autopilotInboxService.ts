/**
 * autopilotInboxService.ts — Normalized user tasks: Answer / Add / Review / Approve.
 */

import { v4 as uuidv4 } from 'uuid';
import type { AutopilotTask, AutopilotTaskType, MissionControlStatus } from '../types/autopilotCase';
import { CaseRepository } from './caseRepository';
import { idbGet, idbGetAll, idbSet } from './indexedDB';

function estimateMinutes(type: AutopilotTaskType): number {
  switch (type) {
    case 'answer':
      return 2;
    case 'add':
      return 4;
    case 'review':
      return 3;
    case 'approve':
      return 5;
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

export const AutopilotInboxService = {
  async listTasks(profileId: string, status: AutopilotTask['status'] | 'all' = 'open'): Promise<AutopilotTask[]> {
    const all = await idbGetAll<AutopilotTask>('autopilotTasks');
    return all
      .filter((t) => t.profileId === profileId && (status === 'all' || t.status === status))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  async getTask(id: string): Promise<AutopilotTask | undefined> {
    return idbGet<AutopilotTask>('autopilotTasks', id);
  },

  async upsertTask(input: {
    profileId: string;
    caseId?: string;
    type: AutopilotTaskType;
    title: string;
    whyItMatters: string;
    afterComplete: string;
    field?: string;
    privacyImpact?: AutopilotTask['privacyImpact'];
    payload?: Record<string, unknown>;
    dedupeKey?: string;
  }): Promise<AutopilotTask> {
    const open = await this.listTasks(input.profileId, 'open');
    const existing = open.find((t) => {
      if (input.dedupeKey && t.payload?.dedupeKey === input.dedupeKey) return true;
      return (
        t.type === input.type &&
        t.caseId === input.caseId &&
        t.field === input.field &&
        t.title === input.title
      );
    });
    if (existing) return existing;

    const task: AutopilotTask = {
      id: uuidv4(),
      profileId: input.profileId,
      caseId: input.caseId,
      type: input.type,
      status: 'open',
      title: input.title,
      whyItMatters: input.whyItMatters,
      estimatedMinutes: estimateMinutes(input.type),
      afterComplete: input.afterComplete,
      privacyImpact: input.privacyImpact || 'local_only',
      field: input.field,
      createdAt: new Date().toISOString(),
      payload: {
        ...(input.payload || {}),
        ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
      },
    };
    await idbSet('autopilotTasks', task);
    await CaseRepository.appendEvent({
      profileId: input.profileId,
      caseId: input.caseId,
      type: 'inbox.task_created',
      actor: 'autopilot',
      payload: { taskId: task.id, taskType: task.type, title: task.title },
    });
    return task;
  },

  async completeTask(taskId: string): Promise<AutopilotTask | undefined> {
    const task = await this.getTask(taskId);
    if (!task) return undefined;
    const updated: AutopilotTask = {
      ...task,
      status: 'completed',
      completedAt: new Date().toISOString(),
    };
    await idbSet('autopilotTasks', updated);
    return updated;
  },

  async skipTask(taskId: string): Promise<AutopilotTask | undefined> {
    const task = await this.getTask(taskId);
    if (!task) return undefined;
    const updated: AutopilotTask = { ...task, status: 'skipped', completedAt: new Date().toISOString() };
    await idbSet('autopilotTasks', updated);
    return updated;
  },

  async holdTask(taskId: string): Promise<AutopilotTask | undefined> {
    const task = await this.getTask(taskId);
    if (!task) return undefined;
    const updated: AutopilotTask = { ...task, status: 'held' };
    await idbSet('autopilotTasks', updated);
    return updated;
  },

  async buildMissionControl(params: {
    profileId: string;
    hasPersonalInfo: boolean;
    hasReports: boolean;
    autopilotEnabled: boolean;
  }): Promise<MissionControlStatus> {
    const { profileId, hasPersonalInfo, hasReports, autopilotEnabled } = params;
    const cases = await CaseRepository.getCasesForProfile(profileId);
    const tasks = await this.listTasks(profileId, 'open');
    const waiting = cases.filter((c) => c.state === 'WAITING' || c.state === 'SENT').length;
    const active = cases.filter((c) =>
      !['RESOLVED', 'CLOSED', 'DELETED', 'CORRECTED'].includes(c.state),
    ).length;
    const confirmed = cases.filter((c) =>
      c.state === 'DELETED' || c.state === 'CORRECTED' || c.state === 'RESOLVED',
    ).length;
    const deletions = cases.filter((c) => c.state === 'DELETED').length;
    const corrections = cases.filter((c) => c.state === 'CORRECTED').length;

    const pipeline: Record<string, number> = {
      Discovered: cases.filter((c) => c.state === 'IMPORTED' || c.state === 'NORMALIZED').length,
      'Needs facts': cases.filter((c) => c.state === 'FACTS_NEEDED' || c.state === 'EVIDENCE_NEEDED').length,
      Ready: cases.filter((c) => c.state === 'VALIDATED' || c.state === 'USER_APPROVAL').length,
      Approved: cases.filter((c) => c.state === 'READY_TO_DISPATCH').length,
      Sent: cases.filter((c) => c.state === 'SENT').length,
      Waiting: waiting,
      'Response received': cases.filter((c) => c.state === 'RESPONSE_RECEIVED').length,
      Resolved: confirmed,
    };

    let autopilotStatus: MissionControlStatus['autopilotStatus'] = 'Setup';
    if (!hasPersonalInfo || !hasReports) autopilotStatus = 'Setup';
    else if (!autopilotEnabled) autopilotStatus = 'Paused';
    else if (tasks.length > 0) autopilotStatus = 'Needs You';
    else if (waiting > 0) autopilotStatus = 'Waiting';
    else autopilotStatus = 'Running';

    const answer = tasks.find((t) => t.type === 'answer');
    const add = tasks.find((t) => t.type === 'add');
    const approve = tasks.find((t) => t.type === 'approve');
    const review = tasks.find((t) => t.type === 'review');

    let nextBestAction: MissionControlStatus['nextBestAction'];
    if (!hasPersonalInfo) {
      nextBestAction = {
        label: 'Complete your identity profile',
        detail: 'Setup · about 3 minutes',
        estimatedMinutes: 3,
        actionKind: 'setup',
      };
    } else if (!hasReports) {
      nextBestAction = {
        label: 'Import your latest reports',
        detail: 'Import · about 2 minutes',
        estimatedMinutes: 2,
        actionKind: 'import',
      };
    } else if (answer) {
      nextBestAction = {
        label: answer.title,
        detail: `Answer · about ${answer.estimatedMinutes} minutes`,
        estimatedMinutes: answer.estimatedMinutes,
        taskId: answer.id,
        actionKind: 'answer',
      };
    } else if (add) {
      nextBestAction = {
        label: add.title,
        detail: `Add evidence · about ${add.estimatedMinutes} minutes`,
        estimatedMinutes: add.estimatedMinutes,
        taskId: add.id,
        actionKind: 'add',
      };
    } else if (approve) {
      nextBestAction = {
        label: approve.title,
        detail: `Review and approve · about ${approve.estimatedMinutes} minutes`,
        estimatedMinutes: approve.estimatedMinutes,
        taskId: approve.id,
        actionKind: 'approve',
      };
    } else if (review) {
      nextBestAction = {
        label: review.title,
        detail: `Review · about ${review.estimatedMinutes} minutes`,
        estimatedMinutes: review.estimatedMinutes,
        taskId: review.id,
        actionKind: 'scan',
      };
    } else {
      nextBestAction = {
        label: 'Nothing needed — AutoPilot is monitoring deadlines',
        detail: 'Monitoring',
        estimatedMinutes: 0,
        actionKind: 'monitor',
      };
    }

    return {
      autopilotStatus,
      nextBestAction,
      activeCases: active,
      waitingOnResponses: waiting,
      confirmedResults: confirmed,
      pipeline,
      success: {
        deletions,
        corrections,
        activeOpportunities: cases.filter((c) => c.priorityLabel === 'Strong case' || c.priorityLabel === 'Promising').length,
        avoidedPremature: cases.filter((c) => c.riskFlags.includes('timing')).length,
        estimatedMinutesSaved: Math.round(confirmed * 18 + active * 4),
      },
    };
  },
};
