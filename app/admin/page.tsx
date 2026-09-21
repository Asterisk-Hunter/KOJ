"use client";

/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/app/components/PageHeader";
import StatCard from "@/app/components/StatCard";
import ContestsSection from "@/app/admin/ContestsSection";
import UsersSection from "@/app/admin/UsersSection";
import ProblemTestCases from "@/app/admin/ProblemTestCases";
import ProblemManagerSection from "@/app/admin/ProblemManagerSection";
import ProblemStudio from "@/app/admin/ProblemStudio";
import SubmissionsSection from "@/app/admin/SubmissionsSection";
import ObservabilitySection from "@/app/admin/ObservabilitySection";

type Summary = {
  role?: "admin" | "problem_setter" | "contest_setter";
  counts: { users: number; problems: number; contests: number; submissions: number };
  recentProblems: Array<{ id: number; title: string; difficulty: string; status: string; createdAt: string }>;
  recentUsers: Array<{ clerkId: string; username: string; email: string; role: string; createdAt: string }>;
};

export default function AdminPage() {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showStudio, setShowStudio] = useState(false);
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [expandedTests, setExpandedTests] = useState<number | null>(null);
  const [editingProblemId, setEditingProblemId] = useState<number | null>(null);

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



  async function handleDeleteProblem(id: number) {
    if (
      !window.confirm(
        `Delete problem #${id}? Only problems with no contest links and no submissions can be deleted.`,
      )
    ) {
      return;
    }
    setDeletingId(id);
    setCreateMessage(null);
    setCreateError(null);
    try {
      const res = await fetch(`/api/admin/problems/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `delete failed (${res.status})`);
      }
      setCreateMessage(`Deleted problem #${id}`);
      void fetchSummary();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Management / DB"
        title={
          data?.role === "problem_setter"
            ? "Problem Setter Dashboard"
            : data?.role === "contest_setter"
              ? "Contest Setter Dashboard"
              : "Admin Dashboard"
        }
        description={
          data?.role === "problem_setter"
            ? "Create and manage your competitive programming problems and test cases."
            : data?.role === "contest_setter"
              ? "Create and schedule contests, manage problems and registrations."
              : "Manage the KOJ catalogue, users, contests, and submissions. Data is live from Neon."
        }
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

        {showStudio && (
          <div className="mb-8">
            <ProblemStudio
              onProblemCreated={() => {
                void fetchSummary();
              }}
              onCancel={() => setShowStudio(false)}
            />
          </div>
        )}

        <div className={`grid gap-6 ${data?.role === "problem_setter" ? "grid-cols-1" : "xl:grid-cols-2"}`}>
          <section className="bg-kjsurface border border-kjborder rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-kjborder flex justify-between items-center flex-wrap gap-2">
              <h2 className="font-mono text-sm text-kjtext">Problem management</h2>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowStudio((prev) => !prev)}
                  className="bg-kjprimary text-kjbg hover:glow-sm px-3 py-1 rounded text-xs font-bold uppercase transition-all cursor-pointer"
                >
                  {showStudio ? "✕ Close Studio" : "+ New Problem / ⚡ Import"}
                </button>
                <span className="text-[11px] font-mono text-kjtext-muted">{data ? `${data.counts.problems} total` : ""}</span>
              </div>
            </div>
            {data && data.recentProblems.length === 0 && (
              <p className="px-5 py-8 text-center text-xs font-mono text-kjtext-muted">No problems yet. Create one below.</p>
            )}
            {data &&
              data.recentProblems.map((problem) => (
                <div key={problem.id} className="px-5 py-4 border-b border-kjborder/70">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm text-kjtext">{problem.title}</p>
                      <p className="text-xs font-mono text-kjtext-muted mt-1">
                        #{String(problem.id).padStart(3, "0")} · {problem.status} · {problem.difficulty}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {problem.status === "draft" && (
                        <button
                          onClick={async () => {
                            const res = await fetch(`/api/admin/problems/${problem.id}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ status: "published" }),
                            });
                            if (res.ok) void fetchSummary();
                          }}
                          className="border border-kjprimary/30 rounded px-3 py-1.5 text-[11px] font-mono text-kjprimary hover:bg-kjprimary/10"
                        >
                          PUBLISH
                        </button>
                      )}
                      {problem.status === "published" && (
                        <button
                          onClick={async () => {
                            const res = await fetch(`/api/admin/problems/${problem.id}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ status: "draft" }),
                            });
                            if (res.ok) void fetchSummary();
                          }}
                          className="border border-yellow-500/30 rounded px-3 py-1.5 text-[11px] font-mono text-yellow-400 hover:bg-yellow-500/10"
                        >
                          UNPUBLISH
                        </button>
                      )}
                      {problem.status === "contest_active" && (
                        <span className="border border-kjborder rounded px-3 py-1.5 text-[11px] font-mono text-kjtext-muted opacity-50">
                          LOCKED
                        </span>
                      )}
                      <button
                        onClick={() => setEditingProblemId((prev) => (prev === problem.id ? null : problem.id))}
                        className="border border-kjborder rounded px-3 py-1.5 text-[11px] font-mono text-kjtext-muted hover:text-kjprimary"
                      >
                        {editingProblemId === problem.id ? "CLOSE" : "EDIT"}
                      </button>
                      <button
                        onClick={() => setExpandedTests((prev) => (prev === problem.id ? null : problem.id))}
                        className="border border-kjborder rounded px-3 py-1.5 text-[11px] font-mono text-kjtext-muted"
                      >
                        {expandedTests === problem.id ? "HIDE" : "TESTS"}
                      </button>
                      <Link href={`/problems/${problem.id}`} className="border border-kjborder rounded px-3 py-1.5 text-[11px] font-mono text-kjtext-muted">
                        VIEW
                      </Link>
                      <button
                        onClick={() => void handleDeleteProblem(problem.id)}
                        disabled={deletingId === problem.id}
                        className="border border-kjborder rounded px-3 py-1.5 text-[11px] font-mono text-kjtext-muted hover:text-red-400 disabled:opacity-50"
                      >
                        {deletingId === problem.id ? "…" : "DEL"}
                      </button>
                    </div>
                  </div>
                  {editingProblemId === problem.id && (
                    <ProblemManagerSection
                      problemId={problem.id}
                      onClose={() => setEditingProblemId(null)}
                      onSaved={() => void fetchSummary()}
                    />
                  )}
                  {expandedTests === problem.id && <ProblemTestCases problemId={problem.id} />}
                </div>
              ))}
            <div className="p-5 border-t border-kjborder bg-kjbg/30 text-center space-y-2">
              <p className="text-xs text-kjtext-muted">Need to author or import competitive programming problems?</p>
              <button
                type="button"
                onClick={() => setShowStudio(true)}
                className="border border-kjprimary text-kjprimary hover:bg-kjprimary/10 px-4 py-2 rounded text-xs font-bold transition-all cursor-pointer"
              >
                ⚡ Open Problem Authoring Studio & 1-Click Importer
              </button>
            </div>
          </section>

          {data?.role === "admin" && (
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
          )}
        </div>

        {(data?.role === "admin" || data?.role === "contest_setter") && <ContestsSection />}
        {data?.role === "admin" && <UsersSection />}
        {data?.role === "admin" && <SubmissionsSection />}
        {data?.role === "admin" && <ObservabilitySection />}
      </main>
    </>
  );
}
