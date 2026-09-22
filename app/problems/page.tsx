"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import PageHeader from "@/app/components/PageHeader";

type DifficultyFilter = "All" | "Easy" | "Medium" | "Hard";
const difficulties: Array<DifficultyFilter> = ["All", "Easy", "Medium", "Hard"];

type StatusFilter = "all" | "solved" | "attempted" | "unsolved";
type SortField = "id" | "title" | "difficulty" | "acceptance";
type SortDirection = "asc" | "desc";

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
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [difficulty, setDifficulty] = useState<DifficultyFilter>("All");
  const [category, setCategory] = useState<string>("All");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortField, setSortField] = useState<SortField>("id");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

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

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  }

  function handlePickRandom() {
    if (problems.length === 0) return;
    const unsolved = problems.filter((p) => p.status !== "solved");
    const pool = unsolved.length > 0 ? unsolved : problems;
    const chosen = pool[Math.floor(Math.random() * pool.length)];
    if (chosen) router.push(`/problems/${chosen.id}`);
  }

  const filteredProblems = useMemo(() => {
    const list = problems.filter((p) => {
      if (statusFilter === "all") return true;
      return p.status === statusFilter;
    });

    list.sort((a, b) => {
      let diff = 0;
      if (sortField === "id") diff = a.id - b.id;
      else if (sortField === "title") diff = a.title.localeCompare(b.title);
      else if (sortField === "difficulty") {
        const rank = { easy: 1, medium: 2, hard: 3 };
        diff =
          (rank[a.difficulty.toLowerCase() as keyof typeof rank] || 2) -
          (rank[b.difficulty.toLowerCase() as keyof typeof rank] || 2);
      } else if (sortField === "acceptance") {
        const parseAcc = (s: string) => parseFloat(s.replace("%", "")) || 0;
        diff = parseAcc(a.acceptance) - parseAcc(b.acceptance);
      }
      return sortDirection === "asc" ? diff : -diff;
    });

    return list;
  }, [problems, statusFilter, sortField, sortDirection]);

  return (
    <>
      <PageHeader
        eyebrow="Archive / indexed"
        title="Problem Archive"
        description="Practice from the public KOJ catalogue. Search by title or topic, then open a problem to read the statement and submit code."
      />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col lg:flex-row gap-3 mb-4">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search title or category..."
            className="flex-1 bg-kjsurface border border-kjborder rounded px-4 py-3 text-sm font-mono text-kjtext placeholder:text-kjtext-muted/50 focus:border-kjprimary focus:outline-none"
          />
          <div className="flex gap-2 flex-wrap items-center">
            {difficulties.map((item) => (
              <button
                key={item}
                onClick={() => setDifficulty(item)}
                className={`px-4 py-2 rounded border text-xs font-mono transition-colors cursor-pointer ${difficulty === item ? "border-kjprimary/50 bg-kjprimary/10 text-kjprimary" : "border-kjborder text-kjtext-muted hover:text-kjtext"}`}
              >
                {item}
              </button>
            ))}

            <button
              type="button"
              onClick={handlePickRandom}
              disabled={problems.length === 0}
              className="px-4 py-2 rounded border border-kjprimary/60 bg-kjprimary/10 text-kjprimary hover:bg-kjprimary/20 text-xs font-mono font-bold transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              title="Pick a random problem to solve"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              >
                <circle cx="12" cy="12" r="3.5" />
                <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" />
              </svg>
              <span>PICK RANDOM</span>
            </button>
          </div>
        </div>

        {/* Filter Pills Bar: Status & Category */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6 pb-2 border-b border-kjborder/40">
          <div className="flex gap-2 flex-wrap items-center">
            <span className="text-[11px] uppercase tracking-widest font-mono text-kjtext-muted">Status:</span>
            {[
              { id: "all", label: "All" },
              { id: "solved", label: "Solved ●" },
              { id: "attempted", label: "Attempted ◐" },
              { id: "unsolved", label: "Todo ○" },
            ].map((s) => (
              <button
                key={s.id}
                onClick={() => setStatusFilter(s.id as StatusFilter)}
                className={`px-3 py-1 rounded border text-xs font-mono transition-colors cursor-pointer ${
                  statusFilter === s.id
                    ? "border-kjprimary/60 bg-kjprimary/15 text-kjprimary font-bold"
                    : "border-kjborder text-kjtext-muted hover:text-kjtext"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {availableCategories.length > 0 && (
            <div className="flex gap-1.5 flex-wrap items-center">
              <span className="text-[11px] uppercase tracking-widest font-mono text-kjtext-muted">Topic:</span>
              {["All", ...availableCategories.slice(0, 6)].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className={`px-2.5 py-1 rounded border text-xs font-mono transition-colors cursor-pointer ${category === cat ? "border-kjprimary/50 bg-kjprimary/10 text-kjprimary" : "border-kjborder text-kjtext-muted hover:text-kjtext"}`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="border border-kjborder rounded-lg overflow-hidden bg-kjsurface/30">
          <div className="px-5 py-4 border-b border-kjborder flex justify-between items-center">
            <span className="text-xs uppercase tracking-widest font-mono text-kjtext-muted">
              {loading ? "loading…" : `${filteredProblems.length} ${filteredProblems.length === 1 ? "problem" : "problems"}`}
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
                  <tr className="bg-kjsurface text-left select-none">
                    <th
                      onClick={() => handleSort("id")}
                      className="px-5 py-3 text-[11px] uppercase tracking-widest font-mono text-kjtext-muted hover:text-kjprimary transition-colors cursor-pointer"
                    >
                      ID {sortField === "id" && (sortDirection === "asc" ? "▲" : "▼")}
                    </th>
                    <th
                      onClick={() => handleSort("title")}
                      className="px-5 py-3 text-[11px] uppercase tracking-widest font-mono text-kjtext-muted hover:text-kjprimary transition-colors cursor-pointer"
                    >
                      Problem {sortField === "title" && (sortDirection === "asc" ? "▲" : "▼")}
                    </th>
                    <th
                      onClick={() => handleSort("difficulty")}
                      className="px-5 py-3 text-[11px] uppercase tracking-widest font-mono text-kjtext-muted hover:text-kjprimary transition-colors cursor-pointer"
                    >
                      Difficulty {sortField === "difficulty" && (sortDirection === "asc" ? "▲" : "▼")}
                    </th>
                    <th className="px-5 py-3 text-[11px] uppercase tracking-widest font-mono text-kjtext-muted">
                      Topic
                    </th>
                    <th
                      onClick={() => handleSort("acceptance")}
                      className="px-5 py-3 text-[11px] uppercase tracking-widest font-mono text-kjtext-muted hover:text-kjprimary transition-colors cursor-pointer"
                    >
                      Acceptance {sortField === "acceptance" && (sortDirection === "asc" ? "▲" : "▼")}
                    </th>
                    <th className="px-5 py-3 text-[11px] uppercase tracking-widest font-mono text-kjtext-muted">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProblems.map((problem) => (
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
                      <td className="px-5 py-4 text-sm font-mono">
                        {problem.status === "solved" ? (
                          <span className="text-green-400">● Solved</span>
                        ) : problem.status === "attempted" ? (
                          <span className="text-yellow-400">◐ Attempted</span>
                        ) : (
                          <span className="text-zinc-500">○ Todo</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && !error && filteredProblems.length === 0 && (
            <p className="px-5 py-12 text-center font-mono text-sm text-kjtext-muted">No problems match those filters.</p>
          )}
        </div>
      </main>
    </>
  );
}
