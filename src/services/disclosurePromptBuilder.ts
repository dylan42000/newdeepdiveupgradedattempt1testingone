import type { DisputeLetterRequest } from './letterGeneratorV2';

export function buildDisclosureDemandPrompt(req: DisputeLetterRequest): string {
  return `
=== §609 DISCLOSURE DEMAND BRIEF ===
ACCOUNT: ${req.account.creditorName} — Account Number: MASKED (****/***)
BUREAU TARGET: ${req.bureau.toUpperCase()}
DATE: ${req.todayDate}
CONSUMER: ${req.consumerName}

=== YOUR OBJECTIVE ===
Draft a formal §609(a)(1) full-file disclosure demand. This is NOT a dispute letter.
The account number is masked and cannot be identified with sufficient certainty to dispute.
The objective is to compel the consumer reporting agency to disclose:
  1. The complete, unmasked account number or identifying information
  2. The name, address, and telephone number of each person who provided the information
  3. All information in the consumer's file related to this tradeline
  4. The sources from which this information was obtained

=== LEGAL REQUIREMENTS TO INVOKE ===
- FCRA §609(a)(1): Full file disclosure right
- FCRA §609(a)(2): Identification of information sources
- FCRA §610(a): Method of disclosure
- State that the consumer is exercising their statutory right — not making a request.

=== MANDATORY STRUCTURE ===
1. Open with: identification of the masked tradeline and its bureau reporting status
2. Invoke FCRA §609(a)(1) as the controlling statutory authority
3. Enumerate each category of information demanded with precision
4. State the 15-business-day response deadline per §610
5. State consequences of non-disclosure (escalation to CFPB, state AG)
6. No pleasantries. No hedging. No boilerplate.

Generate the §609 disclosure demand body now. Raw letter content only.
`.trim();
}
