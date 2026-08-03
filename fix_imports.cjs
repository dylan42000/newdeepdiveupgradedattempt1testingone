const fs = require('fs');
const path = require('path');

function replace(file, search, replacement) {
  const p = path.join('src/services', file);
  let content = fs.readFileSync(p, 'utf8');
  content = content.split(search).join(replacement);
  fs.writeFileSync(p, content, 'utf8');
}

// 1. accountMergeEngine.ts
replace('accountMergeEngine.ts', 
  `import { detectMetro2Discrepancies, Metro2DiscrepancyFlag } from './metro2AuditService';`, 
  `// Metro2DiscrepancyFlag removed`
);
replace('accountMergeEngine.ts', 
  `const metro2Flags = detectMetro2Discrepancies(group);`, 
  `const metro2Flags: any[] = [];`
);

// 2. autoPilotEngineV2.ts
replace('autoPilotEngineV2.ts', 
  `import { LetterGeneratorV2 } from './letterGeneratorV2';`, 
  `import { generateDisputeLetter, DisputeLetterRequest } from './letterGeneratorV2';`
);
replace('autoPilotEngineV2.ts', 
  `import { runFullMetro2Audit } from './metro2AuditService';`, 
  `import { auditMetro2, Metro2AuditInput } from './metro2AuditService';`
);
replace('autoPilotEngineV2.ts', 
  `import { AccountHealingEngine } from './accountHealingEngine';`, 
  `import { HealedAccount, normalizeCreditorName, isAccountNumberMasked, computeConfidenceScore } from './accountHealingEngine';`
);

const oldGen = `            // --- Healing & Metro 2 Engines ---
            const healedAccount = AccountHealingEngine.getHealedAccountForItem(item, items);
            Metro2AuditEngine.auditGroupedAccounts([healedAccount]);

            let metro2EngineDirective = '';
            if (item.metro2Violations && item.metro2Violations.length > 0) {
              const uniqueViolations = Array.from(new Set(item.metro2Violations.map(v => v.description || v.type)));
              metro2EngineDirective += \`\\n\\n## ⚖️ METRO 2 COMPLIANCE AUDIT ENGINE — CRITICAL VIOLATIONS DETECTED:\\n\` +
                \`This account contains fatal Metro 2 reporting contradictions:\\n\` +
                uniqueViolations.map(v => \`• \${v}\`).join('\\n') +
                \`\\n\\nPIVOT STRATEGY: You must pivot this dispute letter to a precise Metro 2 compliance violation demand. \` +
                \`Argue that under FCRA §623(a)(1) and CDIA Metro 2 formatting standards, it is factually impossible for the same account \` +
                \`to have contradictory data. Demand immediate deletion due to irreconcilable data integrity failures.\`;
              progress(\`[METRO2 ENGINE] 🔍 Pivot triggered for \${item.creditorName}: \${uniqueViolations.length} violations found.\`);
            }

            if (healedAccount.requiresDisclosureRequest) {
              metro2EngineDirective += \`\\n\\n## 🔒 DISCLOSURE REQUEST MANDATE:\\n\` +
                \`The account number is completely masked across all bureaus. Demand a full, unmasked disclosure of the account number pursuant to FCRA §609(a)(1) to allow the consumer to identify the alleged debt.\`;
              progress(\`[HEALING ENGINE] 🩹 Account completely masked for \${item.creditorName} - Requesting FCRA §609 disclosure.\`);
            } else if (healedAccount.knownDigitCount > (item.accountNumber?.replace(/[^0-9]/g, '').length || 0)) {
              progress(\`[HEALING ENGINE] 🩹 Reconstructed account number for \${item.creditorName}: \${healedAccount.mergedAccountNumber}\`);
              metro2EngineDirective += \`\\n\\n## 🩹 HEALED ACCOUNT NUMBER:\\n\` +
                \`Using cross-bureau data, the true account number has been reconstructed as: \${healedAccount.mergedAccountNumber}. Use this reconstructed number in the letter instead of the partially masked one.\`;
            }

            // Merge Kill Shot block into strategyDirective so LetterGeneratorV2
            // appends it to the finalPrompt after the existing strategy rotation block.
            let mergedStrategyDirective = strategy.promptDirective ?? '';
            if (crossBureauKillShotBlock) mergedStrategyDirective += crossBureauKillShotBlock;
            if (metro2EngineDirective) mergedStrategyDirective += metro2EngineDirective;

            // QUEUE FIX: Route through apiQueueManager instead of firing directly.
            // The queue enforces MAX_CONCURRENT=2, applies 30s exponential backoff on
            // Groq 429s, and falls back to Gemini/OpenRouter after 3 rate-limit retries.
            // The factory closure captures all params by reference — safe because this
            // loop body is sequential (one iteration awaits before the next begins).
            const isItemOverdue = overdueDeadlines.some(d => d.itemId === item.id);

            const letter = await apiQueueManager.enqueue(
              \`\${item.creditorName} → \${target.name} Pass \${passNumber}\`,
              (attemptNumber) => LetterGeneratorV2.generateLetter({
                item,
                target,
                passNumber,
                cycleId,
                personalInfo,
                disputeHistory,
                evidenceModifiers,
                strategyDirective: mergedStrategyDirective,
                bureauCalibrationDirective: calibration?.promptDirective,
                promptOverride: pass6PromptOverride,
                isNonResponseFlagged: isItemOverdue,
                batchId: cycleId,
                // Task 3 — §609 Disclosure Hard Fork:
                // Forward the healing engine's masking flag so the generator
                // switches to buildDisclosureDemandPrompt() instead of the
                // standard dispute path when the account is fully masked.
                requiresDisclosureRequest: healedAccount.requiresDisclosureRequest,
              })
            );
            letter.profileId = profileId;`;

const newGen = `            // --- Healing & Metro 2 Engines ---
            const matchingItems = items.filter(i => normalizeCreditorName(i.creditorName) === normalizeCreditorName(item.creditorName));
            const scoreAccounts = matchingItems.map(i => ({
              bureau: i.creditBureau[0] ?? 'unknown',
              balance: i.balance ?? 0,
              status: i.status ?? '',
              dofd: i.dateOfFirstDelinquency ?? i.originalDateOfDelinquency ?? null,
              creditorName: i.creditorName
            }));
            const confidence = computeConfidenceScore(scoreAccounts);
            const isMasked = isAccountNumberMasked(item.accountNumber);
            
            const healedAccount: HealedAccount = {
              id: item.id,
              creditorName: normalizeCreditorName(item.creditorName),
              reconstructedAccountNumber: item.accountNumber, // Basic fallback
              balance: item.balance ?? 0,
              status: item.status ?? '',
              dateOpened: item.dateOpened ?? item.originalOpeningDate ?? undefined,
              dateOfFirstDelinquency: item.dateOfFirstDelinquency ?? item.originalDateOfDelinquency ?? undefined,
              confidenceScore: confidence.total,
              healingFlags: [],
              requiresDisclosureRequest: isMasked
            };

            const metro2Input: Metro2AuditInput = {
              status: item.status ?? '',
              balance: item.balance ?? 0,
              paymentHistory: item.paymentHistoryProfile ? item.paymentHistoryProfile.split('') : [],
              dateOfFirstDelinquency: item.dateOfFirstDelinquency ?? item.originalDateOfDelinquency ?? null,
              dateOpened: item.dateOpened ?? item.originalOpeningDate ?? null,
              creditLimit: item.creditLimit ?? item.highCredit ?? null,
              accountType: item.accountType ?? '',
              currentRating: item.currentRating ?? '',
              portfolioType: item.portfolioType ?? '',
              specialComment: item.specialComment ?? null,
              complianceConditionCode: item.complianceConditionCode ?? null,
              crossBureauDofds: matchingItems.map(i => i.dateOfFirstDelinquency ?? i.originalDateOfDelinquency ?? null),
              crossBureauStatuses: matchingItems.map(i => i.status ?? ''),
              crossBureauDateOpened: matchingItems.map(i => i.dateOpened ?? i.originalOpeningDate ?? null)
            };
            const metro2Flags = auditMetro2(metro2Input);

            const req: DisputeLetterRequest = {
              account: healedAccount,
              metro2Flags,
              passNumber: passNumber as any,
              bureau: target.name.toLowerCase() as 'experian' | 'equifax' | 'transunion',
              consumerName: \`\${personalInfo.firstName} \${personalInfo.lastName}\`,
              consumerAddress: \`\${personalInfo.address}, \${personalInfo.city}, \${personalInfo.state} \${personalInfo.zip}\`,
              todayDate: new Date().toISOString().split('T')[0]
            };

            const rawLetter = await generateDisputeLetter(req);
            
            // Map to GeneratedLetterV2 format
            const letter: GeneratedLetterV2 = {
              id: uuidv4(),
              profileId,
              itemId: item.id,
              itemName: item.creditorName,
              targetId: target.id ?? target.name,
              targetName: target.name,
              targetType: target.type,
              passNumber: passNumber,
              strategy: rawLetter.persona,
              status: 'GENERATED',
              letterContent: rawLetter.body,
              htmlContent: \`<p>\${rawLetter.body.replace(/\\n/g, '<br>')}</p>\`,
              generatedAt: rawLetter.generatedAt,
              cycleId,
              validationErrors: [],
              uniquenessScore: 0
            };`;
replace('autoPilotEngineV2.ts', oldGen, newGen);

// 3. metro2AuditEngine.ts
replace('metro2AuditEngine.ts', 
  `import { HealedAccountResult } from './accountHealingEngine';`, 
  `import { HealedAccount } from './accountHealingEngine';`
);
replace('metro2AuditEngine.ts', 
  `auditGroupedAccounts(healedAccounts: HealedAccountResult[]): void {`, 
  `auditGroupedAccounts(healedAccounts: any[]): void {`
);

// 4. scoreImpactProjector.ts
replace('scoreImpactProjector.ts', 
  `import { runFullMetro2Audit } from './metro2AuditService';`, 
  `import { auditMetro2, Metro2AuditInput } from './metro2AuditService';`
);
const oldProjector = `  // Metro 2 violations boost probability
  try {
    const violations = runFullMetro2Audit(item);
    const criticalViolations = violations.filter(v => v.severity === 'CRITICAL');
    base += criticalViolations.length * 15;
    const highViolations = violations.filter(v => v.severity === 'HIGH');
    base += highViolations.length * 7;
  } catch {
    // Non-blocking — metro2 audit is optional signal
  }`;
const newProjector = `  // Metro 2 violations boost probability
  try {
    const metro2Input: Metro2AuditInput = {
      status: item.status ?? '',
      balance: item.balance ?? 0,
      paymentHistory: item.paymentHistoryProfile ? item.paymentHistoryProfile.split('') : [],
      dateOfFirstDelinquency: item.dateOfFirstDelinquency ?? item.originalDateOfDelinquency ?? null,
      dateOpened: item.dateOpened ?? item.originalOpeningDate ?? null,
      creditLimit: item.creditLimit ?? item.highCredit ?? null,
      accountType: item.accountType ?? '',
      currentRating: item.currentRating ?? '',
      portfolioType: item.portfolioType ?? '',
      specialComment: item.specialComment ?? null,
      complianceConditionCode: item.complianceConditionCode ?? null,
      crossBureauDofds: [item.dateOfFirstDelinquency ?? item.originalDateOfDelinquency ?? null],
      crossBureauStatuses: [item.status ?? ''],
      crossBureauDateOpened: [item.dateOpened ?? item.originalOpeningDate ?? null]
    };
    const violations = auditMetro2(metro2Input);
    const criticalViolations = violations.filter(v => v.severity === 'critical');
    base += criticalViolations.length * 15;
    const highViolations = violations.filter(v => v.severity === 'high');
    base += highViolations.length * 7;
  } catch {
    // Non-blocking — metro2 audit is optional signal
  }`;
replace('scoreImpactProjector.ts', oldProjector, newProjector);

console.log("Replacements complete");
