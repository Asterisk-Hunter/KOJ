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
  statement?: string;
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
  currentUserId: string | null;
};

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
    }).format(d);
  } catch {
    return iso;
  }
}

function formatDuration(startIso: string, endIso: string): string {
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  const ms = e - s;
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const hrs = Math.floor(ms / (1000 * 60 * 60));
  const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

function countdownLabel(status: UiStatus): string {
  if (status === "Active") return "time remaining";
  if (status === "Registration Open" || status === "Upcoming") return "starts in";
  return "ended";
}

export default function ContestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [contest, setContest] = useState<ContestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [registering, setRegistering] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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

  const countdown = useMemo(() => {
    if (!contest) return "00:00:00";
    const target =
      contest.status === "Active"
        ? new Date(contest.endsAt).getTime()
        : contest.status === "Registration Open" || contest.status === "Upcoming"
          ? new Date(contest.startsAt).getTime()
          : new Date(contest.endsAt).getTime();
    const diff = Math.max(0, target - now);
    if (contest.status === "Finished") return "00:00:00";
    const totalSec = Math.floor(diff / 1000);
    const h = String(Math.floor(totalSec / 3600)).padStart(2, "0");
    const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
    const s = String(totalSec % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
  }, [contest, now]);

  async function handleRegister() {
    if (!contest || contest.registered) return;
    setRegistering(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/contests/${encodeURIComponent(contest.id)}/register`, {
        method: "POST",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`);
      setContest((prev) => (prev ? { ...prev, registered: true, participants: prev.participants + 1 } : prev));
      setNotice("Registered successfully");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Registration failed");
    } finally {
      setRegistering(false);
    }
  }

  if (loading) {
    return (
      <>
        <Navigation />
        <main className="pt-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-kjsurface/40 border border-kjborder rounded-lg p-8 text-sm font-mono text-kjtext-muted">
            Loading contest…
          </div>
        </main>
      </>
    );
  }

  if (error || !contest) {
    return (
      <>
        <Navigation />
        <main className="pt-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-kjsurface/40 border border-kjborder rounded-lg p-8">
            <p className="text-sm font-mono text-red-400">{error ?? "Contest not found"}</p>
            <Link href="/contests" className="inline-block mt-4 text-xs font-mono text-kjprimary hover:underline">
              ← All contests
            </Link>
          </div>
        </main>
      </>
    );
  }

  const canEnterArena = contest.status === "Active" && contest.registered;
  const showRegister = contest.status === "Registration Open" || contest.status === "Upcoming";

  return (
    <>
      <Navigation />
      <main className="pt-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link href="/contests" className="text-xs font-mono text-kjtext-muted hover:text-kjprimary">
          ← All contests
        </Link>
        <div className="mt-6 flex flex-col lg:flex-row justify-between gap-6">
          <div>
            <p className="text-xs uppercase tracking-widest text-kjprimary font-mono mb-3">
              Contest / {contest.status}
            </p>
            <h1 className="text-3xl font-mono font-bold text-kjtext">{contest.title}</h1>
            <p className="text-sm text-kjtext-muted mt-3 max-w-2xl">{contest.description || "—"}</p>
          </div>
          <div className="bg-kjsurface border border-kjborder rounded-lg p-5 min-w-[230px]">
            <p className="text-[11px] uppercase tracking-widest font-mono text-kjtext-muted">
              {countdownLabel(contest.status)}
            </p>
            <p className="text-3xl font-mono text-kjprimary mt-2">{countdown}</p>
            <p className="text-xs font-mono text-kjtext-muted mt-2">
              {formatDuration(contest.startsAt, contest.endsAt)} · {contest.participants} participants
            </p>
          </div>
        </div>

        {notice && (
          <div className="mt-4 border border-kjprimary/20 bg-kjprimary/5 rounded p-3 text-xs font-mono text-kjprimary">
            {notice}
          </div>
        )}

        <div className="grid lg:grid-cols-[1fr_300px] gap-6 mt-8">
          <section className="bg-kjsurface/60 border border-kjborder rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-kjborder flex justify-between">
              <h2 className="font-mono text-sm text-kjtext">Contest problems</h2>
              <span className="text-xs font-mono text-kjtext-muted">{contest.problemsCount} total</span>
            </div>
            {contest.problems.length === 0 ? (
              <p className="px-5 py-8 text-sm font-mono text-kjtext-muted">No problems assigned to this contest.</p>
            ) : (
              contest.problems
                .slice()
                .sort((a, b) => a.position - b.position)
                .map((problem, index) => (
                  <Link
                    href={`/problems/${problem.id}?contestId=${contest.numericId}`}
                    key={problem.id}
                    className="flex items-center justify-between px-5 py-4 border-b border-kjborder/70 hover:bg-kjsurface"
                  >
                    <div className="flex gap-4 items-center">
                      <span className="font-mono text-kjtext-muted">{String.fromCharCode(65 + index)}</span>
                      <span className="text-sm text-kjtext">{problem.title}</span>
                      <span className="text-[11px] font-mono text-kjtext-muted border border-kjborder rounded px-1.5 py-0.5">
                        {problem.difficulty}
                      </span>
                    </div>
                    <span className="text-xs font-mono text-kjprimary">OPEN →</span>
                  </Link>
                ))
            )}
          </section>
          <aside className="space-y-4">
            <div className="bg-kjsurface border border-kjborder rounded-lg p-5">
              <h2 className="text-xs uppercase tracking-widest font-mono text-kjtext-muted mb-4">Actions</h2>
              {showRegister ? (
                <button
                  onClick={() => void handleRegister()}
                  disabled={contest.registered || registering}
                  className="w-full bg-kjprimary text-kjbg font-mono font-bold text-xs px-4 py-3 rounded disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {contest.registered ? "REGISTERED" : registering ? "REGISTERING…" : "REGISTER NOW"}
                </button>
              ) : null}
              {canEnterArena ? (
                <Link
                  href={`/contests/${encodeURIComponent(contest.id)}/arena`}
                  className="block text-center mt-3 border border-kjborder bg-kjprimary text-kjbg font-mono font-bold text-xs px-4 py-3 rounded hover:opacity-90"
                >
                  ENTER ARENA
                </Link>
              ) : contest.status === "Active" && !contest.registered ? (
                <p className="mt-3 text-xs font-mono text-kjtext-muted border border-kjborder rounded p-3">
                  Registration required to enter arena.
                </p>
              ) : null}
              <Link
                href="/rankings"
                className="block text-center mt-3 text-xs font-mono text-kjprimary hover:underline"
              >
                OPEN LEADERBOARD →
              </Link>
            </div>
            <div className="bg-kjsurface border border-kjborder rounded-lg p-5 text-xs font-mono text-kjtext-muted leading-7">
              <p>
                START <span className="text-kjtext">{formatDate(contest.startsAt)}</span>
              </p>
              <p>
                END <span className="text-kjtext">{formatDate(contest.endsAt)}</span>
              </p>
              <p>
                MODE <span className="text-kjtext">Standard scoring</span>
              </p>
              <p>
                RANK <span className="text-kjtext">Solved ↓ · penalty ↑</span>
              </p>
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}
