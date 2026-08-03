# Android Release Readiness Checklist

Version Target: 4.0.0+
Owner: Dylandos Credit Repair Team
Last Updated: 2026-04-20

## Release Gate Rules

- Mark each item as PASS, FAIL, or N/A.
- Production release requires no FAIL in any Critical section.
- Any FAIL in Security or Data Integrity blocks release.

## 1. Build and Packaging

- [ ] PASS / FAIL: npm run lint completes with zero TypeScript errors.
- [ ] PASS / FAIL: npm run build completes with no build-breaking errors.
- [ ] PASS / FAIL: npm run cap:sync completes and updates android/app/src/main/assets/public.
- [ ] PASS / FAIL: Android Gradle build succeeds on clean workspace.
- [ ] PASS / FAIL: Release APK or AAB installs and launches on Android 10, 12, and 14.

## 2. Security and Privacy (Critical)

- [ ] PASS / FAIL: API keys are loaded through secure storage pathways only.
- [ ] PASS / FAIL: No API keys or PII are logged to console in production build.
- [ ] PASS / FAIL: Vault files remain encrypted at rest and decrypt only with active key.
- [ ] PASS / FAIL: Exported letters do not contain full SSN values.
- [ ] PASS / FAIL: Backup and restore paths do not leak sensitive fields.

## 3. Parser and Data Integrity (Critical)

- [ ] PASS / FAIL: Upload parser extracts only valid negative tradelines.
- [ ] PASS / FAIL: Phantom lines are rejected and logged in rejectedLines diagnostics.
- [ ] PASS / FAIL: Duplicate account ingestion is blocked across report re-uploads.
- [ ] PASS / FAIL: Parser reset clears runtime artifacts and allows clean reparse.
- [ ] PASS / FAIL: Cross-bureau merges preserve account linkage without false merges.

## 4. Autopilot Engine Reliability (Critical)

- [ ] PASS / FAIL: Round progression does not auto-advance with lower-round backlog.
- [ ] PASS / FAIL: Verified outcomes stay in current round verified state.
- [ ] PASS / FAIL: NoResponse outcomes queue next escalation without invalid status creation.
- [ ] PASS / FAIL: Duplicate letter prevention blocks repeat generation within 30-day window.
- [ ] PASS / FAIL: Hold queue persists through app restart and resumes correctly.
- [ ] PASS / FAIL: FCRA deadline timeline survives restart and overdue detection still works.
- [ ] PASS / FAIL: Batch sizing respects configured fraction and max cap.
- [ ] PASS / FAIL: Bureau stagger dates are correctly spaced and reflected in queue.

## 5. Letter Quality and Export Safety (Critical)

- [ ] PASS / FAIL: Generated letters use first-person consumer voice.
- [ ] PASS / FAIL: Placeholder auto-fill resolves known tokens correctly.
- [ ] PASS / FAIL: Export is blocked when unresolved placeholder tokens remain.
- [ ] PASS / FAIL: Export is blocked when target mailing address is missing.
- [ ] PASS / FAIL: Batch export blocks and reports offending letters with unresolved tokens.
- [ ] PASS / FAIL: PDF output renders correctly on Android sharing flow.

## 6. Address Lookup and Contact Book

- [ ] PASS / FAIL: Local lookup returns ranked matches before AI fallback.
- [ ] PASS / FAIL: Alternate local matches are displayed for user selection.
- [ ] PASS / FAIL: Contact save flow prevents duplicate entries by normalized identity.
- [ ] PASS / FAIL: Furnisher selection is required when generating Furnisher-targeted letters.

## 7. UX and Accessibility

- [ ] PASS / FAIL: Interactive controls have accessible labels and titles.
- [ ] PASS / FAIL: Progress indicators expose accessible names.
- [ ] PASS / FAIL: No blocking layout breaks on 360px-wide Android viewport.
- [ ] PASS / FAIL: Empty, loading, and error states render for every major page.

## 8. Performance and Stability

- [ ] PASS / FAIL: App cold start under acceptable threshold on mid-tier Android device.
- [ ] PASS / FAIL: Large report upload does not crash app process.
- [ ] PASS / FAIL: Multiple Autopilot cycles do not create memory leak symptoms.
- [ ] PASS / FAIL: Long-running sessions preserve state across app background/foreground cycles.

## 9. Pre-Launch Operational Checklist

- [ ] PASS / FAIL: Rollback plan documented and tested.
- [ ] PASS / FAIL: Crash monitoring pipeline enabled for production build.
- [ ] PASS / FAIL: Support escalation runbook updated for parser and autopilot incidents.
- [ ] PASS / FAIL: Release notes prepared with known limitations and mitigations.

## Sign-Off

- QA Lead: ____________________ Date: __________
- Security Review: _____________ Date: __________
- Product Owner: ______________ Date: __________
- Release Engineer: ____________ Date: __________
