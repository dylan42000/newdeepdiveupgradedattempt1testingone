/**
 * Consumer education companion (Apex) — contextual micro-lessons, once per topic.
 */

export type EducationTopic =
  | 'metro2'
  | 'sol'
  | 'goodwill'
  | 'frivolous'
  | 'debt_validation'
  | 'score_sim'
  | 'obsolescence'
  | 'fraud';

const LESSONS: Record<EducationTopic, { title: string; body: string }> = {
  metro2: {
    title: 'What is Metro2?',
    body: 'Metro2 is the data format furnishers use to report accounts. Field-level mismatches (status, DOFD, balance) across bureaus are strong accuracy disputes under FCRA.',
  },
  sol: {
    title: 'Statute of Limitations',
    body: 'SOL is how long a collector can sue in court — separate from the 7-year credit reporting clock. A payment can restart SOL in many states.',
  },
  goodwill: {
    title: 'Goodwill deletions',
    body: 'A goodwill request asks a creditor to remove late history as a courtesy after you paid. It is not an FCRA dispute and should not cite legal demands.',
  },
  frivolous: {
    title: 'Avoiding frivolous flags',
    body: 'Bureaus may reject vague or repeat disputes without new evidence. Specific account facts, new angles, and documents reduce frivolous risk.',
  },
  debt_validation: {
    title: 'FDCPA validation rights',
    body: 'Within 30 days of first collection notice, you can demand validation. Collectors must pause collection of the disputed debt until they respond.',
  },
  score_sim: {
    title: 'Score estimates',
    body: 'FICO and VantageScore use different models. In-app projections are educational ranges — not guaranteed lender scores.',
  },
  obsolescence: {
    title: '7-year reporting clock',
    body: 'Most negative items must fall off after about 7 years from DOFD (bankruptcies longer). Obsolete items should be deleted even if the debt is unpaid.',
  },
  fraud: {
    title: 'Suspected identity theft',
    body: 'If an account is not yours, file at IdentityTheft.gov, gather ID proof, and use FCRA §605B block rights. Do not treat it as a normal late-pay dispute.',
  },
};

const STORAGE_KEY = 'dylandos_education_dismissed_v1';

function loadDismissed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveDismissed(map: Record<string, boolean>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export const EducationContentService = {
  getLesson(topic: EducationTopic): { title: string; body: string } {
    return LESSONS[topic];
  },

  /** Returns lesson once per topic until dismissed. */
  maybeShow(topic: EducationTopic): { title: string; body: string } | null {
    const dismissed = loadDismissed();
    if (dismissed[topic]) return null;
    return LESSONS[topic];
  },

  dismiss(topic: EducationTopic): void {
    const dismissed = loadDismissed();
    dismissed[topic] = true;
    saveDismissed(dismissed);
  },
};
