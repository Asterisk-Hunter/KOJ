"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import Navigation from "@/app/components/Navigation";

type SubmissionRow = {
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

function statusBadge(status: string) {
  const s = status.toLowerCase();
  if (s === "accepted") return "text-green-400 bg-green-400/10 border-green-400/20";
  if (s === "pending" || s === "running")
    return "text-yellow-400 bg-yellow-400/10 border-yellow-400/20 animate-pulse";
  return "text-red-400 bg-red-400/10 border-red-400/20";
}

function formatStatus(status: string) {
  return status.replaceAll("_", " ").toUpperCase();
}

export default function SubmissionsPage() {
  const { isSignedIn, isLoaded } = useAuth();
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [langFilter, setLangFilter] = useState("all");

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setLoading(false);
      return;
    }

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/submissions", { cache: "no-store" });
        if (!res.ok) {
          const err = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(err?.error ?? `Failed to load (${res.status})`);
        }
        const data = (await res.json()) as SubmissionRow[];
        setSubmissions(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load submissions");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [isSignedIn, isLoaded]);

  const filtered = submissions.filter((s) => {
    if (statusFilter !== "all" && s.status.toLowerCase() !== statusFilter) return false;
    if (langFilter !== "all" && s.language.toLowerCase() !== langFilter) return false;
    return true;
  });

  return (
    <>
      <Navigation />
      <main className="pt-20 min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
            <div>
              <p className="text-xs uppercase tracking-widest font-mono text-kjprimary">Activity log</p>
              <h1 className="text-3xl font-mono font-bold text-kjtext mt-1">My Submissions</h1>
              <p className="text-xs font-mono text-kjtext-muted mt-1">
                Real-time history of all runs and verdicts
              </p>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-kjsurface border border-kjborder rounded px-3 py-1.5 text-xs font-mono text-kjtext focus:border-kjprimary focus:outline-none"
                aria-label="Filter by verdict"
              >
                <option value="all">All Verdicts</option>
                <option value="accepted">Accepted</option>
                <option value="wrong_answer">Wrong Answer</option>
                <option value="time_limit_exceeded">Time Limit Exceeded</option>
                <option value="memory_limit_exceeded">Memory Limit Exceeded</option>
                <option value="runtime_error">Runtime Error</option>
                <option value="compilation_error">Compilation Error</option>
              </select>

              <select
                value={langFilter}
                onChange={(e) => setLangFilter(e.target.value)}
                className="bg-kjsurface border border-kjborder rounded px-3 py-1.5 text-xs font-mono text-kjtext focus:border-kjprimary focus:outline-none"
                aria-label="Filter by language"
              >
                <option value="all">All Languages</option>
                <option value="python">Python</option>
                <option value="c++">C++</option>
                <option value="c">C</option>
                <option value="java">Java</option>
              </select>
            </div>
          </div>

          {/* Body */}
          {!isLoaded || loading ? (
            <div className="bg-kjsurface border border-kjborder rounded-lg p-8 text-sm font-mono text-kjtext-muted">
              Loading submissions…
            </div>
          ) : !isSignedIn ? (
            <div className="bg-kjsurface border border-kjborder rounded-lg p-10 text-center">
              <p className="text-sm font-mono text-kjtext mb-3">Sign in to view your submission history.</p>
              <Link
                href="/sign-in"
                className="inline-block bg-kjprimary text-kjbg font-mono font-bold text-xs px-5 py-2.5 rounded hover:glow-sm"
              >
                SIGN IN →
              </Link>
            </div>
          ) : error ? (
            <div className="bg-kjsurface border border-red-500/30 rounded-lg p-6 text-sm font-mono text-red-400">
              Error: {error}
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-kjsurface border border-kjborder rounded-lg p-12 text-center">
              <p className="text-sm font-mono text-kjtext-muted mb-4">
                {submissions.length === 0
                  ? "You have not submitted any solutions yet."
                  : "No submissions match the selected filters."}
              </p>
              <Link
                href="/problems"
                className="inline-block border border-kjborder text-kjprimary hover:border-kjprimary font-mono text-xs px-4 py-2 rounded transition-colors"
              >
                Explore Problem Archive →
              </Link>
            </div>
          ) : (
            <div className="bg-kjsurface border border-kjborder rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs">
                  <thead className="border-b border-kjborder bg-kjbg/50 text-kjtext-muted uppercase tracking-wider">
                    <tr>
                      <th className="py-3 px-4"># ID</th>
                      <th className="py-3 px-4">Problem</th>
                      <th className="py-3 px-4">Verdict</th>
                      <th className="py-3 px-4">Passed</th>
                      <th className="py-3 px-4">Language</th>
                      <th className="py-3 px-4">Time</th>
                      <th className="py-3 px-4">Memory</th>
                      <th className="py-3 px-4">Submitted</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-kjborder/60">
                    {filtered.map((s) => (
                      <tr key={s.id} className="hover:bg-kjbg/40 transition-colors">
                        <td className="py-3.5 px-4">
                          <Link
                            href={`/submissions/${s.id}`}
                            className="text-kjprimary font-semibold hover:underline"
                          >
                            #{s.id}
                          </Link>
                        </td>
                        <td className="py-3.5 px-4 font-sans font-medium text-kjtext">
                          <Link
                            href={`/problems/${s.problemId}`}
                            className="hover:text-kjprimary transition-colors"
                          >
                            {s.problemTitle}
                          </Link>
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-block border rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${statusBadge(
                              s.status,
                            )}`}
                          >
                            {formatStatus(s.status)}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-kjtext-muted">
                          {s.passedTests !== null && s.totalTests !== null
                            ? `${s.passedTests} / ${s.totalTests}`
                            : "—"}
                        </td>
                        <td className="py-3.5 px-4 uppercase text-kjtext-muted">
                          {s.language}
                        </td>
                        <td className="py-3.5 px-4 text-kjtext-muted">
                          {s.executionTimeMs !== null ? `${s.executionTimeMs} ms` : "—"}
                        </td>
                        <td className="py-3.5 px-4 text-kjtext-muted">
                          {s.memoryUsedMb !== null ? `${s.memoryUsedMb} MB` : "—"}
                        </td>
                        <td className="py-3.5 px-4 text-kjtext-muted whitespace-nowrap">
                          {s.submittedAt
                            ? new Date(s.submittedAt).toLocaleString(undefined, {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
