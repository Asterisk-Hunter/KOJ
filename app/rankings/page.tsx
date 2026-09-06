"use client";

/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/app/components/PageHeader";

type ContestMeta = {
  id: number;
  numericId?: number;
  title: string;
  status: string;
  startsAt?: string;
  endsAt?: string;
};

type RankingsResponse = {
  contest: {
    id: number;
    title: string;
    status: string;
    startsAt: string;
    endsAt: string;
  };
  problems: Array<{ problemId: number; position: number; label: string }>;
  rows: Array<{
    rank: number;
    userId: string;
    username: string;
    solvedCount: number;
    penalty: number;
    perProblem: Array<{ problemId: number; status: string; attempts: number; penaltyMinutes: number | null }>;
    solved: string[];
  }>;
};

export default function RankingsPage() {
  const [contests, setContests] = useState<ContestMeta[]>([]);
  const [contestsError, setContestsError] = useState<string | null>(null);
  const [contestsLoading, setContestsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string>("");
  const [data, setData] = useState<RankingsResponse | null>(null);
  const [rankingsLoading, setRankingsLoading] = useState(false);
  const [rankingsError, setRankingsError] = useState<string | null>(null);

  const fetchContests = useCallback(async () => {
    setContestsLoading(true);
    setContestsError(null);
    try {
      const res = await fetch("/api/contests", { cache: "no-store" });
      if (!res.ok) {
        // route-safe: if no API, leave empty and allow manual id entry
        if (res.status === 404) {
          setContests([]);
          setContestsError(null);
          return;
        }
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `failed to fetch contests (${res.status})`);
      }
      const json = (await res.json()) as unknown;
      // Support both array response and { contests: [] } or { data: [] }
      let list: ContestMeta[] = [];
      if (Array.isArray(json)) {
        list = json as ContestMeta[];
      } else if (json && typeof json === "object" && Array.isArray((json as { contests?: unknown }).contests)) {
        list = (json as { contests: ContestMeta[] }).contests;
      } else if (json && typeof json === "object" && Array.isArray((json as { data?: unknown }).data)) {
        list = (json as { data: ContestMeta[] }).data;
      } else {
        list = [];
      }
      // normalize ids to numbers
      const normalized = list
        .filter((c) => {
          const numericId = c.numericId ?? c.id;
          return c && Number.isInteger(numericId) && numericId > 0 && typeof c.title === "string" &&
            (c.status === "Active" || c.status === "Finished");
        })
        .map((c) => ({
          id: Number(c.numericId ?? c.id),
          title: String(c.title),
          status: String(c.status),
        }));
      setContests(normalized);
      if (normalized.length > 0 && !selectedId) {
        setSelectedId(String(normalized[0].id));
      }
    } catch (e) {
      setContestsError(e instanceof Error ? e.message : "failed to load contests");
      setContests([]);
    } finally {
      setContestsLoading(false);
    }
  }, [selectedId]);

  const fetchRankings = useCallback(async (contestId: string) => {
    if (!contestId) {
      setData(null);
      return;
    }
    const n = Number(contestId);
    if (!Number.isInteger(n) || n <= 0) {
      setRankingsError("contestId must be a positive integer");
      setData(null);
      return;
    }
    setRankingsLoading(true);
    setRankingsError(null);
    try {
      const res = await fetch(`/api/rankings?contestId=${encodeURIComponent(contestId)}`, { cache: "no-store" });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `failed to fetch rankings (${res.status})`);
      }
      const json = (await res.json()) as RankingsResponse;
      setData(json);
    } catch (e) {
      setRankingsError(e instanceof Error ? e.message : "failed to load rankings");
      setData(null);
    } finally {
      setRankingsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchContests();
  }, [fetchContests]);

  useEffect(() => {
    if (selectedId) void fetchRankings(selectedId);
    else setData(null);
  }, [selectedId, fetchRankings]);

  const contestLabel = data?.contest ? `${data.contest.title} · ${data.contest.status}` : contests.find((c) => String(c.id) === selectedId)?.title ?? (selectedId ? `Contest #${selectedId}` : "Select a contest");
  const isLive = data?.contest.status === "live";
  const isEnded = data?.contest.status === "ended";

  return (
    <>
      <PageHeader
        eyebrow="Standings / live DB"
        title="Leaderboard"
        description="Contest rankings sorted by problems solved descending, then penalty ascending. Data is fetched live from Neon via Drizzle."
      />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-wrap justify-between gap-4 mb-6">
          <div className="flex items-center gap-3 flex-wrap">
            {contests.length > 0 ? (
              <select
                value={selectedId}
                onChange={(event) => setSelectedId(event.target.value)}
                className="bg-kjsurface border border-kjborder rounded px-4 py-3 text-sm font-mono text-kjtext"
                aria-label="Select contest"
              >
                {contests.map((item) => (
                  <option key={item.id} value={String(item.id)}>
                    {item.title}
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  value={selectedId}
                  onChange={(event) => setSelectedId(event.target.value)}
                  placeholder="Contest ID (numeric)"
                  inputMode="numeric"
                  className="bg-kjsurface border border-kjborder rounded px-4 py-3 text-sm font-mono text-kjtext placeholder:text-kjtext-muted/50 w-48"
                  aria-label="Contest ID"
                />
                <button
                  onClick={() => void fetchRankings(selectedId)}
                  className="border border-kjprimary/30 bg-kjprimary/10 text-kjprimary rounded px-4 py-3 text-xs font-mono"
                >
                  LOAD
                </button>
              </div>
            )}
            <span className="text-xs font-mono text-kjtext-muted">{contestsLoading ? "loading contests…" : contestLabel}</span>
            {contestsError && <span className="text-xs font-mono text-red-400">{contestsError}</span>}
          </div>
          <span
            className={`border rounded px-4 py-3 text-xs font-mono ${isLive ? "border-kjprimary/30 bg-kjprimary/10 text-kjprimary" : isEnded ? "border-kjborder bg-kjsurface text-kjtext-muted" : "border-kjborder bg-kjsurface text-kjtext-muted"}`}
          >
            {isLive ? "● LIVE / DB" : isEnded ? "■ ENDED / DB" : "○ DB"}
          </span>
        </div>

        {rankingsLoading && <p className="border border-kjborder bg-kjsurface rounded p-4 text-xs font-mono text-kjtext-muted">Loading standings from DB…</p>}

        {rankingsError && (
          <div className="border border-red-500/30 bg-red-500/10 rounded p-4 text-xs font-mono text-red-400 mb-4">Error: {rankingsError}</div>
        )}

        {!rankingsLoading && !rankingsError && !data && !selectedId && (
          <div className="border border-kjborder bg-kjsurface rounded p-8 text-center">
            <p className="text-sm font-mono text-kjtext-muted">Select a contest or enter a numeric contest ID to view standings.</p>
          </div>
        )}

        {!rankingsLoading && !rankingsError && data && data.rows.length === 0 && (
          <div className="border border-kjborder bg-kjsurface rounded p-8 text-center">
            <p className="text-sm font-mono text-kjtext-muted">No submissions for this contest yet.</p>
            <p className="text-xs font-mono text-kjtext-muted mt-2">
              Contest: {data.contest.title} · {data.rows.length} participants
            </p>
          </div>
        )}

        {!rankingsLoading && data && data.rows.length > 0 && (
          <div className="border border-kjborder rounded-lg overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="bg-kjsurface">
                  {["Rank", "Username", ...data.problems.map((p) => p.label), "Solved", "Penalty"].map((heading) => (
                    <th
                      key={heading}
                      className="px-5 py-4 text-left text-[11px] uppercase tracking-widest font-mono text-kjtext-muted"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.userId} className="border-t border-kjborder/70">
                    <td className="px-5 py-4 font-mono text-kjprimary">{String(row.rank).padStart(2, "0")}</td>
                    <td className="px-5 py-4 font-mono text-kjtext">{row.username}</td>
                    {row.perProblem.map((p, index) => (
                      <td
                        key={`${row.userId}-${p.problemId}-${index}`}
                        className={`px-5 py-4 font-mono text-sm ${p.status === "AC" ? "text-green-400" : p.status === "WA" ? "text-red-400" : "text-kjtext-muted"}`}
                        title={p.penaltyMinutes !== null ? `${p.penaltyMinutes} min` : undefined}
                      >
                        {p.status}
                      </td>
                    ))}
                    <td className="px-5 py-4 font-mono text-kjtext">{row.solvedCount}</td>
                    <td className="px-5 py-4 font-mono text-kjtext-muted">{row.penalty} min</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.rows.length > 0 && (
          <p className="mt-4 text-xs font-mono text-kjtext-muted">
            Penalty = first accepted time + 20 minutes for each incorrect submission before first AC.
          </p>
        )}
      </main>
    </>
  );
}
