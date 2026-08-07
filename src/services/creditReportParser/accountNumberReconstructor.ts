export type MaskPattern = 'suffix_4' | 'suffix_6' | 'prefix_masked' | 'middle_masked' | 'full_visible' | 'unknown';

export interface ReconstructedAccountNumber {
  raw: string;
  normalized: string;
  suffix: string;
  prefix: string | null;
  maskPattern: MaskPattern;
  confidence: number;
  fullEstimate: string | null;
}

export function normalizeAccountNumber(raw = ''): ReconstructedAccountNumber {
  const cleaned = raw.trim();
  const compact = cleaned.replace(/[\s\-_.]/g, '');
  const normalized = compact.replace(/[^0-9]/g, '');
  const masked = /[xX*]/.test(compact);
  let maskPattern: MaskPattern = 'unknown';
  if (/^\d{8,}$/.test(compact)) maskPattern = 'full_visible';
  else if (/^[xX*]+\d{6}$/.test(compact)) maskPattern = 'suffix_6';
  else if (/^[xX*]+\d{4}$/.test(compact) || /^\d{4}$/.test(compact)) maskPattern = 'suffix_4';
  else if (/^\d{4,}[xX*]+$/.test(compact)) maskPattern = 'prefix_masked';
  else if (/^\d{2,}[xX*]+\d{2,}$/.test(compact)) maskPattern = 'middle_masked';
  else if (!masked && normalized.length >= 8) maskPattern = 'full_visible';
  else if (normalized.length >= 4) maskPattern = 'suffix_4';

  const confidence = maskPattern === 'full_visible' ? 1 : normalized.length >= 8 ? 0.85 : normalized.length >= 6 ? 0.7 : normalized.length === 4 ? 0.55 : normalized.length ? 0.3 : 0;
  return {
    raw: cleaned,
    normalized,
    suffix: normalized.length >= 4 ? normalized.slice(-4) : '',
    prefix: normalized.length > 4 ? normalized.slice(0, -4) : null,
    maskPattern,
    confidence,
    fullEstimate: maskPattern === 'full_visible' ? normalized : null,
  };
}

export function extractSuffix(raw?: string | null): string {
  return normalizeAccountNumber(raw ?? '').suffix;
}

export function extractPrefix(raw?: string | null): string | null {
  return normalizeAccountNumber(raw ?? '').prefix;
}
