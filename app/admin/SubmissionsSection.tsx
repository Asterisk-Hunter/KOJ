"use client";

/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState } from "react";

type AdminSubmission = {
  id: number;
  userId: string;
  username: string;
  problemId: number;
  problemTitle: string;
  contestId: number | null;
  language: string;
  status: string;
  passedTests: number | null;
  totalTests: number | null;
  executionTimeMs: number | null;
  submittedAt: string;
  completedAt: string | null;
};

const inputCls =
  "bg-kjsurface border border-kjborder rounded px-3 py-2 text-sm font-mono text-kjtext";

const verdictColor: Record<string, string> = {
  accepted: "text-green-400",
  wrong_answer: "text-red-400",
  time_limit_exceeded: "text-yellow-400",
  memory_limit_exceeded: "text-yellow-400",
  runtime_error: "text-orange-400",
  compilation_error: "text-orange-400",
  pending: "text-kjtext-muted",
  running: "text-blue-400",
};

export default function SubmissionsSection() {
  const [subs, setSubs] = useState<AdminSubmission[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [problemIdFilter, setProblemIdFilter] = useState("");
  const [page, setPage] = useState(0);
  const limit = 25;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String(page * limit) });
      if (statusFilter) params.set("status", statusFilter);
      if (problemIdFilter.trim()) params.set("problemId", problemIdFilter.trim());
      const res = await fetch(`/api/admin/submissions?${params.toString()}`, { cache: "no-store" });
      const j = (await res.json().catch(() => null)) as {
        submissions?: AdminSubmission[];
        total?: number;
        error?: string;
      } | null;
      if (!res.ok) throw new Error(j?.error ?? `failed (${res.status})`);
      setSubs(j?.submissions ?? []);
      setTotal(j?.total ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, problemIdFilter, page]);

  useEffect(() => {
    void load();
  }, [load]);

  function formatDate(iso: string): string {
    try {
      return new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Kolkata",
      }).format(new Date(iso));
    } catch {
      return iso;
    }
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <section className="bg-kjsurface border border-kjborder rounded-lg overflow-hidden mt-6">
      <div className="px-5 py-4 border-b border-kjborder flex justify-between items-center flex-wrap gap-3">
        <h2 className="font-mono text-sm text-kjtext">
          Submission history <span className="text-kjtext-muted text-[11px]">({total} total)</span>
        </h2>
        <div className="flex gap-2">
          <input
            value={problemIdFilter}
            onChange={(e) => { setProblemIdFilter(e.target.value); setPage(0); }}
            placeholder="Problem ID"
            className={`${inputCls} w-28`}
            inputMode="numeric"
          />
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
            className={inputCls}
            aria-label="Filter by verdict"
          >
            <option value="">all verdicts</option>
            <option value="accepted">accepted</option>
            <option value="wrong_answer">wrong_answer</option>
            <option value="time_limit_exceeded">TLE</option>
            <option value="runtime_error">runtime_error</option>
            <option value="compilation_error">CE</option>
            <option value="pending">pending</option>
            <option value="running">running</option>
          </select>
        </div>
      </div>

      {error && (
        <p className="mx-5 mt-4 border border-red-500/20 bg-red-500/10 text-red-400 rounded p-3 text-xs font-mono">
          {error}
        </p>
      )}

      {loading ? (
        <p className="px-5 py-8 text-center text-xs font-mono text-kjtext-muted">Loading submissions…</p>
      ) : subs.length === 0 ? (
        <p className="px-5 py-8 text-center text-xs font-mono text-kjtext-muted">No submissions found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {["#", "User", "Problem", "Verdict", "Tests", "Time", "Submitted"].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-[11px] uppercase tracking-widest font-mono text-kjtext-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.id} className="border-t border-kjborder/70">
                  <td className="px-4 py-3 font-mono text-xs text-kjtext-muted">{s.id}</td>
                  <td className="px-4 py-3 font-mono text-sm text-kjtext">{s.username}</td>
                  <td className="px-4 py-3 text-sm text-kjtext truncate max-w-[200px]" title={s.problemTitle}>
                    {s.problemTitle}
                    {s.contestId ? <span className="ml-1 text-[10px] text-kjtext-muted">[C{s.contestId}]</span> : null}
                  </td>
                  <td className={`px-4 py-3 font-mono text-xs ${verdictColor[s.status] ?? "text-kjtext-muted"}`}>
                    {s.status}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-kjtext-muted">
                    {s.passedTests !== null ? `${s.passedTests}/${s.totalTests}` : "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-kjtext-muted">
                    {s.executionTimeMs !== null ? `${s.executionTimeMs}ms` : "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-kjtext-muted">{formatDate(s.submittedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="px-5 py-3 border-t border-kjborder flex justify-between items-center">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="border border-kjborder rounded px-3 py-1.5 text-[11px] font-mono text-kjtext-muted hover:text-kjtext disabled:opacity-50"
          >
            ← prev
          </button>
          <span className="text-[11px] font-mono text-kjtext-muted">
            page {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="border border-kjborder rounded px-3 py-1.5 text-[11px] font-mono text-kjtext-muted hover:text-kjtext disabled:opacity-50"
          >
            next →
          </button>
        </div>
      )}
    </section>
  );
}
