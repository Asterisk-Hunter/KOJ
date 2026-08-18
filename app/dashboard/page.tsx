import Link from "next/link";
import Navigation from "@/app/components/Navigation";
import StatCard from "@/app/components/StatCard";

const activeContests = [
  {
    name: "Weekly Challenge #42",
    status: "Running",
    description: "Weekly problem-solving challenge with curated algorithmic puzzles.",
    problems: 5,
    time: "1h 23m",
  },
  {
    name: "Algorithmic Sprint",
    status: "Running",
    description: "Fast-paced sprint contest focusing on core data structures.",
    problems: 8,
    time: "2h 10m",
  },
  {
    name: "Debug Derby",
    status: "Running",
    description: "Find and fix bugs in broken code snippets as fast as you can.",
    problems: 4,
    time: "45m",
  },
];

export default function DashboardPage() {
  return (
    <>
      <Navigation />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16">
        {/* Hero Section */}
        <section className="flex flex-col items-center text-center py-20 max-w-2xl mx-auto">
          <h1 className="text-5xl font-mono font-bold text-kjprimary text-glow mb-4">
            KOJ
          </h1>
          <p className="uppercase font-mono tracking-[0.3em] text-kjtext-muted text-sm mb-4">
            Kottayam Online Judge
          </p>
          <p className="text-kjtext-muted text-base">
            Self-hosted contest hosting platform for IIIT Kottayam
          </p>
        </section>

        {/* Stats Grid */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-16">
          <StatCard label="TOTAL PROBLEMS" value="128" icon="{" accent />
          <StatCard label="ACTIVE CONTESTS" value="3" icon="★" accent />
          <StatCard label="REGISTERED USERS" value="256" icon="@" accent />
          <StatCard label="SUBMISSIONS TODAY" value="42" icon="→" />
        </section>

        {/* Active Contests */}
        <section className="mb-20">
          <div className="flex items-center gap-3 mb-6">
            <h2 className="uppercase font-mono tracking-widest text-sm text-kjtext-muted">
              Active Contests
            </h2>
            <div className="h-px flex-1 bg-kjprimary/30" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {activeContests.map((contest) => (
              <Link
                key={contest.name}
                href="/contests"
                className="bg-kjsurface border border-kjborder rounded-lg p-5 hover:border-kjborder-bright transition-all duration-300"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="font-mono font-semibold text-kjtext">
                    {contest.name}
                  </span>
                  <span className="bg-kjprimary/10 text-kjprimary border border-kjprimary/20 rounded-full px-2.5 py-0.5 text-xs font-mono">
                    {contest.status}
                  </span>
                </div>
                <p className="text-sm text-kjtext-muted mb-4">
                  {contest.description}
                </p>
                <div className="flex items-center gap-4 text-xs text-kjtext-muted">
                  <span>Problems: {contest.problems}</span>
                  <span>Time: {contest.time} remaining</span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* CTA Section */}
        <section className="flex flex-col items-center pb-20">
          <p className="text-lg text-kjtext mb-6">Ready to compete?</p>
          <div className="flex items-center gap-4">
            <Link
                href="/contests/weekly-42"
              className="bg-kjprimary text-kjbg font-mono font-semibold px-6 py-3 rounded hover:glow-sm transition-all"
            >
              ENTER THE ARENA
            </Link>
            <Link
              href="/problems"
              className="border border-kjborder text-kjtext font-mono px-6 py-3 rounded hover:border-kjprimary hover:text-kjprimary transition-all"
            >
              VIEW ALL PROBLEMS
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
