"use client";

import Link from "next/link";
import { useState } from "react";

type Difficulty = "All" | "Easy" | "Medium" | "Hard";
type Category = "All" | "Arrays" | "Graphs" | "DP" | "Strings" | "Trees";

const problems = [
  { id: 1, title: "Two Sum", difficulty: "Easy" as Difficulty, category: "Arrays" as Category, acceptance: "85.2%", status: "solved" },
  { id: 2, title: "Longest Substring", difficulty: "Medium" as Difficulty, category: "Strings" as Category, acceptance: "68.4%", status: "attempted" },
  { id: 3, title: "Merge K Sorted Lists", difficulty: "Hard" as Difficulty, category: "Arrays" as Category, acceptance: "45.1%", status: "unsolved" },
  { id: 4, title: "Binary Tree Traversal", difficulty: "Easy" as Difficulty, category: "Trees" as Category, acceptance: "78.9%", status: "solved" },
  { id: 5, title: "Word Break", difficulty: "Medium" as Difficulty, category: "DP" as Category, acceptance: "52.3%", status: "attempted" },
  { id: 6, title: "Course Schedule", difficulty: "Medium" as Difficulty, category: "Graphs" as Category, acceptance: "61.7%", status: "unsolved" },
  { id: 7, title: "Maximum Subarray", difficulty: "Easy" as Difficulty, category: "DP" as Category, acceptance: "82.5%", status: "solved" },
  { id: 8, title: "Alien Dictionary", difficulty: "Hard" as Difficulty, category: "Graphs" as Category, acceptance: "38.6%", status: "unsolved" },
];

const difficulties: Difficulty[] = ["All", "Easy", "Medium", "Hard"];
const categories: Category[] = ["All", "Arrays", "Graphs", "DP", "Strings", "Trees"];

function difficultyColor(d: Difficulty) {
  if (d === "Easy") return "text-green-400 bg-green-400/10 border border-green-400/20 rounded-full px-2 py-0.5 text-xs font-mono";
  if (d === "Medium") return "text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 rounded-full px-2 py-0.5 text-xs font-mono";
  return "text-red-400 bg-red-400/10 border border-red-400/20 rounded-full px-2 py-0.5 text-xs font-mono";
}

function statusDot(s: string) {
  if (s === "solved") return "bg-green-400";
  if (s === "attempted") return "bg-yellow-400";
  return "bg-zinc-500";
}

export default function ProblemsPage() {
  const [difficulty, setDifficulty] = useState<Difficulty>("All");
  const [category, setCategory] = useState<Category>("All");
  const [search, setSearch] = useState("");

  const filtered = problems.filter((p) => {
    if (difficulty !== "All" && p.difficulty !== difficulty) return false;
    if (category !== "All" && p.category !== category) return false;
    if (search && !p.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Page Title */}
      <h1 className="uppercase font-mono tracking-[0.3em] text-2xl text-kjprimary text-glow mb-2">
        Problem Archive
      </h1>
      <p className="text-xs text-kjtext-muted uppercase tracking-widest mb-8">
        Filter by Difficulty / Category
      </p>

      {/* Filter Bar */}
      <div className="flex flex-col gap-4 mb-8">
        <input
          type="text"
          placeholder="Search problems..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-kjsurface border border-kjborder rounded px-4 py-2.5 text-sm text-kjtext font-mono placeholder:text-kjtext-muted/50 focus:border-kjprimary focus:outline-none focus:glow-sm w-full max-w-md"
        />

        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs font-mono text-kjtext-muted mr-2">DIFFICULTY:</span>
          {difficulties.map((d) => (
            <button
              key={d}
              onClick={() => setDifficulty(d)}
              className={
                difficulty === d
                  ? "bg-kjprimary/10 text-kjprimary border border-kjprimary/30 text-xs font-mono px-3 py-1.5 rounded-full"
                  : "border border-kjborder text-kjtext-muted text-xs font-mono px-3 py-1.5 rounded-full hover:border-kjborder-bright cursor-pointer"
              }
            >
              {d}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs font-mono text-kjtext-muted mr-2">CATEGORY:</span>
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={
                category === c
                  ? "bg-kjprimary/10 text-kjprimary border border-kjprimary/30 text-xs font-mono px-3 py-1.5 rounded-full"
                  : "border border-kjborder text-kjtext-muted text-xs font-mono px-3 py-1.5 rounded-full hover:border-kjborder-bright cursor-pointer"
              }
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Problem Table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-kjsurface border-b border-kjborder">
              <th className="text-left px-4 py-3 uppercase font-mono text-xs tracking-widest text-kjtext-muted">ID</th>
              <th className="text-left px-4 py-3 uppercase font-mono text-xs tracking-widest text-kjtext-muted">Problem</th>
              <th className="text-left px-4 py-3 uppercase font-mono text-xs tracking-widest text-kjtext-muted">Difficulty</th>
              <th className="text-left px-4 py-3 uppercase font-mono text-xs tracking-widest text-kjtext-muted">Category</th>
              <th className="text-left px-4 py-3 uppercase font-mono text-xs tracking-widest text-kjtext-muted">Acceptance</th>
              <th className="text-left px-4 py-3 uppercase font-mono text-xs tracking-widest text-kjtext-muted">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr
                key={p.id}
                className="border-b border-kjborder/50 hover:bg-kjsurface/50 transition-colors"
              >
                <td className="px-4 py-3 text-kjtext-muted font-mono text-sm">{String(p.id).padStart(3, "0")}</td>
                <td className="px-4 py-3">
                  <Link href={`/problems/${p.id}`} className="text-kjtext font-medium hover:text-kjprimary transition-colors">
                    {p.title}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span className={difficultyColor(p.difficulty)}>{p.difficulty}</span>
                </td>
                <td className="px-4 py-3 text-kjtext-muted text-sm font-mono">{p.category}</td>
                <td className="px-4 py-3 text-kjtext-muted text-sm">{p.acceptance}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block w-2 h-2 rounded-full ${statusDot(p.status)}`} />
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-kjtext-muted font-mono text-sm">
                  No problems match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
