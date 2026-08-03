/**
 * Per-state statute of limitations for written consumer debt (years).
 * Used by Legal Intelligence Engine — deterministic, no AI.
 */

export const SOL_YEARS_BY_STATE: Record<string, number> = {
  AL: 6, AK: 3, AZ: 6, AR: 5, CA: 4, CO: 6, CT: 6, DE: 3, FL: 5, GA: 6,
  HI: 6, ID: 5, IL: 10, IN: 6, IA: 10, KS: 5, KY: 10, LA: 3, ME: 6, MD: 3,
  MA: 6, MI: 6, MN: 6, MS: 3, MO: 5, MT: 8, NE: 4, NV: 6, NH: 3, NJ: 6,
  NM: 6, NY: 3, NC: 3, ND: 6, OH: 6, OK: 5, OR: 6, PA: 4, RI: 10, SC: 3,
  SD: 6, TN: 6, TX: 4, UT: 6, VT: 6, VA: 5, WA: 6, WV: 10, WI: 6, WY: 8,
  DC: 3,
};

const STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO',
  montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH',
  oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
  'district of columbia': 'DC',
};

export function normalizeStateCode(state: string | null | undefined): string | null {
  if (!state) return null;
  const trimmed = state.trim();
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  const mapped = STATE_NAME_TO_CODE[trimmed.toLowerCase()];
  return mapped ?? null;
}

export function getSolYears(state: string | null | undefined): number {
  const code = normalizeStateCode(state);
  if (!code) return 6; // conservative default
  return SOL_YEARS_BY_STATE[code] ?? 6;
}

export interface SolAssessment {
  stateCode: string | null;
  solYears: number;
  solExpired: boolean;
  solExpiresInDays: number | null;
  solDefenseApplicable: boolean;
  reageingRisk: boolean;
}

export function assessSol(params: {
  state: string | null | undefined;
  /** DOFD or last payment / last activity ISO-ish date */
  anchorDate: string | null | undefined;
  isCollectionOrChargeOff: boolean;
  today?: Date;
}): SolAssessment {
  const stateCode = normalizeStateCode(params.state);
  const solYears = getSolYears(params.state);
  const today = params.today ?? new Date();
  const anchor = params.anchorDate ? Date.parse(params.anchorDate) : NaN;

  if (Number.isNaN(anchor)) {
    return {
      stateCode,
      solYears,
      solExpired: false,
      solExpiresInDays: null,
      solDefenseApplicable: false,
      reageingRisk: params.isCollectionOrChargeOff,
    };
  }

  const expiresAt = new Date(anchor);
  expiresAt.setFullYear(expiresAt.getFullYear() + solYears);
  const msLeft = expiresAt.getTime() - today.getTime();
  const daysLeft = Math.ceil(msLeft / 86_400_000);
  const solExpired = daysLeft <= 0;

  return {
    stateCode,
    solYears,
    solExpired,
    solExpiresInDays: solExpired ? 0 : daysLeft,
    solDefenseApplicable: solExpired && params.isCollectionOrChargeOff,
    reageingRisk: params.isCollectionOrChargeOff && !solExpired,
  };
}
