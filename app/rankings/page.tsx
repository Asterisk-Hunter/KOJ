"use client";

/* eslint-disable react-hooks/set-state-in-effect */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/app/components/PageHeader";

type ContestMeta = {
  id: number;
  numericId?: number;
  title: string;
  status: string;
  dbStatus?: string;
  startsAt?: string;
  endsAt?: string;
};

type ProblemMeta = {
  problemId: number;
  title: string;
  position: number;
  label: string;
  balloonColor: string;
  balloonName: string;
  balloonClass: string;
};

type ProblemSummary = {
  problemId: number;
  label: string;
  totalSolved: number;
  totalAttempts: number;
  firstSolveMinutes: number | null;
  acceptanceRate: number;
};

type PerProblemEntry = {
  problemId: number;
  status: "AC" | "WA" | "PENDING" | "--";
  attempts: number;
  penaltyMinutes: number | null;
  isFirstToSolve: boolean;
  timeMinutes: number | null;
  pendingAttempts?: number;
};

type StandingRow = {
  rank: number;
  userId: string;
  username: string;
  solvedCount: number;
  penalty: number;
  perProblem: PerProblemEntry[];
  solved: string[];
};

type RankingsResponse = {
  contest: {
    id: number;
    title: string;
    status: string;
    startsAt: string;
    endsAt: string;
    isFrozen: boolean;
    freezeMinutesRemaining: number;
  };
  problems: ProblemMeta[];
  summary?: ProblemSummary[];
  rows: StandingRow[];
};

export default function RankingsPage() {
  const [contests, setContests] = useState<ContestMeta[]>([]);
  const [contestsError, setContestsError] = useState<string | null>(null);
  const [contestsLoading, setContestsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string>("");
  const [data, setData] = useState<RankingsResponse | null>(null);
  const [rankingsLoading, setRankingsLoading] = useState(false);
  const [rankingsError, setRankingsError] = useState<string | null>(null);
  const [liveRefresh, setLiveRefresh] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const isLiveContest = data?.contest.status === "live";

  const fetchContests = useCallback(async () => {
    setContestsLoading(true);
    setContestsError(null);
    try {
      const res = await fetch("/api/contests", { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 404) {
          setContests([]);
          setContestsError(null);
          return;
        }
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `failed to fetch contests (${res.status})`);
      }
      const json = (await res.json()) as unknown;
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
      const normalized = list
        .filter((c) => {
          const numericId = c.numericId ?? c.id;
          const statusEligible =
            c.status === "Active" ||
            c.status === "Finished" ||
            c.status === "Registration Open";
          return (
            c &&
            Number.isInteger(numericId) &&
            numericId > 0 &&
            typeof c.title === "string" &&
            statusEligible &&
            c.dbStatus !== "draft"
          );
        })
        .map((c) => ({
          id: Number(c.numericId ?? c.id),
          title: String(c.title),
          status: String(c.status),
        }));
      setContests(normalized);

      const urlContestId =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("contestId")
          : null;
      if (urlContestId && normalized.some((c) => String(c.id) === urlContestId)) {
        setSelectedId(urlContestId);
      } else if (normalized.length > 0 && !selectedId) {
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
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search).get("contestId");
      if (p && Number.isInteger(Number(p)) && Number(p) > 0) {
        setSelectedId(p);
      }
    }
  }, []);

  useEffect(() => {
    void fetchContests();
  }, [fetchContests]);

  useEffect(() => {
    if (selectedId) void fetchRankings(selectedId);
    else setData(null);
  }, [selectedId, fetchRankings]);

  // Live leaderboard: subscribe to SSE version ticker
  useEffect(() => {
    if (!selectedId || !isLiveContest) {
      setLiveRefresh(false);
      return;
    }
    const es = new EventSource(`/api/contests/${encodeURIComponent(selectedId)}/events`);
    let lastVersion: string | null = null;
    setLiveRefresh(true);
    es.addEventListener("version", (ev) => {
      const v = (ev as MessageEvent).data as string;
      if (lastVersion !== null && v !== lastVersion) void fetchRankings(selectedId);
      lastVersion = v;
    });
    return () => {
      es.close();
      setLiveRefresh(false);
    };
  }, [selectedId, isLiveContest, fetchRankings]);

  const filteredRows = useMemo(() => {
    if (!data) return [];
    if (!searchQuery.trim()) return data.rows;
    const q = searchQuery.toLowerCase();
    return data.rows.filter((r) => r.username.toLowerCase().includes(q));
  }, [data, searchQuery]);

  const isLive = data?.contest.status === "live";
  const isEnded = data?.contest.status === "ended";
  const isFrozen = data?.contest.isFrozen ?? false;

  return (
    <>
      <PageHeader
        eyebrow="DOMjudge / ICPC Scoreboard"
        title="Live Standings"
        description="Official ICPC scoring: primary rank by solved problems (descending), secondary rank by total penalty minutes (ascending). Features real-time balloon colors and first-to-solve badges."
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Scoreboard Control & Selector Bar */}
        <div className="flex flex-wrap justify-between items-center gap-4 bg-kjsurface/60 border border-kjborder rounded-lg p-4">
          <div className="flex items-center gap-3 flex-wrap">
            {contests.length > 0 ? (
              <select
                value={selectedId}
                onChange={(event) => setSelectedId(event.target.value)}
                className="bg-kjbg border border-kjborder rounded px-4 py-2 text-sm font-mono text-kjtext focus:border-kjprimary focus:outline-none"
                aria-label="Select contest"
              >
                {contests.map((item) => (
                  <option key={item.id} value={String(item.id)}>
                    {item.title} ({item.status})
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  value={selectedId}
                  onChange={(event) => setSelectedId(event.target.value)}
                  placeholder="Contest ID"
                  inputMode="numeric"
                  className="bg-kjbg border border-kjborder rounded px-3 py-2 text-sm font-mono text-kjtext placeholder:text-kjtext-muted/50 w-36 focus:border-kjprimary focus:outline-none"
                  aria-label="Contest ID"
                />
                <button
                  onClick={() => void fetchRankings(selectedId)}
                  disabled={!selectedId.trim()}
                  className="border border-kjprimary/30 bg-kjprimary/10 text-kjprimary rounded px-3 py-2 text-xs font-mono hover:bg-kjprimary/20 transition-colors"
                >
                  LOAD
                </button>
              </div>
            )}

            {contestsLoading && <span className="text-[11px] font-mono text-kjtext-muted">Loading contests…</span>}
            {contestsError && <span className="text-[11px] font-mono text-red-400">{contestsError}</span>}

            {selectedId && (
              <Link
                href={`/contests/${selectedId}`}
                className="text-xs font-mono text-kjprimary hover:underline"
              >
                Contest details →
              </Link>
            )}

            {/* Search Contestant */}
            {data && data.rows.length > 0 && (
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter contestant…"
                className="bg-kjbg border border-kjborder rounded px-3 py-2 text-xs font-mono text-kjtext placeholder:text-kjtext-muted/50 focus:border-kjprimary focus:outline-none w-44"
              />
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Freeze Badge */}
            {isFrozen && (
              <span className="flex items-center gap-1.5 border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 rounded px-3 py-1.5 text-xs font-mono font-bold animate-pulse">
                <span>🧊</span> FROZEN ({data?.contest.freezeMinutesRemaining ?? 0}m left)
              </span>
            )}

            {/* Status indicator */}
            <span
              className={`border rounded px-3 py-1.5 text-xs font-mono ${
                isLive
                  ? "border-kjprimary/40 bg-kjprimary/10 text-kjprimary"
                  : isEnded
                    ? "border-kjborder bg-kjsurface text-kjtext-muted"
                    : "border-kjborder bg-kjsurface text-kjtext-muted"
              }`}
            >
              {isLive ? (liveRefresh ? "● LIVE STREAMING" : "● LIVE") : isEnded ? "■ FINISHED" : "○ DB"}
            </span>
          </div>
        </div>

        {/* DOMjudge Freeze Notice Banner */}
        {isFrozen && (
          <div className="border border-cyan-500/30 bg-cyan-950/30 rounded-lg p-4 text-xs font-mono text-cyan-200 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-xl">🧊</span>
              <div>
                <strong className="text-cyan-300">DOMjudge Scoreboard Freeze Active</strong>
                <p className="text-cyan-200/70 mt-0.5">
                  Submissions during the final hour are recorded but masked as pending (?). The final standings will be revealed post-contest.
                </p>
              </div>
            </div>
          </div>
        )}

        {rankingsLoading && (
          <div className="border border-kjborder bg-kjsurface rounded p-8 text-center text-xs font-mono text-kjtext-muted">
            <span className="inline-block w-4 h-4 border-2 border-kjprimary border-t-transparent rounded-full animate-spin mr-2 align-middle" />
            Loading live ICPC standings…
          </div>
        )}

        {rankingsError && (
          <div className="border border-red-500/30 bg-red-500/10 rounded p-4 text-xs font-mono text-red-400">
            Error: {rankingsError}
          </div>
        )}

        {!rankingsLoading && !rankingsError && data && data.rows.length === 0 && (
          <div className="border border-kjborder bg-kjsurface rounded-lg p-10 text-center">
            <p className="text-sm font-mono text-kjtext mb-1">No submissions yet</p>
            <p className="text-xs font-mono text-kjtext-muted/70 max-w-md mx-auto">
              {data.contest.title} — no participants have submitted solutions yet. Once submissions are made, the live scoreboard will appear here.
            </p>
            {selectedId && (
              <Link
                href={`/contests/${selectedId}`}
                className="inline-block mt-4 border border-kjborder text-kjprimary hover:border-kjprimary font-mono text-xs px-4 py-2 rounded transition-colors"
              >
                View contest details →
              </Link>
            )}
          </div>
        )}

        {!rankingsLoading && !rankingsError && data && data.rows.length > 0 && (
          <div className="border border-kjborder rounded-lg overflow-x-auto bg-kjbg">
            <table className="w-full min-w-[760px] text-xs font-mono border-collapse">
              <thead>
                <tr className="bg-kjsurface border-b border-kjborder">
                  <th className="px-4 py-3.5 text-left text-kjtext-muted uppercase tracking-wider w-14">Rank</th>
                  <th className="px-4 py-3.5 text-left text-kjtext-muted uppercase tracking-wider min-w-[160px]">Contestant</th>
                  <th className="px-3 py-3.5 text-center text-kjtext-muted uppercase tracking-wider w-16">Solved</th>
                  <th className="px-3 py-3.5 text-center text-kjtext-muted uppercase tracking-wider w-20">Time</th>

                  {/* DOMjudge Problem Columns with Balloons */}
                  {data.problems.map((p) => (
                    <th key={p.problemId} className="px-3 py-3 text-center min-w-[72px]" title={p.title}>
                      <div className="flex flex-col items-center gap-1">
                        <span
                          className="w-4 h-4 rounded-full inline-block shadow-sm"
                          style={{ backgroundColor: p.balloonColor }}
                          title={`Problem ${p.label}: ${p.title} (${p.balloonName} Balloon)`}
                        />
                        <span className="font-bold text-kjtext text-xs">{p.label}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {filteredRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={4 + data.problems.length}
                      className="px-4 py-8 text-center text-xs font-mono text-kjtext-muted"
                    >
                      No contestants match filter &quot;{searchQuery}&quot;
                    </td>
                  </tr>
                )}
                {filteredRows.map((row) => (
                  <tr
                    key={row.userId}
                    className="border-b border-kjborder/60 hover:bg-kjsurface/50 transition-colors"
                  >
                    {/* Rank */}
                    <td className="px-4 py-3 text-kjtext font-bold">
                      {row.rank <= 3 ? (
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-bold ${
                          row.rank === 1
                            ? "bg-yellow-400/20 text-yellow-300 border border-yellow-400/40"
                            : row.rank === 2
                              ? "bg-slate-300/20 text-slate-200 border border-slate-300/40"
                              : "bg-amber-600/20 text-amber-300 border border-amber-600/40"
                        }`}>
                          {row.rank}
                        </span>
                      ) : (
                        row.rank
                      )}
                    </td>

                    {/* Username */}
                    <td className="px-4 py-3 text-kjtext font-medium">
                      <span className="hover:text-kjprimary transition-colors cursor-default">
                        {row.username}
                      </span>
                    </td>

                    {/* Solved Count */}
                    <td className="px-3 py-3 text-center">
                      <span className="inline-block px-2 py-0.5 rounded font-bold text-green-400 bg-green-400/10 border border-green-400/20">
                        {row.solvedCount}
                      </span>
                    </td>

                    {/* Penalty Time */}
                    <td className="px-3 py-3 text-center text-kjtext-muted tabular-nums">
                      {row.penalty}
                    </td>

                    {/* Per Problem Score Cells (DOMjudge Style) */}
                    {data.problems.map((p) => {
                      const entry = row.perProblem.find((item) => item.problemId === p.problemId);

                      if (!entry || entry.status === "--") {
                        return (
                          <td key={p.problemId} className="px-2 py-2 text-center text-kjtext-muted/30">
                            ·
                          </td>
                        );
                      }

                      // First to solve (First Blood / Star)
                      if (entry.status === "AC" && entry.isFirstToSolve) {
                        return (
                          <td
                            key={p.problemId}
                            className="px-2 py-2 text-center bg-emerald-950/90 border border-emerald-500/60 text-emerald-200 shadow-[inset_0_0_8px_rgba(16,185,129,0.3)]"
                            title={`First to solve! ${entry.attempts} attempt(s) in ${entry.timeMinutes ?? 0} mins`}
                          >
                            <div className="font-bold flex items-center justify-center gap-0.5 text-emerald-300 text-xs">
                              <span>★</span>
                              <span>+{entry.attempts > 1 ? entry.attempts - 1 : ""}</span>
                            </div>
                            <div className="text-[10px] text-emerald-400/80 font-mono">
                              {entry.timeMinutes ?? 0}&apos;
                            </div>
                          </td>
                        );
                      }

                      // Regular Accepted
                      if (entry.status === "AC") {
                        return (
                          <td
                            key={p.problemId}
                            className="px-2 py-2 text-center bg-green-950/40 border border-green-600/30 text-green-300"
                            title={`Accepted in ${entry.attempts} attempt(s), ${entry.timeMinutes ?? 0} mins`}
                          >
                            <div className="font-bold text-xs">
                              +{entry.attempts > 1 ? entry.attempts - 1 : ""}
                            </div>
                            <div className="text-[10px] text-green-400/80 font-mono">
                              {entry.timeMinutes ?? 0}&apos;
                            </div>
                          </td>
                        );
                      }

                      // Pending (During Scoreboard Freeze)
                      if (entry.status === "PENDING") {
                        return (
                          <td
                            key={p.problemId}
                            className="px-2 py-2 text-center bg-cyan-950/40 border border-cyan-500/30 text-cyan-300"
                            title={`${entry.attempts} attempt(s) submitted (frozen)`}
                          >
                            <div className="font-bold text-xs text-cyan-300">
                              {entry.attempts} ?
                            </div>
                            <div className="text-[9px] text-cyan-400/70 uppercase">
                              frozen
                            </div>
                          </td>
                        );
                      }

                      // Wrong Answer / Rejected
                      return (
                        <td
                          key={p.problemId}
                          className="px-2 py-2 text-center bg-red-950/30 border border-red-800/30 text-red-400"
                          title={`${entry.attempts} failed attempt(s)`}
                        >
                          <div className="font-bold text-xs">
                            -{entry.attempts}
                          </div>
                          <div className="text-[10px] text-red-400/50">
                            --
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>

              {/* DOMjudge Scoreboard Summary Bottom Row */}
              {data.summary && data.summary.length > 0 && (
                <tfoot>
                  <tr className="bg-kjsurface/90 border-t-2 border-kjborder text-kjtext-muted font-bold">
                    <td colSpan={2} className="px-4 py-3 text-left uppercase tracking-wider text-[11px]">
                      Summary (Solves / Tries)
                    </td>
                    <td className="px-3 py-3 text-center text-green-400 font-mono">
                      {data.summary.reduce((acc, s) => acc + s.totalSolved, 0)}
                    </td>
                    <td className="px-3 py-3 text-center font-mono">
                      {data.summary.reduce((acc, s) => acc + s.totalAttempts, 0)}
                    </td>

                    {data.summary.map((s) => (
                      <td key={s.problemId} className="px-2 py-2.5 text-center text-[11px] font-mono">
                        <div className="text-green-400 font-bold">{s.totalSolved}</div>
                        <div className="text-[10px] text-kjtext-muted/60">{s.totalAttempts} tries</div>
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        {/* Legend */}
        {data && data.rows.length > 0 && (
          <div className="flex flex-wrap gap-4 text-xs font-mono text-kjtext-muted border-t border-kjborder pt-4">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 bg-emerald-950 border border-emerald-500 rounded text-[9px] text-emerald-300 flex items-center justify-center font-bold">★</span>
              First to Solve
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 bg-green-950/60 border border-green-600 rounded text-[9px] text-green-400 flex items-center justify-center font-bold">+</span>
              Solved
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 bg-red-950/60 border border-red-800 rounded text-[9px] text-red-400 flex items-center justify-center font-bold">-</span>
              Attempted / Rejected
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 bg-cyan-950/60 border border-cyan-600 rounded text-[9px] text-cyan-400 flex items-center justify-center font-bold">?</span>
              Pending (Frozen)
            </span>
          </div>
        )}
      </main>
    </>
  );
}
