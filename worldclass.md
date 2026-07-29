# World-Class Finalization Recommendations

These are product recommendations only; this delivery changes the account-merging engine.

## 1. Autopilot: evidence-first decisions

Make every scheduled action show a short **why now** explanation: the bureau, account, dispute stage, deadline, supporting report fields, and the exact next action. Keep an immutable event log of every recommendation, generated letter, user approval, and outcome. This makes the system explainable, auditable, and easy to resume after a new report import.

Add a pre-send gate that checks for conflicting dates, missing bureau addresses, repeated wording, unsupported legal claims, and an unconfirmed consumer fact. When a gate fails, place the action in a clearly labelled review queue instead of sending or generating a risky letter.

## 2. Letters: traceable, tailored, and restrained

For every letter, show a fact-source panel beside the final text. Each material statement should point to a parsed report field, uploaded document, or user-confirmed note. Add a one-click diff when regenerating a letter so the consumer can see exactly what changed between rounds.

Keep the letter generator factual and non-legal-advice oriented: use legally grounded templates only when the supporting data warrants them, never invent a dispute reason, and require the user to review recipient/address and accuracy before export or mailing.

## 3. Cross-bureau account workspace

The new merge engine preserves source rows while assigning a shared identity and reconstructed account token. The next UX upgrade should be a dedicated **Account Identity** drawer that presents one account card with its Equifax, Experian, and TransUnion source rows below it. Show recovered digits, hidden positions, merge confidence, discrepancies, and a reversible “keep separate” action.

## 4. Outcome learning with guardrails

Track outcomes by furnisher, account type, bureau, dispute round, evidence type, and wording family. Use those results to rank options, but do not let historical performance auto-create factual claims or bypass the evidence gate. Explain whether a recommendation is rule-based, data-informed, or needs human review.

## 5. Release quality bar

Before every release: run merge fixtures from real anonymized report formats, parser regression tests, deterministic letter snapshot tests, accessibility keyboard checks, backup/restore verification, and an offline-mode smoke test. Publish a small in-app version/change log and keep a one-click encrypted export so users retain control of their data.
