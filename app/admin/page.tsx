"use client";

/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/app/components/PageHeader";
import StatCard from "@/app/components/StatCard";

type Summary = {
  counts: { users: number; problems: number; contests: number; submissions: number };
  recentProblems: Array<{ id: number; title: string; difficulty: string; status: string; createdAt: string }>;
  recentUsers: Array<{ clerkId: string; username: string; email: string; role: string; createdAt: string }>;
};

type CreateForm = {
  title: string;
  statement: string;
  inputFormat: string;
  outputFormat: string;
  constraints: string;
  difficulty: string;
  tags: string;
  timeLimitMs: string;
  memoryLimitMb: string;
};

export default function AdminPage() {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<CreateForm>({
    title: "",
    statement: "",
    inputFormat: "",
    outputFormat: "",
    constraints: "",
    difficulty: "easy",
    tags: "",
    timeLimitMs: "1000",
    memoryLimitMb: "256",
  });
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function fetchSummary() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/summary", { cache: "no-store" });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `failed (${res.status})`);
      }
      const json = (await res.json()) as Summary;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchSummary();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateMessage(null);
    setCreateError(null);
    setCreating(true);
    try {
      const payload = {
        title: form.title,
        statement: form.statement,
        inputFormat: form.inputFormat,
        outputFormat: form.outputFormat,
        constraints: form.constraints,
        difficulty: form.difficulty,
        tags: form.tags
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        timeLimitMs: Number(form.timeLimitMs),
        memoryLimitMb: Number(form.memoryLimitMb),
      };
      const res = await fetch("/api/admin/problems", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `create failed (${res.status})`);
      }
      const j = (await res.json()) as { id: number };
      setCreateMessage(`Created problem #${j.id}`);
      setForm({
        title: "",
        statement: "",
        inputFormat: "",
        outputFormat: "",
        constraints: "",
        difficulty: "easy",
        tags: "",
        timeLimitMs: "1000",
        memoryLimitMb: "256",
      });
      void fetchSummary();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "create failed");
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Management / DB"
        title="Admin Dashboard"
        description="Manage the KOJ catalogue and users. Data is live from Neon via Drizzle."
        action={{ label: "VIEW PROBLEMS", href: "/problems" }}
      />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading && <p className="border border-kjborder bg-kjsurface rounded p-4 text-xs font-mono text-kjtext-muted">Loading DB summary…</p>}
        {error && (
          <div className="border border-red-500/30 bg-red-500/10 rounded p-4 text-xs font-mono text-red-400 mb-6">
            {error === "forbidden" || error.includes("403") ? "403 · not authorized — admin role required." : `Error: ${error}`}
          </div>
        )}

        {data && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <StatCard label="TOTAL USERS" value={String(data.counts.users)} icon="@" accent />
            <StatCard label="TOTAL PROBLEMS" value={String(data.counts.problems)} icon="{}" accent />
            <StatCard label="TOTAL CONTESTS" value={String(data.counts.contests)} icon="★" accent />
            <StatCard label="SUBMISSIONS" value={String(data.counts.submissions)} icon="→" />
          </div>
        )}

        {createMessage && <p className="mb-5 border border-kjprimary/20 bg-kjprimary/5 text-kjprimary rounded p-3 text-xs font-mono">{createMessage}</p>}
        {createError && <p className="mb-5 border border-red-500/20 bg-red-500/10 text-red-400 rounded p-3 text-xs font-mono">{createError}</p>}

        <div className="grid xl:grid-cols-2 gap-6">
          <section className="bg-kjsurface border border-kjborder rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-kjborder flex justify-between items-center">
              <h2 className="font-mono text-sm text-kjtext">Problem management</h2>
              <span className="text-[11px] font-mono text-kjtext-muted">{data ? `${data.counts.problems} total` : ""}</span>
            </div>
            {data && data.recentProblems.length === 0 && (
              <p className="px-5 py-8 text-center text-xs font-mono text-kjtext-muted">No problems yet. Create one below.</p>
            )}
            {data &&
              data.recentProblems.map((problem) => (
                <div key={problem.id} className="px-5 py-4 border-b border-kjborder/70 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-kjtext">{problem.title}</p>
                    <p className="text-xs font-mono text-kjtext-muted mt-1">
                      #{String(problem.id).padStart(3, "0")} · {problem.status} · {problem.difficulty}
                    </p>
                  </div>
                  <Link href={`/problems/${problem.id}`} className="border border-kjborder rounded px-3 py-1.5 text-[11px] font-mono text-kjtext-muted">
                    VIEW
                  </Link>
                </div>
              ))}
            <form onSubmit={handleCreate} className="p-5 space-y-3 bg-kjbg/30">
              <h3 className="font-mono text-xs text-kjprimary uppercase tracking-widest">Create problem</h3>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Title"
                required
                className="w-full bg-kjsurface border border-kjborder rounded px-3 py-2 text-sm font-mono text-kjtext"
              />
              <textarea
                value={form.statement}
                onChange={(e) => setForm({ ...form, statement: e.target.value })}
                placeholder="Statement"
                required
                rows={3}
                className="w-full bg-kjsurface border border-kjborder rounded px-3 py-2 text-sm font-mono text-kjtext"
              />
              <div className="grid sm:grid-cols-2 gap-3">
                <textarea
                  value={form.inputFormat}
                  onChange={(e) => setForm({ ...form, inputFormat: e.target.value })}
                  placeholder="Input format"
                  required
                  rows={2}
                  className="bg-kjsurface border border-kjborder rounded px-3 py-2 text-sm font-mono text-kjtext"
                />
                <textarea
                  value={form.outputFormat}
                  onChange={(e) => setForm({ ...form, outputFormat: e.target.value })}
                  placeholder="Output format"
                  required
                  rows={2}
                  className="bg-kjsurface border border-kjborder rounded px-3 py-2 text-sm font-mono text-kjtext"
                />
              </div>
              <textarea
                value={form.constraints}
                onChange={(e) => setForm({ ...form, constraints: e.target.value })}
                placeholder="Constraints"
                required
                rows={2}
                className="w-full bg-kjsurface border border-kjborder rounded px-3 py-2 text-sm font-mono text-kjtext"
              />
              <div className="grid sm:grid-cols-3 gap-3">
                <select
                  value={form.difficulty}
                  onChange={(e) => setForm({ ...form, difficulty: e.target.value })}
                  className="bg-kjsurface border border-kjborder rounded px-3 py-2 text-sm font-mono text-kjtext"
                >
                  <option value="easy">easy</option>
                  <option value="medium">medium</option>
                  <option value="hard">hard</option>
                </select>
                <input
                  value={form.timeLimitMs}
                  onChange={(e) => setForm({ ...form, timeLimitMs: e.target.value })}
                  placeholder="Time ms"
                  inputMode="numeric"
                  required
                  className="bg-kjsurface border border-kjborder rounded px-3 py-2 text-sm font-mono text-kjtext"
                />
                <input
                  value={form.memoryLimitMb}
                  onChange={(e) => setForm({ ...form, memoryLimitMb: e.target.value })}
                  placeholder="Memory MB"
                  inputMode="numeric"
                  required
                  className="bg-kjsurface border border-kjborder rounded px-3 py-2 text-sm font-mono text-kjtext"
                />
              </div>
              <input
                value={form.tags}
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
                placeholder="Tags comma-separated (e.g. arrays, dp)"
                className="w-full bg-kjsurface border border-kjborder rounded px-3 py-2 text-sm font-mono text-kjtext"
              />
              <button
                type="submit"
                disabled={creating}
                className="w-full bg-kjprimary text-kjbg font-mono text-xs font-bold tracking-widest px-5 py-3 rounded disabled:opacity-50"
              >
                {creating ? "CREATING…" : "CREATE PROBLEM"}
              </button>
            </form>
          </section>

          <section className="bg-kjsurface border border-kjborder rounded-lg overflow-hidden h-fit">
            <div className="px-5 py-4 border-b border-kjborder">
              <h2 className="font-mono text-sm text-kjtext">User management</h2>
            </div>
            {!data && !loading && <p className="px-5 py-8 text-center text-xs font-mono text-kjtext-muted">No data.</p>}
            {data && (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      {["User", "Email", "Role"].map((heading) => (
                        <th key={heading} className="px-5 py-3 text-left text-[11px] uppercase tracking-widest font-mono text-kjtext-muted">
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentUsers.map((user) => (
                      <tr key={user.clerkId} className="border-t border-kjborder/70">
                        <td className="px-5 py-4 font-mono text-sm text-kjtext">{user.username}</td>
                        <td className="px-5 py-4 text-sm text-kjtext-muted">{user.email}</td>
                        <td className="px-5 py-4 text-xs font-mono text-kjprimary">{user.role}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data && data.recentUsers.length === 0 && <p className="px-5 py-6 text-center text-xs font-mono text-kjtext-muted">No users.</p>}
          </section>
        </div>
      </main>
    </>
  );
}
