/**
 * Focused sanity checks for letter body preamble stripping.
 * Run: npx tsx scripts/letter-body-sanitizer-smoke.ts
 */
import {
  isLetterHeaderLine,
  stripBureauAddressPlaceholders,
  stripLetterBodyPreamble,
} from '../src/services/letterBodySanitizer';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// Multi-line identity + recipient dump (generic fixture — no real PII)
const multiLineDump = [
  'Jane Consumer',
  '123 Example Street',
  'Sampletown, UT 84000',
  'Phone: (555)555-0100',
  'Email: jane.consumer@example.com',
  'Date of Birth: 01/01/1990',
  'SSN (Last 4): XXX-XX-1234',
  '',
  'Experian',
  '[Experian Address]',
  '',
  'The credit report I obtained from your agency lists an inaccurate tradeline.',
].join('\n');

const multiClean = stripLetterBodyPreamble(multiLineDump);
assert(
  multiClean.startsWith('The credit report I obtained'),
  `Multi-line dump must start with narrative. Got: ${multiClean.slice(0, 80)}`,
);
assert(!/Jane Consumer/i.test(multiClean), 'Consumer name must not remain in body');
assert(!/\[Experian Address\]/i.test(multiClean), 'Bureau address placeholder must be removed');
assert(!/XXX-XX-1234/i.test(multiClean), 'SSN mask must not remain in body');

// Collapsed run-on dump matching the production bug shape
const runOn =
  'Jane Consumer 123 Example Street Sampletown, UT 84000 ***-**-1234 01/01/1990 [Experian Address] The credit report I obtained from your agency lists an inaccurate tradeline that must be investigated.';

const runOnClean = stripLetterBodyPreamble(runOn);
assert(
  runOnClean.startsWith('The credit report I obtained'),
  `Run-on dump must start with narrative. Got: ${runOnClean.slice(0, 100)}`,
);
assert(!/\[Experian Address\]/i.test(runOnClean), 'Run-on placeholder must be removed');
assert(!/\*\*\*-\*\*-1234/.test(runOnClean), 'Run-on SSN mask must be removed');

// Clean narrative must pass through unchanged
const clean =
  'The credit report I obtained from your agency contains inaccurate information about account ending 4821.';
assert(stripLetterBodyPreamble(clean) === clean, 'Clean narrative must be unchanged');

// Placeholder-only cleanup
assert(
  stripBureauAddressPlaceholders('Please write to [Equifax Address] regarding this matter.') ===
    'Please write to regarding this matter.',
  'Inline bureau placeholders should be stripped',
);

assert(isLetterHeaderLine('Sampletown, UT 84000'), 'City/state/zip is header');
assert(isLetterHeaderLine('[TransUnion Address]'), 'Bureau placeholder line is header');
assert(!isLetterHeaderLine('The credit report I obtained from your agency is inaccurate.'), 'Narrative is not header');

// HTML <p> identity dump (Autopilot V1 shape)
const htmlDump = [
  '<p>Jane Consumer</p>',
  '<p>123 Example Street</p>',
  '<p>Sampletown, UT 84000</p>',
  '<p>Phone: (555)555-0100</p>',
  '<p>Email: jane.consumer@example.com</p>',
  '<p>The credit report I obtained from your agency lists an inaccurate tradeline.</p>',
].join('\n');
const htmlClean = stripLetterBodyPreamble(htmlDump);
assert(
  /The credit report I obtained/.test(htmlClean),
  `HTML dump must retain narrative. Got: ${htmlClean.slice(0, 120)}`,
);
assert(!/Jane Consumer/i.test(htmlClean), 'HTML dump must strip consumer name');

// No-SSN run-on with phone+email cluster
const noSsnRunOn =
  'Jane Consumer 123 Example Street Sampletown, UT 84000 Phone: (555)555-0100 Email: jane.consumer@example.com 01/01/1990 The credit report I obtained from your agency lists an inaccurate tradeline that must be investigated.';
const noSsnClean = stripLetterBodyPreamble(noSsnRunOn);
assert(
  noSsnClean.startsWith('The credit report I obtained'),
  `No-SSN run-on must start with narrative. Got: ${noSsnClean.slice(0, 100)}`,
);
assert(!/jane\.consumer@example\.com/i.test(noSsnClean), 'No-SSN dump must strip email');

// Title-case subject line must NOT be treated as a consumer name
assert(
  !isLetterHeaderLine('Account Verification Request'),
  'Dispute subject phrases must not be treated as header name lines',
);

console.log('letter-body-sanitizer-smoke: PASS');
