import type { DisputeLetter, HistoryEvent, NegativeItem } from "../types";
import type { BureauResponseType } from "./disputeEngine";

export interface DigestInput {
  periodStart: string;
  periodEnd: string;
  letters: DisputeLetter[];
  history: HistoryEvent[];
  negativeItems: NegativeItem[];
}

export interface WeeklyIntelligenceDigest {
  id: string;
  periodStart: string;
  periodEnd: string;
  headline: string;
  metrics: {
    lettersGenerated: number;
    responsesLogged: number;
    deletions: number;
    updates: number;
    noResponses: number;
    frivolousFlags: number;
  };
  topWinningAngles: Array<{ angle: string; wins: number }>;
  riskSignals: string[];
  recommendedNextActions: string[];
  generatedAt: string;
}

function toDate(input: string): number {
  return new Date(input).getTime();
}

function inWindow(timestamp: string, start: string, end: string): boolean {
  const ms = toDate(timestamp);
  return ms >= toDate(start) && ms <= toDate(end);
}

function normalizeOutcome(value?: string): BureauResponseType | null {
  const text = (value || "").toLowerCase();
  if (!text) return null;
  if (text.includes("deleted")) return "DELETED";
  if (text.includes("updated")) return "UPDATED";
  if (text.includes("no response") || text.includes("deadline")) return "NO_RESPONSE_30_DAYS";
  if (text.includes("frivolous")) return "FRIVOLOUS";
  if (text.includes("verified")) return "VERIFIED_ACCURATE";
  if (text.includes("reinsert")) return "RE_INSERTED";
  return null;
}

function digestId(periodStart: string, periodEnd: string): string {
  return `digest-${periodStart.slice(0, 10)}-${periodEnd.slice(0, 10)}`;
}

export function generateWeeklyIntelligenceDigest(input: DigestInput): WeeklyIntelligenceDigest {
  const letters = input.letters.filter((letter) => inWindow(letter.createdAt, input.periodStart, input.periodEnd));
  const history = input.history.filter((event) => inWindow(event.timestamp, input.periodStart, input.periodEnd));

  const responses = history.filter((event) => event.type === "response_logged" || Boolean(normalizeOutcome(event.outcome)));

  const deletions = responses.filter((event) => normalizeOutcome(event.outcome) === "DELETED").length;
  const updates = responses.filter((event) => normalizeOutcome(event.outcome) === "UPDATED").length;
  const noResponses = responses.filter((event) => normalizeOutcome(event.outcome) === "NO_RESPONSE_30_DAYS").length;
  const frivolousFlags = responses.filter((event) => normalizeOutcome(event.outcome) === "FRIVOLOUS").length;

  const angleWins = new Map<string, number>();
  for (const letter of letters) {
    if (!letter.selectedDisputeAngle) continue;
    const linkedResponse = responses.find(
      (event) => event.letterId === letter.id && normalizeOutcome(event.outcome) === "DELETED",
    );
    if (!linkedResponse) continue;
    angleWins.set(letter.selectedDisputeAngle, (angleWins.get(letter.selectedDisputeAngle) || 0) + 1);
  }

  const topWinningAngles = Array.from(angleWins.entries())
    .map(([angle, wins]) => ({ angle, wins }))
    .sort((a, b) => b.wins - a.wins)
    .slice(0, 5);

  const riskSignals: string[] = [];
  if (frivolousFlags >= 3) {
    riskSignals.push("Elevated frivolous classification volume this period.");
  }
  if (noResponses >= 4) {
    riskSignals.push("Multiple unresolved 30-day response windows detected.");
  }
  if (letters.length > 0 && deletions / letters.length < 0.15) {
    riskSignals.push("Deletion conversion rate below 15%; rotate strategy mix.");
  }

  const recommendedNextActions: string[] = [];
  if (topWinningAngles.length > 0) {
    recommendedNextActions.push(`Increase usage of ${topWinningAngles[0].angle} in next round.`);
  }
  if (noResponses > 0) {
    recommendedNextActions.push("Auto-generate escalation letters for all no-response cases.");
  }
  if (frivolousFlags > 0) {
    recommendedNextActions.push("Strengthen documentary exhibits on accounts flagged as frivolous.");
  }

  if (recommendedNextActions.length === 0) {
    recommendedNextActions.push("Maintain current cadence and continue monitoring response quality.");
  }

  const headline = deletions > updates
    ? `Strong week: ${deletions} deletions outpaced ${updates} updates.`
    : `Mixed week: ${updates} updates and ${deletions} deletions logged.`;

  return {
    id: digestId(input.periodStart, input.periodEnd),
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    headline,
    metrics: {
      lettersGenerated: letters.length,
      responsesLogged: responses.length,
      deletions,
      updates,
      noResponses,
      frivolousFlags,
    },
    topWinningAngles,
    riskSignals,
    recommendedNextActions,
    generatedAt: new Date().toISOString(),
  };
}

export function defaultDigestWindow(now: Date = new Date()): { periodStart: string; periodEnd: string } {
  const periodEnd = new Date(now);
  const periodStart = new Date(now);
  periodStart.setDate(periodStart.getDate() - 7);

  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
  };
}
