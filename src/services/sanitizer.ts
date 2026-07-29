/**
 * sanitizer.ts — PII Sanitization for Logs and Error Reporting
 * Rule 5 (Credit-Grade Reliability): SSN and sensitive PII must NEVER appear in logs.
 */

const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b|\b\d{9}\b/g;
const CREDIT_CARD_PATTERN = /\b(?:\d{4}[-\s]?){3}\d{4}\b/g;
const ROUTING_PATTERN = /\b\d{9}\b/g;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_PATTERN = /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;

const SENSITIVE_KEYS = new Set([
  'ssn', 'ssnFull', 'socialSecurityNumber', 'social_security_number',
  'password', 'pin', 'secret', 'token', 'apiKey', 'api_key',
  'privateKey', 'private_key', 'accessToken', 'access_token',
  'refreshToken', 'refresh_token', 'credentials',
]);

/**
 * Sanitize any value for safe logging.
 * Removes SSNs, credit card numbers, and other PII from strings and objects.
 */
export function sanitizeForLog(data: unknown): unknown {
  if (data === null || data === undefined) return data;

  if (typeof data === 'string') {
    return data
      .replace(SSN_PATTERN, '[SSN-REDACTED]')
      .replace(CREDIT_CARD_PATTERN, '[CC-REDACTED]')
      .replace(EMAIL_PATTERN, '[EMAIL-REDACTED]')
      .replace(PHONE_PATTERN, '[PHONE-REDACTED]');
  }

  if (typeof data === 'number' || typeof data === 'boolean') return data;

  if (Array.isArray(data)) {
    return data.map(sanitizeForLog);
  }

  if (typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase()) || SENSITIVE_KEYS.has(key)) {
        const strVal = String(value ?? '');
        result[key] = strVal.length > 4
          ? `[REDACTED-${strVal.length}chars]`
          : value ? '[REDACTED]' : null;
      } else {
        result[key] = sanitizeForLog(value);
      }
    }
    return result;
  }

  return data;
}

/**
 * Sanitize a letter's content for logging (keep structure, redact PII).
 */
export function sanitizeLetterForLog(content: string): string {
  if (!content) return '';
  // Keep first 100 chars for identification, then redact details
  const preview = content.slice(0, 100).replace(SSN_PATTERN, '[SSN-REDACTED]');
  return `${preview}... [LETTER-BODY-${content.length}-CHARS-REDACTED]`;
}

/**
 * Check if a string contains an SSN pattern (for validation).
 */
export function containsSSN(text: string): boolean {
  // Clone regex so global lastIndex cannot cause alternating false negatives
  return /\b\d{3}-\d{2}-\d{4}\b|\b\d{9}\b/.test(text);
}

/**
 * Mask SSN to last 4 digits for display.
 */
export function maskSSN(ssn: string): string {
  if (!ssn) return '';
  const digits = ssn.replace(/\D/g, '');
  if (digits.length === 9) {
    return `***-**-${digits.slice(5)}`;
  }
  if (ssn.length >= 4) {
    return `***-**-${ssn.slice(-4)}`;
  }
  return '***-**-****';
}
