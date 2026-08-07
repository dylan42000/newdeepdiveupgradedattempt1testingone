# AutoPilot World-Class Upgrade Plan (April 2026)

## Scope
This plan aligns AutoPilot behavior with statutory dispute timelines, stronger evidence quality, and practical dispute-operations patterns used by mature credit dispute platforms.

## External Guidance Mapped

- CFPB dispute guidance:
  - Dispute both CRA and furnisher.
  - Include account-specific errors, supporting documents, and request correction/deletion.
  - Keep complete records and certified-mail proof when mailing.
- FTC dispute guidance:
  - Keep copies of all submitted evidence.
  - Disputes may be rejected as frivolous if insufficiently specific.
- FCRA 15 U.S.C. 1681i:
  - CRA reinvestigation timeline and notice handling.
  - Consumer right to file statement of dispute if unresolved.
- FCRA 15 U.S.C. 1681s-2:
  - Furnisher investigation/correction duties after notice.
- FDCPA 15 U.S.C. 1692g:
  - Debt validation rights and 30-day dispute window.
- CFPB complaint process:
  - Most company responses are expected quickly (often within ~15 days per CFPB process pages).

## Product-Level Upgrade Priorities

### Priority 1: Compliance Timeline Control Tower
- Add event-driven SLA cards per item:
  - CRA dispute sent date, 30-day investigation due date.
  - Furnisher dispute sent date and response due date.
  - CFPB complaint eligibility trigger when SLA is breached.
- Add deterministic escalation rules:
  - No-response -> legal escalation queue with explicit reason code.
  - Verified without method details -> MOV escalation queue.

### Priority 2: Evidence Packet Scoring Before Dispatch
- Add an evidence completeness gate before letter generation:
  - Required: creditor name, account identifier (full or masked), dispute reason, date anchors.
  - Optional but high-value: supporting docs checklist and dispute-specific proof references.
- Block low-quality packets from auto-send and route to remediation.

### Priority 3: Strategy Diversification Controls
- Add per-creditor and per-bureau concentration throttles to reduce repetitive targeting patterns.
- Add reason-code rotation so repeated rounds are not semantic duplicates.
- Add strategy lockout when multiple rounds fail with identical rationale.

### Priority 4: Validation Strictness Improvements
- Extend letter validation with target-aware legal checks:
  - Bureau/MOV paths require FCRA-centric citations.
  - Furnisher/debt-collector paths require applicable FDCPA/FCRA mapping.
- Add unresolved token zero-tolerance at all send/export boundaries.

### Priority 5: Outcome and KPI Intelligence
- Track outcome funnels:
  - sent -> acknowledged -> verified -> deleted/updated/no-response.
- Add first-pass and second-pass deletion rates by bureau, creditor, and reason code.
- Add batch-level confidence score and quality trend over time.

## Implementation Roadmap

### Phase A (1-2 days)
- Add timeline control cards and breach reason codes.
- Add evidence completeness scoring utility with UI warnings.

### Phase B (2-3 days)
- Add strategy diversification (reason rotation + lockouts + concentration controls).
- Add target-aware legal citation matrix in validator.

### Phase C (2-3 days)
- Add KPI dashboards for pass-level and bureau-level outcomes.
- Add CSV export for compliance audit logs.

## Success Criteria

- Reduced invalid-letter generation rate.
- Increased resolved outcomes per cycle with fewer repeat verifications.
- Lower unresolved placeholder incidents at send/export.
- Full traceability for legal/compliance audits across all dispute rounds.
