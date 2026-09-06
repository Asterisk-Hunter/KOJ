"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
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

  // polling only while pending/running
  useEffect(() => {
    if (!submission) return;
    if (!PENDING.has(submission.status)) return;
    const interval = setInterval(() => {
      void fetchSubmission();
    }, 2000);
    return () => clearInterval(interval);
  }, [submission, fetchSubmission]);

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
    return (
      <>
        <Navigation />
        <main className="pt-20 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Link href="/problems" className="text-xs font-mono text-kjtext-muted hover:text-kjprimary">
            ← Back to problems
          </Link>
          <div className="mt-6 border border-red-500/30 bg-red-500/10 rounded p-4 text-xs font-mono text-red-400">Error: {error}</div>
        </main>
      </>
    );
  }

  if (!submission) {
    return (
      <>
        <Navigation />
        <main className="pt-20 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <p className="text-xs font-mono text-kjtext-muted">Submission not found.</p>
        </main>
      </>
    );
  }

  return (
    <>
      <Navigation />
      <main className="pt-20 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link href={problem ? `/problems/${problem.id}` : "/problems"} className="text-xs font-mono text-kjtext-muted hover:text-kjprimary">
          ← Return to problem
        </Link>
        <div className="mt-6 flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest font-mono text-kjprimary">Submission monitor</p>
            <h1 className="text-3xl font-mono font-bold text-kjtext mt-2">Submission #{submission.id}</h1>
          </div>
          <span className={`font-mono text-sm ${statusInfo?.color}`}>{statusInfo?.label}</span>
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
            <div className="h-2 rounded bg-kjbg overflow-hidden">
              <div className="h-full bg-kjprimary transition-all duration-700" style={{ width: `${progress}%` }} />
            </div>
          </div>
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

        {PENDING.has(submission.status) && <p className="mt-4 text-xs font-mono text-kjtext-muted">Polling DB every 2s until terminal verdict…</p>}
        {isTerminal && <p className="mt-4 text-xs font-mono text-kjtext-muted">Terminal verdict reached — polling stopped.</p>}
      </main>
    </>
  );
}
