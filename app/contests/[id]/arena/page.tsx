"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import Navigation from "@/app/components/Navigation";

type UiStatus = "Active" | "Registration Open" | "Upcoming" | "Finished";

type ContestProblem = {
  id: number;
  title: string;
  difficulty: string;
  tags: string[];
  position: number;
};

type ContestDetail = {
  id: string;
  numericId: number;
  slug: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  status: UiStatus;
  dbStatus: string;
  problems: ContestProblem[];
  problemsCount: number;
  participants: number;
  registered: boolean;
};

const BALLOON_COLORS = [
  "#ef4444", "#22c55e", "#3b82f6", "#eab308",
  "#a855f7", "#f97316", "#06b6d4", "#ec4899",
  "#10b981", "#6366f1", "#f59e0b", "#f43f5e",
];

type ArenaSubmission = {
  id: number;
  problemId: number;
  problemTitle: string;
  language: string;
  status: string;
  passedTests: number | null;
  totalTests: number | null;
  executionTimeMs: number | null;
  memoryUsedMb: number | null;
  submittedAt: string | null;
};

export default function ContestArenaPage() {
  const { id } = useParams<{ id: string }>();
  const [contest, setContest] = useState<ContestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [submissions, setSubmissions] = useState<ArenaSubmission[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);

  const loadSubmissions = useCallback(async (numericContestId: number) => {
    setLoadingSubmissions(true);
    try {
      const res = await fetch(`/api/submissions?contestId=${numericContestId}`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as unknown;
        if (Array.isArray(data)) {
          setSubmissions(data as ArenaSubmission[]);
        }
      }
    } catch {
      // Non-fatal
    } finally {
      setLoadingSubmissions(false);
    }
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/contests/${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = (await res.json()) as unknown;
      if (!res.ok) {
        const msg = (data as { error?: string }).error ?? `Failed to load contest (${res.status})`;
        throw new Error(msg);
      }
      const c = data as ContestDetail;
      setContest(c);
      if (c.numericId && c.registered) {
        void loadSubmissions(c.numericId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load contest");
    } finally {
      setLoading(false);
    }
  }, [id, loadSubmissions]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const diffMs = useMemo(() => {
    if (!contest) return 0;
    return Math.max(0, new Date(contest.endsAt).getTime() - now);
  }, [contest, now]);

  const isUrgent = diffMs > 0 && diffMs < 15 * 60 * 1000;
  const isCritical = diffMs > 0 && diffMs < 5 * 60 * 1000;

  const timeRemaining = useMemo(() => {
    const totalSec = Math.floor(diffMs / 1000);
    const h = String(Math.floor(totalSec / 3600)).padStart(2, "0");
    const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
    const s = String(totalSec % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
  }, [diffMs]);

  const problemStatusMap = useMemo(() => {
    const map = new Map<number, { isSolved: boolean; attempts: number }>();
    for (const sub of submissions) {
      const prev = map.get(sub.problemId) ?? { isSolved: false, attempts: 0 };
      map.set(sub.problemId, {
        isSolved: prev.isSolved || sub.status === "accepted",
        attempts: prev.attempts + 1,
      });
    }
    return map;
  }, [submissions]);

  const solvedCount = useMemo(() => {
    let count = 0;
    for (const val of problemStatusMap.values()) {
      if (val.isSolved) count++;
    }
    return count;
  }, [problemStatusMap]);

  if (loading) {
    return (
      <>
        <Navigation />
        <main className="pt-20 max-w-5xl mx-auto px-4 py-8">
          <div className="bg-kjsurface/40 border border-kjborder rounded-lg p-8 text-sm font-mono text-kjtext-muted">
            Loading arena…
          </div>
        </main>
      </>
    );
  }

  if (error || !contest) {
    return (
      <>
        <Navigation />
        <main className="pt-20 max-w-5xl mx-auto px-4 py-8">
          <p className="text-sm font-mono text-red-400">{error ?? "Contest not found"}</p>
          <Link href="/contests" className="inline-block mt-6 text-xs font-mono text-kjprimary hover:underline">
            ← Back to contests
          </Link>
        </main>
      </>
    );
  }

  const isLive = contest.status === "Active";
  const isRegistered = contest.registered;

  if (!isLive) {
    return (
      <>
        <Navigation />
        <main className="pt-20 max-w-5xl mx-auto px-4 py-8">
          <p className="text-xs font-mono text-kjprimary tracking-widest mb-3">ARENA / {contest.status.toUpperCase()}</p>
          <h1 className="text-3xl font-mono text-kjtext">{contest.title}</h1>
          <div className="mt-6 bg-kjsurface border border-kjborder rounded-lg p-6">
            <p className="text-sm font-mono text-kjtext">Contest is not live.</p>
            <p className="text-xs font-mono text-kjtext-muted mt-2">
              {contest.status === "Finished"
                ? "This contest has ended. View results from the contest page."
                : `Contest status: ${contest.status}. Arena opens when the contest is live.`}
            </p>
            <Link
              href={`/contests/${encodeURIComponent(contest.id)}`}
              className="inline-block mt-6 border border-kjborder px-4 py-2 rounded text-xs font-mono text-kjprimary hover:border-kjprimary transition-colors"
            >
              ← Contest details
            </Link>
          </div>
        </main>
      </>
    );
  }

  if (!isRegistered) {
    return (
      <>
        <Navigation />
        <main className="pt-20 max-w-5xl mx-auto px-4 py-8">
          <p className="text-xs font-mono text-kjprimary tracking-widest mb-3">LIVE ARENA / REGISTRATION REQUIRED</p>
          <h1 className="text-3xl font-mono text-kjtext">{contest.title}</h1>
          <div className="mt-6 bg-kjsurface border border-kjborder rounded-lg p-6">
            <p className="text-sm font-mono text-kjtext">You are not registered for this contest.</p>
            <p className="text-xs font-mono text-kjtext-muted mt-2">
              Registration is required to enter the arena and submit solutions.
            </p>
            <Link
              href={`/contests/${encodeURIComponent(contest.id)}`}
              className="inline-block mt-6 bg-kjprimary text-kjbg font-mono font-bold text-xs px-4 py-2 rounded hover:glow-sm transition-all"
            >
              GO TO REGISTRATION →
            </Link>
          </div>
        </main>
      </>
    );
  }

  const sorted = contest.problems.slice().sort((a, b) => a.position - b.position);

  return (
    <>
      <Navigation />
      <main className="pt-20 max-w-5xl mx-auto px-4 py-6">
        {/* CF-style Contest Header Bar */}
        <div className="border border-kjborder rounded-lg overflow-hidden bg-kjsurface/60">
          {/* Top row: title + live badge */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-kjborder bg-kjsurface/80">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-widest text-kjprimary">
                <span className="w-1.5 h-1.5 rounded-full bg-kjprimary animate-pulse" />
                Live Arena
              </span>
              <h1 className="text-sm sm:text-base font-mono font-bold text-kjtext">{contest.title}</h1>
            </div>
            <Link
              href={`/rankings?contestId=${contest.numericId}`}
              className="text-[10px] font-mono text-kjprimary border border-kjprimary/30 px-2.5 py-1 rounded hover:bg-kjprimary/10 transition-colors"
            >
              STANDINGS →
            </Link>
          </div>

          {/* Stats row: timer + solved + problems */}
          <div className="flex flex-col sm:flex-row items-stretch divide-y sm:divide-y-0 sm:divide-x divide-kjborder">
            {/* Timer — the focal point */}
            <div className="flex-1 flex items-center justify-center px-5 py-3">
              <div className="text-center">
                <p className="text-[9px] uppercase tracking-[0.2em] font-mono text-kjtext-muted font-bold mb-1">Time Remaining</p>
                <p className={`text-2xl sm:text-3xl font-mono font-bold tabular-nums tracking-wider ${
                  isCritical
                    ? "text-red-400 animate-pulse"
                    : isUrgent
                      ? "text-yellow-400"
                      : "text-kjprimary text-glow"
                }`}>{timeRemaining}</p>
              </div>
            </div>

            {/* Solved progress */}
            <div className="flex items-center justify-center px-5 py-3 min-w-[160px]">
              <div className="text-center">
                <p className="text-[9px] uppercase tracking-[0.2em] font-mono text-kjtext-muted font-bold mb-1">Solved</p>
                <div className="flex items-baseline justify-center gap-1">
                  <span className="text-xl font-mono font-bold text-kjtext tabular-nums">{solvedCount}</span>
                  <span className="text-xs font-mono text-kjtext-muted">/</span>
                  <span className="text-sm font-mono text-kjtext-muted tabular-nums">{contest.problemsCount}</span>
                </div>
                {/* Progress bar */}
                <div className="mt-1.5 h-1 bg-kjborder rounded-full overflow-hidden w-full max-w-[100px] mx-auto">
                  <div
                    className="h-full bg-kjprimary/80 rounded-full transition-all duration-500"
                    style={{ width: `${contest.problemsCount > 0 ? (solvedCount / contest.problemsCount) * 100 : 0}%` }}
                  />
                </div>
                {loadingSubmissions && (
                  <p className="text-[9px] font-mono text-kjtext-muted/50 mt-1 animate-pulse">syncing…</p>
                )}
              </div>
            </div>

            {/* Problem strip — quick glance */}
            <div className="flex items-center justify-center gap-1.5 px-5 py-3 flex-wrap">
              {sorted.map((p, idx) => {
                const letter = String.fromCharCode(65 + idx);
                const balloonColor = BALLOON_COLORS[idx % BALLOON_COLORS.length];
                const pStatus = problemStatusMap.get(p.id);
                return (
                  <Link
                    key={p.id}
                    href={`/problems/${p.id}?contestId=${contest.numericId}`}
                    className={`group relative flex items-center justify-center w-8 h-8 rounded border text-[10px] font-mono font-bold transition-all ${
                      pStatus?.isSolved
                        ? "border-green-500/40 bg-green-500/10 text-green-400"
                        : pStatus && pStatus.attempts > 0
                          ? "border-yellow-500/30 bg-yellow-500/5 text-yellow-400"
                          : "border-kjborder hover:border-kjprimary/50 text-kjtext-muted hover:text-kjtext"
                    }`}
                    title={`${letter}: ${p.title}${pStatus?.isSolved ? " (solved)" : pStatus ? ` (${pStatus.attempts} attempts)` : ""}`}
                  >
                    {pStatus?.isSolved ? (
                      <span className="text-green-400">✓</span>
                    ) : (
                      letter
                    )}
                    {/* Balloon dot */}
                    <span
                      className="absolute -top-1 -right-1 w-2 h-2 rounded-full border border-kjbg"
                      style={{ backgroundColor: balloonColor }}
                    />
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        {/* Problem Queue */}
        <div className="mt-6 bg-kjsurface border border-kjborder rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-kjborder flex items-center justify-between">
            <h2 className="font-mono text-xs uppercase tracking-wider text-kjtext-muted font-bold">Problems</h2>
            <span className="text-[10px] font-mono text-kjtext-muted">{sorted.length} problems</span>
          </div>
          {sorted.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm font-mono text-kjtext-muted">No problems in this contest.</p>
              <p className="text-xs font-mono text-kjtext-muted/60 mt-1">Check back later or contact the contest organizer.</p>
            </div>
          ) : (
            sorted.map((p, idx) => {
              const letter = String.fromCharCode(65 + idx);
              const balloonColor = BALLOON_COLORS[idx % BALLOON_COLORS.length];
              const pStatus = problemStatusMap.get(p.id);
              return (
                <Link
                  key={p.id}
                  href={`/problems/${p.id}?contestId=${contest.numericId}`}
                  className="flex justify-between items-center px-5 py-2.5 border-b border-kjborder/60 last:border-b-0 text-sm text-kjtext hover:bg-kjsurface/80 hover:text-kjprimary transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-sm"
                      style={{ backgroundColor: balloonColor }}
                    >
                      {letter}
                    </span>
                    <span className="font-mono text-sm">{p.title}</span>
                    <span className={`text-[10px] font-mono border rounded px-1.5 py-0.5 ${
                      p.difficulty === "easy"
                        ? "text-green-400 border-green-400/20"
                        : p.difficulty === "medium"
                          ? "text-yellow-400 border-yellow-400/20"
                          : "text-red-400 border-red-400/20"
                    }`}>
                      {p.difficulty}
                    </span>
                    {pStatus?.isSolved ? (
                      <span className="text-[10px] font-mono text-green-400 border border-green-400/20 px-1.5 py-0.5 rounded">
                        ✓ SOLVED
                      </span>
                    ) : pStatus && pStatus.attempts > 0 ? (
                      <span className="text-[10px] font-mono text-yellow-400 border border-yellow-400/20 px-1.5 py-0.5 rounded">
                        {pStatus.attempts}×
                      </span>
                    ) : null}
                  </div>
                  <span className="text-[10px] text-kjprimary border border-kjborder/70 rounded px-2 py-0.5 group-hover:border-kjprimary transition-colors font-mono">
                    SOLVE →
                  </span>
                </Link>
              );
            })
          )}
        </div>

        <Link
          href={`/contests/${encodeURIComponent(contest.id)}`}
          className="inline-block mt-5 text-[10px] font-mono text-kjtext-muted hover:text-kjprimary"
        >
          ← Contest details
        </Link>
      </main>
    </>
  );
}
