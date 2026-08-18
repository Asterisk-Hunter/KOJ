"use client";

import Link from "next/link";
import { useState } from "react";
import PageHeader from "@/app/components/PageHeader";
import { problems, type Difficulty } from "@/mock/data";

const difficulties: Array<"All" | Difficulty> = ["All", "Easy", "Medium", "Hard"];

function badge(difficulty: Difficulty) {
  return difficulty === "Easy" ? "text-green-400 bg-green-400/10 border-green-400/20" : difficulty === "Medium" ? "text-yellow-400 bg-yellow-400/10 border-yellow-400/20" : "text-red-400 bg-red-400/10 border-red-400/20";
}

export default function ProblemsPage() {
  const [search, setSearch] = useState("");
  const [difficulty, setDifficulty] = useState<"All" | Difficulty>("All");
  const filtered = problems.filter((problem) => (difficulty === "All" || problem.difficulty === difficulty) && `${problem.title} ${problem.category}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <PageHeader eyebrow="Archive / 008 indexed" title="Problem Archive" description="Practice from the public KOJ catalogue. Search by title or topic, then open a problem to read the statement and submit code." />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col lg:flex-row gap-3 mb-6">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title or category..." className="flex-1 bg-kjsurface border border-kjborder rounded px-4 py-3 text-sm font-mono text-kjtext placeholder:text-kjtext-muted/50 focus:border-kjprimary focus:outline-none" />
          <div className="flex gap-2 flex-wrap">
            {difficulties.map((item) => <button key={item} onClick={() => setDifficulty(item)} className={`px-4 py-2 rounded border text-xs font-mono ${difficulty === item ? "border-kjprimary/50 bg-kjprimary/10 text-kjprimary" : "border-kjborder text-kjtext-muted hover:text-kjtext"}`}>{item}</button>)}
          </div>
        </div>
        <div className="border border-kjborder rounded-lg overflow-hidden bg-kjsurface/30">
          <div className="px-5 py-4 border-b border-kjborder flex justify-between items-center"><span className="text-xs uppercase tracking-widest font-mono text-kjtext-muted">{filtered.length} problems</span><span className="text-xs font-mono text-kjtext-muted">● solved &nbsp; ◐ attempted &nbsp; ○ new</span></div>
          <div className="overflow-x-auto"><table className="w-full"><thead><tr className="bg-kjsurface text-left">{["ID", "Problem", "Difficulty", "Topic", "Acceptance", "Status"].map((heading) => <th key={heading} className="px-5 py-3 text-[11px] uppercase tracking-widest font-mono text-kjtext-muted">{heading}</th>)}</tr></thead><tbody>{filtered.map((problem) => <tr key={problem.id} className="border-t border-kjborder/70 hover:bg-kjsurface transition-colors"><td className="px-5 py-4 font-mono text-sm text-kjtext-muted">{String(problem.id).padStart(3, "0")}</td><td className="px-5 py-4"><Link href={`/problems/${problem.id}`} className="font-medium text-kjtext hover:text-kjprimary">{problem.title}</Link></td><td className="px-5 py-4"><span className={`rounded-full border px-2 py-1 text-xs font-mono ${badge(problem.difficulty)}`}>{problem.difficulty}</span></td><td className="px-5 py-4 text-sm text-kjtext-muted">{problem.category}</td><td className="px-5 py-4 text-sm font-mono text-kjtext-muted">{problem.acceptance}</td><td className="px-5 py-4 text-sm">{problem.status === "solved" ? <span className="text-green-400">● Solved</span> : problem.status === "attempted" ? <span className="text-yellow-400">◐ Attempted</span> : <span className="text-zinc-500">○ Unsolved</span>}</td></tr>)}</tbody></table></div>
          {filtered.length === 0 && <p className="px-5 py-12 text-center font-mono text-sm text-kjtext-muted">No problems match those filters.</p>}
        </div>
      </main>
    </>
  );
}
