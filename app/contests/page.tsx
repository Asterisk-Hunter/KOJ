"use client";

import { useState } from "react";

type Tab = "ACTIVE" | "UPCOMING" | "ENDED";
type Status = "Running" | "Upcoming" | "Ended";

interface Contest {
  name: string;
  status: Status;
  description: string;
  problems: number;
  duration: string;
  participants: number;
}

const allContests: Record<Tab, Contest[]> = {
  ACTIVE: [
    { name: "Weekly Challenge #42", status: "Running", description: "Weekly problem-solving challenge with curated algorithmic puzzles.", problems: 5, duration: "2 hrs", participants: 128 },
    { name: "Algorithmic Sprint", status: "Running", description: "Fast-paced sprint contest focusing on core data structures.", problems: 8, duration: "3 hrs", participants: 89 },
    { name: "Debug Derby", status: "Running", description: "Find and fix bugs in broken code snippets as fast as you can.", problems: 4, duration: "1.5 hrs", participants: 56 },
  ],
  UPCOMING: [
    { name: "Winter Championship", status: "Upcoming", description: "The flagship annual championship with challenging problems across all topics.", problems: 10, duration: "5 hrs", participants: 0 },
    { name: "Speed Coding Friday", status: "Upcoming", description: "Quick-fire coding session for those who thrive under tight deadlines.", problems: 6, duration: "1 hr", participants: 0 },
  ],
  ENDED: [
    { name: "Monsoon Mayhem", status: "Ended", description: "Intense monsoon edition contest with tough graph and DP problems.", problems: 7, duration: "4 hrs", participants: 234 },
    { name: "Code Golf Special", status: "Ended", description: "Shortest code wins. Creative solutions to deceptively simple problems.", problems: 12, duration: "2 hrs", participants: 167 },
  ],
};

function statusBadge(status: Status) {
  if (status === "Running") return "bg-green-500/10 text-green-400 border border-green-500/20 rounded-full px-2.5 py-0.5 text-xs font-mono";
  if (status === "Upcoming") return "bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full px-2.5 py-0.5 text-xs font-mono";
  return "bg-zinc-500/10 text-zinc-400 border border-zinc-500/20 rounded-full px-2.5 py-0.5 text-xs font-mono";
}

function actionButton(status: Status) {
  if (status === "Running") return (
    <button className="bg-kjprimary text-kjbg font-mono text-xs px-4 py-1.5 rounded hover:glow-sm transition-all">
      ENTER
    </button>
  );
  if (status === "Upcoming") return (
    <button className="border border-kjborder text-kjtext font-mono text-xs px-4 py-1.5 rounded hover:border-kjprimary hover:text-kjprimary transition-all">
      REGISTER
    </button>
  );
  return (
    <button className="border border-kjborder text-kjtext-muted font-mono text-xs px-4 py-1.5 rounded hover:border-kjborder-bright transition-all">
      VIEW RESULTS
    </button>
  );
}

export default function ContestsPage() {
  const [tab, setTab] = useState<Tab>("ACTIVE");
  const tabs: Tab[] = ["ACTIVE", "UPCOMING", "ENDED"];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Page Title */}
      <h1 className="uppercase font-mono tracking-[0.3em] text-2xl text-kjprimary text-glow mb-8">
        Contest Arena
      </h1>

      {/* Tab Bar */}
      <div className="flex gap-1 bg-kjsurface rounded-lg p-1 border border-kjborder mb-8 w-fit">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              tab === t
                ? "bg-kjprimary/10 text-kjprimary border border-kjprimary/20 rounded-md px-4 py-2 text-xs font-mono"
                : "text-kjtext-muted text-xs font-mono px-4 py-2 rounded-md hover:text-kjtext cursor-pointer"
            }
          >
            {t}
          </button>
        ))}
      </div>

      {/* Contest Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {allContests[tab].map((contest) => (
          <div
            key={contest.name}
            className="bg-kjsurface border border-kjborder rounded-lg p-5 hover:border-kjborder-bright transition-all duration-300"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="font-mono font-semibold text-kjtext">
                {contest.name}
              </span>
              <span className={statusBadge(contest.status)}>
                {contest.status}
              </span>
            </div>
            <p className="text-sm text-kjtext-muted mb-4">
              {contest.description}
            </p>
            <div className="flex items-center gap-4 text-xs text-kjtext-muted mb-4">
              <span>Problems: {contest.problems}</span>
              <span>Duration: {contest.duration}</span>
              <span>Participants: {contest.participants}</span>
            </div>
            {actionButton(contest.status)}
          </div>
        ))}
      </div>
    </div>
  );
}
