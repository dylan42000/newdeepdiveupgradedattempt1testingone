const CREDITOR_ALIASES: Record<string, string> = {
  'wamu': 'jpmorgan chase',
  'washington mutual': 'jpmorgan chase',
  'bank of america na': 'bank of america',
  'bofa': 'bank of america',
  'citi bank': 'citibank',
  'capital one na': 'capital one',
  'cap one': 'capital one',
  'synchrony bank': 'synchrony',
  'td bank na': 'td bank',
  'ally financial inc': 'ally financial',
};

export interface HealedAccount {
  id: string;
  creditorName: string;
  reconstructedAccountNumber?: string;
  balance: number;
  status: string;
  dateOpened?: string;
  dateOfFirstDelinquency?: string;
  confidenceScore: number;
  healingFlags: string[];
  requiresDisclosureRequest: boolean;
}

export function normalizeCreditorName(raw: string): string {
  const lower = raw.toLowerCase().trim();
  for (const [alias, canonical] of Object.entries(CREDITOR_ALIASES)) {
    if (lower.includes(alias)) return canonical;
  }
  return lower
    .replace(/\b(inc|llc|na|n\.a\.|corp|ltd|bank|financial|services?)\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const MASKED_PATTERNS = [
  /\*{2,}/,          // Catches any instance of 2 or more asterisks anywhere (e.g., xxxx****)
  /[xX]{2,}/,        // Catches any instance of 2 or more X's anywhere
  /[\*xX\s\-]{4,}$/, // Catches sequences ending in mixed masks or spaces
];

export function isAccountNumberMasked(accountNumber: string | null | undefined): boolean {
  if (!accountNumber) return true;
  const cleaned = accountNumber.replace(/[\s\-]/g, '');
  return MASKED_PATTERNS.some((pattern) => pattern.test(cleaned));
}

export interface ConfidenceBreakdown {
  bureauCoverage: number;
  balanceAgreement: number;
  statusAgreement: number;
  dofdAgreement: number;
  creditorMatch: number;
  total: number;
}

export function computeConfidenceScore(
  accounts: Array<{ bureau: string; balance: number; status: string; dofd: string | null; creditorName: string; }>,
): ConfidenceBreakdown {
  const bureauCoverage = Math.min(accounts.length, 3) * 10;

  const balances = accounts.map((a) => a.balance).filter((b) => b > 0);
  const balanceMean = balances.reduce((s, b) => s + b, 0) / (balances.length || 1);
  const balanceVariance = balances.every((b) => Math.abs(b - balanceMean) / balanceMean < 0.1);
  const balanceAgreement = balances.length > 1 && balanceVariance ? 25 : balances.length === 1 ? 15 : 0;

  const statuses = accounts.map((a) => a.status.toLowerCase());
  const statusAgreement = statuses.every((s) => s === statuses[0]) ? 20 : 0;

  const dofds = accounts.map((a) => a.dofd).filter(Boolean) as string[];
  const dofdTimestamps = dofds.map((d) => new Date(d).getTime());
  const dofdRange = dofdTimestamps.length > 1 ? Math.max(...dofdTimestamps) - Math.min(...dofdTimestamps) : 0;
  const dofdAgreement = dofds.length === 0 ? 0 : dofdTimestamps.length === 1 ? 10 : dofdRange <= 30 * 24 * 60 * 60 * 1000 ? 15 : 5;

  const normalizedNames = accounts.map((a) => normalizeCreditorName(a.creditorName));
  const creditorMatch = normalizedNames.every((n) => n === normalizedNames[0]) ? 10 : 5;

  const total = bureauCoverage + balanceAgreement + statusAgreement + dofdAgreement + creditorMatch;
  return { bureauCoverage, balanceAgreement, statusAgreement, dofdAgreement, creditorMatch, total };
}
