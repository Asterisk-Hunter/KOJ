"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

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
      <main className="max-w-5xl mx-auto px-4 py-16">
        <div className="bg-kjsurface/40 border border-kjborder rounded-lg p-8 text-sm font-mono text-kjtext-muted">
          Loading arena…
        </div>
      </main>
    );
  }

  if (error || !contest) {
    return (
      <main className="max-w-5xl mx-auto px-4 py-16">
        <p className="text-sm font-mono text-red-400">{error ?? "Contest not found"}</p>
        <Link href="/contests" className="inline-block mt-6 text-xs font-mono text-kjprimary hover:underline">
          ← Back to contests
        </Link>
      </main>
    );
  }

  const isLive = contest.status === "Active";
  const isRegistered = contest.registered;

  if (!isLive) {
    return (
      <main className="max-w-5xl mx-auto px-4 py-16">
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
            className="inline-block mt-6 border border-kjborder px-4 py-2 rounded text-xs font-mono text-kjprimary"
          >
            ← Contest details
          </Link>
        </div>
      </main>
    );
  }

  if (!isRegistered) {
    return (
      <main className="max-w-5xl mx-auto px-4 py-16">
        <p className="text-xs font-mono text-kjprimary tracking-widest mb-3">LIVE ARENA / REGISTRATION REQUIRED</p>
        <h1 className="text-3xl font-mono text-kjtext">{contest.title}</h1>
        <div className="mt-6 bg-kjsurface border border-kjborder rounded-lg p-6">
          <p className="text-sm font-mono text-kjtext">You are not registered for this contest.</p>
          <p className="text-xs font-mono text-kjtext-muted mt-2">
            Registration is required to enter the arena and submit solutions.
          </p>
          <Link
            href={`/contests/${encodeURIComponent(contest.id)}`}
            className="inline-block mt-6 bg-kjprimary text-kjbg font-mono font-bold text-xs px-4 py-2 rounded"
          >
            GO TO REGISTRATION →
          </Link>
        </div>
      </main>
    );
  }

  const sorted = contest.problems.slice().sort((a, b) => a.position - b.position);

  return (
    <main className="max-w-5xl mx-auto px-4 py-16">
      <p className="text-xs font-mono text-kjprimary tracking-widest mb-3">LIVE ARENA</p>
      <h1 className="text-3xl font-mono text-kjtext">{contest.title}</h1>
      <p className="text-kjtext-muted mt-3 text-sm">{contest.description || "—"}</p>
      <div className="mt-8 grid md:grid-cols-2 gap-4">
        <div className="bg-kjsurface border border-kjborder rounded-lg p-5">
          <h2 className="font-mono text-kjtext mb-4">Problem queue</h2>
          {sorted.length === 0 ? (
            <p className="text-sm font-mono text-kjtext-muted">No problems in this contest.</p>
          ) : (
            sorted.map((p, idx) => {
              const letter = String.fromCharCode(65 + idx);
              return (
                <Link
                  key={p.id}
                  href={`/problems/${p.id}?contestId=${contest.numericId}`}
                  className="flex justify-between items-center border-b border-kjborder py-3 text-sm text-kjtext hover:text-kjprimary"
                >
                  <span>
                    {letter} · {p.title}
                  </span>
                  <span className="text-xs text-kjprimary border border-kjborder rounded px-2 py-0.5">OPEN</span>
                </Link>
              );
            })
          )}
        </div>
        <div className="bg-kjsurface border border-kjborder rounded-lg p-5">
          <h2 className="font-mono text-kjtext mb-4">Contest panel</h2>
          <p className="font-mono text-3xl text-kjprimary">{timeRemaining}</p>
          <p className="text-sm text-kjtext-muted mt-3">
            {contest.problemsCount} problems · scoring is solved count, then penalty.
          </p>
          <p className="text-xs font-mono text-kjtext-muted mt-2">{contest.participants} participants registered</p>
          <Link
            href="/rankings"
            className="inline-block mt-6 border border-kjborder px-4 py-2 rounded text-xs font-mono text-kjprimary"
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
  );
}
