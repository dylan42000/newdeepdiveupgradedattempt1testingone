\---

name: credit-repair-validator

description: Enforces strict 2026 FCRA law grounding and structural formatting rules for the DylandOs suite. Run this skill before finalizing any dispute letters.

\---



\# 🏦 DylandOs Credit Repair Validation Skill



Use this skill whenever analyzing, generating, or modifying code inside `src/services/` or `src/pages/DisputeLetters.tsx`.



\## Core Guardrails:

1\. \*\*Currency Grounding:\*\* Never output plain decimals for currency comparisons. Ensure `normalizeCurrency()` matches cents integers (e.g., "$388.00" -> "38800").

2\. \*\*Citation Mapping:\*\* Always leverage the `CITATION\_EQUIVALENCES` matrix from `src/services/citationEquivalenceMap.ts` to evaluate legal text. Ensure both short-form (§611) and long-form (15 U.S.C. §1681i) expressions pass valid quality scoring safely.

3\. \*\*Double RE Line Defeat:\*\* Ensure any AI letter body generator returns text ONLY. Programmatic headers (Sender/Recipient blocks) must be left entirely to `letterTemplateService.ts`.

4\. \*\*Metro 2 Tracking:\*\* If `detectMetro2Discrepancies()` is triggered, aggressively map field deviations directly into the letter prompt arguments.



\## Verification Action:

Always verify edits by executing:

`npx tsc --noEmit`

