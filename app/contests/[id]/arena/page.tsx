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

export default function ContestArenaPage() {
  const { id } = useParams<{ id: string }>();
  const [contest, setContest] = useState<ContestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

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
      setContest(data as ContestDetail);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load contest");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const timeRemaining = useMemo(() => {
    if (!contest) return "00:00:00";
    const end = new Date(contest.endsAt).getTime();
    const diff = Math.max(0, end - now);
    const totalSec = Math.floor(diff / 1000);
    const h = String(Math.floor(totalSec / 3600)).padStart(2, "0");
    const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
    const s = String(totalSec % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
  }, [contest, now]);

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
      <main className="pt-20 max-w-5xl mx-auto px-4 py-8">
        <p className="text-xs font-mono text-kjprimary tracking-widest mb-3">LIVE ARENA</p>
        <h1 className="text-3xl font-mono text-kjtext">{contest.title}</h1>
        <p className="text-kjtext-muted mt-3 text-sm">{contest.description || "—"}</p>
        <div className="mt-8 grid md:grid-cols-2 gap-4">
          <div className="bg-kjsurface border border-kjborder rounded-lg p-5">
            <h2 className="font-mono text-kjtext mb-4 text-sm">Problem queue</h2>
            {sorted.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-sm font-mono text-kjtext-muted">No problems in this contest.</p>
                <p className="text-xs font-mono text-kjtext-muted/60 mt-1">Check back later or contact the contest organizer.</p>
              </div>
            ) : (
              sorted.map((p, idx) => {
                const letter = String.fromCharCode(65 + idx);
                const balloonColor = BALLOON_COLORS[idx % BALLOON_COLORS.length];
                return (
                  <Link
                    key={p.id}
                    href={`/problems/${p.id}?contestId=${contest.numericId}`}
                    className="flex justify-between items-center border-b border-kjborder/60 py-3 text-sm text-kjtext hover:text-kjprimary transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-sm"
                        style={{ backgroundColor: balloonColor }}
                        title={`Problem ${letter} (${p.title})`}
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
                    </div>
                    <span className="text-xs text-kjprimary border border-kjborder/70 rounded px-2 py-0.5 group-hover:border-kjprimary transition-colors font-mono">
                      SOLVE →
                    </span>
                  </Link>
                );
              })
            )}
          </div>
          <div className="bg-kjsurface border border-kjborder rounded-lg p-5">
            <h2 className="font-mono text-kjtext mb-4 text-sm">Contest panel</h2>
            <p className="font-mono text-3xl text-kjprimary text-glow tabular-nums">{timeRemaining}</p>
            <p className="text-sm text-kjtext-muted mt-3">
              {contest.problemsCount} problems · scoring is solved count, then penalty.
            </p>
            <p className="text-xs font-mono text-kjtext-muted mt-2">{contest.participants} participants registered</p>
            <Link
              href={`/rankings?contestId=${contest.numericId}`}
              className="inline-block mt-6 border border-kjborder px-4 py-2 rounded text-xs font-mono text-kjprimary hover:border-kjprimary transition-colors"
            >
              LEADERBOARD →
            </Link>
          </div>
        </div>
        <Link
          href={`/contests/${encodeURIComponent(contest.id)}`}
          className="inline-block mt-8 text-xs font-mono text-kjtext-muted hover:text-kjprimary"
        >
          ← Contest details
        </Link>
      </main>
    </>
  );
}
