"use client";

/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState } from "react";

type MetricsData = {
  window: string;
  allTimeByStatus: Record<string, number>;
  last24hByStatus: Record<string, number>;
  judgedLast24h: number;
  avgExecutionMsLast24h: number | null;
  judgeUnavailableLast24h: number;
  contestsByStatus: Record<string, number>;
  recentSubmissions: Array<{
    id: number;
    username: string;
    language: string;
    problemId: number;
    contestId: number | null;
    status: string;
    executionTimeMs: number | null;
    submittedAt: string | null;
  }>;
  recentFailures: Array<{
    id: number;
    problemId: number;
    contestId: number | null;
    status: string;
    errorMessage: string | null;
    submittedAt: string | null;
  }>;
};

const verdictColor: Record<string, string> = {
  accepted: "text-green-400 border-green-500/30 bg-green-500/10",
  wrong_answer: "text-red-400 border-red-500/30 bg-red-500/10",
  time_limit_exceeded: "text-yellow-400 border-yellow-500/30 bg-yellow-500/10",
  memory_limit_exceeded: "text-yellow-400 border-yellow-500/30 bg-yellow-500/10",
  runtime_error: "text-orange-400 border-orange-500/30 bg-orange-500/10",
  compilation_error: "text-orange-400 border-orange-500/30 bg-orange-500/10",
  presentation_error: "text-purple-400 border-purple-500/30 bg-purple-500/10",
};

export default function ObservabilitySection() {
  const [data, setData] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/metrics", { cache: "no-store" });
      const j = (await res.json().catch(() => null)) as MetricsData & { error?: string } | null;
      if (!res.ok) throw new Error(j?.error ?? `Failed (${res.status})`);
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load metrics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function formatDate(iso: string | null): string {
    if (!iso) return "—";
    try {
      return new Intl.DateTimeFormat("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: "Asia/Kolkata",
      }).format(new Date(iso));
    } catch {
      return iso;
    }
  }

  return (
    <section className="bg-kjsurface border border-kjborder rounded-lg overflow-hidden mt-6">
      <div className="px-5 py-4 border-b border-kjborder flex justify-between items-center flex-wrap gap-3">
        <div>
          <h2 className="font-mono text-sm text-kjtext">Judge Observability & System Health</h2>
          <p className="text-[11px] font-mono text-kjtext-muted mt-0.5">
            24-hour rolling metrics, latency monitoring, and failure tracking
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="border border-kjborder rounded px-3 py-1.5 text-[11px] font-mono text-kjtext-muted hover:text-kjprimary disabled:opacity-50"
        >
          {loading ? "REFRESHING…" : "REFRESH"}
        </button>
      </div>

      {error && (
        <p className="mx-5 mt-4 border border-red-500/20 bg-red-500/10 text-red-400 rounded p-3 text-xs font-mono">
          {error}
        </p>
      )}

      {loading && !data ? (
        <p className="px-5 py-8 text-center text-xs font-mono text-kjtext-muted">Loading metrics…</p>
      ) : data ? (
        <div className="p-5 space-y-6">
          {/* Top 3 KPI stats */}
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="bg-kjbg/40 border border-kjborder rounded-lg p-4">
              <p className="text-[11px] font-mono uppercase tracking-widest text-kjtext-muted">24h Judged</p>
              <p className="text-2xl font-mono text-kjprimary mt-1">{data.judgedLast24h}</p>
              <p className="text-[11px] font-mono text-kjtext-muted mt-1">Total evaluated runs</p>
            </div>
            <div className="bg-kjbg/40 border border-kjborder rounded-lg p-4">
              <p className="text-[11px] font-mono uppercase tracking-widest text-kjtext-muted">Avg Execution Time</p>
              <p className="text-2xl font-mono text-kjtext mt-1">
                {data.avgExecutionMsLast24h !== null ? `${data.avgExecutionMsLast24h} ms` : "—"}
              </p>
              <p className="text-[11px] font-mono text-kjtext-muted mt-1">Average sandbox runtime</p>
            </div>
            <div className="bg-kjbg/40 border border-kjborder rounded-lg p-4">
              <p className="text-[11px] font-mono uppercase tracking-widest text-kjtext-muted">Judge Outages (24h)</p>
              <p
                className={`text-2xl font-mono mt-1 ${
                  data.judgeUnavailableLast24h > 0 ? "text-red-400" : "text-green-400"
                }`}
              >
                {data.judgeUnavailableLast24h}
              </p>
              <p className="text-[11px] font-mono text-kjtext-muted mt-1">
                {data.judgeUnavailableLast24h === 0 ? "Normal operations" : "Service connection errors"}
              </p>
            </div>
          </div>

          {/* 24h Verdict Distribution */}
          <div>
            <h3 className="font-mono text-xs text-kjprimary uppercase tracking-widest mb-3">
              Verdict breakdown (last 24 hours)
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {Object.entries(data.last24hByStatus).length === 0 ? (
                <p className="col-span-full text-xs font-mono text-kjtext-muted py-2">
                  No submissions in the last 24 hours.
                </p>
              ) : (
                Object.entries(data.last24hByStatus).map(([status, count]) => {
                  const style = verdictColor[status] ?? "text-kjtext border-kjborder bg-kjbg/30";
                  return (
                    <div
                      key={status}
                      className={`border rounded px-3 py-2 text-xs font-mono flex justify-between items-center ${style}`}
                    >
                      <span>{status.replace(/_/g, " ")}</span>
                      <span className="font-bold">{count}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Recent Failures & Errors */}
          <div>
            <h3 className="font-mono text-xs text-kjprimary uppercase tracking-widest mb-3">
              Recent judge errors & failures
            </h3>
            {data.recentFailures.length === 0 ? (
              <p className="border border-kjborder/60 bg-kjbg/20 rounded p-4 text-xs font-mono text-green-400">
                ✓ No failures or errors recorded in recent submissions.
              </p>
            ) : (
              <div className="overflow-x-auto border border-kjborder rounded-lg">
                <table className="w-full text-left font-mono text-xs">
                  <thead className="bg-kjbg/60 border-b border-kjborder">
                    <tr>
                      <th className="px-4 py-2.5 text-kjtext-muted uppercase text-[10px] tracking-wider">Sub ID</th>
                      <th className="px-4 py-2.5 text-kjtext-muted uppercase text-[10px] tracking-wider">Problem</th>
                      <th className="px-4 py-2.5 text-kjtext-muted uppercase text-[10px] tracking-wider">Verdict</th>
                      <th className="px-4 py-2.5 text-kjtext-muted uppercase text-[10px] tracking-wider">Error Details</th>
                      <th className="px-4 py-2.5 text-kjtext-muted uppercase text-[10px] tracking-wider">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentFailures.map((f) => (
                      <tr key={f.id} className="border-b border-kjborder/40 hover:bg-kjbg/30">
                        <td className="px-4 py-2.5 text-kjtext font-medium">#{f.id}</td>
                        <td className="px-4 py-2.5 text-kjtext">#{f.problemId}</td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`border rounded px-1.5 py-0.5 text-[10px] uppercase ${
                              verdictColor[f.status] ?? "text-kjtext border-kjborder"
                            }`}
                          >
                            {f.status.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-kjtext-muted max-w-md truncate">
                          {f.errorMessage || "—"}
                        </td>
                        <td className="px-4 py-2.5 text-kjtext-muted">{formatDate(f.submittedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
