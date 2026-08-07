/**
 * letterBodySanitizer.ts
 *
 * Strips structured letter-header / recipient identity blocks that the AI
 * sometimes prepends to dispute letter bodies. The app template
 * (renderLetter / buildLetterHTML) already renders sender + recipient blocks,
 * so repeating them in the body produces a duplicated identity dump — often
 * collapsed into a single run-on line when newlines are normalized.
 *
 * Uses generic structural patterns only — never hardcodes consumer PII.
 */

/** Placeholder like [Experian Address], [Equifax Address], [Credit Bureau Address]. */
const BUREAU_ADDRESS_PLACEHOLDER_SOURCE =
  '\\[(?:Equifax|Experian|TransUnion|Credit\\s+Bureau|Furnisher|[A-Za-z][A-Za-z .&\'-]{0,40})\\s+Address\\]';

const BUREAU_ADDRESS_PLACEHOLDER = new RegExp(BUREAU_ADDRESS_PLACEHOLDER_SOURCE, 'gi');
const BUREAU_ADDRESS_PLACEHOLDER_ONCE = new RegExp(BUREAU_ADDRESS_PLACEHOLDER_SOURCE, 'i');

const SSN_MASK =
  /(?:\*{2,3}|X{2,3}|x{2,3})[-\s]?(?:\*{2}|X{2}|x{2})[-\s]?\d{4}/;

const PHONE_NUMBER =
  /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;

const EMAIL_ADDRESS =
  /[^\s@]+@[^\s@]+\.[^\s@]+/;

const CITY_STATE_ZIP =
  /^[A-Za-z][A-Za-z .'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?$/;

const STREET_ADDRESS =
  /^(?:\d{1,6}[A-Za-z]?\s+|P\.?\s*O\.?\s*Box\s+\d+)/i;

const DOB_OR_SHORT_DATE =
  /^(?:\d{1,2}\/\d{1,2}\/\d{2,4}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})$/i;

const CONSUMER_NAME_LINE =
  /^[A-Z][a-zA-Z'.-]+(?:\s+[A-Z][a-zA-Z'.-]+){0,3}$/;

/** Title-case phrases that look like names but are real letter openers / subject lines. */
const TITLE_CASE_FALSE_POSITIVES =
  /^(?:Account\s+Verification\s+Request|Formal\s+Dispute|Dispute\s+Letter|Method\s+of\s+Verification|Request\s+for\s+Reinvestigation|Notice\s+of\s+Dispute|Credit\s+Report\s+Dispute|Direct\s+Dispute|Goodwill\s+Request|Pay\s+for\s+Delete|Consumer\s+Statement)$/i;

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

/**
 * Unwrap leading `<p>…</p>` / `<div>…</div>` blocks into plain lines so
 * header-line detection works on HTML identity dumps from Autopilot prompts.
 */
function unwrapLeadingBlockTags(text: string): string {
  let out = text;
  // Convert consecutive opening block paragraphs into newline-separated plain text
  if (/^\s*<(?:p|div)\b/i.test(out)) {
    out = out
      .replace(/<\/(?:p|div)>\s*<(?:p|div)[^>]*>/gi, '\n')
      .replace(/<\/?(?:p|div)[^>]*>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  return out;
}

/**
 * True when a line looks like structured letterhead / recipient metadata,
 * not dispute narrative.
 */
export function isLetterHeaderLine(line: string): boolean {
  const t = line.trim().replace(/<\/?(?:p|div|span|strong|em|b|i)[^>]*>/gi, '').trim();
  if (!t) return true;

  if (/^phone\s*:/i.test(t)) return true;
  if (/^email\s*:/i.test(t)) return true;
  if (/^(?:date\s+of\s+birth|dob)\s*:/i.test(t)) return true;
  if (/^ssn\b/i.test(t)) return true;
  if (/^(?:via\s+)?certified\s+mail/i.test(t)) return true;
  if (/^to whom it may concern[:.]?$/i.test(t)) return true;
  if (/^re\s*:/i.test(t)) return true;
  if (/^(sincerely|respectfully|regards)[,]?$/i.test(t)) return true;

  if (CITY_STATE_ZIP.test(t)) return true;
  if (STREET_ADDRESS.test(t) && t.length < 120) return true;
  if (DOB_OR_SHORT_DATE.test(t)) return true;
  if (new RegExp(`^${SSN_MASK.source}$`, 'i').test(t)) return true;
  if (new RegExp(`^${PHONE_NUMBER.source}$`).test(t)) return true;
  if (new RegExp(`^${EMAIL_ADDRESS.source}$`).test(t)) return true;

  // Bureau name alone (recipient line)
  if (/^(equifax|experian|transunion)(?:\s+information\s+services)?(?:\s+llc)?$/i.test(t)) {
    return true;
  }

  // Standalone bureau-address placeholder line
  if (
    /^\[(?:Equifax|Experian|TransUnion|Credit\s+Bureau|Furnisher|[A-Za-z][A-Za-z .&'-]{0,40})\s+Address\]$/i.test(
      t,
    )
  ) {
    return true;
  }

  // Short consumer-name line (2–4 capitalized tokens) — exclude known subject phrases
  if (
    CONSUMER_NAME_LINE.test(t) &&
    t.length <= 60 &&
    !/[.!?:]/.test(t) &&
    !TITLE_CASE_FALSE_POSITIVES.test(t)
  ) {
    return true;
  }

  return false;
}

/**
 * Strip a leading multi-line identity / recipient block.
 * Stops at the first line that looks like dispute narrative.
 */
function stripLeadingHeaderLines(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  let strippedAny = false;

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      // Keep blank lines only after we've started stripping header material
      if (strippedAny) {
        i += 1;
        continue;
      }
      break;
    }
    if (isLetterHeaderLine(line)) {
      strippedAny = true;
      i += 1;
      continue;
    }
    break;
  }

  if (!strippedAny) return text.replace(/\r\n/g, '\n');

  // Drop leftover leading blanks after header removal
  while (i < lines.length && isBlank(lines[i])) i += 1;
  return lines.slice(i).join('\n');
}

/**
 * Handle the collapsed run-on dump:
 *   "Jane Doe 123 Main St City, ST 00000 ***-**-1234 01/01/1990 [Experian Address] The credit report..."
 * Prefer cutting through a bureau-address placeholder near the start.
 * Also handles no-SSN dumps that still cluster phone + email + CSZ.
 */
function stripInlineIdentityDump(text: string): string {
  const trimmed = text.trimStart();
  const firstParagraphEnd = trimmed.search(/\n\s*\n/);
  const head = firstParagraphEnd >= 0 ? trimmed.slice(0, firstParagraphEnd) : trimmed.slice(0, 600);

  // Only act when the head looks like an identity dump (SSN mask and/or address placeholder
  // and/or phone+email+street/CSZ cluster)
  const hasSsn = SSN_MASK.test(head);
  const hasPhone = PHONE_NUMBER.test(head);
  const hasEmail = EMAIL_ADDRESS.test(head);
  const hasStreetOrCsz =
    /\d{1,6}[A-Za-z]?\s+[A-Za-z]/.test(head) ||
    /[A-Za-z][A-Za-z .'-]+,\s*[A-Z]{2}\s+\d{5}/.test(head);
  const placeholderMatch = head.match(BUREAU_ADDRESS_PLACEHOLDER_ONCE);
  const looksLikeContactCluster = hasPhone && hasEmail && hasStreetOrCsz;

  if (placeholderMatch && placeholderMatch.index !== undefined && placeholderMatch.index < 450) {
    const after = trimmed.slice(placeholderMatch.index + placeholderMatch[0].length).trimStart();
    if (after.length >= 40) return after;
  }

  if (!hasSsn && !looksLikeContactCluster) return trimmed;

  // Cut after SSN mask (+ optional DOB) when followed by a narrative opener
  const dumpPrefixWithSsn =
    /^(?:[A-Z][a-zA-Z'.-]+(?:\s+[A-Z][a-zA-Z'.-]+){0,3}\s+)?(?:\d{1,6}[A-Za-z]?[^\n]{0,80}?\s+)?(?:[A-Za-z][A-Za-z .'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\s+)?(?:Phone:\s*)?(?:\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\s+)?(?:Email:\s*)?(?:[^\s@]+@[^\s@]+\.[^\s@]+\s+)?(?:(?:Date of Birth|DOB):\s*)?(?:\*{2,3}|X{2,3}|x{2,3})[-\s]?(?:\*{2}|X{2}|x{2})[-\s]?\d{4}\s+(?:\d{1,2}\/\d{1,2}\/\d{2,4}\s+)?/i;

  // No-SSN contact dump: Name + street + CSZ + Phone + Email (+ optional DOB) then narrative
  const dumpPrefixNoSsn =
    /^(?:[A-Z][a-zA-Z'.-]+(?:\s+[A-Z][a-zA-Z'.-]+){0,3}\s+)(?:\d{1,6}[A-Za-z]?[^\n]{0,80}?\s+)(?:[A-Za-z][A-Za-z .'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\s+)(?:Phone:\s*)?(?:\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\s+)(?:Email:\s*)?(?:[^\s@]+@[^\s@]+\.[^\s@]+\s+)(?:(?:Date of Birth|DOB):\s*)?(?:\d{1,2}\/\d{1,2}\/\d{2,4}\s+)?/i;

  const m = hasSsn
    ? trimmed.match(dumpPrefixWithSsn)
    : trimmed.match(dumpPrefixNoSsn);

  if (m && m[0].length < 450) {
    const after = trimmed.slice(m[0].length).trimStart();
    // Also drop a trailing bureau placeholder if still present
    const cleaned = after.replace(new RegExp(`^${BUREAU_ADDRESS_PLACEHOLDER_SOURCE}\\s*`, 'i'), '').trimStart();
    if (cleaned.length >= 40) return cleaned;
  }

  return trimmed;
}

/**
 * Remove residual bureau-address placeholders that belong in the recipient block.
 * Safe to run on full body: only removes the bracket token itself.
 */
export function stripBureauAddressPlaceholders(text: string): string {
  return text
    .replace(BUREAU_ADDRESS_PLACEHOLDER, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Sanitize a dispute letter body so it starts with narrative content.
 * Idempotent — safe to call at generation time and again at format/display time.
 */
export function stripLetterBodyPreamble(content: string): string {
  if (!content || !content.trim()) return content ?? '';

  let text = content.replace(/\r\n/g, '\n').trim();

  // HTML identity dumps (<p>Name</p><p>Street</p>…) → plain lines first
  text = unwrapLeadingBlockTags(text);

  // Multi-line letterhead first
  text = stripLeadingHeaderLines(text);

  // Collapsed run-on identity dump (common after white-space normalization)
  text = stripInlineIdentityDump(text);

  // One more multi-line pass in case run-on stripping left blank/header crumbs
  text = stripLeadingHeaderLines(text);

  // Drop any leftover [Bureau Address] tokens in the opening region / body
  text = stripBureauAddressPlaceholders(text);

  return text.trim();
}
