export interface Persona {
  id: string;
  name: string;
  voiceDescription: string;
  legalFraming: string;
  systemPromptAddendum: string;
}

const PERSONA_POOL: Persona[] = [
  {
    id: 'audit_examiner',
    name: 'Consumer — Documented Error',
    voiceDescription: 'First-person, factual, methodical, and specific about reported fields.',
    legalFraming: 'The consumer identifies a reporting problem and asks for an accurate investigation and correction.',
    systemPromptAddendum: `Write as the consumer describing what appears in my report, the exact field I dispute, and the result I am requesting. Keep the tone measured and factual.`,
  },
  {
    id: 'rights_enforcer',
    name: 'Consumer — Rights Aware',
    voiceDescription: 'Direct first-person consumer voice with restrained legal support.',
    legalFraming: 'Centers the consumer\'s statutory rights under FCRA and makes the furnisher\'s obligations explicit.',
    systemPromptAddendum: `Write as me, the consumer. Lead with my account facts and use legal citations only where they directly support the requested investigation or correction.`,
  },
  {
    id: 'data_analyst',
    name: 'Consumer — Data Comparison',
    voiceDescription: 'First-person, numbers-first, and focused on specific cross-report differences.',
    legalFraming: 'Frames the dispute as a data quality problem that violates reporting standards.',
    systemPromptAddendum: `Write as me, the consumer, comparing the exact reported values. Do not claim a correct value unless it is supplied.`,
  },
  {
    id: 'legal_strategist',
    name: 'Consumer — Firm Follow-up',
    voiceDescription: 'First-person, chronological, firm, and suitable for preserving a clear record.',
    legalFraming: 'Each letter is written as if it will be exhibit A in a civil action.',
    systemPromptAddendum: `Write as me, the consumer, identifying prior dates and the exact unresolved field. Do not claim I filed or will file anything unless the case history says so.`,
  },
  {
    id: 'investigative_reporter',
    name: 'Consumer — Plain Language',
    voiceDescription: 'Natural first-person wording that is clear, specific, and easy to investigate.',
    legalFraming: 'Frames the dispute as holding a furnisher accountable to verifiable source documents.',
    systemPromptAddendum: `Write as me, the consumer, in natural language. State what my report shows, why I dispute it, and what I want corrected.`,
  },
];

function stableHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

export function getPersonaForItem(itemId: string, passNumber: number): Persona {
  const key = `${itemId}::pass${passNumber}`;
  const index = stableHash(key) % PERSONA_POOL.length;
  return PERSONA_POOL[index];
}

export function buildPersonaSystemPrompt(persona: Persona): string {
  return `
=== VOICE AND LEGAL PERSONA ===
You are operating as: ${persona.name}
Voice: ${persona.voiceDescription}
Legal Framing: ${persona.legalFraming}

${persona.systemPromptAddendum}

${CONSUMER_VOICE_POLICY}

UNIVERSAL CONSTRAINTS:
- Never use any form of greeting or salutation.
- Never use any closing phrase, thank you, or pleasantry.
- Prefer direct factual statements, but allow ordinary first-person language where it improves clarity.
- Every sentence must help identify the account, disputed field, basis, evidence, history, or requested result.
- If no legal citation applies, write a precise factual sentence instead of inventing one.
`.trim();
}
import { CONSUMER_VOICE_POLICY } from './consumerVoicePolicy';
