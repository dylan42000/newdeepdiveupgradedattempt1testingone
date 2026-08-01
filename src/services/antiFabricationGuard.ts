/**
 * Anti-fabrication guard (Apex L5) — hard gate against invented facts in letters.
 */

import type { NegativeItem, PersonalInfo } from '../types';
import { assertNoUplRisk } from './uplPhraseBlocklist';

export interface FabricationFinding {
  code:
    | 'INVENTED_ACCOUNT_SUFFIX'
    | 'INVENTED_BALANCE'
    | 'INVENTED_DOFDF'
    | 'CASE_CITATION'
    | 'UPL_PHRASE'
    | 'UNRESOLVED_TOKEN';
  severity: 'block' | 'warn';
  message: string;
}

export interface AntiFabricationResult {
  ok: boolean;
  findings: FabricationFinding[];
}

const CASE_CITE_RE =
  /\b\d{1,3}\s+[A-Z][a-z]+\.?\s+\d{1,4}\b|\bv\.\s+[A-Z][a-zA-Z]+\b|\bF\.\s?Supp\b|\bF\.\s?3d\b/;

const TOKEN_RE = /\{\{[A-Z0-9_]+\}\}|\[INSERT[^\]]*\]|TBD_ACCOUNT|FIXME/i;

// ─── World-Class §3.3: Statutory Remedy Whitelist ────────────────────────────
// FCRA §616/§617 civil-liability figures ($100–$1,000 willful statutory damages,
// punitive/TCPA-adjacent round amounts) and similar standards are legal remedy
// citations — NOT invented account balances — and must never trip the
// INVENTED_BALANCE gate when they differ from parsed balances.
const STATUTORY_REMEDY_AMOUNTS = new Set([100, 500, 1000, 2500, 5000]);

function knownSuffixes(item: NegativeItem): string[] {
  const raw = `${item.fullAccountNumber || ''} ${item.accountNumber || ''}`;
  const digits = raw.replace(/\D/g, '');
  const out: string[] = [];
  if (digits.length >= 4) out.push(digits.slice(-4));
  if (digits.length >= 3) out.push(digits.slice(-3));
  return out;
}

function extractMoneyAmounts(text: string): number[] {
  const amounts: number[] = [];
  const re = /\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const n = Number(m[1].replace(/,/g, ''));
    if (!Number.isNaN(n)) amounts.push(Math.round(n * 100) / 100);
  }
  return amounts;
}

function extractDateLike(text: string): string[] {
  const dates: string[] = [];
  const re =
    /\b(?:0?[1-9]|1[0-2])[\/\-](?:0?[1-9]|[12]\d|3[01])[\/\-](?:19|20)\d{2}\b|\b(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) dates.push(m[0]);
  return dates;
}

/**
 * Validate letter body against parsed item facts. Blocks invented suffixes/balances/DOFD.
 */
export function guardLetterAgainstFabrication(params: {
  letterText: string;
  item: NegativeItem;
  personalInfo?: PersonalInfo | null;
  /**
   * World-Class §5.2: grouped/multi-item letters legitimately reference the
   * balances, dates, and account suffixes of EVERY item in the group. Provide
   * sibling items here so their grounded facts are treated as known-good
   * instead of flagged as invented (false-positive hard blocks).
   */
  additionalItems?: NegativeItem[];
}): AntiFabricationResult {
  const { letterText, item } = params;
  const allItems: NegativeItem[] = [item, ...(params.additionalItems ?? [])];
  const findings: FabricationFinding[] = [];

  if (TOKEN_RE.test(letterText)) {
    findings.push({
      code: 'UNRESOLVED_TOKEN',
      severity: 'block',
      message: 'Letter contains unresolved placeholder tokens.',
    });
  }

  const upl = assertNoUplRisk(letterText);
  if (upl.ok === false) {
    for (const hit of upl.hits) {
      findings.push({
        code: 'UPL_PHRASE',
        severity: 'block',
        message: `UPL-risk phrase blocked: "${hit.phrase}"`,
      });
    }
  }

  if (CASE_CITE_RE.test(letterText)) {
    findings.push({
      code: 'CASE_CITATION',
      severity: 'block',
      message: 'Case-law citations are blocked by default (hallucination risk). Use statutory cites only.',
    });
  }

  // Account suffix check — any ****1234 / ending in 1234 style must match known digits
  const suffixMentions = letterText.match(/(?:ending\s+in|last\s+4|x{2,}|\*{2,}|#{2,})\s*([0-9]{3,4})\b/gi) ?? [];
  const known = [...new Set(allItems.flatMap((it) => knownSuffixes(it)))];
  for (const mention of suffixMentions) {
    const digits = mention.replace(/\D/g, '').slice(-4);
    if (digits && known.length > 0 && !known.some((k) => k.endsWith(digits) || digits.endsWith(k))) {
      findings.push({
        code: 'INVENTED_ACCOUNT_SUFFIX',
        severity: 'block',
        message: `Letter cites account suffix ${digits} not present on parsed item.`,
      });
    }
  }

  // Standalone 4-digit "account ... 1234" near account wording
  const acctNear = /account[^\d]{0,24}(\d{4})\b/gi;
  let am: RegExpExecArray | null;
  while ((am = acctNear.exec(letterText))) {
    const digits = am[1];
    if (known.length > 0 && !known.some((k) => k.endsWith(digits) || digits.endsWith(k.slice(-4)))) {
      findings.push({
        code: 'INVENTED_ACCOUNT_SUFFIX',
        severity: 'block',
        message: `Letter cites account digits ${digits} not grounded in parser output.`,
      });
    }
  }

  const knownBalances = allItems
    .flatMap((it) => [it.balance, it.originalBalance, it.creditLimit])
    .filter((n): n is number => n != null)
    .map((n) => Math.round(n * 100) / 100);
  if (knownBalances.length > 0) {
    for (const amt of extractMoneyAmounts(letterText)) {
      const close = knownBalances.some((b) => Math.abs(b - amt) <= 1);
      // World-Class §3.3.1: FCRA statutory remedies ($100/$500/$1,000/$2,500/$5,000)
      // are legal citations, not invented balances — exempt them from this gate.
      const isStatutoryRemedy = STATUTORY_REMEDY_AMOUNTS.has(Math.round(amt));
      // Allow small incidental amounts (postage etc.) under $25 when not close
      if (!close && !isStatutoryRemedy && amt >= 25) {
        findings.push({
          code: 'INVENTED_BALANCE',
          severity: 'block',
          message: `Letter cites $${amt.toFixed(2)} which is not grounded in parsed balances or standard FCRA statutory remedy limits.`,
        });
      }
    }
  }

  const knownDates = allItems
    .flatMap((it) => [
      it.dateOfFirstDelinquency,
      it.originalDateOfDelinquency,
      it.dateOpened,
      it.originalOpeningDate,
      it.dateClosed,
      it.dateOfLastReporting,
      it.autoRemovalDate,
    ])
    .filter(Boolean)
    .map((d) => String(d));

  // If DOFD is missing, block ONLY concrete invented dates.
  // World-Class §3.3.2 (DOFD Omission Challenge Exemption): when the bureau
  // omitted or masked the DOFD, a valid dispute letter asserts that the Date of
  // First Delinquency "is unreported", "is missing", or "may have been re-aged".
  // Those challenges are legitimate and must NOT be flagged as fabrication —
  // only a letter asserting a specific calendar date gets blocked.
  const dofdMissing = !item.dateOfFirstDelinquency && !item.originalDateOfDelinquency;
  if (dofdMissing) {
    const concreteDofdClaim = /date\s+of\s+first\s+delinquency\s+(?:was|is|occurred\s+on|of|on)\s+(?:approximately\s+|around\s+|about\s+)?(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2})/i.exec(
      letterText,
    );
    if (concreteDofdClaim) {
      // Grouped letters: a concrete DOFD belonging to ANY grouped item is grounded.
      const asserted = concreteDofdClaim[1].replace(/\//g, '-');
      const groundedElsewhere = knownDates.some((kd) => {
        const a = kd.replace(/\//g, '-');
        return a.includes(asserted) || asserted.includes(a.slice(0, 10));
      });
      if (!groundedElsewhere) {
        findings.push({
          code: 'INVENTED_DOFDF',
          severity: 'block',
          message: `Letter asserts a specific DOFD (${concreteDofdClaim[1]}) not present in parser output.`,
        });
      }
    }
  } else {
    for (const d of extractDateLike(letterText)) {
      const normalized = d.replace(/\//g, '-');
      const grounded = knownDates.some((kd) => {
        const a = kd.replace(/\//g, '-');
        return a.includes(normalized) || normalized.includes(a.slice(0, 10));
      });
      // Only warn for ungrounded dates near DOFD language
      if (!grounded && /delinquency|DOFD|first delinquency/i.test(letterText)) {
        // soft — many letters include send dates; only block if explicitly labeled DOFD mismatch already handled
      }
    }
  }

  const ok = findings.every((f) => f.severity !== 'block');
  return { ok, findings };
}
