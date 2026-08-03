// src/services/platform/androidNotificationHandler.ts
// Handles deep-link navigation from AutoPilot notifications on Android

type AutopilotNotificationAction =
  | 'CYCLE_READY'
  | 'HOLD_EXPIRED'
  | 'TIMELINE_REMINDER'
  | 'OVERDUE'
  | 'STRATEGY_WHY';

export function initAndroidNotificationHandler(
  navigate: (path: string) => void
): void {
  window.addEventListener('autopilot_notification', (event: Event) => {
    const customEvent = event as CustomEvent;
    let action: string;
    let whySummary = '';

    // Handle both string and object payloads from the bridge
    if (typeof customEvent.detail === 'string') {
      action = customEvent.detail;
    } else if (customEvent.detail && typeof customEvent.detail === 'object') {
      action = customEvent.detail.action || '';
      whySummary = customEvent.detail.whySummary || customEvent.detail.summary || '';
    } else {
      return;
    }

    const typed = action as AutopilotNotificationAction;
    switch (typed) {
      case 'CYCLE_READY':
        navigate('/autopilot?action=cycle_ready');
        break;
      case 'HOLD_EXPIRED':
        navigate('/autopilot?action=hold_expired');
        break;
      case 'TIMELINE_REMINDER':
        navigate('/autopilot/timeline');
        break;
      case 'OVERDUE':
        navigate('/autopilot/timeline?filter=overdue');
        break;
      case 'STRATEGY_WHY':
        navigate(
          whySummary
            ? `/autopilot?action=strategy_why&summary=${encodeURIComponent(whySummary.slice(0, 200))}`
            : '/autopilot?action=strategy_why',
        );
        break;
      default: {
        // Unknown / future actions — open Autopilot home rather than crash
        const _unknown: string = typed;
        void _unknown;
        navigate('/autopilot');
        break;
      }
    }
  });
}
