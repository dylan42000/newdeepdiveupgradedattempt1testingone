/**
 * Dispute Notifications Service
 * Cross-platform deadline alert system.
 *
 * Android:  @capacitor/local-notifications
 * Electron: IPC → main.cjs Notification handler via window.electronAPI
 * Web:      Notification API (with permission request)
 */

import { isDeadlineApproaching, isDeadlineOverdue, daysUntilDeadline, DISPUTE_TIMING } from '../config/disputeTimingConfig';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DeadlineAlert {
  id: string;
  disputeItemId: string;
  bureauName: string;
  accountName: string;
  round: number;
  deadlineDate: Date;
  alertType: 'approaching' | 'overdue' | 'ready_to_escalate';
  message: string;
  daysRemaining: number;
}

export interface ScheduledNotification {
  id: number;
  title: string;
  body: string;
  scheduleDate: Date;
  disputeItemId: string;
}

// ─── Platform detection ───────────────────────────────────────────────────────

function isElectron(): boolean {
  return typeof window !== 'undefined' && !!(window as any).electronAPI;
}

async function isCapacitorAvailable(): Promise<boolean> {
  try {
    const cap = (window as any).Capacitor;
    return !!(cap && cap.isNativePlatform && cap.isNativePlatform() && cap.Plugins?.LocalNotifications);
  } catch {
    return false;
  }
}

// ─── Web Notification API ─────────────────────────────────────────────────────

async function requestWebNotificationPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

function showWebNotification(title: string, body: string): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, icon: '/icon-192.png' });
  } catch (e) {
    console.warn('[Notifications] Web Notification failed:', e);
  }
}

// ─── Cross-platform send ──────────────────────────────────────────────────────

export async function sendNotification(
  title: string,
  body: string,
  urgency: 'normal' | 'critical' = 'normal'
): Promise<void> {
  // Electron
  if (isElectron()) {
    try {
      await (window as any).electronAPI.showNotification(title, body, urgency);
      return;
    } catch (e) {
      console.warn('[Notifications] Electron notification failed:', e);
    }
  }

  // Capacitor (Android)
  if (await isCapacitorAvailable()) {
    try {
      const LocalNotifications = (window as any).Capacitor.Plugins.LocalNotifications;
      await LocalNotifications.requestPermissions();
      await LocalNotifications.schedule({
        notifications: [
          {
            title,
            body,
            id: Date.now(),
            schedule: { at: new Date(Date.now() + 1000) }, // fire immediately
            sound: undefined,
            attachments: undefined,
            actionTypeId: '',
            extra: null,
          },
        ],
      });
      return;
    } catch (e) {
      console.warn('[Notifications] Capacitor LocalNotifications failed:', e);
    }
  }

  // Web fallback
  const permitted = await requestWebNotificationPermission();
  if (permitted) {
    showWebNotification(title, body);
  }
}

// ─── Schedule future notification (Android only, Electron handles via main) ───

export async function scheduleNotification(notification: ScheduledNotification): Promise<void> {
  if (await isCapacitorAvailable()) {
    try {
      const LocalNotifications = (window as any).Capacitor.Plugins.LocalNotifications;
      await LocalNotifications.schedule({
        notifications: [
          {
            title: notification.title,
            body: notification.body,
            id: notification.id,
            schedule: { at: notification.scheduleDate },
            sound: undefined,
            attachments: undefined,
            actionTypeId: '',
            extra: { disputeItemId: notification.disputeItemId },
          },
        ],
      });
    } catch (e) {
      console.warn('[Notifications] Failed to schedule notification:', e);
    }
  }
  // On Electron/web, deadline check runs on app startup — no pre-scheduling needed
}

// ─── Deadline checking ────────────────────────────────────────────────────────

export interface DisputeDeadlineInput {
  id: string;
  accountName: string;
  bureauName: string;
  round: number;
  deadlineDate: string | Date; // ISO date string or Date
  status: string;
}

/**
 * Scans all dispute items and returns alerts for approaching / overdue deadlines.
 * Call this on app startup and daily thereafter.
 */
export function checkDeadlines(disputes: DisputeDeadlineInput[]): DeadlineAlert[] {
  const alerts: DeadlineAlert[] = [];

  for (const dispute of disputes) {
    const deadline = new Date(dispute.deadlineDate);
    const daysLeft = daysUntilDeadline(deadline);

    if (isDeadlineOverdue(deadline)) {
      alerts.push({
        id: `${dispute.id}-${dispute.bureauName}-overdue`,
        disputeItemId: dispute.id,
        bureauName: dispute.bureauName,
        accountName: dispute.accountName,
        round: dispute.round,
        deadlineDate: deadline,
        alertType: 'overdue',
        message: `${dispute.accountName} @ ${dispute.bureauName} — Round ${dispute.round} is ${Math.abs(daysLeft)} days OVERDUE. Escalate now!`,
        daysRemaining: daysLeft,
      });
    } else if (isDeadlineApproaching(deadline)) {
      alerts.push({
        id: `${dispute.id}-${dispute.bureauName}-approaching`,
        disputeItemId: dispute.id,
        bureauName: dispute.bureauName,
        accountName: dispute.accountName,
        round: dispute.round,
        deadlineDate: deadline,
        alertType: 'approaching',
        message: `${dispute.accountName} @ ${dispute.bureauName} — Round ${dispute.round} deadline in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}.`,
        daysRemaining: daysLeft,
      });
    }
  }

  return alerts;
}

/**
 * Send desktop/push notifications for all detected alerts.
 * Filters to avoid re-notifying the same alert twice per session.
 */
const _notifiedThisSession = new Set<string>();

export async function notifyDeadlineAlerts(alerts: DeadlineAlert[]): Promise<void> {
  for (const alert of alerts) {
    if (_notifiedThisSession.has(alert.id)) continue;
    _notifiedThisSession.add(alert.id);

    const urgency = alert.alertType === 'overdue' ? 'critical' : 'normal';
    const title = alert.alertType === 'overdue'
      ? '⚠️ Dispute Deadline OVERDUE'
      : '📅 Dispute Deadline Approaching';

    await sendNotification(title, alert.message, urgency);
  }
}

/**
 * One-call helper: check all disputes and fire notifications for any alerts.
 */
export async function runDeadlineCheck(disputes: DisputeDeadlineInput[]): Promise<DeadlineAlert[]> {
  const alerts = checkDeadlines(disputes);
  if (alerts.length > 0) {
    await notifyDeadlineAlerts(alerts);
  }
  return alerts;
}

/**
 * Format a deadline alert for display in the UI.
 */
export function formatAlertForUI(alert: DeadlineAlert): {
  color: string;
  icon: string;
  label: string;
} {
  if (alert.alertType === 'overdue') {
    return { color: 'text-red-500', icon: '🚨', label: `${Math.abs(alert.daysRemaining)}d overdue` };
  }
  if (alert.daysRemaining <= 2) {
    return { color: 'text-orange-500', icon: '⚠️', label: `${alert.daysRemaining}d left` };
  }
  return { color: 'text-yellow-400', icon: '📅', label: `${alert.daysRemaining}d left` };
}
