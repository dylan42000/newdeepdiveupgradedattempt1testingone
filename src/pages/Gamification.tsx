import React, { useEffect, useState } from "react";
import { Trophy, Star, Target, Zap, Lock, Unlock } from "lucide-react";
import { useAppContext } from "../context/AppContext";

export function Gamification() {
  const { gamification, disputeLetters, reports, negativeItems } = useAppContext();
  const [streak, setStreak] = useState(1);

  useEffect(() => {
    // Simple streak logic using localStorage
    const lastLogin = localStorage.getItem("DYLANDOS_LAST_LOGIN");
    const currentStreak = localStorage.getItem("DYLANDOS_STREAK");
    const today = new Date().toDateString();

    if (lastLogin !== today) {
      if (lastLogin === new Date(Date.now() - 86400000).toDateString()) {
        // Logged in yesterday
        const newStreak = (parseInt(currentStreak || "0") + 1);
        setStreak(newStreak);
        localStorage.setItem("DYLANDOS_STREAK", newStreak.toString());
      } else {
        // Missed a day or first login
        setStreak(1);
        localStorage.setItem("DYLANDOS_STREAK", "1");
      }
      localStorage.setItem("DYLANDOS_LAST_LOGIN", today);
    } else {
      setStreak(parseInt(currentStreak || "1"));
    }
  }, []);

  const nextLevelXp = gamification.level * 1000;
  const rank = gamification.level < 5 ? "Initiate" : gamification.level < 10 ? "Credit Hacker" : "Credit Master";

  const stats = {
    level: gamification.level,
    xp: gamification.xp,
    nextLevelXp,
    rank,
    streak,
  };

  const resolvedItemsCount = disputeLetters.filter(l => l.status === "Resolved").reduce((acc, letter) => acc + letter.negativeItemIds.length, 0);

  const missions = [
    {
      id: 1,
      title: "First Dispute",
      desc: "Generate and send your first dispute letter.",
      xp: 500,
      completed: disputeLetters.length > 0,
    },
    {
      id: 2,
      title: "Data Hoarder",
      desc: "Upload your first credit report.",
      xp: 750,
      completed: reports.length > 0,
    },
    {
      id: 3,
      title: "The Purge",
      desc: "Successfully remove 3 negative items.",
      xp: 1000,
      completed: resolvedItemsCount >= 3,
      progress: Math.min(resolvedItemsCount, 3),
      total: 3,
    },
    {
      id: 4,
      title: "Consistency is Key",
      desc: "Log in for 7 consecutive days.",
      xp: 300,
      completed: streak >= 7,
      progress: Math.min(streak, 7),
      total: 7,
    },
  ];

  const achievements = [
    {
      id: 1,
      title: "Initiate",
      icon: Zap,
      unlocked: gamification.level >= 1,
      color: "text-[#00ffff]",
    },
    {
      id: 2,
      title: "Disputer",
      icon: Target,
      unlocked: disputeLetters.length > 0,
      color: "text-[#ff00ff]",
    },
    {
      id: 3,
      title: "Clean Slate",
      icon: Star,
      unlocked: gamification.level >= 5,
      color: "text-zinc-600",
    },
    {
      id: 4,
      title: "800 Club",
      icon: Trophy,
      unlocked: gamification.level >= 10,
      color: "text-zinc-600",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
          <Trophy className="text-[#ff00ff]" />
          MISSIONS & XP
        </h2>
        <p className="text-zinc-400 mt-1">
          Track your progress and earn rewards for improving your credit.
        </p>
      </div>

      <div className="cyber-panel p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-4 opacity-10">
          <Trophy size={100} className="text-[#ff00ff]" />
        </div>

        <div className="relative z-10 flex flex-col md:flex-row items-center gap-8">
          <div className="flex-shrink-0 text-center">
            <div className="w-24 h-24 rounded-full border-4 border-[#ff00ff] flex items-center justify-center bg-[#111] shadow-[0_0_15px_rgba(255,0,255,0.3)]">
              <span className="text-3xl font-bold text-white">
                {stats.level}
              </span>
            </div>
            <p className="mt-2 font-mono text-sm text-[#00ffff]">
              {stats.rank}
            </p>
          </div>

          <div className="flex-1 w-full">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-zinc-400">EXPERIENCE</span>
              <span className="text-white font-mono">
                {stats.xp} / {stats.nextLevelXp} XP
              </span>
            </div>
            <div className="h-4 bg-zinc-900 rounded-full overflow-hidden border border-zinc-800">
              <div
                className="h-full bg-gradient-to-r from-[#ff00ff] to-[#00ffff]"
                style={{ width: `${Math.min((stats.xp / stats.nextLevelXp) * 100, 100)}%` }}
              ></div>
            </div>
            <div className="flex justify-between items-center mt-2">
              <p className="text-xs text-zinc-500 font-mono">
                {Math.max(stats.nextLevelXp - stats.xp, 0)} XP TO NEXT LEVEL
              </p>
              <p className="text-xs text-[#ff9900] font-mono font-bold">
                {stats.streak} DAY STREAK 🔥
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Target className="text-[#00ffff]" size={20} />
            ACTIVE MISSIONS
          </h3>

          <div className="space-y-3">
            {missions.map((mission) => (
              <div
                key={mission.id}
                className={`cyber-panel p-4 ${mission.completed ? "opacity-50" : ""}`}
              >
                <div className="flex justify-between items-start mb-2">
                  <h4
                    className={`font-bold ${mission.completed ? "text-zinc-400 line-through" : "text-white"}`}
                  >
                    {mission.title}
                  </h4>
                  <span className="cyber-badge text-[#ff9900] border-[#ff9900]">
                    +{mission.xp} XP
                  </span>
                </div>
                <p className="text-sm text-zinc-400 mb-3">{mission.desc}</p>

                {!mission.completed && mission.total !== undefined && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs font-mono text-zinc-500">
                      <span>PROGRESS</span>
                      <span>
                        {mission.progress} / {mission.total}
                      </span>
                    </div>
                    <div className="h-1.5 bg-zinc-900 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#00ffff]"
                        style={{
                          width: `${(mission.progress! / mission.total) * 100}%`,
                        }}
                      ></div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Star className="text-[#ff9900]" size={20} />
            ACHIEVEMENTS
          </h3>

          <div className="grid grid-cols-2 gap-3">
            {achievements.map((achievement) => {
              const Icon = achievement.icon;
              return (
                <div
                  key={achievement.id}
                  className={`cyber-panel p-4 flex flex-col items-center justify-center text-center gap-2 ${
                    achievement.unlocked
                      ? "border-[#ff00ff]/30 bg-[#ff00ff]/5"
                      : "opacity-50"
                  }`}
                >
                  <div
                    className={`p-3 rounded-full bg-[#111] border ${achievement.unlocked ? "border-[#ff00ff]/50" : "border-zinc-800"}`}
                  >
                    <Icon size={24} className={achievement.color} />
                  </div>
                  <h4 className="font-bold text-sm text-white">
                    {achievement.title}
                  </h4>
                  <div className="flex items-center gap-1 text-xs font-mono text-zinc-500">
                    {achievement.unlocked ? (
                      <>
                        <Unlock size={12} className="text-[#00ff00]" /> UNLOCKED
                      </>
                    ) : (
                      <>
                        <Lock size={12} /> LOCKED
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
