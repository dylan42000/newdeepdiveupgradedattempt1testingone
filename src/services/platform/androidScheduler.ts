// src/services/platform/androidScheduler.ts
// Wraps the AutoPilot native plugin for background scheduling on Android

import { registerPlugin } from '@capacitor/core';

interface AutoPilotPluginInterface {
  scheduleBackgroundCheck(options: {
    intervalHours: number;
    state: string;
  }): Promise<{ success: boolean; message: string }>;

  updateSchedulerState(options: {
    state: string;
  }): Promise<{ success: boolean }>;

  cancelBackgroundCheck(): Promise<{ success: boolean; message: string }>;

  getSchedulerStatus(): Promise<{
    isScheduled: boolean;
    workState: string;
    enabled: boolean;
    hasStoredState: boolean;
  }>;

  isSchedulerAvailable(): Promise<{
    available: boolean;
    platform: string;
    engine: string;
  }>;

  requestBatteryOptimizationExemption(): Promise<{
    alreadyExempt?: boolean;
    requested?: boolean;
    notNeeded?: boolean;
  }>;
}

const AutoPilotNative = registerPlugin<AutoPilotPluginInterface>('AutoPilot');

export interface DisputeTimeline {
  itemId: string;
  itemName: string;
  bureauName: string;
  fcraDeadlineDate: string;
  reminderDate: string;
  overdueDate: string;
}

export interface DisputeItem {
  id: string;
  holdUntilDate?: string;
}

export interface AutoPilotSettings {
  cycleIntervalDays: number;
  maxPassCount: number;
}

export class AndroidScheduler {

  async enable(
    nextCycleDate: Date,
    timelines: DisputeTimeline[],
    heldItems: DisputeItem[],
    _settings: AutoPilotSettings
  ): Promise<void> {
    const state = {
      enabled: true,
      nextCycleDateMs: nextCycleDate.getTime(),
      timelines: timelines.map(t => ({
        itemId: t.itemId,
        itemName: t.itemName,
        bureauName: t.bureauName,
        fcraDeadlineMs: new Date(t.fcraDeadlineDate).getTime(),
        reminderMs: new Date(t.reminderDate).getTime(),
        overdueMs: new Date(t.overdueDate).getTime(),
      })),
      heldItems: heldItems.map(i => ({
        id: i.id,
        holdUntilMs: i.holdUntilDate
          ? new Date(i.holdUntilDate).getTime()
          : null,
      })),
    };

    await AutoPilotNative.scheduleBackgroundCheck({
      intervalHours: 12,
      state: JSON.stringify(state),
    });
  }

  async updateState(
    timelines: DisputeTimeline[],
    heldItems: DisputeItem[],
    nextCycleDate: Date | null
  ): Promise<void> {
    const state = {
      enabled: true,
      nextCycleDateMs: nextCycleDate?.getTime() ?? -1,
      timelines: timelines.map(t => ({
        itemId: t.itemId,
        itemName: t.itemName,
        bureauName: t.bureauName,
        fcraDeadlineMs: new Date(t.fcraDeadlineDate).getTime(),
        reminderMs: new Date(t.reminderDate).getTime(),
        overdueMs: new Date(t.overdueDate).getTime(),
      })),
      heldItems: heldItems.map(i => ({
        id: i.id,
        holdUntilMs: i.holdUntilDate
          ? new Date(i.holdUntilDate).getTime()
          : null,
      })),
    };

    await AutoPilotNative.updateSchedulerState({ state: JSON.stringify(state) });
  }

  async disable(): Promise<void> {
    await AutoPilotNative.cancelBackgroundCheck();
  }

  async getStatus(): Promise<{
    isScheduled: boolean;
    workState: string;
    enabled: boolean;
  }> {
    return AutoPilotNative.getSchedulerStatus();
  }

  async syncNextCycleDate(nextCycleDate: Date | null): Promise<void> {
    if (!nextCycleDate) return;
    const current = await AutoPilotNative.getSchedulerStatus();
    if (!current.isScheduled) return;
    // Merge-only patch — never wipe timelines/holds with empty arrays
    await AutoPilotNative.updateSchedulerState({
      state: JSON.stringify({
        patchOnly: true,
        nextCycleDateMs: nextCycleDate.getTime(),
      }),
    });
  }

  async requestBatteryExemption(): Promise<void> {
    await AutoPilotNative.requestBatteryOptimizationExemption();
  }

  async isAvailable(): Promise<boolean> {
    const result = await AutoPilotNative.isSchedulerAvailable();
    return result.available;
  }
}
