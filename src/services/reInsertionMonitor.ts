import type { NegativeItem } from "../types";

export interface ArchivedDeletionRecord {
  itemId: string;
  creditorName: string;
  accountNumber: string | null;
  deletedAt: string;
  bureau: string[];
  priorLetterIds: string[];
}

export interface ReInsertionAlert {
  itemId: string;
  archivedItemId: string;
  creditorName: string;
  accountMask: string;
  reinsertedAt: string;
  originallyDeletedAt: string;
  daysSinceDeletion: number;
  impactedBureaus: string[];
  violationFlags: string[];
}

export interface ReInsertionEvidencePacket {
  alert: ReInsertionAlert;
  legalBasis: string[];
  requestedActions: string[];
  evidenceSummary: string[];
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function accountMask(account: string | null | undefined): string {
  const digits = (account || "").replace(/\D/g, "");
  if (!digits) return "XXXX";
  return `****${digits.slice(-4)}`;
}

function dateDiffDays(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.round((to - from) / (1000 * 60 * 60 * 24)));
}

function likelySameAccount(current: NegativeItem, archived: ArchivedDeletionRecord): boolean {
  const currentCreditor = normalize(current.creditorName || "");
  const archivedCreditor = normalize(archived.creditorName || "");
  const creditorMatch = currentCreditor.length > 0 && archivedCreditor.length > 0 && (
    currentCreditor.includes(archivedCreditor) || archivedCreditor.includes(currentCreditor)
  );

  const currentDigits = (current.accountNumber || "").replace(/\D/g, "");
  const archivedDigits = (archived.accountNumber || "").replace(/\D/g, "");

  const accountMatch = Boolean(currentDigits && archivedDigits && (
    currentDigits.endsWith(archivedDigits.slice(-4)) || archivedDigits.endsWith(currentDigits.slice(-4))
  ));

  return creditorMatch && (accountMatch || !currentDigits || !archivedDigits);
}

export function detectReinsertedItems(
  currentItems: NegativeItem[],
  archivedDeletions: ArchivedDeletionRecord[],
  detectionDate: string = new Date().toISOString(),
): ReInsertionAlert[] {
  const alerts: ReInsertionAlert[] = [];

  for (const current of currentItems) {
    for (const archived of archivedDeletions) {
      if (!likelySameAccount(current, archived)) continue;

      const impactedBureaus = (current.creditBureau || []).filter((bureau) => archived.bureau.includes(bureau));
      if (impactedBureaus.length === 0) continue;

      const daysSinceDeletion = dateDiffDays(archived.deletedAt, detectionDate);
      const flags = [
        "FCRA_611_A_5_B_REINSERTION_NOTICE_REQUIRED",
      ];

      if (daysSinceDeletion <= 45) {
        flags.push("RAPID_REINSERTION_HIGH_RISK");
      }

      alerts.push({
        itemId: current.id,
        archivedItemId: archived.itemId,
        creditorName: current.creditorName,
        accountMask: accountMask(current.accountNumber),
        reinsertedAt: detectionDate,
        originallyDeletedAt: archived.deletedAt,
        daysSinceDeletion,
        impactedBureaus,
        violationFlags: flags,
      });
    }
  }

  return dedupeAlerts(alerts);
}

function dedupeAlerts(alerts: ReInsertionAlert[]): ReInsertionAlert[] {
  const seen = new Set<string>();
  const deduped: ReInsertionAlert[] = [];

  for (const alert of alerts) {
    const key = `${normalize(alert.creditorName)}|${alert.accountMask}|${alert.impactedBureaus.sort().join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(alert);
  }

  return deduped;
}

export function buildReInsertionEvidencePacket(alert: ReInsertionAlert): ReInsertionEvidencePacket {
  return {
    alert,
    legalBasis: [
      "FCRA §611(a)(5)(B): Reinsertions require certification of completeness and accuracy.",
      "FCRA §611(a)(5)(B)(ii): Consumer must receive written notice within 5 business days of reinsertion.",
      "FCRA §623(a)(1)(A): Furnishers may not report information known to be inaccurate.",
    ],
    requestedActions: [
      "Immediate deletion of unlawfully reinserted tradeline.",
      "Disclosure of furnisher certification relied on for reinsertion.",
      "Written confirmation of deletion and correction to all recipients.",
    ],
    evidenceSummary: [
      `Original deletion date: ${alert.originallyDeletedAt}`,
      `Reinsertion detected: ${alert.reinsertedAt}`,
      `Creditor: ${alert.creditorName}`,
      `Account reference: ${alert.accountMask}`,
      `Impacted bureaus: ${alert.impactedBureaus.join(", ")}`,
    ],
  };
}
