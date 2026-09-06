"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/app/components/PageHeader";

type UiStatus = "Active" | "Registration Open" | "Upcoming" | "Finished";

type ContestListItem = {
  id: string;
  numericId: number;
  slug: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  status: UiStatus;
  dbStatus: string;
  problems: number;
  participants: number;
  registered: boolean;
};

const filters: Array<"All" | UiStatus> = ["All", "Registration Open", "Active", "Upcoming", "Finished"];
const colors: Record<UiStatus, string> = {
  Active: "text-green-400 bg-green-400/10 border-green-400/20",
  "Registration Open": "text-kjprimary bg-kjprimary/10 border-kjprimary/20",
  Upcoming: "text-blue-400 bg-blue-400/10 border-blue-400/20",
  Finished: "text-kjtext-muted bg-kjbg border-kjborder",
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

export default function ContestsPage() {
  const [filter, setFilter] = useState<"All" | UiStatus>("All");
  const [contests, setContests] = useState<ContestListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [registering, setRegistering] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/contests", { cache: "no-store" });
      const data = (await res.json()) as unknown;
      if (!res.ok) {
        const msg = (data as { error?: string }).error ?? `Failed to load contests (${res.status})`;
        throw new Error(msg);
      }
      const list = Array.isArray(data)
        ? (data as ContestListItem[])
        : ((data as { contests?: ContestListItem[] }).contests ?? []);
      setContests(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load contests");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function handleRegister(item: ContestListItem) {
    if (item.registered) return;
    setRegistering(item.id);
    setNotice(null);
    try {
      const res = await fetch(`/api/contests/${encodeURIComponent(item.id)}/register`, {
        method: "POST",
      });
      const data = (await res.json()) as { error?: string; registered?: boolean };
      if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`);
      setContests((prev) =>
        prev.map((c) =>
          c.id === item.id ? { ...c, registered: true, participants: c.participants + 1 } : c,
        ),
      );
      setNotice(`Registered for ${item.title}`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Registration failed");
    } finally {
      setRegistering(null);
    }
  }

  const visible = contests.filter((c) => filter === "All" || c.status === filter);

  return (
    <>
      <PageHeader
        eyebrow="Arena / schedules"
        title="Contest Arena"
        description="Register for upcoming events, enter active arenas, and inspect final results from completed contests."
      />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-wrap gap-2 mb-7">
          {filters.map((item) => (
            <button
              key={item}
              onClick={() => setFilter(item)}
              className={`px-4 py-2 rounded border text-xs font-mono ${
                filter === item ? "border-kjprimary/50 bg-kjprimary/10 text-kjprimary" : "border-kjborder text-kjtext-muted"
              }`}
            >
              {item}
            </button>
          ))}
        </div>

        {notice && (
          <div className="mb-4 border border-kjprimary/20 bg-kjprimary/5 rounded p-3 text-xs font-mono text-kjprimary">
            {notice}
          </div>
        )}

        {loading ? (
          <div className="bg-kjsurface/40 border border-kjborder rounded-lg p-8 text-sm font-mono text-kjtext-muted">
            Loading contests…
          </div>
        ) : error ? (
          <div className="bg-kjsurface/40 border border-kjborder rounded-lg p-8">
            <p className="text-sm font-mono text-red-400">{error}</p>
            <button
              onClick={() => void load()}
              className="mt-4 border border-kjborder text-kjtext font-mono text-xs px-4 py-2 rounded hover:border-kjprimary hover:text-kjprimary"
            >
              Retry
            </button>
          </div>
        ) : contests.length === 0 ? (
          <div className="bg-kjsurface/40 border border-kjborder rounded-lg p-8 text-sm font-mono text-kjtext-muted">
            No contests found. Check back soon.
          </div>
        ) : visible.length === 0 ? (
          <div className="bg-kjsurface/40 border border-kjborder rounded-lg p-8 text-sm font-mono text-kjtext-muted">
            No contests match &ldquo;{filter}&rdquo;.
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {visible.map((contest) => (
              <article
                key={contest.id}
                className="bg-kjsurface border border-kjborder rounded-lg p-5 hover:border-kjborder-bright"
              >
                <div className="flex justify-between gap-4 mb-3">
                  <Link
                    href={`/contests/${encodeURIComponent(contest.id)}`}
                    className="font-mono font-semibold text-kjtext hover:text-kjprimary"
                  >
                    {contest.title}
                  </Link>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-1 text-[11px] font-mono ${colors[contest.status]}`}
                  >
                    {contest.status}
                  </span>
                </div>
                <p className="text-sm text-kjtext-muted leading-6 mb-5">{contest.description || "—"}</p>
                <div className="grid grid-cols-2 gap-y-2 text-xs font-mono text-kjtext-muted mb-5">
                  <span>
                    START <b className="text-kjtext font-normal">{formatDate(contest.startsAt)}</b>
                  </span>
                  <span>
                    END <b className="text-kjtext font-normal">{formatDate(contest.endsAt)}</b>
                  </span>
                  <span>
                    PROBLEMS <b className="text-kjtext font-normal">{contest.problems}</b>
                  </span>
                  <span>
                    PARTICIPANTS <b className="text-kjtext font-normal">{contest.participants}</b>
                  </span>
                </div>
                <div className="flex gap-3">
                  <Link
                    href={`/contests/${encodeURIComponent(contest.id)}`}
                    className="bg-kjprimary text-kjbg font-mono font-bold text-xs px-4 py-2 rounded"
                  >
                    {contest.status === "Active"
                      ? "ENTER ARENA"
                      : contest.status === "Finished"
                        ? "VIEW RESULTS"
                        : "VIEW DETAILS"}
                  </Link>
                  {(contest.status === "Registration Open" || contest.status === "Upcoming") && (
                    <button
                      onClick={() => void handleRegister(contest)}
                      disabled={contest.registered || registering === contest.id}
                      className="border border-kjborder text-kjtext font-mono text-xs px-4 py-2 rounded hover:border-kjprimary hover:text-kjprimary disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {contest.registered ? "REGISTERED" : registering === contest.id ? "REGISTERING…" : "REGISTER"}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
