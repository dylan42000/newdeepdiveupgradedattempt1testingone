import type { DisputeLetter, NegativeItem, DisputeRound, HistoryEvent } from "../types";
import type { BureauResponseType } from "./disputeEngine";

export interface DisputeGenealogy {
  itemId: string;
  creditorName: string;
  bureauName: string;
  roundHistory: Array<{
    round: DisputeRound;
    letterId: string;
    disputeAngle: string;
    letterTone: string;
    uniquenessScore: number;
    strengthScore: number;
    aiProviderUsed: string;
    sentDate: string;
    responseDate: string | null;
    outcome: BureauResponseType | null;
    daysToResponse: number | null;
  }>;
  finalOutcome: "deleted" | "verified_accurate" | "updated" | "in_progress";
  totalRoundsRequired: number;
  winningRound: DisputeRound | null;
  winningAngle: string | null;
  winningTone: string | null;
  totalDaysToResolution: number | null;
  whatWorked: string[];
  whatFailed: string[];
  recommendedStrategyForSimilarItems: string;
}

function inferTone(content: string): string {
  const text = (content || "").toLowerCase();
  if (text.includes("immediately") || text.includes("final notice")) return "aggressive";
  if (text.includes("respectfully") || text.includes("thank you")) return "formal";
  if (text.includes("chronology") || text.includes("documentation")) return "methodical";
  return "direct";
}

function daysBetween(startIso: string, endIso: string): number | null {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.round((end - start) / (1000 * 60 * 60 * 24)));
}

function mapOutcome(value?: string): BureauResponseType | null {
  const normalized = (value || "").toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("deleted") || normalized.includes("won")) return "DELETED";
  if (normalized.includes("updated")) return "UPDATED";
  if (normalized.includes("frivolous")) return "FRIVOLOUS";
  if (normalized.includes("re-insert") || normalized.includes("reinsert")) return "RE_INSERTED";
  if (normalized.includes("verified")) return "VERIFIED_ACCURATE";
  if (normalized.includes("no response") || normalized.includes("deadline")) return "NO_RESPONSE_30_DAYS";
  return null;
}

export function buildDisputeGenealogy(
  item: NegativeItem,
  letters: DisputeLetter[],
  historyEvents: HistoryEvent[],
): DisputeGenealogy {
  const itemLetters = letters
    .filter((letter) => letter.negativeItemIds.includes(item.id))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const itemEvents = historyEvents
    .filter((event) => event.itemId === item.id)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const roundHistory = itemLetters.map((letter) => {
    const responseEvent = itemEvents.find((event) => {
      if (event.bureau && letter.bureau && event.bureau !== letter.bureau) return false;
      const outcome = mapOutcome(event.outcome);
      return event.type === "response_logged" || outcome !== null;
    });

    const outcome = responseEvent ? mapOutcome(responseEvent.outcome) : null;

    return {
      round: letter.round,
      letterId: letter.id,
      disputeAngle: letter.selectedDisputeAngle || "UNKNOWN_ANGLE",
      letterTone: inferTone(letter.content),
      uniquenessScore: typeof letter.similarityScore === "number" ? letter.similarityScore : 0,
      strengthScore: typeof letter.disputeStrengthScore === "number" ? letter.disputeStrengthScore : 0,
      aiProviderUsed: letter.aiProviderUsed || "unknown",
      sentDate: letter.mailedAt || letter.createdAt,
      responseDate: responseEvent?.timestamp || null,
      outcome,
      daysToResponse: responseEvent?.timestamp ? daysBetween(letter.createdAt, responseEvent.timestamp) : null,
    };
  });

  const winningNode = roundHistory.find((node) => node.outcome === "DELETED");
  const updatedNode = roundHistory.find((node) => node.outcome === "UPDATED");

  const finalOutcome: DisputeGenealogy["finalOutcome"] = winningNode
    ? "deleted"
    : updatedNode
      ? "updated"
      : roundHistory.some((node) => node.outcome === "VERIFIED_ACCURATE")
        ? "verified_accurate"
        : "in_progress";

  const firstDate = roundHistory[0]?.sentDate || null;
  const finalDate = (winningNode || updatedNode)?.responseDate || roundHistory[roundHistory.length - 1]?.responseDate || null;

  const whatWorked: string[] = [];
  const whatFailed: string[] = [];

  for (const node of roundHistory) {
    if (node.outcome === "DELETED" || node.outcome === "UPDATED") {
      whatWorked.push(`Round ${node.round}: ${node.disputeAngle} (${node.letterTone})`);
    } else if (node.outcome === "VERIFIED_ACCURATE" || node.outcome === "FRIVOLOUS") {
      whatFailed.push(`Round ${node.round}: ${node.disputeAngle} (${node.outcome})`);
    }
  }

  const strategyRecommendation = winningNode
    ? `Reuse angle ${winningNode.disputeAngle} with ${winningNode.letterTone} tone for similar ${item.typeOfNegative} items.`
    : "Rotate to a new dispute angle and escalate evidence specificity in the next round.";

  return {
    itemId: item.id,
    creditorName: item.creditorName,
    bureauName: (item.creditBureau || []).join(", ") || "Unknown",
    roundHistory,
    finalOutcome,
    totalRoundsRequired: roundHistory.length,
    winningRound: winningNode?.round || null,
    winningAngle: winningNode?.disputeAngle || null,
    winningTone: winningNode?.letterTone || null,
    totalDaysToResolution: firstDate && finalDate ? daysBetween(firstDate, finalDate) : null,
    whatWorked,
    whatFailed,
    recommendedStrategyForSimilarItems: strategyRecommendation,
  };
}
