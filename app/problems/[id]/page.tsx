"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import Markdown from "react-markdown";
import Navigation from "@/app/components/Navigation";

const STARTERS: Record<string, string> = {
  python: `# Write your solution here

def solve():
    pass

if __name__ == "__main__":
    solve()`,
  "c++": `#include <iostream>
using namespace std;

int main() {
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);
    // Write your solution here
    return 0;
}`,
  c: `#include <stdio.h>

int main() {
    // Write your solution here
    return 0;
}`,
  java: `import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        // Write your solution here
    }
}`,
};

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
  const [codeByLang, setCodeByLang] = useState<Record<string, string>>(STARTERS);
  const [language, setLanguage] = useState("python");
  const [copiedSample, setCopiedSample] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [verdicts, setVerdicts] = useState<VerdictRow[]>([]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

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
      const currentCode = codeByLang[language] ?? STARTERS[language] ?? "";
      const payload: Record<string, unknown> = {
        problemId: problem.id,
        language,
        code: currentCode,
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
        id?: number;
        error?: string;
        passedTests?: number;
        totalTests?: number;
        status?: string;
        executionTimeMs?: number | null;
        errorMessage?: string | null;
      };
      if (!res.ok) {
        if (res.status === 429) {
          const retryHeader = res.headers.get("Retry-After");
          const retrySec = retryHeader ? parseInt(retryHeader, 10) : 30;
          setCooldown(Number.isFinite(retrySec) && retrySec > 0 ? retrySec : 30);
        }
        throw new Error(data.error ?? `Failed (${res.status})`);
      }
      if (mode === "submit") {
        setCooldown(30);
      }

      // If we got a submission ID back (async judge flow), subscribe to SSE
      // for real-time verdict delivery (REQ-JUDGE-12).
      if (data.id && (data.status === "running" || data.status === "pending")) {
        const head = mode === "run" ? "Run" : "Submit";
        setNotice(`${head}: judging…`);

        const es = new EventSource(`/api/submissions/${data.id}/events`);
        es.addEventListener("status", (ev) => {
          try {
            const update = JSON.parse(ev.data) as { status: string };
            setNotice(`${head}: ${formatStatus(update.status)}…`);
          } catch { /* ignore malformed events */ }
        });
        es.addEventListener("done", (ev) => {
          es.close();
          try {
            const result = JSON.parse(ev.data) as {
              status: string;
              passedTests: number | null;
              totalTests: number | null;
              executionTimeMs: number | null;
              errorMessage: string | null;
            };
            const parts: string[] = [];
            if (result.passedTests !== null && result.totalTests !== null)
              parts.push(`${result.passedTests}/${result.totalTests}`);
            parts.push(formatStatus(result.status));
            if (result.executionTimeMs !== null)
              parts.push(`${result.executionTimeMs}ms`);
            let msg = `${head}: ${parts.join(" · ")}`;
            if (result.errorMessage) msg += ` — ${result.errorMessage}`;
            setNotice(msg);
          } catch { /* ignore */ }
          setSubmitting(false);
          void loadVerdicts();
        });
        es.addEventListener("error", () => {
          es.close();
          setNotice(`${head}: verdict pending — refresh to check`);
          setSubmitting(false);
          void loadVerdicts();
        });
        // Don't setSubmitting(false) here — the SSE handlers will do it
        return;
      }

      // Fallback for synchronous judge response (legacy /judge path)
      const parts: string[] = [];
      if (typeof data.passedTests === "number" && typeof data.totalTests === "number")
        parts.push(`${data.passedTests}/${data.totalTests}`);
      if (data.status) parts.push(formatStatus(data.status));
      if (typeof data.executionTimeMs === "number")
        parts.push(`${data.executionTimeMs}ms`);
      const head = mode === "run" ? "Run" : "Submit";
      let msg = `${head}: ${parts.join(" · ")}`;
      if (data.errorMessage) msg += ` — ${data.errorMessage}`;
      setNotice(msg);
      void loadVerdicts();
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
        <main className="max-w-6xl mx-auto px-4 py-20 font-mono text-xs text-kjtext-muted">
          Loading problem #{id}…
        </main>
      </>
    );
  }

  if (error || !problem) {
    return (
      <>
        <Navigation />
        <main className="max-w-6xl mx-auto px-4 py-20">
          <p className="font-mono text-sm text-red-400">{error ?? "Problem not found"}</p>
          <Link href="/problems" className="inline-block mt-4 text-xs font-mono text-kjprimary hover:underline">
            ← Return to problem list
          </Link>
        </main>
      </>
    );
  }

  return (
    <>
      <Navigation />
      <main className="pt-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-4">
          <Link
            href={contestId ? `/contests/${contestId}/arena` : "/problems"}
            className="text-xs font-mono text-kjtext-muted hover:text-kjprimary"
          >
            ← {contestId ? "Return to contest arena" : "Browse all problems"}
          </Link>
        </div>
        <div className="grid lg:grid-cols-[1.08fr_0.92fr] gap-8 items-start">
          <article className="space-y-6">
            <div>
              <div className="flex items-center gap-3">
                <span className="text-xs uppercase tracking-widest font-mono text-kjprimary">Problem #{problem.id}</span>
                <span className={`text-[11px] font-mono border rounded-full px-2 py-0.5 ${
                  problem.difficulty === "easy"
                    ? "text-green-400 border-green-400/20"
                    : problem.difficulty === "medium"
                      ? "text-yellow-400 border-yellow-400/20"
                      : "text-red-400 border-red-400/20"
                }`}>
                  {problem.difficulty}
                </span>
                {problem.tags?.map((t) => (
                  <span key={t} className="text-[11px] font-mono border border-kjborder rounded px-1.5 text-kjtext-muted">
                    {t}
                  </span>
                ))}
              </div>
              <h1 className="text-2xl sm:text-3xl font-mono font-bold text-kjtext mt-2">{problem.title}</h1>
            </div>
            <div className="prose prose-invert max-w-none text-sm leading-6 text-kjtext font-sans">
              <Markdown>{problem.statement}</Markdown>
            </div>
            <div>
              <h2 className="text-xs uppercase tracking-widest font-mono text-kjtext-muted mb-2">Input format</h2>
              <pre className="bg-kjsurface border border-kjborder rounded p-4 text-xs font-mono text-kjtext whitespace-pre-wrap">
                {problem.inputFormat}
              </pre>
            </div>
            <div>
              <h2 className="text-xs uppercase tracking-widest font-mono text-kjtext-muted mb-2">Output format</h2>
              <pre className="bg-kjsurface border border-kjborder rounded p-4 text-xs font-mono text-kjtext whitespace-pre-wrap">
                {problem.outputFormat}
              </pre>
            </div>
            <div>
              <h2 className="text-xs uppercase tracking-widest font-mono text-kjtext-muted mb-2">Constraints</h2>
              <pre className="bg-kjsurface border border-kjborder rounded p-4 text-xs font-mono text-kjtext whitespace-pre-wrap">
                {problem.constraints}
              </pre>
            </div>
            {problem.explanation && (
              <div>
                <h2 className="text-xs uppercase tracking-widest font-mono text-kjtext-muted mb-2">Explanation</h2>
                <div className="bg-kjsurface border border-kjborder rounded p-4 text-xs font-mono text-kjtext whitespace-pre-wrap">
                  {problem.explanation}
                </div>
              </div>
            )}
            <div className="space-y-4">
              <h2 className="text-xs uppercase tracking-widest font-mono text-kjtext-muted">Sample cases</h2>
              {problem.samples.length === 0 ? (
                <p className="text-xs font-mono text-kjtext-muted">No public sample test cases configured.</p>
              ) : (
                problem.samples.map((s, idx) => (
                  <div key={idx} className="grid sm:grid-cols-2 gap-3 font-mono">
                    <pre className="bg-kjbg border border-kjborder rounded p-4 text-xs text-kjtext whitespace-pre-wrap">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-kjtext-muted">SAMPLE INPUT{problem.samples.length > 1 ? ` #${idx + 1}` : ""}</span>
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard.writeText(s.input);
                            setCopiedSample(`in-${idx}`);
                            setTimeout(() => setCopiedSample(null), 1500);
                          }}
                          className="text-[10px] uppercase font-mono text-kjprimary hover:underline cursor-pointer"
                        >
                          {copiedSample === `in-${idx}` ? "Copied!" : "Copy"}
                        </button>
                      </div>
                      {s.input}
                    </pre>
                    <pre className="bg-kjbg border border-kjborder rounded p-4 text-xs text-kjtext whitespace-pre-wrap">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-kjtext-muted">SAMPLE OUTPUT{problem.samples.length > 1 ? ` #${idx + 1}` : ""}</span>
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard.writeText(s.expectedOutput);
                            setCopiedSample(`out-${idx}`);
                            setTimeout(() => setCopiedSample(null), 1500);
                          }}
                          className="text-[10px] uppercase font-mono text-kjprimary hover:underline cursor-pointer"
                        >
                          {copiedSample === `out-${idx}` ? "Copied!" : "Copy"}
                        </button>
                      </div>
                      {s.expectedOutput}
                    </pre>
                  </div>
                ))
              )}
            </div>
          </article>
          <section className="bg-kjsurface/40 border border-kjborder rounded-lg p-4 lg:p-5 h-fit lg:sticky lg:top-20">
            <div className="flex items-center justify-between border-b border-kjborder pb-3 mb-3">
              <p className="text-xs uppercase tracking-widest font-mono text-kjprimary">Submit solution</p>
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                className="bg-kjbg border border-kjborder rounded px-3 py-2 text-xs font-mono text-kjprimary"
                aria-label="Select language"
              >
                <option value="python">Python</option>
                <option value="c">C</option>
                <option value="c++">C++</option>
                <option value="java">Java</option>
              </select>
            </div>
            <textarea
              value={codeByLang[language] ?? STARTERS[language] ?? ""}
              onChange={(event) => {
                const val = event.target.value;
                setCodeByLang((prev) => ({ ...prev, [language]: val }));
              }}
              spellCheck={false}
              className="w-full min-h-[360px] resize-y bg-kjbg border border-kjborder rounded p-4 text-sm leading-6 font-mono text-kjtext focus:border-kjprimary focus:outline-none"
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => handleSubmit("run")}
                disabled={submitting}
                className="border border-kjborder text-kjtext font-mono text-xs px-4 py-2 rounded hover:border-kjprimary hover:text-kjprimary disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {submitting ? "RUNNING…" : "RUN SAMPLE"}
              </button>
              <button
                onClick={() => handleSubmit("submit")}
                disabled={submitting || cooldown > 0}
                className="bg-kjprimary text-kjbg font-mono font-bold text-xs px-5 py-2 rounded hover:glow-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {submitting ? "SUBMITTING…" : cooldown > 0 ? `WAIT ${cooldown}s` : "SUBMIT"}
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
                <Link href={`/submissions?problemId=${problem.id}`} className="text-xs font-mono text-kjprimary hover:underline">
                  view all →
                </Link>
              </div>
              <div className="space-y-1 text-xs font-mono">
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
                    <Link
                      key={v.id}
                      href={`/submissions/${v.id}`}
                      className="flex justify-between items-center border-b border-kjborder/50 py-1.5 px-2 rounded hover:bg-kjbg/60 transition-colors group"
                    >
                      <div className="flex items-center gap-2">
                        <span className={`border rounded-full px-2 py-0.5 text-[11px] ${statusBadge(v.status)}`}>
                          {formatStatus(v.status)}
                        </span>
                        <span className="text-[10px] text-kjtext-muted group-hover:text-kjprimary transition-colors">
                          #{v.id}
                        </span>
                      </div>
                      <span className="text-kjtext-muted text-[11px]">
                        {v.passedTests !== null && v.totalTests !== null ? `${v.passedTests}/${v.totalTests}` : ""}{" "}
                        {v.executionTimeMs !== null ? `${v.executionTimeMs}ms` : ""}{" "}
                        {v.submittedAt ? new Date(v.submittedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                      </span>
                    </Link>
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
