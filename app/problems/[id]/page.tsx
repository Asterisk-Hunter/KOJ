"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import Navigation from "@/app/components/Navigation";

const starter = `# Write your solution here

def solve():
    pass

if __name__ == "__main__":
    solve()`;

type ProblemResponse = {
  id: number;
  title: string;
  statement: string;
  inputFormat: string;
  outputFormat: string;
  constraints: string;
  explanation: string | null;
  difficulty: "easy" | "medium" | "hard";
  tags: string[];
  timeLimitMs: number;
  memoryMb: number;
  status: string;
  samples: { input: string; expectedOutput: string }[];
  contestId?: number;
};

type VerdictRow = {
  id: number;
  status: string;
  passedTests: number | null;
  totalTests: number | null;
  executionTimeMs: number | null;
  submittedAt: string | null;
};

function statusBadge(status: string) {
  if (status === "accepted") return "text-green-400 bg-green-400/10 border-green-400/20";
  if (status === "pending" || status === "running")
    return "text-yellow-400 bg-yellow-400/10 border-yellow-400/20 animate-pulse";
  return "text-red-400 bg-red-400/10 border-red-400/20";
}

function formatStatus(status: string) {
  return status.replaceAll("_", " ");
}

export default function ProblemDetailPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const { isSignedIn, isLoaded } = useAuth();
  const id = params.id;
  const contestIdParam = searchParams.get("contestId");
  const contestId = contestIdParam ? Number(contestIdParam) : null;

  const [problem, setProblem] = useState<ProblemResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState(starter);
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [verdicts, setVerdicts] = useState<VerdictRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const q = contestId && Number.isInteger(contestId) && contestId > 0 ? `?contestId=${contestId}` : "";
        const res = await fetch(`/api/problems/${id}${q}`, { cache: "no-store" });
        const data = (await res.json()) as unknown;
        if (!res.ok) {
          const msg = (data as { error?: string }).error ?? `Failed to load problem (${res.status})`;
          throw new Error(msg);
        }
        if (!cancelled) setProblem(data as ProblemResponse);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load problem");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (id) load();
    return () => {
      cancelled = true;
    };
  }, [id, contestId]);

  async function loadVerdicts() {
    if (!isLoaded || !isSignedIn) {
      setVerdicts([]);
      return;
    }
    try {
      const q = new URLSearchParams();
      q.set("problemId", String(problem?.id ?? id));
      if (contestId && Number.isInteger(contestId) && contestId > 0) q.set("contestId", String(contestId));
      const res = await fetch(`/api/submissions?${q.toString()}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as VerdictRow[];
      setVerdicts(data);
    } catch {
      // silent
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadVerdicts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problem?.id, isSignedIn, isLoaded, contestId]);

  async function handleSubmit(mode: "run" | "submit") {
    if (!problem) return;
    setSubmitting(true);
    setNotice("");
    try {
      const payload: Record<string, unknown> = {
        problemId: problem.id,
        language: "python",
        code,
        mode,
      };
      if (problem.contestId) payload.contestId = problem.contestId;
      else if (contestId && Number.isInteger(contestId) && contestId > 0) payload.contestId = contestId;

      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        error?: string;
        passedTests?: number;
        totalTests?: number;
        status?: string;
        executionTimeMs?: number | null;
        errorMessage?: string | null;
      };
      if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`);
      const parts: string[] = [];
      if (typeof data.passedTests === "number" && typeof data.totalTests === "number")
        parts.push(`${data.passedTests}/${data.totalTests}`);
      if (data.status) parts.push(formatStatus(String(data.status)));
      if (typeof data.executionTimeMs === "number" && data.executionTimeMs !== null)
        parts.push(`${data.executionTimeMs}ms`);
      const head = mode === "run" ? "Run" : "Submit";
      let msg = `${head}: ${parts.join(" · ")}`;
      if (data.errorMessage) msg += ` — ${data.errorMessage}`;
      setNotice(msg);
      await loadVerdicts();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <>
        <Navigation />
        <main className="pt-20 min-h-screen">
          <div className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="bg-kjsurface/40 border border-kjborder rounded-lg p-8 text-sm font-mono text-kjtext-muted">
              Loading problem…
            </div>
          </div>
        </main>
      </>
    );
  }

  if (error || !problem) {
    return (
      <>
        <Navigation />
        <main className="pt-20 min-h-screen">
          <div className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="bg-kjsurface/40 border border-kjborder rounded-lg p-8">
              <p className="text-sm font-mono text-red-400">{error ?? "Problem not found"}</p>
              <Link
                href="/problems"
                className="inline-block mt-4 text-xs font-mono text-kjprimary hover:underline"
              >
                ← Back to archive
              </Link>
            </div>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Navigation />
      <main className="pt-20 min-h-screen">
        <div className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-6 grid lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.9fr)] gap-6">
          <article className="bg-kjsurface/40 border border-kjborder rounded-lg p-6 lg:p-8">
            <Link href="/problems" className="text-xs font-mono text-kjtext-muted hover:text-kjprimary">
              ← Back to archive
            </Link>
            <div className="flex flex-wrap gap-2 mt-6 mb-3">
              <span className="text-green-400 bg-green-400/10 border border-green-400/20 rounded-full px-2 py-1 text-xs font-mono">
                {problem.difficulty}
              </span>
              <span className="text-kjtext-muted bg-kjbg border border-kjborder rounded-full px-2 py-1 text-xs font-mono">
                {problem.tags[0] ?? problem.difficulty}
              </span>
            </div>
            <h1 className="text-3xl font-mono font-bold text-kjtext mb-8">{problem.title}</h1>
            {[
              ["Problem Statement", problem.statement],
              ["Input Format", problem.inputFormat],
              ["Output Format", problem.outputFormat],
              ["Constraints", problem.constraints],
              ...(problem.explanation ? [["Explanation", problem.explanation] as const] : []),
            ].map(([heading, text]) => (
              <section key={heading} className="mb-7">
                <h2 className="text-xs uppercase tracking-widest font-mono text-kjprimary border-b border-kjborder pb-2 mb-3">
                  {heading}
                </h2>
                <p className="text-sm text-kjtext-muted leading-7">{text}</p>
              </section>
            ))}
            <div className="grid sm:grid-cols-2 gap-3 mb-7">
              {problem.samples.length === 0 ? (
                <pre className="bg-kjbg border border-kjborder rounded p-4 text-xs text-kjtext whitespace-pre-wrap">
                  <span className="text-kjtext-muted">SAMPLE INPUT</span>
                  {"\n\n"}—</pre>
              ) : (
                problem.samples.map((s, idx) => (
                  <div key={idx} className="grid sm:grid-cols-2 gap-3 sm:contents">
                    <pre className="bg-kjbg border border-kjborder rounded p-4 text-xs text-kjtext whitespace-pre-wrap">
                      <span className="text-kjtext-muted">SAMPLE INPUT{problem.samples.length > 1 ? ` #${idx + 1}` : ""}</span>
                      {"\n\n"}
                      {s.input}
                    </pre>
                    <pre className="bg-kjbg border border-kjborder rounded p-4 text-xs text-kjtext whitespace-pre-wrap">
                      <span className="text-kjtext-muted">SAMPLE OUTPUT{problem.samples.length > 1 ? ` #${idx + 1}` : ""}</span>
                      {"\n\n"}
                      {s.expectedOutput}
                    </pre>
                  </div>
                ))
              )}
            </div>
            <div className="flex gap-5 text-xs font-mono text-kjtext-muted">
              <span>TIME {problem.timeLimitMs}ms</span>
              <span>MEMORY {problem.memoryMb}MB</span>
            </div>
          </article>
          <section className="bg-kjsurface/40 border border-kjborder rounded-lg p-4 lg:p-5 h-fit lg:sticky lg:top-20">
            <div className="flex items-center justify-between border-b border-kjborder pb-3 mb-3">
              <p className="text-xs uppercase tracking-widest font-mono text-kjprimary">Submit solution</p>
              <span className="bg-kjbg border border-kjborder rounded px-3 py-2 text-xs font-mono text-kjprimary">Python</span>
            </div>
            <textarea
              value={code}
              onChange={(event) => setCode(event.target.value)}
              spellCheck={false}
              className="w-full min-h-[360px] resize-y bg-kjbg border border-kjborder rounded p-4 text-sm leading-6 font-mono text-kjtext focus:border-kjprimary focus:outline-none"
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => handleSubmit("run")}
                disabled={submitting}
                className="border border-kjborder text-kjtext font-mono text-xs px-4 py-2 rounded hover:border-kjprimary hover:text-kjprimary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? "RUNNING…" : "RUN SAMPLE"}
              </button>
              <button
                onClick={() => handleSubmit("submit")}
                disabled={submitting}
                className="bg-kjprimary text-kjbg font-mono font-bold text-xs px-5 py-2 rounded hover:glow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? "SUBMITTING…" : "SUBMIT"}
              </button>
            </div>
            {notice && (
              <p className="mt-4 border border-kjprimary/20 bg-kjprimary/5 rounded p-3 text-xs font-mono text-kjprimary break-words">
                {notice}
              </p>
            )}
            <div className="mt-7">
              <div className="flex justify-between mb-3">
                <h2 className="text-xs uppercase tracking-widest font-mono text-kjtext-muted">Recent verdicts</h2>
                <Link href="/submissions/1042" className="text-xs font-mono text-kjprimary">
                  view all →
                </Link>
              </div>
              <div className="space-y-2 text-xs font-mono">
                {!isLoaded ? (
                  <p className="text-kjtext-muted">Loading…</p>
                ) : !isSignedIn ? (
                  <p className="text-kjtext-muted">
                    Sign in to see your submissions and run code.
                  </p>
                ) : verdicts.length === 0 ? (
                  <p className="text-kjtext-muted">No submissions yet.</p>
                ) : (
                  verdicts.map((v) => (
                    <p key={v.id} className="flex justify-between border-b border-kjborder/70 pb-2">
                      <span className={`border rounded-full px-2 py-0.5 ${statusBadge(v.status)}`}>
                        {formatStatus(v.status)}
                      </span>
                      <span className="text-kjtext-muted">
                        {v.passedTests !== null && v.totalTests !== null ? `${v.passedTests}/${v.totalTests}` : ""}{" "}
                        {v.executionTimeMs !== null ? `${v.executionTimeMs}ms` : ""}{" "}
                        {v.submittedAt ? new Date(v.submittedAt).toLocaleTimeString() : ""}
                      </span>
                    </p>
                  ))
                )}
              </div>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
