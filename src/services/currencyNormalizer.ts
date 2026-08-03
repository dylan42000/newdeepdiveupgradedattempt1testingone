/**
 * currencyNormalizer.ts — Unified Currency Normalization Utilities
 *
 * BUG-03 FIX: The grounding validator had an inline normalizeCurrency() that
 * could produce false positives when comparing "$388" vs "$388.00" (string match
 * vs numeric equivalence). This module normalizes ALL currency values to integer
 * cents for lossless, format-agnostic comparison.
 *
 * All services that need to compare or validate dollar amounts MUST use this module.
 * Never compare currency strings directly — use normalizeCurrencyToCents().
 */

/**
 * Convert any dollar string or number to integer cents.
 * Examples:
 *   "$1,388.50" → 138850
 *   "$388.00"   → 38800
 *   "$388"      → 38800
 *   388         → 38800
 *   388.5       → 38850
 * Returns null for non-numeric / empty / undefined input.
 */
export function normalizeCurrencyToCents(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const str = typeof value === 'number' ? String(value) : value;
  // Strip everything except digits and the decimal point
  const stripped = str.replace(/[^0-9.]/g, '');
  if (stripped === '' || stripped === '.') return null;
  const asNum = parseFloat(stripped);
  if (isNaN(asNum)) return null;
  return Math.round(asNum * 100);
}

/**
 * Convert an integer cents value back to a human-readable display string.
 * Examples: 38800 → "$388.00"   138850 → "$1,388.50"
 * Returns "unconfirmed" when cents is null.
 */
export function centsToDisplay(cents: number | null): string {
  if (cents === null || cents === undefined) return 'unconfirmed';
  const dollars = cents / 100;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(dollars);
}

/**
 * Compare two currency values for numeric equality, normalizing both to cents.
 * "$388.00" === "$388" === 388 → true
 * Returns false when either value is null/undefined/non-numeric.
 */
export function currencyEquals(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
): boolean {
  const ca = normalizeCurrencyToCents(a);
  const cb = normalizeCurrencyToCents(b);
  if (ca === null || cb === null) return false;
  return ca === cb;
}

/**
 * Build a Set of all textual forms a dollar amount might appear as in a letter.
 * Used to check whether a letter's currency references are grounded in known facts.
 *
 * For valueCents = 38800 (i.e. $388.00):
 *   → "$388.00", "$388", "388.00", "388", "$388,00" (comma-formatted thousands, etc.)
 */
export function buildAllCurrencyForms(valueCents: number): Set<string> {
  const forms = new Set<string>();
  const dollars = valueCents / 100;
  const hasFractionalCents = valueCents % 100 !== 0;

  const fixed2 = dollars.toFixed(2);
  const fixed0 = Math.floor(dollars).toFixed(0);

  // Comma-formatted with 2 decimal places
  const formattedFull = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(dollars);

  // Comma-formatted without trailing zeroes when cents = 0
  const formattedShort = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: hasFractionalCents ? 2 : 0,
    maximumFractionDigits: hasFractionalCents ? 2 : 0,
  }).format(dollars);

  for (const base of [fixed2, fixed0, formattedFull, formattedShort]) {
    forms.add(`$${base}`);
    forms.add(base);
  }

  return forms;
}

/**
 * Check whether the content string contains a specific dollar amount (in any recognized form).
 * Uses buildAllCurrencyForms() internally so "$388" and "$388.00" both match.
 */
export function contentContainsAmount(content: string, expectedCents: number): boolean {
  const forms = buildAllCurrencyForms(expectedCents);
  for (const form of forms) {
    if (content.includes(form)) return true;
  }
  return false;
}

/**
 * Extract all currency amounts found in text, returned as unique integer cent values.
 * Matches patterns like $388, $1,388.50, $0.99, etc.
 */
export function extractCurrencyAmounts(text: string): number[] {
  const matches = text.match(/\$\s?\d[\d,]*(?:\.\d{1,2})?/g) ?? [];
  const cents = new Set<number>();
  for (const match of matches) {
    const val = normalizeCurrencyToCents(match);
    if (val !== null) cents.add(val);
  }
  return [...cents];
}

/**
 * Detect currency amounts in the letter content that are NOT in the set of known/confirmed amounts.
 * Returns an array of suspicious dollar strings (potential hallucinations).
 *
 * @param content       - The letter body text to scan.
 * @param knownCents    - Array of confirmed integer cent values from the credit report item.
 * @param toleranceCents - Allow minor rounding differences (default 0 = exact match required).
 */
export function detectHallucinatedAmounts(
  content: string,
  knownCents: number[],
  toleranceCents = 0,
): string[] {
  const matches = content.match(/\$\s?\d[\d,]*(?:\.\d{1,2})?/g) ?? [];
  const suspicious = new Set<string>();

  for (const match of matches) {
    const cents = normalizeCurrencyToCents(match);
    if (cents === null) continue;
    const isKnown = knownCents.some(k => Math.abs(k - cents) <= toleranceCents);
    if (!isKnown) suspicious.add(match.trim());
  }

  return [...suspicious];
}
