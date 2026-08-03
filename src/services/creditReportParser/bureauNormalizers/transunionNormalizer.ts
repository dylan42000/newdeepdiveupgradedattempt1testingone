/**
 * TransUnion PDF Linearization Artifact Repair v2.0
 * 
 * TU credit reports frequently use 3+ column layouts.
 * When linearized to plain text, columns interleave into single lines,
 * producing noise like: "Equifax    TransUnion    Experian" or
 * "$1,234.56    $0.00    $5,678.90".
 * 
 * IMPORTANT: Do NOT replace ADVERSE/DEROGATORY with NEGATIVE here.
 * The golden parser and negative-signal detectors rely on these exact terms.
 * Replacing them silently breaks all downstream detection.
 */

export function normalizeTransUnionText(text: string): string {
  let t = text;

  // 1. Repair 3-column interleaving artifacts
  // TransUnion PDFs sometimes interleave columns into a single line.
  // Split lines that contain multiple "$" amounts or alternating bureau labels.
  const lines = t.split('\n');
  const repaired: string[] = [];
  for (const line of lines) {
    const parts = line.split(/\s{3,}/); // 3+ spaces = column gap
    if (parts.length >= 3 && parts.some((p) => p.includes('$'))) {
      // Heuristic: if there are 3+ parts and at least one has a dollar amount,
      // replace with newlines between the parts to un-interleave them
      repaired.push(...parts.filter((p) => p.trim().length > 0));
    } else {
      repaired.push(line);
    }
  }
  t = repaired.join('\n');

  // 2. Fix TU date labels (standardize without destroying content)
  t = t.replace(/\bDATE\s+OF\s+1ST\s+DELINQUENCY[:\s]*/gi, 'Date of First Delinquency: ');
  t = t.replace(/\bDATE\s+REPORTED[:\s]*/gi, 'Date Reported: ');
  t = t.replace(/\bDATE\s+OPENED[:\s]*/gi, 'Date Opened: ');
  t = t.replace(/\bORIGINAL\s+CREDITOR[:\s]*/gi, 'Original Creditor: ');

  // 3. Normalize "Pay Status" label variants
  t = t.replace(/\bPAYMENT\s+STATUS[:\s]*/gi, 'Pay Status: ');
  t = t.replace(/\bACCOUNT\s+STATUS[:\s]*/gi, 'Pay Status: ');

  // 4. Fix "Account Information" boundary header variants
  t = t.replace(/\bACCOUNT\s+INFORMATION\b/gi, 'Account Information');

  return t;
}
