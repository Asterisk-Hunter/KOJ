"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import Link from "next/link";
import { useParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useState } from "react";
import Navigation from "@/app/components/Navigation";

type SubmissionDetail = {
  id: number;
  userId: string;
  problemId: number;
  contestId: number | null;
  language: string;
  code: string;
  status: string;
  executionTimeMs: number | null;
  memoryUsedMb: number | null;
  passedTests: number | null;
  totalTests: number | null;
  errorMessage: string | null;
  caseResults: Array<{
    index: number;
    passed: boolean;
    verdict: string;
    runtime_ms: number;
    stdout: string;
    stderr: string;
  }> | null;
  submittedAt: string | null;
  completedAt: string | null;
  startedAt: string | null;
};

type ProblemBrief = {
  id: number;
  title: string;
};

const TERMINAL = new Set(["accepted", "wrong_answer", "time_limit_exceeded", "memory_limit_exceeded", "runtime_error", "compilation_error"]);
const PENDING = new Set(["pending", "running"]);

function formatStatus(status: string): { label: string; color: string } {
  const s = status.toLowerCase();
  if (s === "accepted") return { label: "✓ ACCEPTED", color: "text-green-400" };
  if (s === "pending") return { label: "◌ PENDING", color: "text-yellow-400" };
  if (s === "running") return { label: "◌ RUNNING", color: "text-yellow-400" };
  if (s === "wrong_answer") return { label: "✗ WRONG ANSWER", color: "text-red-400" };
  if (s === "time_limit_exceeded") return { label: "✗ TLE", color: "text-red-400" };
  if (s === "memory_limit_exceeded") return { label: "✗ MLE", color: "text-red-400" };
  if (s === "runtime_error") return { label: "✗ RUNTIME ERROR", color: "text-red-400" };
  if (s === "compilation_error") return { label: "✗ COMPILATION ERROR", color: "text-red-400" };
  return { label: s.toUpperCase(), color: "text-kjtext-muted" };
}

export default function SubmissionStatusPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [submission, setSubmission] = useState<SubmissionDetail | null>(null);
  const [problem, setProblem] = useState<ProblemBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedTests, setExpandedTests] = useState<Set<number>>(new Set());

  const fetchSubmission = useCallback(async () => {
    if (!id) return;
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) {
      setError("invalid submission id");
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/submissions/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          setError("__AUTH_REQUIRED__");
          setLoading(false);
          return;
        }
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `failed (${res.status})`);
      }
      const json = (await res.json()) as SubmissionDetail;
      setSubmission(json);
      setError(null);
      // fetch problem title
      if (json.problemId) {
        try {
          const pr = await fetch(`/api/problems/${json.problemId}`, { cache: "no-store" });
          if (pr.ok) {
            const pj = (await pr.json()) as { title?: string; id?: number };
            if (pj.title) setProblem({ id: pj.id ?? json.problemId, title: pj.title });
          }
        } catch {
          // ignore
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchSubmission();
  }, [fetchSubmission]);

  // Subscribe to SSE for real-time verdict delivery (REQ-JUDGE-12)
  const sseSubId = submission?.id;
  const sseSubStatus = submission?.status;
  useEffect(() => {
    if (sseSubId === undefined || sseSubStatus === undefined) return;
    if (!PENDING.has(sseSubStatus)) return;

    const es = new EventSource(`/api/submissions/${sseSubId}/events`);
    es.addEventListener("status", (ev) => {
      try {
        const data = JSON.parse(ev.data) as Partial<SubmissionDetail>;
        setSubmission((prev) => prev ? { ...prev, ...data } : prev);
      } catch { /* ignore */ }
    });
    es.addEventListener("done", (ev) => {
      es.close();
      try {
        const data = JSON.parse(ev.data) as Partial<SubmissionDetail>;
        setSubmission((prev) => prev ? { ...prev, ...data } : prev);
      } catch { /* ignore */ }
    });
    es.addEventListener("error", () => {
      es.close();
      // Fallback: refetch once on SSE failure
      void fetchSubmission();
    });
    return () => es.close();
  }, [sseSubId, sseSubStatus, fetchSubmission]);

  const statusInfo = submission ? formatStatus(submission.status) : null;
  const submittedLabel = submission?.submittedAt ? new Date(submission.submittedAt).toLocaleString() : "--";
  const completedLabel = submission?.completedAt ? new Date(submission.completedAt).toLocaleString() : "--";
  const progress =
    !submission
      ? 0
      : submission.status === "pending"
        ? 0
        : submission.status === "running"
          ? 58
          : TERMINAL.has(submission.status)
            ? 100
            : 100;
  const isTerminal = submission ? TERMINAL.has(submission.status) : false;

  if (loading) {
    return (
      <>
        <Navigation />
        <main className="pt-20 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <p className="text-xs font-mono text-kjtext-muted">Loading submission #{id} from DB…</p>
        </main>
      </>
    );
  }

  if (error) {
    if (error === "__AUTH_REQUIRED__") {
      return (
        <>
          <Navigation />
          <main className="pt-20 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <Link href="/problems" className="text-xs font-mono text-kjtext-muted hover:text-kjprimary">
              ← Back to problems
            </Link>
            <div className="mt-8 bg-kjsurface border border-kjborder rounded-lg p-10 text-center max-w-md mx-auto">
              <p className="text-sm font-mono text-kjtext mb-2">Sign in required</p>
              <p className="text-xs font-mono text-kjtext-muted mb-5">
                You need to be signed in to view this submission. This submission may belong to another user.
              </p>
              <Link
                href="/sign-in"
                className="inline-block bg-kjprimary text-kjbg font-mono font-bold text-xs px-6 py-2.5 rounded hover:glow-sm transition-all"
              >
                SIGN IN →
              </Link>
            </div>
          </main>
        </>
      );
    }
    return (
      <>
        <Navigation />
        <main className="pt-20 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Link href="/problems" className="text-xs font-mono text-kjtext-muted hover:text-kjprimary">
            ← Back to problems
          </Link>
          <div className="mt-6 border border-red-500/30 bg-red-500/10 rounded p-4 text-xs font-mono text-red-400">
            {error}
          </div>
        </main>
      </>
    );
  }

  if (!submission) {
    return (
      <>
        <Navigation />
        <main className="pt-20 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Link href="/problems" className="text-xs font-mono text-kjtext-muted hover:text-kjprimary">
            ← Back to problems
          </Link>
          <div className="mt-8 bg-kjsurface border border-kjborder rounded-lg p-10 text-center max-w-md mx-auto">
            <p className="text-sm font-mono text-kjtext mb-2">Submission not found</p>
            <p className="text-xs font-mono text-kjtext-muted mb-5">
              This submission may have been deleted or the ID is invalid.
            </p>
            <Link
              href="/submissions"
              className="inline-block border border-kjborder text-kjprimary hover:border-kjprimary font-mono text-xs px-4 py-2 rounded transition-colors"
            >
              View my submissions →
            </Link>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Navigation />
      <main className="pt-20 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link
          href={problem ? `/problems/${problem.id}${submission.contestId ? `?contestId=${submission.contestId}` : ""}` : "/problems"}
          className="text-xs font-mono text-kjtext-muted hover:text-kjprimary"
        >
          ← Return to problem
        </Link>
        <div className="mt-6 flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest font-mono text-kjprimary">Submission monitor</p>
            <h1 className="text-3xl font-mono font-bold text-kjtext mt-2">Submission #{submission.id}</h1>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className={`font-mono text-sm font-bold ${statusInfo?.color}`}>{statusInfo?.label}</span>
            {submission.contestId && (
              <Link
                href={`/rankings?contestId=${submission.contestId}`}
                className="text-xs font-mono text-kjprimary hover:underline"
              >
                View contest standings →
              </Link>
            )}
          </div>
        </div>

        <section className="mt-8 bg-kjsurface border border-kjborder rounded-lg p-6">
          <div className="grid sm:grid-cols-4 gap-5 text-xs font-mono">
            <div>
              <p className="text-kjtext-muted">PROBLEM</p>
              <p className="text-kjtext mt-2">{problem ? problem.title : `#${submission.problemId}`}</p>
            </div>
            <div>
              <p className="text-kjtext-muted">LANGUAGE</p>
              <p className="text-kjtext mt-2">{submission.language}</p>
            </div>
            <div>
              <p className="text-kjtext-muted">SUBMITTED</p>
              <p className="text-kjtext mt-2">{submittedLabel}</p>
            </div>
            <div>
              <p className="text-kjtext-muted">VERDICT</p>
              <p className={`mt-2 ${statusInfo?.color}`}>{submission.status}</p>
            </div>
          </div>

          {submission.caseResults && submission.caseResults.length > 0 ? (
            <div className="mt-8">
              <div className="flex justify-between text-xs font-mono text-kjtext-muted mb-3">
                <span>TEST CASE RESULTS</span>
                <span>
                  {submission.passedTests !== null && submission.totalTests !== null
                    ? `${submission.passedTests} / ${submission.totalTests}`
                    : `${submission.caseResults.filter((c) => c.passed).length} / ${submission.caseResults.length}`}
                </span>
              </div>
              <div className="border border-kjborder rounded-lg overflow-hidden">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="bg-kjbg border-b border-kjborder text-kjtext-muted">
                      <th className="text-left py-2.5 px-4 uppercase tracking-wider">Test #</th>
                      <th className="text-left py-2.5 px-4 uppercase tracking-wider">Result</th>
                      <th className="text-right py-2.5 px-4 uppercase tracking-wider">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {submission.caseResults.map((tc) => (
                      <Fragment key={tc.index}>
                        <tr
                          className={`border-b border-kjborder/50 ${
                            !tc.passed ? "cursor-pointer hover:bg-kjbg/60" : ""
                          }`}
                          onClick={
                            !tc.passed
                              ? () =>
                                  setExpandedTests((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(tc.index)) next.delete(tc.index);
                                    else next.add(tc.index);
                                    return next;
                                  })
                              : undefined
                          }
                        >
                          <td className="py-2 px-4 text-kjtext tabular-nums">{tc.index + 1}</td>
                          <td className="py-2 px-4">
                            <span
                              className={
                                tc.passed
                                  ? "text-green-400"
                                  : tc.verdict === "time_limit_exceeded"
                                    ? "text-yellow-400"
                                    : "text-red-400"
                              }
                            >
                              {tc.passed ? "✓ PASS" : `✗ ${tc.verdict.replace(/_/g, " ").toUpperCase()}`}
                            </span>
                          </td>
                          <td className="py-2 px-4 text-right text-kjtext-muted tabular-nums">
                            {tc.runtime_ms != null ? `${tc.runtime_ms} ms` : "--"}
                          </td>
                        </tr>
                        {!tc.passed && expandedTests.has(tc.index) && (
                          <tr>
                            <td colSpan={3} className="bg-kjbg px-4 py-3 border-b border-kjborder/50">
                              <p className="text-[10px] uppercase tracking-wider text-kjtext-muted mb-1.5">
                                stdout
                              </p>
                              <pre className="text-xs font-mono text-kjtext whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                                {tc.stdout || "(no output)"}
                              </pre>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="mt-10">
              <div className="flex justify-between text-xs font-mono text-kjtext-muted mb-2">
                <span>TEST CASE PROGRESS</span>
                <span>
                  {submission.passedTests !== null && submission.totalTests !== null
                    ? `${submission.passedTests} / ${submission.totalTests}`
                    : PENDING.has(submission.status)
                      ? "queued"
                      : "--"}
                </span>
              </div>
              <div className="h-2.5 rounded bg-kjbg overflow-hidden">
                <div
                  className={`h-full transition-all duration-700 rounded ${
                    submission.status === "accepted"
                      ? "bg-gradient-to-r from-green-500 to-green-400"
                      : TERMINAL.has(submission.status) && submission.status !== "accepted"
                        ? "bg-gradient-to-r from-red-500 to-red-400"
                        : "bg-kjprimary"
                  }`}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}
        </section>

        <div className="grid sm:grid-cols-3 gap-4 mt-4">
          <div className="bg-kjsurface border border-kjborder rounded-lg p-5">
            <p className="text-xs font-mono text-kjtext-muted">RUNTIME</p>
            <p className="text-2xl font-mono text-kjtext mt-2">
              {submission.executionTimeMs !== null ? `${(submission.executionTimeMs / 1000).toFixed(2)} s` : "--"}
            </p>
          </div>
          <div className="bg-kjsurface border border-kjborder rounded-lg p-5">
            <p className="text-xs font-mono text-kjtext-muted">MEMORY</p>
            <p className="text-2xl font-mono text-kjtext mt-2">{submission.memoryUsedMb !== null ? `${submission.memoryUsedMb} MB` : "--"}</p>
          </div>
          <div className="bg-kjsurface border border-kjborder rounded-lg p-5">
            <p className="text-xs font-mono text-kjtext-muted">QUEUE STATE</p>
            <p className={`text-2xl font-mono mt-2 ${statusInfo?.color}`}>{submission.status}</p>
          </div>
        </div>

        {submission.errorMessage && (
          <div className="mt-4 bg-kjsurface border border-red-500/20 rounded-lg p-4">
            <p className="text-xs font-mono text-red-400">ERROR</p>
            <pre className="mt-2 text-xs font-mono text-kjtext whitespace-pre-wrap break-words">{submission.errorMessage}</pre>
          </div>
        )}

        <div className="mt-6 grid sm:grid-cols-2 gap-4 text-xs font-mono text-kjtext-muted">
          <div className="bg-kjsurface border border-kjborder rounded-lg p-4">
            <p>STARTED</p>
            <p className="text-kjtext mt-1">{submission.startedAt ? new Date(submission.startedAt).toLocaleString() : "--"}</p>
          </div>
          <div className="bg-kjsurface border border-kjborder rounded-lg p-4">
            <p>COMPLETED</p>
            <p className="text-kjtext mt-1">{completedLabel}</p>
          </div>
        </div>

        <section className="mt-6 bg-kjsurface border border-kjborder rounded-lg p-5">
          <p className="text-xs font-mono text-kjtext-muted">CODE</p>
          <pre className="mt-3 bg-kjbg border border-kjborder rounded p-4 text-xs font-mono text-kjtext overflow-x-auto whitespace-pre-wrap break-words">
            {submission.code}
          </pre>
        </section>

        {PENDING.has(submission.status) && (
          <div className="mt-4 flex items-center gap-2 text-xs font-mono text-kjtext-muted">
            <span className="inline-block w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
            Live update via SSE — waiting for verdict…
          </div>
        )}
        {isTerminal && (
          <div className="mt-4 flex items-center gap-2 text-xs font-mono text-kjtext-muted">
            <span className={`inline-block w-2 h-2 rounded-full ${submission.status === "accepted" ? "bg-green-400" : "bg-red-400"}`} />
            Terminal verdict reached.
          </div>
        )}
      </main>
    </>
  );
}
