import { DisputeRoundTracker } from '../types/creditRepair';

/**
 * disputeClockEngine.ts — 35-Day FCRA Clock & Round Evolution
 *
 * This engine tracks the 35-day statutory deadline (30 days to investigate + 5 days mailing).
 * If a batch exceeds 35 days without a user-logged response, it flags the batch to unlock
 * a "Non-Response Deletion Demand" strategy for the next autopilot run.
 */

export const DisputeClockEngine = {
  /**
   * Evaluates a list of round trackers and returns those that have exceeded
   * their 35-day statutory deadline without a logged response.
   */
  checkStatutoryDeadlines(trackers: DisputeRoundTracker[]): DisputeRoundTracker[] {
    const overdueBatches: DisputeRoundTracker[] = [];
    const now = new Date().getTime();

    for (const tracker of trackers) {
      if (tracker.hasUserLoggedResponse) continue;

      const deadlineTime = new Date(tracker.statutoryDeadline).getTime();
      if (now > deadlineTime) {
        overdueBatches.push(tracker);
      }
    }

    return overdueBatches;
  },

  /**
   * Returns a strategy override string if the provided batchId has been flagged
   * as a non-response deletion demand.
   *
   * In a complete implementation, this state would be persisted. Here we expose the
   * utility for the generation queue.
   */
  unlockNonResponseDemand(batchId: string): string {
    console.info(`[DisputeClockEngine] ⏰ Unlocking Non-Response Deletion Demand for batch ${batchId}`);
    return (
      `\n\n## ⚖️ NON-RESPONSE DELETION DEMAND:\n` +
      `The statutory 35-day investigation window has expired without a legally sufficient response. ` +
      `Under FCRA §1681i(a)(5)(A), you must promptly delete the disputed information. ` +
      `Pivot this letter to a strict demand for immediate deletion due to failure to investigate within the statutory timeline.`
    );
  }
};
