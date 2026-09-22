"use client";

import { useState } from "react";
import Link from "next/link";
import Markdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { pairPolygonTestFiles } from "@/app/api/admin/problems/import/parser";

type Difficulty = "easy" | "medium" | "hard";

type TestCaseDraft = {
  input: string;
  expectedOutput: string;
  isSample: boolean;
  position: number;
};

type ProblemForm = {
  title: string;
  statement: string;
  inputFormat: string;
  outputFormat: string;
  constraints: string;
  explanation: string;
  difficulty: Difficulty;
  tags: string;
  timeLimitMs: string;
  memoryLimitMb: string;
  testCases: TestCaseDraft[];
};

const COMMON_TAGS = [
  "arrays",
  "strings",
  "dp",
  "math",
  "greedy",
  "graphs",
  "two-pointers",
  "binary-search",
  "sorting",
  "implementation",
];

const PRESETS = {
  cf: [
    { label: "4A · Watermelon", code: "4A" },
    { label: "71A · Way Too Long Words", code: "71A" },
    { label: "158A · Next Round", code: "158A" },
    { label: "1A · Theatre Square", code: "1A" },
  ],
  lc: [
    { label: "Two Sum", slug: "two-sum" },
    { label: "Valid Parentheses", slug: "valid-parentheses" },
    { label: "Merge Two Sorted Lists", slug: "merge-two-sorted-lists" },
    { label: "Climbing Stairs", slug: "climbing-stairs" },
  ],
  ac: [
    { label: "ABC 340 A · Arithmetic", code: "abc340_a" },
    { label: "ABC 300 A · N-choice", code: "abc300_a" },
    { label: "ABC 200 A · Century", code: "abc200_a" },
  ],
};

const SAMPLE_CC_JSON = JSON.stringify(
  {
    name: "A. Watermelon",
    group: "Codeforces - Codeforces Round 4 (Div. 2)",
    url: "https://codeforces.com/problemset/problem/4/A",
    interactive: false,
    memoryLimit: 64,
    timeLimit: 1000,
    tests: [
      {
        input: "8\n",
        output: "YES\n",
      },
    ],
    testType: "single",
    input: { type: "stdin" },
    output: { type: "stdout" },
  },
  null,
  2,
);

const STARTER_TEMPLATES: Record<string, Partial<ProblemForm>> = {
  icpc: {
    title: "Array Sum Pair",
    difficulty: "easy",
    tags: "arrays, two-pointers, math",
    timeLimitMs: "1000",
    memoryLimitMb: "256",
    statement: `You are given an array $A$ of $N$ integers and an integer target $X$.

Your task is to determine whether there exist two distinct indices $i$ and $j$ ($1 \\le i < j \\le N$) such that:
$$ A_i + A_j = X $$

If such a pair exists, output any valid pair of 1-based indices $i$ and $j$. If multiple pairs exist, output any one. If no such pair exists, output \`-1\`.`,
    inputFormat: `The first line contains an integer $T$ ($1 \\le T \\le 100$) — the number of test cases.
For each test case:
- The first line contains two integers $N$ and $X$.
- The second line contains $N$ space-separated integers $A_1, A_2, \\dots, A_N$.`,
    outputFormat: `For each test case, output two space-separated indices $i$ and $j$, or \`-1\` if no valid pair exists.`,
    constraints: `- $1 \\le T \\le 100$
- $2 \\le N \\le 2 \\times 10^5$
- $1 \\le A_i, X \\le 10^9$
- The sum of $N$ over all test cases does not exceed $2 \\times 10^5$.`,
    explanation: `For the first testcase, $A_1 + A_2 = 2 + 7 = 9 = X$, so indices 1 and 2 are returned.`,
    testCases: [
      { input: "2\n5 9\n2 7 11 15 1\n3 10\n1 2 3\n", expectedOutput: "1 2\n-1\n", isSample: true, position: 0 },
      { input: "1\n4 6\n3 3 1 2\n", expectedOutput: "1 2\n", isSample: false, position: 1 },
    ],
  },
  leetcode: {
    title: "Valid Parentheses Sequence",
    difficulty: "easy",
    tags: "stack, strings",
    timeLimitMs: "1000",
    memoryLimitMb: "256",
    statement: `Given a string $s$ containing just the characters \`'('\`, \`')'\`, \`'{'\`, \`'}'\`, \`'['\` and \`']'\`, determine if the input string is valid.

An input string is valid if:
1. Open brackets must be closed by the same type of brackets.
2. Open brackets must be closed in the correct order.
3. Every close bracket has a corresponding open bracket of the same type.`,
    inputFormat: `A single line containing the string $s$.`,
    outputFormat: `Print \`true\` if the sequence is valid, or \`false\` otherwise.`,
    constraints: `- $1 \\le |s| \\le 10^4$
- $s$ consists of parentheses only \`'()[]{}'\`.`,
    explanation: `Sample 1: "()[]{}" is valid since every bracket is closed in proper nesting order.`,
    testCases: [
      { input: "()[]{}\n", expectedOutput: "true\n", isSample: true, position: 0 },
      { input: "(]\n", expectedOutput: "false\n", isSample: true, position: 1 },
      { input: "([{}])\n", expectedOutput: "true\n", isSample: false, position: 2 },
    ],
  },
  graph: {
    title: "Shortest Path in Graph",
    difficulty: "medium",
    tags: "graphs, bfs, shortest-path",
    timeLimitMs: "2000",
    memoryLimitMb: "256",
    statement: `You are given an unweighted, undirected graph with $N$ vertices numbered $1$ to $N$ and $M$ edges.

Find the length of the shortest path from vertex $1$ to vertex $N$ (the minimum number of edges traversed). If vertex $N$ is not reachable from vertex $1$, output \`-1\`.`,
    inputFormat: `The first line contains two integers $N$ and $M$ — the number of vertices and edges.
The next $M$ lines each contain two integers $u$ and $v$ ($1 \\le u, v \\le N$, $u \\ne v$) denoting an undirected edge between $u$ and $v$.`,
    outputFormat: `Print a single integer — the shortest distance from vertex 1 to vertex $N$, or \`-1\` if unreachable.`,
    constraints: `- $2 \\le N \\le 10^5$
- $1 \\le M \\le 2 \\times 10^5$
- The graph contains no self-loops.`,
    explanation: `Path 1 -> 2 -> 4 traverses 2 edges.`,
    testCases: [
      { input: "4 3\n1 2\n2 4\n1 3\n", expectedOutput: "2\n", isSample: true, position: 0 },
      { input: "3 1\n1 2\n", expectedOutput: "-1\n", isSample: true, position: 1 },
    ],
  },
  math: {
    title: "Modulo Exponential Power",
    difficulty: "easy",
    tags: "math, number-theory, binary-exponentiation",
    timeLimitMs: "1000",
    memoryLimitMb: "256",
    statement: `Given three positive integers $A$, $B$, and $M$, calculate:
$$ (A^B) \\pmod{M} $$
using fast binary modular exponentiation in $O(\\log B)$ time.`,
    inputFormat: `A single line containing three space-separated integers $A$, $B$, and $M$.`,
    outputFormat: `Print $(A^B) \\pmod{M}$.`,
    constraints: `- $1 \\le A, B \\le 10^{18}$
- $2 \\le M \\le 10^9 + 7$`,
    explanation: `2^10 = 1024. 1024 mod 1000 = 24.`,
    testCases: [
      { input: "2 10 1000\n", expectedOutput: "24\n", isSample: true, position: 0 },
      { input: "3 5 13\n", expectedOutput: "9\n", isSample: true, position: 1 },
    ],
  },
};

interface ProblemStudioProps {
  onProblemCreated?: (created?: { id: number; title: string }) => void;
  onCancel?: () => void;
}

export default function ProblemStudio({ onProblemCreated, onCancel }: ProblemStudioProps) {
  // Main modes: "importer" | "studio" | "bulk_cases"
  const [activeTab, setActiveTab] = useState<"importer" | "studio" | "bulk_cases">("importer");

  // Importer state
  const [importSource, setImportSource] = useState<"leetcode" | "codeforces" | "atcoder" | "competitive-companion" | "csv">("leetcode");
  const [importInput, setImportInput] = useState("two-sum");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Authoring Studio state
  const [viewMode, setViewMode] = useState<"split" | "editor" | "preview">("split");
  const [submitting, setSubmitting] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  // Success celebration state
  const [createdSuccess, setCreatedSuccess] = useState<{ id: number; title: string; count?: number } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const [form, setForm] = useState<ProblemForm>({
    title: "",
    statement: "",
    inputFormat: "",
    outputFormat: "",
    constraints: "",
    explanation: "",
    difficulty: "easy",
    tags: "arrays, implementation",
    timeLimitMs: "1000",
    memoryLimitMb: "256",
    testCases: [],
  });

  // Test case inline builder state
  const [newTc, setNewTc] = useState<{ input: string; expectedOutput: string; isSample: boolean }>({
    input: "",
    expectedOutput: "",
    isSample: true,
  });
  const [expandedCase, setExpandedCase] = useState<number | null>(null);

  // Bulk test cases tab state
  const [bulkMode, setBulkMode] = useState<"polygon" | "csv">("polygon");
  const [bulkText, setBulkText] = useState("");
  const [parsedBulkCases, setParsedBulkCases] = useState<TestCaseDraft[]>([]);
  const [unmatchedFiles, setUnmatchedFiles] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // Apply parsed data into the Authoring Studio
  function populateStudio(parsed: {
    title: string;
    statement: string;
    inputFormat: string;
    outputFormat: string;
    constraints: string;
    explanation?: string | null;
    difficulty: Difficulty;
    tags: string[];
    timeLimitMs: number;
    memoryLimitMb: number;
    testCases?: TestCaseDraft[];
  }) {
    setForm({
      title: parsed.title,
      statement: parsed.statement,
      inputFormat: parsed.inputFormat,
      outputFormat: parsed.outputFormat,
      constraints: parsed.constraints,
      explanation: parsed.explanation || "",
      difficulty: parsed.difficulty || "easy",
      tags: parsed.tags.join(", "),
      timeLimitMs: String(parsed.timeLimitMs || 1000),
      memoryLimitMb: String(parsed.memoryLimitMb || 256),
      testCases: parsed.testCases || [],
    });
    setActiveTab("studio");
    setStatusNotice(`Successfully loaded "${parsed.title}" with ${parsed.testCases?.length || 0} test cases into Studio.`);
  }

  // Load starter template
  function handleApplyTemplate(key: string) {
    const t = STARTER_TEMPLATES[key];
    if (!t) return;
    setForm((prev) => ({
      ...prev,
      title: t.title ?? prev.title,
      difficulty: (t.difficulty as Difficulty) ?? prev.difficulty,
      tags: t.tags ?? prev.tags,
      timeLimitMs: t.timeLimitMs ?? prev.timeLimitMs,
      memoryLimitMb: t.memoryLimitMb ?? prev.memoryLimitMb,
      statement: t.statement ?? prev.statement,
      inputFormat: t.inputFormat ?? prev.inputFormat,
      outputFormat: t.outputFormat ?? prev.outputFormat,
      constraints: t.constraints ?? prev.constraints,
      explanation: t.explanation ?? prev.explanation,
      testCases: t.testCases ?? prev.testCases,
    }));
    setStatusNotice(`Loaded "${t.title}" starter template with test cases.`);
  }

  // Handle Import & Fetch
  async function handleFetchImport(autoPublish = false) {
    setImporting(true);
    setImportError(null);
    setStatusNotice(null);
    setStatusError(null);

    try {
      const res = await fetch("/api/admin/problems/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: importSource,
          input: importInput,
          autoCreate: autoPublish,
          status: "published",
        }),
      });

      const data = (await res.json()) as {
        status?: string;
        problem?: {
          title: string;
          statement: string;
          inputFormat: string;
          outputFormat: string;
          constraints: string;
          explanation?: string | null;
          difficulty: Difficulty;
          tags: string[];
          timeLimitMs: number;
          memoryLimitMb: number;
          testCases?: TestCaseDraft[];
        };
        problemId?: number;
        error?: string;
      };

      if (!res.ok) {
        throw new Error(data.error ?? `Import failed (${res.status})`);
      }

      if (autoPublish && data.problemId) {
        const created = {
          id: data.problemId,
          title: data.problem?.title ?? `Problem #${data.problemId}`,
          count: data.problem?.testCases?.length,
        };
        setCreatedSuccess(created);
        setStatusNotice(`Successfully imported and published problem #${data.problemId}: "${created.title}"!`);
        if (onProblemCreated) onProblemCreated(created);
        return;
      }

      if (data.problem) {
        populateStudio(data.problem);
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  // Handle Save from Studio (Draft or Published)
  async function handleSaveProblem(status: "draft" | "published") {
    setSubmitting(true);
    setStatusError(null);
    setStatusNotice(null);

    try {
      const payload = {
        title: form.title,
        statement: form.statement,
        inputFormat: form.inputFormat,
        outputFormat: form.outputFormat,
        constraints: form.constraints,
        explanation: form.explanation || undefined,
        difficulty: form.difficulty,
        tags: form.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        timeLimitMs: parseInt(form.timeLimitMs, 10),
        memoryLimitMb: parseInt(form.memoryLimitMb, 10),
        status,
        testCases: form.testCases,
      };

      const res = await fetch("/api/admin/problems", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as { id?: number; testCaseCount?: number; error?: string };

      if (!res.ok) {
        throw new Error(data.error ?? `Failed to save problem (${res.status})`);
      }

      if (data.id) {
        const created = { id: data.id, title: payload.title, count: data.testCaseCount };
        setCreatedSuccess(created);
        setStatusNotice(`✓ Problem #${data.id} saved as ${status.toUpperCase()} with ${data.testCaseCount ?? 0} test cases!`);
        if (onProblemCreated) onProblemCreated(created);
      }
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Failed to save problem");
    } finally {
      setSubmitting(false);
    }
  }

  // Quick tag toggle (adds if missing, removes if present)
  function handleToggleTag(tag: string) {
    const current = form.tags
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    const tagLower = tag.toLowerCase();
    const next = current.includes(tagLower)
      ? current.filter((t) => t !== tagLower)
      : [...current, tagLower];
    setForm({ ...form, tags: next.join(", ") });
  }

  async function handleLoadTxtFile(
    file: File,
    field: "input" | "expectedOutput"
  ) {
    try {
      const text = await file.text();
      setNewTc((prev) => ({ ...prev, [field]: text }));
      setStatusNotice(`Loaded ${file.name} (${file.size} bytes) into ${field === "input" ? "Input" : "Expected Output"}.`);
    } catch {
      setStatusError(`Failed to read file ${file.name}.`);
    }
  }

  // Inline Test Case Add
  function handleAddInlineTestCase() {
    if (!newTc.input.trim() || !newTc.expectedOutput.trim()) return;
    const added: TestCaseDraft = {
      input: newTc.input.endsWith("\n") ? newTc.input : newTc.input + "\n",
      expectedOutput: newTc.expectedOutput.endsWith("\n") ? newTc.expectedOutput : newTc.expectedOutput + "\n",
      isSample: newTc.isSample,
      position: form.testCases.length,
    };
    setForm((prev) => ({
      ...prev,
      testCases: [...prev.testCases, added],
    }));
    setNewTc({ input: "", expectedOutput: "", isSample: false });
  }

  function handleRemoveTestCase(idx: number) {
    setForm((prev) => ({
      ...prev,
      testCases: prev.testCases.filter((_, i) => i !== idx).map((c, i) => ({ ...c, position: i })),
    }));
  }

  function handleToggleSample(idx: number) {
    setForm((prev) => ({
      ...prev,
      testCases: prev.testCases.map((c, i) => (i === idx ? { ...c, isSample: !c.isSample } : c)),
    }));
  }

  // Parse bulk text cases
  function handlePreviewBulk() {
    if (!bulkText.trim()) return;
    // Simple line/block parser
    const lines = bulkText.trim().split("\n");
    const cases: TestCaseDraft[] = [];
    let startIdx = 0;
    if (lines[0].toLowerCase().includes("input") && (lines[0].toLowerCase().includes("output") || lines[0].toLowerCase().includes("expected"))) {
      startIdx = 1;
    }

    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const delimiter = line.includes("\t") ? "\t" : ",";
      const parts = line.split(delimiter).map((p) => p.replace(/^["']|["']$/g, "").replace(/\\n/g, "\n").trim());
      if (parts.length >= 2 && parts[0] && parts[1]) {
        cases.push({
          input: parts[0] + "\n",
          expectedOutput: parts[1] + "\n",
          isSample: parts[2] ? parts[2].toLowerCase() === "true" || parts[2] === "1" : cases.length === 0,
          position: cases.length,
        });
      }
    }
    setParsedBulkCases(cases);
  }

  async function handlePolygonFiles(fileList: FileList | File[]) {
    const filesArray = Array.from(fileList);
    if (filesArray.length === 0) return;

    const readFiles: Array<{ name: string; content: string }> = [];
    for (const file of filesArray) {
      if (file.size > 10 * 1024 * 1024) continue;
      try {
        const text = await file.text();
        readFiles.push({ name: file.name, content: text });
      } catch {
        // ignore unreadable
      }
    }

    const { paired, unmatched } = pairPolygonTestFiles(readFiles);
    setParsedBulkCases(paired);
    setUnmatchedFiles(unmatched);
    if (paired.length > 0) {
      setStatusNotice(`Paired ${paired.length} test case(s) from ${readFiles.length} Polygon/ICPC files.`);
      if (unmatched.length > 0) {
        setStatusError(`Note: ${unmatched.length} file(s) had no matching counterpart: ${unmatched.slice(0, 5).join(", ")}${unmatched.length > 5 ? "…" : ""}`);
      } else {
        setStatusError(null);
      }
    } else {
      setStatusError(`No matching input/output pairs found in ${readFiles.length} files. Ensure files follow conventions like 01 & 01.a, 1.in & 1.out, or input1.txt & output1.txt.`);
    }
  }

  function handleApplyBulkCases() {
    if (parsedBulkCases.length === 0) return;
    setForm((prev) => ({
      ...prev,
      testCases: [...prev.testCases, ...parsedBulkCases].map((c, idx) => ({ ...c, position: idx })),
    }));
    setBulkText("");
    setParsedBulkCases([]);
    setUnmatchedFiles([]);
    setActiveTab("studio");
    setStatusNotice(`Added ${parsedBulkCases.length} bulk test cases to problem!`);
  }

  return (
    <div className="border border-kjborder bg-kjsurface/90 rounded-xl overflow-hidden shadow-2xl font-mono transition-all">
      {/* Studio Header Bar */}
      <div className="bg-kjbg/80 border-b border-kjborder px-5 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="w-2.5 h-2.5 rounded-full bg-kjprimary animate-pulse" />
          <h2 className="text-sm font-bold text-kjtext uppercase tracking-widest">
            Problem Authoring Studio & Importer
          </h2>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-1 bg-kjsurface p-1 rounded-lg border border-kjborder">
          <button
            type="button"
            onClick={() => setActiveTab("importer")}
            className={`px-3 py-1.5 rounded text-xs font-bold transition-all cursor-pointer ${
              activeTab === "importer"
                ? "bg-kjprimary text-kjbg shadow-sm"
                : "text-kjtext-muted hover:text-kjtext"
            }`}
          >
            1-Click Importer
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("studio")}
            className={`px-3 py-1.5 rounded text-xs font-bold transition-all cursor-pointer ${
              activeTab === "studio"
                ? "bg-kjprimary text-kjbg shadow-sm"
                : "text-kjtext-muted hover:text-kjtext"
            }`}
          >
            Studio Editor {form.title && `(${form.title.slice(0, 16)}…)`}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("bulk_cases")}
            className={`px-3 py-1.5 rounded text-xs font-bold transition-all cursor-pointer ${
              activeTab === "bulk_cases"
                ? "bg-kjprimary text-kjbg shadow-sm"
                : "text-kjtext-muted hover:text-kjtext"
            }`}
          >
            Polygon & Bulk Tests {form.testCases.length > 0 && `(${form.testCases.length})`}
          </button>
        </div>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-kjtext-muted hover:text-kjtext border border-kjborder px-3 py-1.5 rounded transition-colors"
          >
            Close
          </button>
        )}
      </div>

      {/* Global Notifications */}
      {statusNotice && (
        <div className="px-5 py-3 bg-kjprimary/10 border-b border-kjprimary/20 text-kjprimary text-xs flex justify-between items-center">
          <span>{statusNotice}</span>
          <button type="button" onClick={() => setStatusNotice(null)} className="text-kjprimary/70 hover:text-kjprimary" aria-label="Dismiss notice">Close</button>
        </div>
      )}
      {statusError && (
        <div className="px-5 py-3 bg-red-500/10 border-b border-red-500/20 text-red-400 text-xs flex justify-between items-center">
          <span>{statusError}</span>
          <button type="button" onClick={() => setStatusError(null)} className="text-red-400/70 hover:text-red-400" aria-label="Dismiss error">Close</button>
        </div>
      )}

      {/* Celebration Hero Box when a problem is created or imported */}
      {createdSuccess && (
        <div className="m-5 p-5 rounded-xl border-2 border-kjprimary/50 bg-gradient-to-br from-kjprimary/10 via-kjsurface to-kjbg text-kjtext shadow-2xl space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-kjprimary animate-ping" />
              <span className="text-xs font-bold uppercase tracking-widest text-kjprimary bg-kjprimary/20 px-2.5 py-0.5 rounded-full border border-kjprimary/30">
                Problem Published & Live
              </span>
            </div>
            <span className="text-xs font-mono text-kjtext-muted">
              Assigned ID: <strong className="text-kjprimary">#{createdSuccess.id}</strong>
            </span>
          </div>

          <div>
            <h3 className="text-lg font-bold font-mono text-kjtext">
              {createdSuccess.title}
            </h3>
            <p className="text-xs text-kjtext-muted mt-0.5">
              Problem is now live in the KOJ catalogue. Contestants can solve it in the arena, view statement, test against samples, and submit.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <Link
              href={`/problems/${createdSuccess.id}`}
              className="bg-kjprimary text-kjbg hover:glow-sm font-bold text-xs px-4 py-2 rounded-lg flex items-center gap-1.5 transition-all shadow-md"
            >
              <span>OPEN IN SOLVING ARENA</span>
              <span>→</span>
            </Link>
            <button
              type="button"
              onClick={() => {
                if (typeof window !== "undefined") {
                  void navigator.clipboard.writeText(`${window.location.origin}/problems/${createdSuccess.id}`);
                  setCopiedLink(true);
                  setTimeout(() => setCopiedLink(false), 2000);
                }
              }}
              className="border border-kjborder bg-kjsurface hover:border-kjprimary/60 text-xs px-3.5 py-2 rounded-lg font-mono transition-colors text-kjtext cursor-pointer"
            >
              {copiedLink ? "✓ LINK COPIED!" : "COPY PROBLEM LINK"}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreatedSuccess(null);
                setForm({
                  title: "",
                  statement: "",
                  inputFormat: "",
                  outputFormat: "",
                  constraints: "",
                  explanation: "",
                  difficulty: "easy",
                  tags: "arrays",
                  timeLimitMs: "1000",
                  memoryLimitMb: "256",
                  testCases: [],
                });
                setActiveTab("studio");
              }}
              className="border border-kjborder bg-kjsurface hover:text-kjprimary text-xs px-3.5 py-2 rounded-lg font-mono transition-colors text-kjtext-muted cursor-pointer"
            >
              CREATE ANOTHER
            </button>
            <Link
              href="/problems"
              className="text-xs text-kjtext-muted hover:text-kjtext px-2 py-2 font-mono underline transition-colors"
            >
              ← Back to Problem Archive
            </Link>
          </div>
        </div>
      )}

      {/* TAB 1: 1-CLICK IMPORTER */}
      {activeTab === "importer" && (
        <div className="p-6 space-y-6">
          <div className="border border-kjborder/70 rounded-lg p-4 bg-kjbg/40">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <span className="text-xs font-bold text-kjprimary uppercase tracking-widest">
                Select Platform Source
              </span>
              <span className="text-[11px] text-kjtext-muted">
                One-click sync with LeetCode GraphQL, Codeforces REST API & Competitive Companion
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {[
                { id: "leetcode", label: "LeetCode", marker: "bg-yellow-300", desc: "URL or slug" },
                { id: "codeforces", label: "Codeforces", marker: "bg-blue-400", desc: "4A, 158B, or URL" },
                { id: "atcoder", label: "AtCoder", marker: "bg-rose-400", desc: "abc340_a or URL" },
                { id: "competitive-companion", label: "Competitive Companion", marker: "bg-emerald-300", desc: "Browser JSON format" },
                { id: "csv", label: "Polygon / CSV", marker: "bg-kjtext-muted", desc: "Test cases batch" },
              ].map((src) => (
                <button
                  key={src.id}
                  type="button"
                  data-source={src.id}
                  onClick={() => {
                    const nextId = src.id as typeof importSource;
                    setImportSource(nextId);
                    if (nextId === "leetcode") setImportInput("two-sum");
                    else if (nextId === "codeforces") setImportInput("4A");
                    else if (nextId === "atcoder") setImportInput("abc340_a");
                    else if (nextId === "competitive-companion") setImportInput(SAMPLE_CC_JSON);
                    else setImportInput("1 2,3,true\n4 5,9,false");
                  }}
                  className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                    importSource === src.id
                      ? "border-kjprimary bg-kjprimary/10 shadow-sm"
                      : "border-kjborder/60 bg-kjsurface hover:border-kjprimary/40"
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs font-bold text-kjtext">
                    <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${src.marker}`} />
                    <span>{src.label}</span>
                  </div>
                  <p className="text-[10px] text-kjtext-muted mt-1">{src.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Contest Adaptation Workflow Callout */}
          <div className="border border-kjprimary/30 bg-kjprimary/5 rounded-lg p-3.5 text-xs font-mono flex items-start gap-2.5">
            <div className="space-y-1">
              <strong className="text-kjprimary">Contest Adaptation & Statement Customization:</strong>
              <p className="text-[11px] text-kjtext-muted leading-relaxed">
                Want to adapt problems from Codeforces, LeetCode, or AtCoder for your college contest? Click{" "}
                <strong className="text-kjtext">FETCH & PREVIEW IN STUDIO</strong>. It pulls the problem along with all verified test cases into the Studio Editor. You can then freely rewrite the problem statement, add college lore, and customize LaTeX formulas while keeping all original test cases intact!
              </p>
            </div>
          </div>

          {/* Source Input Body */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <label className="text-xs font-bold text-kjtext-muted uppercase tracking-wider">
                {importSource === "leetcode" && "Enter LeetCode Problem URL or Slug"}
                {importSource === "codeforces" && "Enter Codeforces Problem ID or Contest URL"}
                {importSource === "atcoder" && "Enter AtCoder Task Code (e.g. abc340_a) or Contest URL"}
                {importSource === "competitive-companion" && "Paste Competitive Companion JSON Payload"}
                {importSource === "csv" && "Paste CSV Test Cases (input,expectedOutput,isSample)"}
              </label>

              {/* Quick Presets */}
              {importSource === "leetcode" && (
                <div className="flex gap-1.5 flex-wrap">
                  {PRESETS.lc.map((p) => (
                    <button
                      key={p.slug}
                      type="button"
                      onClick={() => setImportInput(p.slug)}
                      className="text-[10px] border border-kjborder/80 px-2 py-0.5 rounded text-kjtext-muted hover:text-kjprimary hover:border-kjprimary transition-colors cursor-pointer"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
              {importSource === "codeforces" && (
                <div className="flex gap-1.5 flex-wrap">
                  {PRESETS.cf.map((p) => (
                    <button
                      key={p.code}
                      type="button"
                      onClick={() => setImportInput(p.code)}
                      className="text-[10px] border border-kjborder/80 px-2 py-0.5 rounded text-kjtext-muted hover:text-kjprimary hover:border-kjprimary transition-colors cursor-pointer"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
              {importSource === "atcoder" && (
                <div className="flex gap-1.5 flex-wrap">
                  {PRESETS.ac.map((p) => (
                    <button
                      key={p.code}
                      type="button"
                      onClick={() => setImportInput(p.code)}
                      className="text-[10px] border border-kjborder/80 px-2 py-0.5 rounded text-kjtext-muted hover:text-kjprimary hover:border-kjprimary transition-colors cursor-pointer"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {importSource === "competitive-companion" || importSource === "csv" ? (
              <textarea
                data-testid="import-input"
                value={importInput}
                onChange={(e) => setImportInput(e.target.value)}
                rows={9}
                placeholder={importSource === "csv" ? "input,expectedOutput,isSample\n1 2,3,true\n4 5,9,false" : "{ ... }"}
                className="w-full bg-kjbg border border-kjborder rounded-lg p-3 text-xs font-mono text-kjtext focus:border-kjprimary focus:outline-none"
              />
            ) : (
              <input
                data-testid="import-input"
                type="text"
                value={importInput}
                onChange={(e) => setImportInput(e.target.value)}
                placeholder={
                  importSource === "leetcode"
                    ? "e.g. two-sum or https://leetcode.com/problems/two-sum/"
                    : importSource === "atcoder"
                      ? "e.g. abc340_a or https://atcoder.jp/contests/abc340/tasks/abc340_a"
                      : "e.g. 4A, 158B, or https://codeforces.com/problemset/problem/4/A"
                }
                className="w-full bg-kjbg border border-kjborder rounded-lg px-4 py-3 text-sm font-mono text-kjtext focus:border-kjprimary focus:outline-none"
              />
            )}

            {importError && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-lg">
                Error: {importError}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => void handleFetchImport(false)}
                disabled={importing || !importInput.trim()}
                className="border border-kjprimary text-kjprimary bg-kjprimary/5 hover:bg-kjprimary/15 font-bold text-xs px-5 py-2.5 rounded-lg transition-all cursor-pointer disabled:opacity-50"
              >
                {importing ? "FETCHING & PARSING…" : "FETCH & PREVIEW IN STUDIO"}
              </button>
              <button
                type="button"
                onClick={() => void handleFetchImport(true)}
                disabled={importing || !importInput.trim()}
                className="bg-kjprimary text-kjbg hover:glow-sm font-bold text-xs px-6 py-2.5 rounded-lg transition-all cursor-pointer disabled:opacity-50"
              >
                {importing ? "IMPORTING…" : "1-CLICK IMPORT & PUBLISH"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: PROBLEM AUTHORING STUDIO */}
      {activeTab === "studio" && (
        <div className="p-6 space-y-6">
          {/* Starter Templates Toolbar */}
          <div className="border border-kjborder/70 rounded-lg p-3 bg-kjbg/40 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] uppercase tracking-wider text-kjprimary font-bold">
                Starter Templates:
              </span>
              <button
                type="button"
                onClick={() => handleApplyTemplate("icpc")}
                className="text-xs border border-kjborder hover:border-kjprimary/70 bg-kjsurface px-2.5 py-1 rounded text-kjtext-muted hover:text-kjtext transition-colors cursor-pointer"
              >
                Standard ICPC / CF
              </button>
              <button
                type="button"
                onClick={() => handleApplyTemplate("leetcode")}
                className="text-xs border border-kjborder hover:border-kjprimary/70 bg-kjsurface px-2.5 py-1 rounded text-kjtext-muted hover:text-kjtext transition-colors cursor-pointer"
              >
                LeetCode Style
              </button>
              <button
                type="button"
                onClick={() => handleApplyTemplate("graph")}
                className="text-xs border border-kjborder hover:border-kjprimary/70 bg-kjsurface px-2.5 py-1 rounded text-kjtext-muted hover:text-kjtext transition-colors cursor-pointer"
              >
                Graph & Shortest Path
              </button>
              <button
                type="button"
                onClick={() => handleApplyTemplate("math")}
                className="text-xs border border-kjborder hover:border-kjprimary/70 bg-kjsurface px-2.5 py-1 rounded text-kjtext-muted hover:text-kjtext transition-colors cursor-pointer"
              >
                Math & Exponentiation
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setForm({
                  title: "",
                  statement: "",
                  inputFormat: "",
                  outputFormat: "",
                  constraints: "",
                  explanation: "",
                  difficulty: "easy",
                  tags: "arrays",
                  timeLimitMs: "1000",
                  memoryLimitMb: "256",
                  testCases: [],
                });
                setStatusNotice("Form cleared.");
              }}
              className="text-[10px] text-kjtext-muted hover:text-red-400 border border-kjborder/60 hover:border-red-500/40 px-2 py-0.5 rounded transition-colors cursor-pointer"
            >
              Clear Form
            </button>
          </div>

          {/* Subheader Toolbar */}
          <div className="flex items-center justify-between border-b border-kjborder pb-3 flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-kjtext-muted uppercase">View mode:</span>
              <div className="flex border border-kjborder rounded overflow-hidden">
                {(["split", "editor", "preview"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setViewMode(m)}
                    className={`px-3 py-1 text-xs uppercase ${
                      viewMode === m
                        ? "bg-kjprimary/20 text-kjprimary font-bold"
                        : "bg-kjsurface text-kjtext-muted hover:text-kjtext"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleSaveProblem("draft")}
                disabled={submitting || !form.title.trim() || !form.statement.trim()}
                className="border border-kjborder hover:border-kjtext-muted text-kjtext-muted hover:text-kjtext px-4 py-1.5 rounded text-xs transition-colors disabled:opacity-50 cursor-pointer"
              >
                {submitting ? "SAVING…" : "SAVE AS DRAFT"}
              </button>
              <button
                type="button"
                onClick={() => void handleSaveProblem("published")}
                disabled={submitting || !form.title.trim() || !form.statement.trim()}
                className="bg-kjprimary text-kjbg font-bold px-5 py-1.5 rounded text-xs hover:glow-sm transition-all disabled:opacity-50 cursor-pointer"
              >
                {submitting ? "PUBLISHING…" : "PUBLISH PROBLEM"}
              </button>
            </div>
          </div>

          {/* Main Workspace (Editor + Live Preview) */}
          <div className={`grid gap-6 ${viewMode === "split" ? "lg:grid-cols-2" : "grid-cols-1"}`}>
            {/* LEFT / EDITOR PANE */}
            {(viewMode === "split" || viewMode === "editor") && (
              <div className="space-y-4">
                {/* Title & Difficulty */}
                <div className="grid sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] text-kjtext-muted uppercase mb-1">Problem Title</label>
                    <input
                      type="text"
                      value={form.title}
                      onChange={(e) => setForm({ ...form, title: e.target.value })}
                      placeholder="e.g. Watermelon"
                      required
                      className="w-full bg-kjbg border border-kjborder rounded px-3 py-2 text-sm text-kjtext focus:border-kjprimary focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-kjtext-muted uppercase mb-1">Difficulty</label>
                    <select
                      value={form.difficulty}
                      onChange={(e) => setForm({ ...form, difficulty: e.target.value as Difficulty })}
                      className="w-full bg-kjbg border border-kjborder rounded px-3 py-2 text-sm text-kjtext focus:border-kjprimary focus:outline-none"
                    >
                      <option value="easy">Easy</option>
                      <option value="medium">Medium</option>
                      <option value="hard">Hard</option>
                    </select>
                  </div>
                </div>

                {/* Limits & Tags */}
                <div className="grid sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] text-kjtext-muted uppercase mb-1">Time Limit (ms)</label>
                    <input
                      type="number"
                      value={form.timeLimitMs}
                      onChange={(e) => setForm({ ...form, timeLimitMs: e.target.value })}
                      className="w-full bg-kjbg border border-kjborder rounded px-3 py-2 text-sm text-kjtext focus:border-kjprimary focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-kjtext-muted uppercase mb-1">Memory Limit (MB)</label>
                    <input
                      type="number"
                      value={form.memoryLimitMb}
                      onChange={(e) => setForm({ ...form, memoryLimitMb: e.target.value })}
                      className="w-full bg-kjbg border border-kjborder rounded px-3 py-2 text-sm text-kjtext focus:border-kjprimary focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-kjtext-muted uppercase mb-1">Tags (comma-separated)</label>
                    <input
                      type="text"
                      value={form.tags}
                      onChange={(e) => setForm({ ...form, tags: e.target.value })}
                      placeholder="arrays, dp, math"
                      className="w-full bg-kjbg border border-kjborder rounded px-3 py-2 text-sm text-kjtext focus:border-kjprimary focus:outline-none"
                    />
                  </div>
                </div>

                {/* Quick Tag Pills */}
                <div className="flex flex-wrap gap-1.5 items-center">
                  <span className="text-[10px] text-kjtext-muted mr-1">Quick tags:</span>
                  {COMMON_TAGS.map((tag) => {
                    const isSelected = form.tags
                      .split(",")
                      .map((t) => t.trim().toLowerCase())
                      .includes(tag.toLowerCase());
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => handleToggleTag(tag)}
                        className={`text-[10px] px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                          isSelected
                            ? "border-kjprimary bg-kjprimary/20 text-kjprimary font-bold shadow-xs"
                            : "border-kjborder/60 bg-kjsurface/60 text-kjtext-muted hover:text-kjprimary hover:border-kjprimary"
                        }`}
                      >
                        {isSelected ? "✓ " : "+"}{tag}
                      </button>
                    );
                  })}
                </div>

                {/* Statement Editor */}
                <div>
                  <div className="flex justify-between items-center mb-1 flex-wrap gap-2">
                    <label className="text-[11px] text-kjtext-muted uppercase">Statement (Markdown & LaTeX)</label>
                    <div className="flex gap-1 flex-wrap items-center">
                      {[
                        { label: "B", insert: "**bold**" },
                        { label: "I", insert: "*italic*" },
                        { label: "Code", insert: "`code`" },
                        { label: "$x$", insert: "$N$" },
                        { label: "$$ Math $$", insert: "\n\n$$ A_i + A_j = X $$\n\n" },
                        { label: "\\sum", insert: "\\sum_{i=1}^n" },
                        { label: "\\le", insert: "\\le" },
                        { label: "\\ge", insert: "\\ge" },
                        { label: "\\frac", insert: "\\frac{a}{b}" },
                        { label: "\\sqrt", insert: "\\sqrt{n}" },
                        { label: "O(N)", insert: "O(N \\log N)" },
                      ].map((btn) => (
                        <button
                          key={btn.label}
                          type="button"
                          onClick={() => setForm({ ...form, statement: form.statement + " " + btn.insert })}
                          className="text-[10px] border border-kjborder px-1.5 py-0.5 rounded text-kjtext-muted hover:text-kjprimary hover:border-kjprimary transition-colors cursor-pointer"
                        >
                          {btn.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <textarea
                    value={form.statement}
                    onChange={(e) => setForm({ ...form, statement: e.target.value })}
                    rows={9}
                    required
                    placeholder="Write problem statement in Markdown. Supports LaTeX math: $N$ for inline math, and $$ \sum_{i=1}^n A_i $$ for display equations..."
                    className="w-full bg-kjbg border border-kjborder rounded p-3 text-xs leading-5 text-kjtext focus:border-kjprimary focus:outline-none font-mono"
                  />
                </div>

                {/* Input & Output Formats */}
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-kjtext-muted uppercase mb-1">Input Format</label>
                    <textarea
                      value={form.inputFormat}
                      onChange={(e) => setForm({ ...form, inputFormat: e.target.value })}
                      rows={3}
                      placeholder="The first line contains an integer T..."
                      className="w-full bg-kjbg border border-kjborder rounded p-2.5 text-xs text-kjtext focus:border-kjprimary focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-kjtext-muted uppercase mb-1">Output Format</label>
                    <textarea
                      value={form.outputFormat}
                      onChange={(e) => setForm({ ...form, outputFormat: e.target.value })}
                      rows={3}
                      placeholder="For each test case, output..."
                      className="w-full bg-kjbg border border-kjborder rounded p-2.5 text-xs text-kjtext focus:border-kjprimary focus:outline-none"
                    />
                  </div>
                </div>

                {/* Constraints & Explanation */}
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-kjtext-muted uppercase mb-1">Constraints</label>
                    <textarea
                      value={form.constraints}
                      onChange={(e) => setForm({ ...form, constraints: e.target.value })}
                      rows={2}
                      placeholder="1 <= N <= 10^5"
                      className="w-full bg-kjbg border border-kjborder rounded p-2.5 text-xs text-kjtext focus:border-kjprimary focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-kjtext-muted uppercase mb-1">Explanation (Optional)</label>
                    <textarea
                      value={form.explanation}
                      onChange={(e) => setForm({ ...form, explanation: e.target.value })}
                      rows={2}
                      placeholder="Sample 1 explanation..."
                      className="w-full bg-kjbg border border-kjborder rounded p-2.5 text-xs text-kjtext focus:border-kjprimary focus:outline-none"
                    />
                  </div>
                </div>

                {/* Test Cases Builder Section */}
                <div className="border border-kjborder/80 rounded-lg p-4 bg-kjbg/50 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-kjtext uppercase tracking-wider">
                      Initial Test Cases ({form.testCases.length})
                    </span>
                    <span className="text-[10px] text-kjtext-muted">
                      {form.testCases.filter((c) => c.isSample).length} samples · {form.testCases.filter((c) => !c.isSample).length} hidden
                    </span>
                  </div>

                  {/* List of currently attached test cases */}
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {form.testCases.length === 0 ? (
                      <p className="text-[11px] text-kjtext-muted italic py-3 text-center border border-dashed border-kjborder rounded">
                        No test cases added yet. Add one below or use the 1-Click Importer.
                      </p>
                    ) : (
                      form.testCases.map((tc, idx) => (
                        <div key={idx} className="border border-kjborder/80 rounded p-2.5 bg-kjsurface/60 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold text-kjtext-muted">#{idx + 1}</span>
                              <span
                                className={`text-[9px] px-1.5 py-0.5 rounded font-bold border ${
                                  tc.isSample
                                    ? "bg-green-500/10 text-green-400 border-green-500/20"
                                    : "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
                                }`}
                              >
                                {tc.isSample ? "SAMPLE" : "HIDDEN"}
                              </span>
                              <span className="text-[10px] text-kjtext-muted truncate max-w-[140px]">
                                IN: {tc.input.trim().slice(0, 20)}
                              </span>
                            </div>

                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleToggleSample(idx)}
                                className="text-[10px] border border-kjborder px-1.5 py-0.5 rounded text-kjtext-muted hover:text-kjtext"
                              >
                                {tc.isSample ? "MAKE HIDDEN" : "MAKE SAMPLE"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setExpandedCase(expandedCase === idx ? null : idx)}
                                className="text-[10px] border border-kjborder px-1.5 py-0.5 rounded text-kjtext-muted hover:text-kjtext"
                              >
                                {expandedCase === idx ? "COLLAPSE" : "VIEW"}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveTestCase(idx)}
                                className="text-[10px] border border-red-500/40 text-red-400 px-1.5 py-0.5 rounded hover:bg-red-500/10"
                              >
                                DEL
                              </button>
                            </div>
                          </div>

                          {expandedCase === idx && (
                            <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-kjborder/40 text-[11px]">
                              <div>
                                <span className="text-[9px] text-kjtext-muted uppercase">Input</span>
                                <pre className="bg-kjbg p-1.5 rounded overflow-x-auto whitespace-pre-wrap">{tc.input}</pre>
                              </div>
                              <div>
                                <span className="text-[9px] text-kjtext-muted uppercase">Expected Output</span>
                                <pre className="bg-kjbg p-1.5 rounded overflow-x-auto whitespace-pre-wrap">{tc.expectedOutput}</pre>
                              </div>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>

                  {/* Inline Add Form */}
                  <div className="pt-2 border-t border-kjborder/60">
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-[10px] uppercase text-kjtext-muted font-bold">Input (stdin)</span>
                          <label className="text-[10px] text-kjprimary hover:underline cursor-pointer flex items-center gap-1">
                            <span>Upload .txt</span>
                            <input
                              type="file"
                              accept=".txt,.in,.stdin"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) void handleLoadTxtFile(f, "input");
                              }}
                            />
                          </label>
                        </div>
                        <textarea
                          value={newTc.input}
                          onChange={(e) => setNewTc({ ...newTc, input: e.target.value })}
                          rows={3}
                          placeholder="Paste or upload input (stdin)..."
                          className="w-full bg-kjbg border border-kjborder rounded p-2 text-xs text-kjtext focus:border-kjprimary focus:outline-none font-mono"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-[10px] uppercase text-kjtext-muted font-bold">Expected Output (stdout)</span>
                          <label className="text-[10px] text-kjprimary hover:underline cursor-pointer flex items-center gap-1">
                            <span>Upload .txt</span>
                            <input
                              type="file"
                              accept=".txt,.out,.ans,.stdout"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) void handleLoadTxtFile(f, "expectedOutput");
                              }}
                            />
                          </label>
                        </div>
                        <textarea
                          value={newTc.expectedOutput}
                          onChange={(e) => setNewTc({ ...newTc, expectedOutput: e.target.value })}
                          rows={3}
                          placeholder="Paste or upload expected output (stdout)..."
                          className="w-full bg-kjbg border border-kjborder rounded p-2 text-xs text-kjtext focus:border-kjprimary focus:outline-none font-mono"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <label className="flex items-center gap-1.5 text-xs text-kjtext-muted cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newTc.isSample}
                          onChange={(e) => setNewTc({ ...newTc, isSample: e.target.checked })}
                        />
                        <span>Is Sample Case (Visible to contestants)</span>
                      </label>
                      <button
                        type="button"
                        onClick={handleAddInlineTestCase}
                        disabled={!newTc.input.trim() || !newTc.expectedOutput.trim()}
                        className="border border-kjprimary text-kjprimary bg-kjprimary/10 hover:bg-kjprimary/20 text-xs px-3 py-1 rounded font-bold transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        + Add Test Case
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* RIGHT / LIVE PREVIEW PANE */}
            {(viewMode === "split" || viewMode === "preview") && (
              <div className="border border-kjborder rounded-lg bg-kjbg/70 p-5 space-y-6 overflow-y-auto max-h-[800px]">
                <div className="border-b border-kjborder pb-3 flex justify-between items-center">
                  <span className="text-xs uppercase tracking-widest text-kjprimary font-bold">
                    Contestant View Preview
                  </span>
                  <div className="flex items-center gap-3 text-[11px] text-kjtext-muted">
                    <span>Time: <strong className="text-kjtext">{form.timeLimitMs}ms</strong></span>
                    <span>Memory: <strong className="text-kjtext">{form.memoryLimitMb}MB</strong></span>
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full border border-kjprimary/30 text-kjprimary bg-kjprimary/5">
                      PROBLEM DRAFT
                    </span>
                    <span
                      className={`text-[10px] font-mono border rounded-full px-2 py-0.5 ${
                        form.difficulty === "easy"
                          ? "text-green-400 border-green-400/20 bg-green-400/5"
                          : form.difficulty === "medium"
                            ? "text-yellow-400 border-yellow-400/20 bg-yellow-400/5"
                            : "text-red-400 border-red-400/20 bg-red-400/5"
                      }`}
                    >
                      {form.difficulty.toUpperCase()}
                    </span>
                    {form.tags
                      .split(",")
                      .map((t) => t.trim())
                      .filter(Boolean)
                      .map((t) => (
                        <span key={t} className="text-[10px] border border-kjborder rounded px-1.5 text-kjtext-muted">
                          {t}
                        </span>
                      ))}
                  </div>
                  <h1 className="text-xl font-bold text-kjtext mt-2 font-mono">
                    {form.title || "Untitled Problem"}
                  </h1>
                </div>

                <div className="prose prose-invert max-w-none text-xs leading-6 text-kjtext font-sans border-t border-kjborder/40 pt-3">
                  <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                    {form.statement || "*No statement written yet.*"}
                  </Markdown>
                </div>

                {form.inputFormat && (
                  <div>
                    <h3 className="text-[11px] uppercase tracking-widest text-kjtext-muted mb-1 font-bold">Input Format</h3>
                    <div className="bg-kjsurface border border-kjborder rounded p-3 text-xs text-kjtext prose prose-invert max-w-none font-mono">
                      <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                        {form.inputFormat}
                      </Markdown>
                    </div>
                  </div>
                )}

                {form.outputFormat && (
                  <div>
                    <h3 className="text-[11px] uppercase tracking-widest text-kjtext-muted mb-1 font-bold">Output Format</h3>
                    <div className="bg-kjsurface border border-kjborder rounded p-3 text-xs text-kjtext prose prose-invert max-w-none font-mono">
                      <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                        {form.outputFormat}
                      </Markdown>
                    </div>
                  </div>
                )}

                {form.constraints && (
                  <div>
                    <h3 className="text-[11px] uppercase tracking-widest text-kjtext-muted mb-1 font-bold">Constraints</h3>
                    <div className="bg-kjsurface border border-kjborder rounded p-3 text-xs text-kjtext prose prose-invert max-w-none font-mono">
                      <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                        {form.constraints}
                      </Markdown>
                    </div>
                  </div>
                )}

                {/* Sample Cases Preview */}
                <div>
                  <h3 className="text-[11px] uppercase tracking-widest text-kjtext-muted mb-2 font-bold">
                    Sample Cases ({form.testCases.filter((c) => c.isSample).length})
                  </h3>
                  <div className="space-y-3">
                    {form.testCases.filter((c) => c.isSample).length === 0 ? (
                      <p className="text-xs text-kjtext-muted italic">No sample test cases marked.</p>
                    ) : (
                      form.testCases
                        .filter((c) => c.isSample)
                        .map((s, idx) => (
                          <div key={idx} className="grid grid-cols-2 gap-3 text-xs font-mono">
                            <div className="bg-kjbg border border-kjborder rounded p-3">
                              <span className="text-[10px] text-kjtext-muted font-bold block mb-1">SAMPLE INPUT #{idx + 1}</span>
                              <pre className="whitespace-pre-wrap text-kjtext">{s.input}</pre>
                            </div>
                            <div className="bg-kjbg border border-kjborder rounded p-3">
                              <span className="text-[10px] text-kjtext-muted font-bold block mb-1">SAMPLE OUTPUT #{idx + 1}</span>
                              <pre className="whitespace-pre-wrap text-kjtext">{s.expectedOutput}</pre>
                            </div>
                          </div>
                        ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: BATCH TEST CASES (POLYGON & CSV) */}
      {activeTab === "bulk_cases" && (
        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between border-b border-kjborder pb-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setBulkMode("polygon")}
                className={`px-3 py-1.5 rounded text-xs font-bold transition-all cursor-pointer ${
                  bulkMode === "polygon"
                    ? "bg-kjprimary/10 text-kjprimary border border-kjprimary/40"
                    : "text-kjtext-muted hover:text-kjtext border border-transparent"
                }`}
              >
                Polygon / ICPC Multi-File Upload
              </button>
              <button
                type="button"
                onClick={() => setBulkMode("csv")}
                className={`px-3 py-1.5 rounded text-xs font-bold transition-all cursor-pointer ${
                  bulkMode === "csv"
                    ? "bg-kjprimary/10 text-kjprimary border border-kjprimary/40"
                    : "text-kjtext-muted hover:text-kjtext border border-transparent"
                }`}
              >
                CSV / Tab Delimited Text
              </button>
            </div>
            <span className="text-[11px] text-kjtext-muted hidden sm:inline">
              {bulkMode === "polygon" ? "Supports Polygon (.a), ICPC (.in/.out), CSV & JSON" : "Comma or tab-delimited text"}
            </span>
          </div>

          {bulkMode === "polygon" ? (
            <div className="border border-kjborder/80 rounded-lg p-5 bg-kjbg/40 space-y-4">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  if (e.dataTransfer.files) {
                    void handlePolygonFiles(e.dataTransfer.files);
                  }
                }}
                className={`border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer relative ${
                  isDragging
                    ? "border-kjprimary bg-kjprimary/10 text-kjprimary"
                    : "border-kjborder hover:border-kjprimary/60 bg-kjsurface/40"
                }`}
              >
                <input
                  type="file"
                  multiple
                  onChange={(e) => {
                    if (e.target.files) {
                      void handlePolygonFiles(e.target.files);
                    }
                  }}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                />
                <div className="space-y-2 pointer-events-none">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg border border-kjprimary/50 text-2xl font-mono text-kjprimary">+</div>
                  <div className="text-xs font-bold text-kjtext uppercase tracking-wider">
                    Drag & Drop Polygon, ICPC, CSV, or JSON Test Files Here
                  </div>
                  <div className="text-[11px] text-kjtext-muted max-w-lg mx-auto">
                    Select all files at once (e.g. <code className="text-kjprimary">01, 01.a</code>, <code className="text-kjprimary">1.in, 1.out</code>, <code className="text-kjprimary">tests.csv</code>, or <code className="text-kjprimary">cases.json</code>). KOJ auto-pairs inputs & outputs and parses structured datasets.
                  </div>
                  <div className="pt-2">
                    <span className="inline-block px-3 py-1 bg-kjsurface border border-kjborder rounded text-[11px] text-kjprimary font-bold">
                      Or click to browse files…
                    </span>
                  </div>
                </div>
              </div>

              {unmatchedFiles.length > 0 && (
                <div className="border border-yellow-400/30 bg-yellow-400/10 rounded p-3 text-xs text-yellow-300 space-y-1">
                  <div className="font-bold">Unmatched Files ({unmatchedFiles.length})</div>
                  <div className="text-[11px] text-yellow-300/80">
                    The following files could not be paired with an input or output counterpart:{" "}
                    <code className="text-yellow-200">{unmatchedFiles.slice(0, 8).join(", ")}{unmatchedFiles.length > 8 ? "…" : ""}</code>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="border border-kjborder/80 rounded-lg p-4 bg-kjbg/40 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-kjprimary uppercase tracking-widest">
                  CSV Test Case Batch
                </span>
                <span className="text-[11px] text-kjtext-muted">
                  One row per test case
                </span>
              </div>
              <p className="text-xs text-kjtext-muted leading-relaxed">
                Format: <code className="text-kjprimary">input,expectedOutput,isSample</code>. Delimited by comma or tab. Multi-line tokens supported in quotes.
              </p>

              <textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                rows={8}
                placeholder={"input,expectedOutput,isSample\n1 2,3,true\n4 5,9,false\n10 20,30,false"}
                className="w-full bg-kjbg border border-kjborder rounded-lg p-3 text-xs font-mono text-kjtext focus:border-kjprimary focus:outline-none"
              />

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={handlePreviewBulk}
                  disabled={!bulkText.trim()}
                  className="border border-kjborder px-4 py-2 rounded text-xs text-kjtext hover:border-kjprimary transition-colors cursor-pointer disabled:opacity-50"
                >
                  PREVIEW PARSED CASES
                </button>
              </div>
            </div>
          )}

          {/* Parsed Preview Table & Attach Button */}
          {parsedBulkCases.length > 0 && (
            <div className="border border-kjborder rounded-lg overflow-hidden bg-kjbg space-y-0">
              <div className="px-4 py-3 border-b border-kjborder bg-kjsurface flex flex-wrap justify-between items-center gap-2">
                <div className="text-xs font-bold text-kjtext uppercase tracking-wider">
                  Parsed Test Cases Preview ({parsedBulkCases.length})
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setParsedBulkCases([]);
                      setUnmatchedFiles([]);
                    }}
                    className="border border-kjborder text-kjtext-muted hover:text-kjtext text-xs px-3 py-1.5 rounded transition-colors cursor-pointer"
                  >
                    CLEAR
                  </button>
                  <button
                    type="button"
                    onClick={handleApplyBulkCases}
                    className="bg-kjprimary text-kjbg font-bold px-4 py-1.5 rounded text-xs hover:glow-sm transition-all cursor-pointer"
                  >
                    ATTACH ALL TO PROBLEM ({parsedBulkCases.length})
                  </button>
                </div>
              </div>

              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="border-b border-kjborder text-left text-kjtext-muted bg-kjsurface/40">
                      <th className="p-3">#</th>
                      <th className="p-3">Input</th>
                      <th className="p-3">Expected Output</th>
                      <th className="p-3">Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedBulkCases.map((c, i) => (
                      <tr key={i} className="border-b border-kjborder/50 hover:bg-kjsurface/50">
                        <td className="p-3 text-kjtext-muted">{i + 1}</td>
                        <td className="p-3 text-kjtext font-mono whitespace-pre-wrap max-w-xs break-all max-h-24 overflow-hidden">
                          {c.input.length > 100 ? `${c.input.slice(0, 100)}…` : c.input}
                        </td>
                        <td className="p-3 text-kjtext font-mono whitespace-pre-wrap max-w-xs break-all max-h-24 overflow-hidden">
                          {c.expectedOutput.length > 100 ? `${c.expectedOutput.slice(0, 100)}…` : c.expectedOutput}
                        </td>
                        <td className="p-3">
                          <button
                            type="button"
                            onClick={() => {
                              setParsedBulkCases((prev) =>
                                prev.map((tc, idx) => (idx === i ? { ...tc, isSample: !tc.isSample } : tc))
                              );
                            }}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-colors ${
                              c.isSample
                                ? "bg-green-500/10 text-green-400 border border-green-500/30"
                                : "bg-yellow-500/10 text-yellow-400 border border-yellow-500/30"
                            }`}
                          >
                            {c.isSample ? "SAMPLE" : "HIDDEN"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
