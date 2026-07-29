/**
 * bureauAddressService.ts — Verified 2026 Bureau Dispute Addresses
 *
 * Issue 3 Fix: Replace all dynamic address-string-parsing with hardcoded,
 * verified 2026 P.O. Boxes. Source: FTC, CFPB, Equifax.com (confirmed May 2026).
 *
 * These are the DISPUTE-SPECIFIC P.O. Boxes, NOT general mailing addresses.
 * Always send dispute letters via Certified Mail with Return Receipt (USPS Form 3811).
 * The return receipt proves the date the bureau received your dispute, starting
 * the 30-day investigation clock under FCRA §611(a)(1)(A).
 */

export interface BureauAddress {
  name: string;
  fullName: string;
  line1: string;       // Street/PO Box line
  line2?: string;      // Suite / Department if applicable
  city: string;
  state: string;
  zip: string;
  fullAddress: string; // Pre-formatted single-line string
  phone: string;
  department: string;
}

// ─── HARDCODED VERIFIED 2026 BUREAU DISPUTE ADDRESSES ────────────────────────

export const BUREAU_DISPUTE_ADDRESSES: Record<string, BureauAddress> = {

  // ── Equifax ─────────────────────────────────────────────────────────────────
  Equifax: {
    name: 'Equifax',
    fullName: 'Equifax Information Services, LLC',
    line1: 'P.O. Box 740256',
    city: 'Atlanta',
    state: 'GA',
    zip: '30374-0256',
    fullAddress: 'P.O. Box 740256, Atlanta, GA 30374-0256',
    phone: '1-888-378-4329',
    department: 'Dispute Department',
  },

  // ── Experian ────────────────────────────────────────────────────────────────
  Experian: {
    name: 'Experian',
    fullName: 'Experian Information Solutions, Inc.',
    line1: 'P.O. Box 4500',
    city: 'Allen',
    state: 'TX',
    zip: '75013',
    fullAddress: 'P.O. Box 4500, Allen, TX 75013',
    phone: '1-888-397-3742',
    department: 'Dispute Department',
  },

  // ── TransUnion ──────────────────────────────────────────────────────────────
  TransUnion: {
    name: 'TransUnion',
    fullName: 'TransUnion Consumer Solutions',
    line1: 'P.O. Box 2000',
    city: 'Chester',
    state: 'PA',
    zip: '19016',
    fullAddress: 'P.O. Box 2000, Chester, PA 19016',
    phone: '1-800-916-8800',
    department: 'Consumer Solutions',
  },
};

// ─── ALIAS MAP — normalize any input variation to a canonical key ─────────────

const BUREAU_ALIASES: Record<string, string> = {
  // Equifax variants
  'equifax': 'Equifax',
  'equifax information services': 'Equifax',
  'equifax information services llc': 'Equifax',
  'eqfx': 'Equifax',
  'eq': 'Equifax',
  'equ': 'Equifax',

  // Experian variants
  'experian': 'Experian',
  'experian information solutions': 'Experian',
  'experian information solutions inc': 'Experian',
  'exp': 'Experian',
  'xpn': 'Experian',

  // TransUnion variants
  'transunion': 'TransUnion',
  'trans union': 'TransUnion',
  'transunion consumer solutions': 'TransUnion',
  'transunion llc': 'TransUnion',
  'tu': 'TransUnion',
  'tuc': 'TransUnion',
};

// ─── MAIN RESOLVER ────────────────────────────────────────────────────────────

/**
 * Parse a bureau name string (any casing/variant) into the verified BureauAddress.
 * Falls back to a safe placeholder rather than crashing when the bureau is unknown
 * (e.g., a furnisher name passed by mistake).
 */
export function parseBureauAddress(bureauInput: string): BureauAddress {
  const normalized = bureauInput.toLowerCase().trim();
  const canonicalKey = BUREAU_ALIASES[normalized] ?? null;

  if (canonicalKey && BUREAU_DISPUTE_ADDRESSES[canonicalKey]) {
    return BUREAU_DISPUTE_ADDRESSES[canonicalKey];
  }

  // Fuzzy match — check if input contains a known alias as a substring
  for (const [alias, key] of Object.entries(BUREAU_ALIASES)) {
    if (normalized.includes(alias)) {
      return BUREAU_DISPUTE_ADDRESSES[key];
    }
  }

  // FALLBACK: Unknown bureau — return safe placeholder rather than crashing
  console.warn(`[bureauAddressService] Unknown bureau: "${bureauInput}" — using placeholder`);
  return {
    name: bureauInput,
    fullName: bureauInput,
    line1: '[Bureau Address — Please Verify]',
    city: '[City]',
    state: '[ST]',
    zip: '[ZIP]',
    fullAddress: `${bureauInput}, [Address Verification Required]`,
    phone: '[Phone]',
    department: 'Dispute Department',
  };
}

/**
 * Returns true if the input resolves to one of the 3 known bureaus.
 */
export function isKnownBureau(bureauInput: string): boolean {
  const normalized = bureauInput.toLowerCase().trim();
  if (BUREAU_ALIASES[normalized]) return true;
  for (const alias of Object.keys(BUREAU_ALIASES)) {
    if (normalized.includes(alias)) return true;
  }
  return false;
}

// ─── LETTER TEMPLATE HELPERS ──────────────────────────────────────────────────

/**
 * Returns the full recipient name + address block as a multi-line string
 * suitable for the physical address area of a dispute letter.
 */
export function formatBureauRecipientBlock(bureau: string): string {
  const addr = parseBureauAddress(bureau);
  return [
    addr.fullName,
    addr.department,
    addr.line1,
    addr.line2 ?? null,
    `${addr.city}, ${addr.state} ${addr.zip}`,
  ].filter(Boolean).join('\n');
}

/**
 * Returns the individual address fields needed by buildLetterHTML() and
 * renderLetter() — replaces the old parseRecipientAddress(resolveTargetAddress(...)) chain.
 */
export function getBureauAddressForLetterTemplate(bureau: string): {
  recipientName: string;
  recipientAddress: string;
  recipientCity: string;
  recipientState: string;
  recipientZip: string;
} {
  const addr = parseBureauAddress(bureau);
  return {
    recipientName: addr.fullName,
    recipientAddress: addr.line1,
    recipientCity: addr.city,
    recipientState: addr.state,
    recipientZip: addr.zip,
  };
}
