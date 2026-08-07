/**
 * Apex feature flags — keep heavy optional paths off by default so Electron +
 * Capacitor builds stay lean and reliable.
 */

export const FEATURE_FLAGS = {
  /**
   * When true, attempt dynamic Transformers.js load for on-device classification.
   * Default false: use the lightweight heuristic classifier (same API surface).
   * Enabling requires shipping model assets; leave off for production builds.
   */
  ON_DEVICE_TRANSFORMERS_JS: false,

  /** Require Android biometric before revealing Autopilot letter preview text. */
  ANDROID_BIOMETRIC_LETTER_LOCK: true,

  /** Offer second-monitor letter review when Electron detects >1 display. */
  WINDOWS_MULTI_MONITOR_LETTER_REVIEW: true,

  /** Route AutoPilot cycles through autopilotOrchestrator (canonical entry). */
  AUTOPILOT_ORCHESTRATOR: true,

  /** Show Mission Control as the AutoPilot landing surface. */
  MISSION_CONTROL: true,
} as const;

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;
