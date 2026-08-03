import React, { useMemo } from "react";
import { HeartHandshake } from "lucide-react";
import { useAppContext } from "../context/AppContext";
import {
  evaluateGoodwillEligibility,
  goodwillLetterGuard,
} from "../services/goodwillCampaignEngine";

export function GoodwillCampaign() {
  const { negativeItems, disputeLetters } = useAppContext();

  const eligible = useMemo(() => {
    return negativeItems
      .map((item) => ({ item, eval: evaluateGoodwillEligibility(item) }))
      .filter((r) => r.eval.eligible && r.eval.profile);
  }, [negativeItems]);

  const goodwillLetters = useMemo(
    () =>
      disputeLetters.filter(
        (l) =>
          /goodwill/i.test(l.content || "") ||
          /goodwill/i.test(l.selectedDisputeAngle || "") ||
          /goodwill/i.test(l.templateType || ""),
      ),
    [disputeLetters],
  );

  return (
    <div className="space-y-6" role="main" aria-labelledby="goodwill-title">
      <div>
        <h2 id="goodwill-title" className="text-2xl font-bold text-white flex items-center gap-2">
          <HeartHandshake className="text-[#00ff00]" aria-hidden /> GOODWILL CAMPAIGNS
        </h2>
        <p className="text-zinc-400 font-mono text-xs mt-1">
          REQUESTS — NOT FCRA DISPUTES. NO LEGAL DEMAND LANGUAGE. NO FCRA CLOCK.
        </p>
      </div>

      <div
        className="cyber-panel p-4 border border-[#00ff00]/20"
        role="note"
        aria-label="Goodwill disclaimer"
      >
        <p className="text-xs text-zinc-300">
          Goodwill letters ask a creditor to remove late history as a courtesy after the account is
          paid or settled. They must never cite FCRA reinvestigation rights or demand deletion.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="cyber-panel p-4">
          <div className="text-[10px] font-mono text-zinc-600">ELIGIBLE ACCOUNTS</div>
          <div className="text-2xl font-bold text-[#00ff00]">{eligible.length}</div>
        </div>
        <div className="cyber-panel p-4">
          <div className="text-[10px] font-mono text-zinc-600">GOODWILL LETTERS</div>
          <div className="text-2xl font-bold text-white">{goodwillLetters.length}</div>
        </div>
      </div>

      {eligible.length === 0 ? (
        <div className="cyber-panel p-8 text-center text-zinc-500 text-sm" role="status">
          No paid/settled accounts with late-history goodwill profiles yet. Mark force strategy
          &quot;Goodwill&quot; on Autopilot items when appropriate.
        </div>
      ) : (
        <ul className="space-y-3" aria-label="Goodwill-eligible accounts">
          {eligible.map(({ item, eval: ev }) => {
            const profile = ev.profile!;
            return (
              <li key={item.id} className="cyber-panel p-4">
                <div className="text-sm font-bold text-white">{item.creditorName}</div>
                <div className="text-xs text-zinc-500 font-mono mt-0.5">
                  {profile.passLabel} · {profile.accountStatus} · success {profile.expectedSuccessRate}
                </div>
                <p className="text-xs text-zinc-400 mt-2">{ev.reason}</p>
                <div className="text-[10px] font-mono text-zinc-600 mt-2">
                  Tone: {profile.toneProfile} · Approach: {profile.goodwillApproachRecommended}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {goodwillLetters.length > 0 && (
        <section aria-labelledby="gw-letter-check">
          <h3 id="gw-letter-check" className="text-xs font-mono text-zinc-500 mb-2">
            LETTER GUARD CHECK
          </h3>
          <ul className="space-y-2">
            {goodwillLetters.slice(0, 8).map((letter) => {
              const guard = goodwillLetterGuard(letter.content || "");
              return (
                <li key={letter.id} className="cyber-panel p-3 text-xs">
                  <span className="text-white font-semibold">{letter.bureau || "Letter"}</span>
                  <span className={`ml-2 font-mono ${guard.ok ? "text-[#00ff00]" : "text-red-400"}`}>
                    {guard.ok ? "PASS" : "FAIL"}
                  </span>
                  {!guard.ok && (
                    <p className="text-red-300/80 mt-1">{guard.issues.join(" ")}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
