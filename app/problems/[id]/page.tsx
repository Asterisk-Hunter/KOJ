"use client";

/* eslint-disable react-hooks/set-state-in-effect */
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import Markdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import Navigation from "@/app/components/Navigation";

const STARTERS: Record<string, string> = {
  python: `# Codeforces / ICPC Python 3 Template
import sys

def solve():
    # Read all tokens for fast I/O
    input_data = sys.stdin.read().split()
    if not input_data:
        return
    # Write your solution here
    pass

if __name__ == "__main__":
    solve()`,
  "c++": `// Codeforces / ICPC C++ Template
#include <bits/stdc++.h>
using namespace std;

void solve() {
    // Write your solution here
}

int main() {
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);
    solve();
    return 0;
}`,
  c: `// Standard C Template
#include <stdio.h>
#include <stdlib.h>

int main() {
    // Write your solution here
    return 0;
}`,
  java: `// Codeforces / ICPC Java Template
import java.io.*;
import java.util.*;

public class Main {
    public static void main(String[] args) throws Exception {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
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
  language?: string;
  passedTests: number | null;
  totalTests: number | null;
  executionTimeMs: number | null;
  memoryUsedMb?: number | null;
  submittedAt: string | null;
};

type InteractiveCaseResult = {
  index: number;
  passed: boolean;
  verdict: string;
  runtimeMs: number;
  stdout: string;
  stderr: string;
  stdin: string;
  expectedOutput: string;
};

type CustomRunResult = {
  status: string;
  stdout: string;
  stderr: string;
  executionTimeMs: number;
  memoryUsedMb: number;
  errorMessage: string | null;
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
  const [copiedCode, setCopiedCode] = useState(false);
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [runningSamples, setRunningSamples] = useState(false);
  const [runningCustom, setRunningCustom] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [verdicts, setVerdicts] = useState<VerdictRow[]>([]);

  // Left panel mode: "statement" | "editorial" | "submissions"
  const [leftTab, setLeftTab] = useState<"statement" | "editorial" | "submissions">("statement");
  const gutterRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Workspace tab: "samples" | "custom" | "submissions"
  const [activeTab, setActiveTab] = useState<"samples" | "custom" | "submissions">("samples");
  const [activeSampleIndex, setActiveSampleIndex] = useState(0);
  const [customInput, setCustomInput] = useState("");
  const [customExpected, setCustomExpected] = useState("");
  const [customResult, setCustomResult] = useState<CustomRunResult | null>(null);
  const [sampleResults, setSampleResults] = useState<InteractiveCaseResult[]>([]);

  const currentCode = codeByLang[language] ?? STARTERS[language] ?? "";
  const lineCount = Math.max(1, currentCode.split("\n").length);
  const lineNumbers = useMemo(() => Array.from({ length: lineCount }, (_, i) => i + 1), [lineCount]);

  function handleEditorScroll(e: React.UIEvent<HTMLTextAreaElement>) {
    if (gutterRef.current) {
      gutterRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  }

  const activeEsRef = useRef<EventSource | null>(null);

  useEffect(() => {
    return () => {
      if (activeEsRef.current) {
        activeEsRef.current.close();
        activeEsRef.current = null;
      }
    };
  }, []);

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
        if (!cancelled) {
          const prob = data as ProblemResponse;
          setProblem(prob);
          if (prob.samples.length > 0) {
            setCustomInput((prev) => (!prev ? prob.samples[0].input : prev));
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load problem");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (id) void load();
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
    void loadVerdicts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problem?.id, isSignedIn, isLoaded, contestId]);

  // Codeforces Custom Test Runner
  async function handleRunCustom() {
    if (!problem) return;
    if (!isLoaded || !isSignedIn) {
      setNotice("Please sign in to test your code.");
      return;
    }
    setRunningCustom(true);
    setNotice("");
    setCustomResult(null);
    try {
      const currentCode = codeByLang[language] ?? STARTERS[language] ?? "";
      const res = await fetch("/api/judge/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language,
          code: currentCode,
          input: customInput,
          expectedOutput: customExpected,
          timeLimitMs: problem.timeLimitMs,
          memoryMb: problem.memoryMb,
        }),
      });
      const data = (await res.json()) as {
        status?: string;
        cases?: InteractiveCaseResult[];
        executionTimeMs?: number;
        memoryUsedMb?: number;
        errorMessage?: string | null;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? `Run failed (${res.status})`);
      }
      const firstCase = data.cases?.[0];
      setCustomResult({
        status: data.status ?? "finished",
        stdout: firstCase?.stdout ?? "",
        stderr: firstCase?.stderr ?? "",
        executionTimeMs: data.executionTimeMs ?? firstCase?.runtimeMs ?? 0,
        memoryUsedMb: data.memoryUsedMb ?? 0,
        errorMessage: data.errorMessage ?? null,
      });
      setNotice(`Custom Run: ${formatStatus(data.status ?? "finished")} · ${data.executionTimeMs ?? 0}ms`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Run failed");
    } finally {
      setRunningCustom(false);
    }
  }

  // Interactive Sample Cases Runner
  async function handleRunSamples() {
    if (!problem || problem.samples.length === 0) {
      setNotice("No sample cases available to run.");
      return;
    }
    if (!isLoaded || !isSignedIn) {
      setNotice("Please sign in to run sample test cases.");
      return;
    }
    setRunningSamples(true);
    setNotice("Running against sample test cases…");
    setActiveTab("samples");
    try {
      const currentCode = codeByLang[language] ?? STARTERS[language] ?? "";
      const res = await fetch("/api/judge/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language,
          code: currentCode,
          cases: problem.samples.map((s) => ({ stdin: s.input, expectedOutput: s.expectedOutput })),
          timeLimitMs: problem.timeLimitMs,
          memoryMb: problem.memoryMb,
        }),
      });
      const data = (await res.json()) as {
        status?: string;
        passedTests?: number;
        totalTests?: number;
        executionTimeMs?: number;
        cases?: InteractiveCaseResult[];
        errorMessage?: string | null;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? `Sample run failed (${res.status})`);
      }
      setSampleResults(data.cases ?? []);
      const pass = data.passedTests ?? 0;
      const total = data.totalTests ?? problem.samples.length;
      setNotice(`Samples: ${pass}/${total} Passed · ${formatStatus(data.status ?? "done")} (${data.executionTimeMs ?? 0}ms)`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Sample run failed");
    } finally {
      setRunningSamples(false);
    }
  }

  // Official Submission with SSE Real-time Feedback
  async function handleSubmit() {
    if (!problem) return;
    if (!isLoaded || !isSignedIn) {
      setNotice("Please sign in to submit solutions.");
      return;
    }
    setSubmitting(true);
    setNotice("");
    try {
      const currentCode = codeByLang[language] ?? STARTERS[language] ?? "";
      const payload: Record<string, unknown> = {
        problemId: problem.id,
        language,
        code: currentCode,
        mode: "submit",
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
      setCooldown(30);

      // Subscribe to SSE for real-time verdict delivery
      if (data.id && (data.status === "running" || data.status === "pending")) {
        setNotice(`Submission #${data.id}: judging…`);
        setActiveTab("submissions");

        if (activeEsRef.current) {
          activeEsRef.current.close();
        }
        const es = new EventSource(`/api/submissions/${data.id}/events`);
        activeEsRef.current = es;

        es.addEventListener("status", (ev) => {
          try {
            const update = JSON.parse(ev.data) as { status: string };
            setNotice(`Submission #${data.id}: ${formatStatus(update.status)}…`);
          } catch { /* ignore */ }
        });
        es.addEventListener("done", (ev) => {
          es.close();
          if (activeEsRef.current === es) activeEsRef.current = null;
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
            let msg = `Verdict: ${parts.join(" · ")}`;
            if (result.errorMessage) msg += ` — ${result.errorMessage}`;
            setNotice(msg);
          } catch { /* ignore */ }
          setSubmitting(false);
          void loadVerdicts();
        });
        es.addEventListener("error", () => {
          es.close();
          if (activeEsRef.current === es) activeEsRef.current = null;
          setNotice(`Submission #${data.id}: verdict pending — refresh to check`);
          setSubmitting(false);
          void loadVerdicts();
        });
      }

      setNotice(`Submitted #${data.id ?? ""}`);
      void loadVerdicts();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  function handleResetCode() {
    if (window.confirm(`Reset ${language.toUpperCase()} code to default starter template?`)) {
      setCodeByLang((prev) => ({ ...prev, [language]: STARTERS[language] ?? "" }));
    }
  }

  const activeSample = useMemo(() => {
    if (!problem || problem.samples.length === 0) return null;
    return problem.samples[activeSampleIndex] ?? problem.samples[0];
  }, [problem, activeSampleIndex]);

  const activeSampleResult = useMemo(() => {
    return sampleResults.find((r) => r.index === activeSampleIndex);
  }, [sampleResults, activeSampleIndex]);

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
        {/* Contest Mode Banner */}
        {contestId && (
          <div className="mb-4 p-3 rounded-lg border border-kjprimary/30 bg-kjprimary/5 flex flex-wrap items-center justify-between gap-3 font-mono text-xs text-kjtext">
            <div className="flex items-center gap-2.5">
              <span className="w-2 h-2 rounded-full bg-kjprimary animate-pulse" />
              <span className="font-bold text-kjprimary tracking-wider">CONTEST MODE</span>
              <span className="text-kjtext-muted hidden sm:inline">· Submissions scored under official ICPC penalty rules</span>
            </div>
            <div className="flex items-center gap-4">
              <Link
                href={`/rankings?contestId=${contestId}`}
                className="text-kjprimary hover:underline font-bold"
              >
                📊 Scoreboard →
              </Link>
              <Link
                href={`/contests/${contestId}/arena`}
                className="text-kjtext-muted hover:text-kjtext"
              >
                🎪 Contest Arena →
              </Link>
            </div>
          </div>
        )}

        <div className="mb-4 flex justify-between items-center">
          <Link
            href={contestId ? `/contests/${contestId}/arena` : "/problems"}
            className="text-xs font-mono text-kjtext-muted hover:text-kjprimary transition-colors"
          >
            ← {contestId ? "Return to contest arena" : "Browse all problems"}
          </Link>
          <div className="flex items-center gap-4 text-xs font-mono text-kjtext-muted">
            <span>Time limit: <strong className="text-kjtext">{problem.timeLimitMs}ms</strong></span>
            <span>Memory limit: <strong className="text-kjtext">{problem.memoryMb}MB</strong></span>
          </div>
        </div>

        <div className="grid lg:grid-cols-[1.05fr_0.95fr] gap-8 items-start">
          {/* Problem Statement Section */}
          <article className="space-y-5">
            {/* Left Panel Tabs Bar */}
            <div className="flex items-center gap-1 bg-kjsurface/60 p-1 rounded-lg border border-kjborder font-mono text-xs">
              <button
                type="button"
                onClick={() => setLeftTab("statement")}
                className={`px-3 py-1.5 rounded transition-all cursor-pointer ${
                  leftTab === "statement"
                    ? "bg-kjprimary text-kjbg font-bold shadow-sm"
                    : "text-kjtext-muted hover:text-kjtext"
                }`}
              >
                📄 Statement
              </button>
              <button
                type="button"
                onClick={() => setLeftTab("editorial")}
                className={`px-3 py-1.5 rounded transition-all cursor-pointer ${
                  leftTab === "editorial"
                    ? "bg-kjprimary text-kjbg font-bold shadow-sm"
                    : "text-kjtext-muted hover:text-kjtext"
                }`}
              >
                💡 Editorial {problem.explanation ? "✓" : ""}
              </button>
              <button
                type="button"
                onClick={() => setLeftTab("submissions")}
                className={`px-3 py-1.5 rounded transition-all cursor-pointer ${
                  leftTab === "submissions"
                    ? "bg-kjprimary text-kjbg font-bold shadow-sm"
                    : "text-kjtext-muted hover:text-kjtext"
                }`}
              >
                🕒 Submissions {verdicts.length > 0 ? `(${verdicts.length})` : ""}
              </button>
            </div>

            {leftTab === "statement" && (
              <div className="space-y-5">
                {/* Problem meta + title */}
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] uppercase tracking-[0.2em] font-mono text-kjprimary font-bold">Problem #{problem.id}</span>
                    <span className={`text-[10px] font-mono border rounded px-1.5 py-px ${
                      problem.difficulty === "easy"
                        ? "text-green-400 border-green-400/20 bg-green-400/5"
                        : problem.difficulty === "medium"
                          ? "text-yellow-400 border-yellow-400/20 bg-yellow-400/5"
                          : "text-red-400 border-red-400/20 bg-red-400/5"
                    }`}>
                      {problem.difficulty}
                    </span>
                    {problem.tags?.map((t) => (
                      <span key={t} className="text-[10px] font-mono border border-kjborder rounded px-1.5 text-kjtext-muted bg-kjsurface">
                        {t}
                      </span>
                    ))}
                  </div>
                  <h1 className="text-xl sm:text-2xl font-mono font-bold text-kjtext mt-2 leading-tight">{problem.title}</h1>
                </div>

                {/* Statement — reading prose */}
                <div className="prose prose-invert max-w-none text-[13px] leading-[1.7] text-kjtext/90 font-sans">
                  <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                    {problem.statement}
                  </Markdown>
                </div>

                {/* Input Format — left-accent callout */}
                <div className="border-l-2 border-kjprimary/40 bg-kjsurface/40 rounded-r-lg px-4 py-3">
                  <h2 className="text-[10px] uppercase tracking-[0.15em] font-mono text-kjprimary mb-1.5 font-bold">Input format</h2>
                  <div className="text-xs font-mono text-kjtext/80 prose prose-invert max-w-none">
                    <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                      {problem.inputFormat}
                    </Markdown>
                  </div>
                </div>

                {/* Output Format — left-accent callout */}
                <div className="border-l-2 border-kjsecondary/40 bg-kjsurface/40 rounded-r-lg px-4 py-3">
                  <h2 className="text-[10px] uppercase tracking-[0.15em] font-mono text-kjsecondary mb-1.5 font-bold">Output format</h2>
                  <div className="text-xs font-mono text-kjtext/80 prose prose-invert max-w-none">
                    <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                      {problem.outputFormat}
                    </Markdown>
                  </div>
                </div>

                {/* Constraints — amber accent for visibility */}
                <div className="border-l-2 border-amber-500/50 bg-amber-950/15 rounded-r-lg px-4 py-3">
                  <h2 className="text-[10px] uppercase tracking-[0.15em] font-mono text-amber-400 mb-1.5 font-bold">Constraints</h2>
                  <div className="text-xs font-mono text-kjtext/80 prose prose-invert max-w-none">
                    <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                      {problem.constraints}
                    </Markdown>
                  </div>
                </div>

                {/* Sample Test Cases — CF-style callouts */}
                <div className="space-y-3">
                  <h2 className="text-[10px] uppercase tracking-[0.15em] font-mono text-kjtext-muted font-bold">Sample cases</h2>
                  {problem.samples.length === 0 ? (
                    <p className="text-xs font-mono text-kjtext-muted">No public sample test cases configured.</p>
                  ) : (
                    problem.samples.map((s, idx) => (
                      <div key={idx} className="grid sm:grid-cols-2 gap-0 font-mono rounded-lg overflow-hidden border border-kjborder">
                        {/* Input half */}
                        <div className="bg-kjsurface/60 border-b sm:border-b-0 sm:border-r border-kjborder">
                          <div className="flex justify-between items-center px-3 py-1.5 border-b border-kjborder/60 bg-kjsurface/80">
                            <span className="text-kjtext-muted text-[10px] uppercase tracking-wider font-bold">Input{problem.samples.length > 1 ? ` ${idx + 1}` : ""}</span>
                            <button
                              type="button"
                              onClick={() => {
                                void navigator.clipboard.writeText(s.input);
                                setCopiedSample(`in-${idx}`);
                                setTimeout(() => setCopiedSample(null), 1500);
                              }}
                              className={`text-[9px] uppercase font-mono px-1.5 py-0.5 rounded transition-colors cursor-pointer ${
                                copiedSample === `in-${idx}`
                                  ? "text-green-400 bg-green-400/10"
                                  : "text-kjtext-muted hover:text-kjprimary hover:bg-kjprimary/10"
                              }`}
                            >
                              {copiedSample === `in-${idx}` ? "✓" : "copy"}
                            </button>
                          </div>
                          <pre className="p-3 text-xs text-kjtext whitespace-pre-wrap max-h-40 overflow-y-auto">{s.input}</pre>
                        </div>
                        {/* Output half */}
                        <div className="bg-kjsurface/40">
                          <div className="flex justify-between items-center px-3 py-1.5 border-b border-kjborder/60 bg-kjsurface/60">
                            <span className="text-kjtext-muted text-[10px] uppercase tracking-wider font-bold">Output{problem.samples.length > 1 ? ` ${idx + 1}` : ""}</span>
                            <button
                              type="button"
                              onClick={() => {
                                void navigator.clipboard.writeText(s.expectedOutput);
                                setCopiedSample(`out-${idx}`);
                                setTimeout(() => setCopiedSample(null), 1500);
                              }}
                              className={`text-[9px] uppercase font-mono px-1.5 py-0.5 rounded transition-colors cursor-pointer ${
                                copiedSample === `out-${idx}`
                                  ? "text-green-400 bg-green-400/10"
                                  : "text-kjtext-muted hover:text-kjprimary hover:bg-kjprimary/10"
                              }`}
                            >
                              {copiedSample === `out-${idx}` ? "✓" : "copy"}
                            </button>
                          </div>
                          <pre className="p-3 text-xs text-kjtext whitespace-pre-wrap max-h-40 overflow-y-auto">{s.expectedOutput}</pre>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {leftTab === "editorial" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-kjborder pb-2">
                  <h2 className="text-sm font-mono font-bold text-kjtext">
                    Official Solution & Editorial
                  </h2>
                  <span className="text-[10px] font-mono text-kjprimary border border-kjprimary/30 px-2 py-0.5 rounded">
                    APPROACH & ANALYSIS
                  </span>
                </div>
                {problem.explanation ? (
                  <div className="bg-kjsurface border border-kjborder rounded-lg p-5 text-xs sm:text-sm font-sans text-kjtext leading-relaxed prose prose-invert max-w-none">
                    <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{problem.explanation}</Markdown>
                  </div>
                ) : (
                  <div className="bg-kjsurface border border-kjborder rounded-lg p-8 text-center space-y-2 font-mono">
                    <p className="text-sm text-kjtext font-bold">No Editorial Available</p>
                    <p className="text-xs text-kjtext-muted">
                      An official editorial has not been authored for this problem yet, or is hidden while a live contest is currently active.
                    </p>
                  </div>
                )}
              </div>
            )}

            {leftTab === "submissions" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-kjborder pb-2">
                  <h2 className="text-sm font-mono font-bold text-kjtext">
                    My Submissions ({verdicts.length})
                  </h2>
                  <button
                    type="button"
                    onClick={() => void loadVerdicts()}
                    className="text-[10px] font-mono text-kjtext-muted hover:text-kjprimary border border-kjborder px-2 py-0.5 rounded transition-colors cursor-pointer"
                  >
                    REFRESH
                  </button>
                </div>
                {verdicts.length === 0 ? (
                  <div className="bg-kjsurface border border-kjborder rounded-lg p-8 text-center font-mono text-xs text-kjtext-muted space-y-2">
                    <p className="text-kjtext">No submissions yet on Problem #{problem.id}</p>
                    <p className="text-kjtext-muted/70">
                      Submit your solution in the code editor to view real-time verdicts here.
                    </p>
                  </div>
                ) : (
                  <div className="border border-kjborder rounded-lg overflow-hidden bg-kjsurface/30 font-mono text-xs">
                    <table className="w-full text-left">
                      <thead className="bg-kjsurface border-b border-kjborder text-kjtext-muted text-[10px] uppercase tracking-wider">
                        <tr>
                          <th className="py-2.5 px-3"># ID</th>
                          <th className="py-2.5 px-3">Verdict</th>
                          <th className="py-2.5 px-3">Lang</th>
                          <th className="py-2.5 px-3">Time</th>
                          <th className="py-2.5 px-3">Memory</th>
                          <th className="py-2.5 px-3">Submitted</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-kjborder/50">
                        {verdicts.map((v) => (
                          <tr key={v.id} className="hover:bg-kjbg/50 transition-colors">
                            <td className="py-2.5 px-3">
                              <Link
                                href={`/submissions/${v.id}`}
                                className="text-kjprimary font-bold hover:underline"
                              >
                                #{v.id}
                              </Link>
                            </td>
                            <td className="py-2.5 px-3">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                v.status.toLowerCase() === "accepted"
                                  ? "text-green-400 bg-green-400/10 border border-green-400/20"
                                  : v.status.toLowerCase().includes("pending") || v.status.toLowerCase().includes("running")
                                    ? "text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 animate-pulse"
                                    : "text-red-400 bg-red-400/10 border border-red-400/20"
                              }`}>
                                {v.status.replaceAll("_", " ").toUpperCase()}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 uppercase text-kjtext-muted">{v.language}</td>
                            <td className="py-2.5 px-3 text-kjtext-muted">{v.executionTimeMs != null ? `${v.executionTimeMs}ms` : "--"}</td>
                            <td className="py-2.5 px-3 text-kjtext-muted">{v.memoryUsedMb != null ? `${v.memoryUsedMb}MB` : "--"}</td>
                            <td className="py-2.5 px-3 text-kjtext-muted text-[11px] whitespace-nowrap">
                              {v.submittedAt ? new Date(v.submittedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </article>

          {/* Interactive Code Editor & Test Runner Section */}
          <section className="bg-kjsurface/40 border border-kjborder rounded-lg p-4 lg:p-5 h-fit lg:sticky lg:top-20 space-y-4">
            {/* Editor Top Bar */}
            <div className="flex items-center justify-between border-b border-kjborder pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-widest font-mono text-kjprimary">Solution</span>
                <button
                  type="button"
                  onClick={handleResetCode}
                  title="Reset code to default template"
                  className="text-[10px] font-mono text-kjtext-muted hover:text-kjtext px-2 py-0.5 border border-kjborder/70 rounded transition-colors cursor-pointer"
                >
                  RESET
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const code = codeByLang[language] ?? STARTERS[language] ?? "";
                    void navigator.clipboard.writeText(code);
                    setCopiedCode(true);
                    setTimeout(() => setCopiedCode(false), 1500);
                  }}
                  title="Copy editor code"
                  className="text-[10px] font-mono text-kjtext-muted hover:text-kjtext px-2 py-0.5 border border-kjborder/70 rounded transition-colors cursor-pointer"
                >
                  {copiedCode ? "✓ COPIED" : "COPY"}
                </button>
              </div>
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                className="bg-kjbg border border-kjborder rounded px-3 py-1.5 text-xs font-mono text-kjprimary focus:outline-none focus:border-kjprimary"
                aria-label="Select language"
              >
                <option value="python">Python 3.11</option>
                <option value="c++">C++ (G++ 20)</option>
                <option value="c">C (GCC 11)</option>
                <option value="java">Java (OpenJDK 17)</option>
              </select>
            </div>

            {/* Monaco-style Textarea Editor with Line Numbers */}
            <div className="relative flex rounded border border-kjborder bg-kjbg overflow-hidden focus-within:border-kjprimary">
              {/* Line numbers gutter */}
              <div
                ref={gutterRef}
                className="select-none py-4 px-2 text-right font-mono text-xs text-kjtext-muted/40 bg-kjsurface/50 border-r border-kjborder/60 overflow-hidden"
                style={{ minWidth: "2.75rem" }}
                aria-hidden="true"
              >
                {lineNumbers.map((n) => (
                  <div key={n} className="leading-6">{n}</div>
                ))}
              </div>

              {/* Textarea */}
              <textarea
                ref={textareaRef}
                onScroll={handleEditorScroll}
                value={codeByLang[language] ?? STARTERS[language] ?? ""}
                onChange={(event) => {
                  const val = event.target.value;
                  setCodeByLang((prev) => ({ ...prev, [language]: val }));
                }}
                onKeyDown={(event) => {
                  if (event.key === "Tab") {
                    event.preventDefault();
                    const ta = event.currentTarget;
                    const start = ta.selectionStart;
                    const end = ta.selectionEnd;
                    const val = ta.value;
                    const newVal = val.substring(0, start) + "    " + val.substring(end);
                    setCodeByLang((prev) => ({ ...prev, [language]: newVal }));
                    requestAnimationFrame(() => {
                      ta.selectionStart = ta.selectionEnd = start + 4;
                    });
                  }
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    if (!submitting && cooldown === 0) {
                      void handleSubmit();
                    }
                  }
                  if ((event.metaKey || event.ctrlKey) && event.key === "'") {
                    event.preventDefault();
                    if (!runningSamples && !submitting) {
                      void handleRunSamples();
                    }
                  }
                }}
                spellCheck={false}
                className="flex-1 min-h-[340px] resize-y bg-transparent p-4 text-xs sm:text-sm leading-6 font-mono text-kjtext focus:outline-none selection:bg-kjprimary/20"
              />
              <span className="absolute bottom-2 right-3 text-[10px] font-mono text-kjtext-muted/50 select-none pointer-events-none">
                {lineCount} lines · Ctrl+Enter submit · Ctrl+&apos; run
              </span>
            </div>

            {/* Primary Action Buttons */}
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => void handleRunSamples()}
                disabled={runningSamples || submitting}
                className="border border-kjborder text-kjtext font-mono text-xs px-4 py-2 rounded hover:border-kjprimary hover:text-kjprimary disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                {runningSamples ? (
                  <span className="flex items-center gap-2">
                    <span className="inline-block w-3 h-3 border-2 border-kjtext-muted/30 border-t-kjtext-muted rounded-full animate-spin" />
                    RUNNING…
                  </span>
                ) : (
                  "RUN SAMPLES"
                )}
              </button>
              <button
                onClick={() => void handleSubmit()}
                disabled={submitting || runningSamples || cooldown > 0}
                className="bg-kjprimary text-kjbg font-mono font-bold text-xs px-5 py-2 rounded hover:glow-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-all"
              >
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <span className="inline-block w-3 h-3 border-2 border-kjbg/30 border-t-kjbg rounded-full animate-spin" />
                    SUBMITTING…
                  </span>
                ) : cooldown > 0 ? (
                  <span className="flex items-center gap-2">
                    <span className="inline-block w-3 h-3 border-2 border-kjbg/30 border-t-kjbg rounded-full animate-spin" />
                    WAIT {cooldown}s
                  </span>
                ) : (
                  "SUBMIT"
                )}
              </button>
            </div>

            {/* Rate limit cooldown indicator */}
            {cooldown > 0 && (
              <div className="h-1 bg-kjbg rounded-full overflow-hidden">
                <div
                  className="h-full bg-kjprimary/50 transition-all duration-1000 ease-linear"
                  style={{ width: `${(cooldown / 30) * 100}%` }}
                />
              </div>
            )}

            {/* Status notice */}
            {notice && (
              <div className={`border rounded p-3 text-xs font-mono break-words ${
                notice.includes("ACCEPTED") || notice.includes("accepted") || notice.includes("Passed")
                  ? "border-green-400/30 bg-green-400/10 text-green-400"
                  : notice.includes("judging") || notice.includes("running") || notice.includes("pending")
                    ? "border-yellow-400/30 bg-yellow-400/10 text-yellow-400"
                    : notice.includes("WRONG") || notice.includes("TLE") || notice.includes("MLE") || notice.includes("ERROR") || notice.includes("error")
                      ? "border-red-400/30 bg-red-400/10 text-red-400"
                      : "border-kjprimary/30 bg-kjprimary/10 text-kjprimary"
              }`}>
                {notice}
              </div>
            )}

            {/* Codeforces-Style Interactive Workspace Tabs */}
            <div className="border-t border-kjborder pt-4">
              <div className="flex border-b border-kjborder gap-2 pb-2 text-xs font-mono">
                <button
                  type="button"
                  onClick={() => setActiveTab("samples")}
                  className={`px-3 py-1.5 rounded transition-colors cursor-pointer ${
                    activeTab === "samples"
                      ? "bg-kjprimary/10 text-kjprimary border border-kjprimary/30 font-bold"
                      : "text-kjtext-muted hover:text-kjtext"
                  }`}
                >
                  Sample Cases {sampleResults.length > 0 && `(${sampleResults.filter((r) => r.passed).length}/${sampleResults.length})`}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("custom")}
                  className={`px-3 py-1.5 rounded transition-colors cursor-pointer ${
                    activeTab === "custom"
                      ? "bg-kjprimary/10 text-kjprimary border border-kjprimary/30 font-bold"
                      : "text-kjtext-muted hover:text-kjtext"
                  }`}
                >
                  Custom Test
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("submissions")}
                  className={`px-3 py-1.5 rounded transition-colors cursor-pointer ${
                    activeTab === "submissions"
                      ? "bg-kjprimary/10 text-kjprimary border border-kjprimary/30 font-bold"
                      : "text-kjtext-muted hover:text-kjtext"
                  }`}
                >
                  My Submissions {verdicts.length > 0 && `(${verdicts.length})`}
                </button>
              </div>

              {/* Tab 1: Sample Cases Runner */}
              {activeTab === "samples" && (
                <div className="mt-3 space-y-3 font-mono text-xs">
                  {problem.samples.length === 0 ? (
                    <p className="text-kjtext-muted py-4 text-center">No sample cases available.</p>
                  ) : (
                    <>
                      {/* Case selector pills */}
                      <div className="flex gap-2">
                        {problem.samples.map((_, idx) => {
                          const res = sampleResults.find((r) => r.index === idx);
                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => setActiveSampleIndex(idx)}
                              className={`px-3 py-1 rounded border text-xs cursor-pointer flex items-center gap-1.5 transition-colors ${
                                activeSampleIndex === idx
                                  ? "border-kjprimary text-kjprimary bg-kjprimary/10 font-bold"
                                  : "border-kjborder text-kjtext-muted hover:text-kjtext"
                              }`}
                            >
                              {res ? (
                                res.passed ? (
                                  <span className="text-green-400 font-bold">✓</span>
                                ) : (
                                  <span className="text-red-400 font-bold">✗</span>
                                )
                              ) : (
                                <span>○</span>
                              )}
                              Case #{idx + 1}
                            </button>
                          );
                        })}
                      </div>

                      {/* Active Case Details */}
                      {activeSample && (
                        <div className="space-y-2">
                          <div className="grid sm:grid-cols-2 gap-2">
                            <div>
                              <span className="text-[10px] text-kjtext-muted uppercase">Input</span>
                              <pre className="bg-kjbg border border-kjborder rounded p-2.5 text-xs text-kjtext max-h-32 overflow-y-auto whitespace-pre-wrap">
                                {activeSample.input}
                              </pre>
                            </div>
                            <div>
                              <span className="text-[10px] text-kjtext-muted uppercase">Expected Output</span>
                              <pre className="bg-kjbg border border-kjborder rounded p-2.5 text-xs text-kjtext max-h-32 overflow-y-auto whitespace-pre-wrap">
                                {activeSample.expectedOutput}
                              </pre>
                            </div>
                          </div>

                          {/* Execution Result if run */}
                          {activeSampleResult && (
                            <div className="mt-3 border border-kjborder/80 rounded p-3 bg-kjbg">
                              <div className="flex justify-between items-center mb-1.5">
                                <span className="text-[10px] uppercase text-kjtext-muted">Your Output</span>
                                <div className="flex items-center gap-2">
                                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                                    activeSampleResult.passed
                                      ? "text-green-400 border-green-400/20 bg-green-400/10"
                                      : "text-red-400 border-red-400/20 bg-red-400/10"
                                  }`}>
                                    {formatStatus(activeSampleResult.verdict)}
                                  </span>
                                  <span className="text-[10px] text-kjtext-muted">{activeSampleResult.runtimeMs}ms</span>
                                </div>
                              </div>
                              <pre className="text-xs text-kjtext whitespace-pre-wrap font-mono max-h-36 overflow-y-auto">
                                {activeSampleResult.stdout || "(no stdout)"}
                              </pre>
                              {activeSampleResult.stderr && (
                                <div className="mt-2 text-red-400 border-t border-red-500/20 pt-2">
                                  <span className="text-[10px] uppercase text-red-400/80">Stderr / Trace:</span>
                                  <pre className="text-[11px] whitespace-pre-wrap">{activeSampleResult.stderr}</pre>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Tab 2: Custom Test Runner (Codeforces Style) */}
              {activeTab === "custom" && (
                <div className="mt-3 space-y-3 font-mono text-xs">
                  <div>
                    <label className="block text-[10px] uppercase text-kjtext-muted mb-1">
                      Standard Input (stdin)
                    </label>
                    <textarea
                      value={customInput}
                      onChange={(e) => setCustomInput(e.target.value)}
                      placeholder="Enter custom input to test your program…"
                      rows={3}
                      className="w-full bg-kjbg border border-kjborder rounded p-2.5 text-xs text-kjtext font-mono focus:border-kjprimary focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase text-kjtext-muted mb-1">
                      Expected Output (optional — for diff check)
                    </label>
                    <textarea
                      value={customExpected}
                      onChange={(e) => setCustomExpected(e.target.value)}
                      placeholder="Expected output (optional)…"
                      rows={2}
                      className="w-full bg-kjbg border border-kjborder rounded p-2.5 text-xs text-kjtext font-mono focus:border-kjprimary focus:outline-none"
                    />
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => void handleRunCustom()}
                      disabled={runningCustom}
                      className="bg-kjprimary/10 border border-kjprimary/30 text-kjprimary px-4 py-1.5 rounded font-mono text-xs hover:bg-kjprimary/20 cursor-pointer disabled:opacity-50"
                    >
                      {runningCustom ? "TESTING…" : "RUN CUSTOM TEST →"}
                    </button>
                  </div>

                  {customResult && (() => {
                    const isSuccess = customResult.status === "accepted" || customResult.status === "finished";
                    const errorTrace = customResult.stderr || customResult.errorMessage;
                    return (
                      <div className="border border-kjborder rounded p-3 bg-kjbg space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] uppercase text-kjtext-muted">Result</span>
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                              isSuccess
                                ? "text-green-400 border-green-400/20 bg-green-400/10"
                                : "text-red-400 border-red-400/20 bg-red-400/10"
                            }`}>
                              {formatStatus(customResult.status)}
                            </span>
                            <span className="text-[10px] text-kjtext-muted">{customResult.executionTimeMs}ms · {customResult.memoryUsedMb}MB</span>
                          </div>
                        </div>

                        {customResult.stdout && (
                          <div>
                            <span className="text-[10px] uppercase text-kjtext-muted">Stdout:</span>
                            <pre className="text-xs text-kjtext whitespace-pre-wrap max-h-40 overflow-y-auto">
                              {customResult.stdout}
                            </pre>
                          </div>
                        )}

                        {errorTrace && (
                          <div className="text-red-400 border-t border-red-500/20 pt-2">
                            <span className="text-[10px] uppercase text-red-400/80">Stderr / Errors:</span>
                            <pre className="text-[11px] whitespace-pre-wrap max-h-40 overflow-y-auto">
                              {errorTrace}
                            </pre>
                          </div>
                        )}

                        {!customResult.stdout && !errorTrace && (
                          <p className="text-[11px] text-kjtext-muted">(program exited cleanly with no output)</p>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Tab 3: My Submissions History */}
              {activeTab === "submissions" && (
                <div className="mt-3 font-mono text-xs space-y-2">
                  {!isLoaded ? (
                    <p className="text-kjtext-muted py-3">Loading submissions…</p>
                  ) : !isSignedIn ? (
                    <div className="bg-kjbg/50 border border-kjborder rounded p-4 text-center">
                      <p className="text-kjtext-muted mb-2">Sign in to view your submission history.</p>
                      <Link href="/sign-in" className="text-kjprimary hover:underline text-xs">Sign in →</Link>
                    </div>
                  ) : verdicts.length === 0 ? (
                    <div className="bg-kjbg/50 border border-kjborder rounded p-4 text-center">
                      <p className="text-kjtext-muted">No submissions recorded for this problem yet.</p>
                      <p className="text-kjtext-muted/60 mt-1 text-[11px]">Click Submit above to submit your code.</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                      {verdicts.map((v) => (
                        <Link
                          key={v.id}
                          href={`/submissions/${v.id}`}
                          className="flex justify-between items-center border border-kjborder/60 bg-kjbg/60 p-2 rounded hover:border-kjprimary/50 transition-colors group"
                        >
                          <div className="flex items-center gap-2">
                            <span className={`border rounded-full px-2 py-0.5 text-[10px] ${statusBadge(v.status)}`}>
                              {formatStatus(v.status)}
                            </span>
                            <span className="text-[11px] text-kjtext-muted group-hover:text-kjprimary transition-colors">
                              #{v.id}
                            </span>
                          </div>
                          <div className="text-right text-[10px] text-kjtext-muted">
                            {v.passedTests !== null && v.totalTests !== null && (
                              <span className="mr-2 text-kjtext">{v.passedTests}/{v.totalTests} tests</span>
                            )}
                            {v.executionTimeMs !== null && <span>{v.executionTimeMs}ms</span>}
                            {v.submittedAt && (
                              <span className="ml-2 text-kjtext-muted/60">
                                {new Date(v.submittedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            )}
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
