"use client";

import Link from "next/link";
import { SignInButton, SignUpButton, UserButton, useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import GlitchingTerminal from "@/app/components/GlitchingTerminal";
import Navigation from "@/app/components/Navigation";

const features = [
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
      </svg>
    ),
    title: "Real-Time Judging",
    description: "Sub-100ms evaluation with isolated sandboxes",
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0016.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.003 6.003 0 01-5.54 0" />
      </svg>
    ),
    title: "Contest Engine",
    description: "Schedule, host, and manage programming contests",
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
    title: "Live Rankings",
    description: "Global and contest-specific leaderboards",
  },
];

type ProblemSummary = {
  id: number;
  title: string;
  difficulty: string;
  acceptance: number | null;
};

type ContestSummary = {
  id: number | string;
  slug: string;
  title: string;
  status: string;
  startsAt: string;
  endsAt: string;
  participants: number;
};

export default function LandingPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const [recentProblems, setRecentProblems] = useState<ProblemSummary[]>([]);
  const [activeContests, setActiveContests] = useState<ContestSummary[]>([]);
  const [stats, setStats] = useState({ problems: 0, contests: 0 });

  useEffect(() => {
    fetch("/api/problems")
      .then((r) => r.json())
      .then((data: { problems?: ProblemSummary[] }) => {
        if (data.problems) {
          setRecentProblems(data.problems.slice(0, 4));
          setStats((prev) => ({ ...prev, problems: data.problems?.length ?? 0 }));
        }
      })
      .catch(() => {});

    fetch("/api/contests")
      .then((r) => r.json())
      .then((data: { contests?: ContestSummary[] }) => {
        if (data.contests) {
          const visible = data.contests.filter(
            (c) => c.status === "Active" || c.status === "Registration Open" || c.status === "Upcoming",
          );
          setActiveContests(visible.slice(0, 3));
          setStats((prev) => ({ ...prev, contests: data.contests?.length ?? 0 }));
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <Navigation />
      {/* Hero Section */}
      <section className="flex-1 flex items-center justify-center px-4 sm:px-6 lg:px-8 py-20">
        <div className="max-w-7xl mx-auto w-full flex flex-col lg:flex-row items-center gap-12 lg:gap-20">
          {/* Left - Text */}
          <div className="flex-1 text-center lg:text-left">
            <h1 className="text-7xl sm:text-8xl font-mono font-bold text-kjprimary text-glow mb-4 leading-none">
              KOJ
            </h1>
            <p className="uppercase font-mono tracking-[0.3em] text-kjtext-muted text-sm mb-6">
              Kottayam Online Judge
            </p>
            <p className="text-lg text-kjtext-muted max-w-md mx-auto lg:mx-0 mb-10">
              Host programming contests. Judge submissions in real-time. Built
              for competitive excellence.
            </p>
            <div className="flex items-center gap-4 justify-center lg:justify-start">
              {!isLoaded ? null : !isSignedIn ? (
                <>
                  <SignUpButton mode="modal">
                  <button className="bg-kjprimary text-[#050505] font-mono font-semibold text-sm uppercase tracking-widest px-8 py-3 rounded hover:glow transition-all cursor-pointer">
                      Get Started
                    </button>
                  </SignUpButton>
                  <SignInButton mode="modal">
                    <button className="border border-kjborder text-kjtext font-mono text-sm uppercase tracking-widest px-8 py-3 rounded hover:border-kjprimary hover:text-kjprimary transition-all cursor-pointer">
                      Sign In
                    </button>
                  </SignInButton>
                </>
              ) : (
                <>
                  <Link
                    href="/dashboard"
                    className="bg-kjprimary text-[#050505] font-mono font-semibold text-sm uppercase tracking-widest px-8 py-3 rounded hover:glow transition-all"
                  >
                    Enter App
                  </Link>
                  <UserButton />
                </>
              )}
            </div>
            <div className="flex gap-3 justify-center lg:justify-start mt-5">
              <Link href="/problems" className="text-xs font-mono text-kjtext-muted hover:text-kjprimary">Browse problems →</Link>
              <Link href="/contests" className="text-xs font-mono text-kjtext-muted hover:text-kjprimary">View contests →</Link>
            </div>
          </div>

          {/* Right - Terminal */}
          <div className="flex-1 w-full max-w-xl">
            <GlitchingTerminal />
          </div>
        </div>
      </section>

      {/* Platform Stats */}
      <section className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pb-8">
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-kjsurface border border-kjborder rounded-lg p-5 text-center">
            <p className="text-3xl font-mono font-bold text-kjprimary">{stats.problems}</p>
            <p className="text-xs font-mono text-kjtext-muted mt-1">Problems</p>
          </div>
          <div className="bg-kjsurface border border-kjborder rounded-lg p-5 text-center">
            <p className="text-3xl font-mono font-bold text-kjprimary">{stats.contests}</p>
            <p className="text-xs font-mono text-kjtext-muted mt-1">Contests</p>
          </div>
          <div className="bg-kjsurface border border-kjborder rounded-lg p-5 text-center">
            <p className="text-3xl font-mono font-bold text-kjprimary">4</p>
            <p className="text-xs font-mono text-kjtext-muted mt-1">Languages</p>
          </div>
        </div>
      </section>

      {/* Recent Problems + Active Contests */}
      <section className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pb-16 grid md:grid-cols-2 gap-6">
        <div>
          <h2 className="text-xs uppercase tracking-widest font-mono text-kjprimary mb-4">Recent Problems</h2>
          {recentProblems.length === 0 ? (
            <div className="bg-kjsurface border border-kjborder rounded-lg p-5">
              <p className="text-sm font-mono text-kjtext-muted">No problems yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentProblems.map((p) => (
                <Link
                  key={p.id}
                  href={`/problems/${p.id}`}
                  className="flex items-center justify-between bg-kjsurface border border-kjborder rounded-lg px-5 py-3 hover:border-kjprimary/50"
                >
                  <span className="text-sm font-mono text-kjtext">{p.title}</span>
                  <span className={`text-[11px] font-mono border rounded-full px-2 py-0.5 ${
                    p.difficulty === "easy"
                      ? "text-green-400 border-green-400/20"
                      : p.difficulty === "medium"
                        ? "text-yellow-400 border-yellow-400/20"
                        : "text-red-400 border-red-400/20"
                  }`}>
                    {p.difficulty}
                  </span>
                </Link>
              ))}
              <Link href="/problems" className="block text-xs font-mono text-kjprimary mt-2 hover:underline">
                View all problems →
              </Link>
            </div>
          )}
        </div>

        <div>
          <h2 className="text-xs uppercase tracking-widest font-mono text-kjprimary mb-4">Active & Upcoming Contests</h2>
          {activeContests.length === 0 ? (
            <div className="bg-kjsurface border border-kjborder rounded-lg p-5">
              <p className="text-sm font-mono text-kjtext-muted">No active contests right now.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {activeContests.map((c) => (
                <Link
                  key={c.slug}
                  href={`/contests/${c.slug}`}
                  className="block bg-kjsurface border border-kjborder rounded-lg px-5 py-3 hover:border-kjprimary/50"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-mono text-kjtext">{c.title}</span>
                    <span className={`text-[11px] font-mono border rounded-full px-2 py-0.5 ${
                      c.status === "Active"
                        ? "text-green-400 border-green-400/20"
                        : "text-yellow-400 border-yellow-400/20"
                    }`}>
                      {c.status}
                    </span>
                  </div>
                  <p className="text-xs font-mono text-kjtext-muted mt-1">
                    {c.participants} participants · {new Date(c.startsAt).toLocaleDateString()}
                  </p>
                </Link>
              ))}
              <Link href="/contests" className="block text-xs font-mono text-kjprimary mt-2 hover:underline">
                View all contests →
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="uppercase font-mono tracking-[0.2em] text-sm text-kjtext-muted text-center mb-12">
            Built for Competitive Excellence
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="bg-kjsurface border border-kjborder rounded-lg p-6 hover:border-kjborder-bright transition-all"
              >
                <div className="text-kjprimary mb-4">{feature.icon}</div>
                <h3 className="font-mono font-semibold text-kjtext mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-kjtext-muted">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-kjborder py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="font-mono text-xs text-kjtext-muted">
              &copy; 2026 IIIT Kottayam. Built for Competitive Excellence.
            </p>
            <div className="flex items-center gap-6">
              <Link href="/problems" className="font-mono text-xs text-kjtext-muted hover:text-kjprimary transition-colors">
                Problems
              </Link>
              <Link href="/contests" className="font-mono text-xs text-kjtext-muted hover:text-kjprimary transition-colors">
                Contests
              </Link>
              <Link href="/rankings" className="font-mono text-xs text-kjtext-muted hover:text-kjprimary transition-colors">
                Rankings
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
