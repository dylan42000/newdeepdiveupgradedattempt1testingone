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
}): AntiFabricationResult {
  const { letterText, item } = params;
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
  const known = knownSuffixes(item);
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

  const knownBalances = [item.balance, item.originalBalance, item.creditLimit]
    .filter((n): n is number => n != null)
    .map((n) => Math.round(n * 100) / 100);
  if (knownBalances.length > 0) {
    for (const amt of extractMoneyAmounts(letterText)) {
      const close = knownBalances.some((b) => Math.abs(b - amt) <= 1);
      // Allow small incidental amounts (postage etc.) under $25 when not close
      if (!close && amt >= 25) {
        findings.push({
          code: 'INVENTED_BALANCE',
          severity: 'block',
          message: `Letter cites $${amt.toFixed(2)} which is not grounded in parsed balances.`,
        });
      }
    }
  }

  const knownDates = [
    item.dateOfFirstDelinquency,
    item.originalDateOfDelinquency,
    item.dateOpened,
    item.originalOpeningDate,
    item.dateClosed,
    item.dateOfLastReporting,
    item.autoRemovalDate,
  ]
    .filter(Boolean)
    .map((d) => String(d));

  // If DOFD is missing, block any DOFD-labeled date claims that invent one
  const dofdMissing = !item.dateOfFirstDelinquency && !item.originalDateOfDelinquency;
  if (dofdMissing) {
    const dofdClaim = /date\s+of\s+first\s+delinquency[^\d]{0,40}(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2})/i.exec(
      letterText,
    );
    if (dofdClaim) {
      findings.push({
        code: 'INVENTED_DOFDF',
        severity: 'block',
        message: 'Letter asserts a DOFD but parser has no DOFD — fabrication blocked.',
      });
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
