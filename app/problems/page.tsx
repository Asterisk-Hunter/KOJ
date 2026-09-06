"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PageHeader from "@/app/components/PageHeader";

type DifficultyFilter = "All" | "Easy" | "Medium" | "Hard";
const difficulties: Array<DifficultyFilter> = ["All", "Easy", "Medium", "Hard"];

type ProblemItem = {
  id: number;
  title: string;
  difficulty: string;
  category: string;
  acceptance: string;
  status: string;
};

function badge(difficulty: string) {
  const d = difficulty.toLowerCase();
  if (d === "easy") return "text-green-400 bg-green-400/10 border-green-400/20";
  if (d === "medium") return "text-yellow-400 bg-yellow-400/10 border-yellow-400/20";
  return "text-red-400 bg-red-400/10 border-red-400/20";
}

function capitalize(s: string) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export default function ProblemsPage() {
  const [search, setSearch] = useState("");
  const [difficulty, setDifficulty] = useState<DifficultyFilter>("All");
  const [category, setCategory] = useState<string>("All");
  const [problems, setProblems] = useState<ProblemItem[]>([]);
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        const q = search.trim();
        if (q) params.set("q", q.slice(0, 100));
        if (difficulty !== "All") params.set("difficulty", difficulty.toLowerCase());
        if (category !== "All") params.set("category", category);
        const qs = params.toString();
        const res = await fetch(`/api/problems${qs ? `?${qs}` : ""}`, { cache: "no-store" });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `Failed to load problems (${res.status})`);
        }
        const data = (await res.json()) as ProblemItem[];
        if (!cancelled) {
          setProblems(data);
          // maintain union of seen categories for filter buttons
          setAvailableCategories((prev) => {
            const nextSet = new Set<string>(prev);
            for (const p of data) {
              if (p.category) nextSet.add(p.category);
            }
            return Array.from(nextSet).sort((a, b) => a.localeCompare(b));
          });
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load problems");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [search, difficulty, category, reloadKey]);

  // Initial category discovery: fetch unfiltered once to populate category buttons even when filtered list hides some categories
  useEffect(() => {
    let cancelled = false;
    async function discover() {
      try {
        const res = await fetch("/api/problems", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as ProblemItem[];
        if (!cancelled && data.length > 0) {
          setAvailableCategories((prev) => {
            const set = new Set<string>(prev);
            for (const p of data) if (p.category) set.add(p.category);
            return Array.from(set).sort((a, b) => a.localeCompare(b));
          });
        }
      } catch {
        // silent
      }
    }
    discover();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <PageHeader
        eyebrow="Archive / indexed"
        title="Problem Archive"
        description="Practice from the public KOJ catalogue. Search by title or topic, then open a problem to read the statement and submit code."
      />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col lg:flex-row gap-3 mb-6">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search title or category..."
            className="flex-1 bg-kjsurface border border-kjborder rounded px-4 py-3 text-sm font-mono text-kjtext placeholder:text-kjtext-muted/50 focus:border-kjprimary focus:outline-none"
          />
          <div className="flex gap-2 flex-wrap">
            {difficulties.map((item) => (
              <button
                key={item}
                onClick={() => setDifficulty(item)}
                className={`px-4 py-2 rounded border text-xs font-mono ${difficulty === item ? "border-kjprimary/50 bg-kjprimary/10 text-kjprimary" : "border-kjborder text-kjtext-muted hover:text-kjtext"}`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        {availableCategories.length > 0 && (
          <div className="flex gap-2 flex-wrap items-center mb-6">
            <span className="text-[11px] uppercase tracking-widest font-mono text-kjtext-muted">Category:</span>
            {["All", ...availableCategories].map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`px-3 py-1.5 rounded border text-xs font-mono ${category === cat ? "border-kjprimary/50 bg-kjprimary/10 text-kjprimary" : "border-kjborder text-kjtext-muted hover:text-kjtext"}`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        <div className="border border-kjborder rounded-lg overflow-hidden bg-kjsurface/30">
          <div className="px-5 py-4 border-b border-kjborder flex justify-between items-center">
            <span className="text-xs uppercase tracking-widest font-mono text-kjtext-muted">
              {loading ? "loading…" : `${problems.length} problems`}
            </span>
            <span className="text-xs font-mono text-kjtext-muted">● solved &nbsp; ◐ attempted &nbsp; ○ new</span>
          </div>

          {loading ? (
            <div className="px-5 py-12 text-center font-mono text-sm text-kjtext-muted">Loading problems…</div>
          ) : error ? (
            <div className="px-5 py-12 text-center">
              <p className="font-mono text-sm text-red-400">{error}</p>
              <button
                onClick={() => setReloadKey((k) => k + 1)}
                className="mt-4 px-4 py-2 rounded border border-kjborder text-xs font-mono text-kjtext-muted hover:text-kjtext"
              >
                Retry
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-kjsurface text-left">
                    {["ID", "Problem", "Difficulty", "Topic", "Acceptance", "Status"].map((heading) => (
                      <th key={heading} className="px-5 py-3 text-[11px] uppercase tracking-widest font-mono text-kjtext-muted">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {problems.map((problem) => (
                    <tr key={problem.id} className="border-t border-kjborder/70 hover:bg-kjsurface transition-colors">
                      <td className="px-5 py-4 font-mono text-sm text-kjtext-muted">{String(problem.id).padStart(3, "0")}</td>
                      <td className="px-5 py-4">
                        <Link href={`/problems/${problem.id}`} className="font-medium text-kjtext hover:text-kjprimary">
                          {problem.title}
                        </Link>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`rounded-full border px-2 py-1 text-xs font-mono ${badge(problem.difficulty)}`}>
                          {capitalize(problem.difficulty)}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-sm text-kjtext-muted">{problem.category}</td>
                      <td className="px-5 py-4 text-sm font-mono text-kjtext-muted">{problem.acceptance}</td>
                      <td className="px-5 py-4 text-sm">
                        {problem.status === "solved" ? (
                          <span className="text-green-400">● Solved</span>
                        ) : problem.status === "attempted" ? (
                          <span className="text-yellow-400">◐ Attempted</span>
                        ) : (
                          <span className="text-zinc-500">○ Unsolved</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && !error && problems.length === 0 && (
            <p className="px-5 py-12 text-center font-mono text-sm text-kjtext-muted">No problems match those filters.</p>
          )}
        </div>
      </main>
    </>
  );
}
