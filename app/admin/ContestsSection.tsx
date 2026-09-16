"use client";

/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState } from "react";

type AdminContest = {
  id: number;
  slug: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  status: "draft" | "live" | "ended" | "archived";
  problems: number;
  participants: number;
};

type ContestDetail = AdminContest & {
  problems: Array<{
    problemId: number;
    position: number;
    title: string;
    difficulty: string;
    status: string;
  }>;
  registrations: number;
};

const inputCls =
  "bg-kjsurface border border-kjborder rounded px-3 py-2 text-sm font-mono text-kjtext";
const btnPrimary =
  "bg-kjprimary text-kjbg font-mono text-xs font-bold tracking-widest px-4 py-2 rounded disabled:opacity-50";
const btnGhost =
  "border border-kjborder rounded px-3 py-1.5 text-[11px] font-mono text-kjtext-muted hover:text-kjtext disabled:opacity-50";

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ContestsSection() {
  const [contests, setContests] = useState<AdminContest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<number, ContestDetail>>({});
  const [form, setForm] = useState({ title: "", description: "", slug: "", startsAt: "", endsAt: "" });
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [addProblemId, setAddProblemId] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/contests", { cache: "no-store" });
      const j = (await res.json().catch(() => null)) as {
        contests?: AdminContest[];
        error?: string;
      } | null;
      if (!res.ok) throw new Error(j?.error ?? `failed (${res.status})`);
      setContests(j?.contests ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function mutate(
    key: string,
    fn: () => Promise<{ ok: boolean; status: number; message: string }>,
  ) {
    setBusy(key);
    setNotice(null);
    setError(null);
    try {
      const r = await fn();
      if (!r.ok) throw new Error(r.message);
      setNotice(r.message);
      setExpanded({});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "action failed");
    } finally {
      setBusy(null);
    }
  }

  async function callJson(url: string, init?: RequestInit) {
    const res = await fetch(url, init);
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: res.ok, status: res.status, body: j, message: j?.error ?? `failed (${res.status})` };
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    await mutate("create", async () => {
      setCreating(true);
      try {
        const payload = {
          title: form.title,
          description: form.description,
          slug: form.slug.trim() === "" ? undefined : form.slug.trim(),
          startsAt: new Date(form.startsAt).toISOString(),
          endsAt: new Date(form.endsAt).toISOString(),
        };
        const r = await callJson("/api/admin/contests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (r.ok) setForm({ title: "", description: "", slug: "", startsAt: "", endsAt: "" });
        return { ...r, message: r.ok ? `Created contest #${(r.body as { id?: number })?.id}` : r.message };
      } finally {
        setCreating(false);
      }
    });
  }

  async function handleStatus(id: number, status: string, label: string) {
    await mutate(`${id}:${status}`, async () => {
      const r = await callJson(`/api/admin/contests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      return { ...r, message: r.ok ? `Contest #${id} → ${label}` : r.message };
    });
  }

  async function handleDelete(id: number) {
    if (!window.confirm(`Delete draft contest #${id}? Links and registrations go with it.`)) return;
    await mutate(`${id}:delete`, async () => {
      const r = await callJson(`/api/admin/contests/${id}`, { method: "DELETE" });
      return { ...r, message: r.ok ? `Deleted contest #${id}` : r.message };
    });
  }

  async function toggleExpand(id: number) {
    if (expanded[id]) {
      setExpanded((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      return;
    }
    setBusy(`${id}:expand`);
    try {
      const r = await callJson(`/api/admin/contests/${id}`);
      if (!r.ok) throw new Error(r.message);
      setExpanded((prev) => ({ ...prev, [id]: r.body as ContestDetail }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load detail");
    } finally {
      setBusy(null);
    }
  }

  async function handleAddProblem(id: number) {
    const raw = (addProblemId[id] ?? "").trim();
    const problemId = Number(raw);
    if (!Number.isInteger(problemId) || problemId <= 0) {
      setError("problemId must be a positive integer");
      return;
    }
    await mutate(`${id}:add`, async () => {
      const r = await callJson(`/api/admin/contests/${id}/problems`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ problemId }),
      });
      if (r.ok) {
        const d = await callJson(`/api/admin/contests/${id}`);
        if (d.ok) setExpanded((prev) => ({ ...prev, [id]: d.body as ContestDetail }));
      }
      return { ...r, message: r.ok ? `Added problem #${problemId}` : r.message };
    });
  }

  async function handleRemoveProblem(id: number, problemId: number) {
    await mutate(`${id}:rm${problemId}`, async () => {
      const r = await callJson(
        `/api/admin/contests/${id}/problems?problemId=${problemId}`,
        { method: "DELETE" },
      );
      if (r.ok) {
        const d = await callJson(`/api/admin/contests/${id}`);
        if (d.ok) setExpanded((prev) => ({ ...prev, [id]: d.body as ContestDetail }));
      }
      return { ...r, message: r.ok ? `Removed problem #${problemId}` : r.message };
    });
  }

  return (
    <section className="bg-kjsurface border border-kjborder rounded-lg overflow-hidden mt-6">
      <div className="px-5 py-4 border-b border-kjborder flex justify-between items-center">
        <h2 className="font-mono text-sm text-kjtext">Contest management</h2>
        <span className="text-[11px] font-mono text-kjtext-muted">
          {loading ? "loading…" : `${contests.length} total`}
        </span>
      </div>

      {notice && (
        <p className="mx-5 mt-4 border border-kjprimary/20 bg-kjprimary/5 text-kjprimary rounded p-3 text-xs font-mono">
          {notice}
        </p>
      )}
      {error && (
        <p className="mx-5 mt-4 border border-red-500/20 bg-red-500/10 text-red-400 rounded p-3 text-xs font-mono">
          {error}
        </p>
      )}

      {contests.map((c) => (
        <div key={c.id} className="px-5 py-4 border-b border-kjborder/70">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm text-kjtext">
                {c.title}{" "}
                <span className="text-[11px] font-mono text-kjprimary border border-kjprimary/30 rounded px-1.5 py-0.5 ml-1">
                  {c.status}
                </span>
              </p>
              <p className="text-xs font-mono text-kjtext-muted mt-1">
                #{c.id} · /{c.slug} · {c.problems} problems · {c.participants} registered
              </p>
              <p className="text-[11px] font-mono text-kjtext-muted mt-1">
                {toLocalInput(c.startsAt).replace("T", " ")} → {toLocalInput(c.endsAt).replace("T", " ")}
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => void toggleExpand(c.id)} disabled={busy !== null} className={btnGhost}>
                {expanded[c.id] ? "HIDE" : "MANAGE"}
              </button>
              {c.status === "draft" && (
                <>
                  <button
                    onClick={() => void handleStatus(c.id, "live", "live")}
                    disabled={busy !== null}
                    className={btnGhost}
                  >
                    PUBLISH
                  </button>
                  <button
                    onClick={() => void handleDelete(c.id)}
                    disabled={busy !== null}
                    className={btnGhost}
                  >
                    DELETE
                  </button>
                </>
              )}
              {c.status === "live" && (
                <>
                  <button
                    onClick={() => void handleStatus(c.id, "ended", "ended")}
                    disabled={busy !== null}
                    className={btnGhost}
                  >
                    END NOW
                  </button>
                  <button
                    onClick={() => void handleStatus(c.id, "draft", "draft")}
                    disabled={busy !== null}
                    className={btnGhost}
                  >
                    UNPUBLISH
                  </button>
                </>
              )}
              {c.status === "ended" && (
                <button
                  onClick={() => void handleStatus(c.id, "archived", "archived")}
                  disabled={busy !== null}
                  className={btnGhost}
                >
                  ARCHIVE
                </button>
              )}
              {c.status === "archived" && (
                <button
                  onClick={() => void handleStatus(c.id, "ended", "ended")}
                  disabled={busy !== null}
                  className={btnGhost}
                >
                  REOPEN
                </button>
              )}
            </div>
          </div>

          {expanded[c.id] && (
            <div className="mt-3 border border-kjborder rounded p-3 bg-kjbg/30">
              {expanded[c.id].problems.length === 0 ? (
                <p className="text-xs font-mono text-kjtext-muted">No problems linked yet.</p>
              ) : (
                expanded[c.id].problems.map((p) => (
                  <div key={p.problemId} className="flex items-center justify-between py-1.5 gap-3">
                    <span className="text-xs font-mono text-kjtext">
                      {String.fromCharCode(65 + p.position)} · #{p.problemId} {p.title}
                      <span className="text-kjtext-muted"> · {p.status}</span>
                    </span>
                    {c.status === "draft" && (
                      <button
                        onClick={() => void handleRemoveProblem(c.id, p.problemId)}
                        disabled={busy !== null}
                        className={btnGhost}
                      >
                        REMOVE
                      </button>
                    )}
                  </div>
                ))
              )}
              {c.status === "draft" && (
                <div className="flex gap-2 mt-3">
                  <input
                    value={addProblemId[c.id] ?? ""}
                    onChange={(e) => setAddProblemId((prev) => ({ ...prev, [c.id]: e.target.value }))}
                    placeholder="Problem ID (draft only)"
                    inputMode="numeric"
                    className={`${inputCls} w-48`}
                  />
                  <button onClick={() => void handleAddProblem(c.id)} disabled={busy !== null} className={btnGhost}>
                    ADD PROBLEM
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      <form onSubmit={(e) => void handleCreate(e)} className="p-5 space-y-3 bg-kjbg/30">
        <h3 className="font-mono text-xs text-kjprimary uppercase tracking-widest">Create contest (draft)</h3>
        <input
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="Title"
          required
          maxLength={200}
          className={`${inputCls} w-full`}
        />
        <textarea
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Description"
          rows={2}
          className={`${inputCls} w-full`}
        />
        <div className="grid sm:grid-cols-3 gap-3">
          <input
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value })}
            placeholder="slug (auto)"
            className={inputCls}
          />
          <label className="text-[11px] font-mono text-kjtext-muted">
            STARTS
            <input
              type="datetime-local"
              value={form.startsAt}
              onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
              required
              className={`${inputCls} w-full mt-1`}
            />
          </label>
          <label className="text-[11px] font-mono text-kjtext-muted">
            ENDS
            <input
              type="datetime-local"
              value={form.endsAt}
              onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
              required
              className={`${inputCls} w-full mt-1`}
            />
          </label>
        </div>
        <button type="submit" disabled={creating || busy !== null} className={`${btnPrimary} w-full py-3`}>
          {creating ? "CREATING…" : "CREATE CONTEST"}
        </button>
      </form>
    </section>
  );
}
