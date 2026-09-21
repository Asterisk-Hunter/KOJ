"use client";

/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState } from "react";

type TestCase = {
  id: number;
  input: string;
  expectedOutput: string;
  isSample: boolean;
  position: number;
};

const inputCls =
  "bg-kjsurface border border-kjborder rounded px-3 py-2 text-sm font-mono text-kjtext";
const btnGhost =
  "border border-kjborder rounded px-3 py-1.5 text-[11px] font-mono text-kjtext-muted hover:text-kjtext disabled:opacity-50";

export default function ProblemTestCases({ problemId }: { problemId: number }) {
  const [cases, setCases] = useState<TestCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ input: "", expectedOutput: "", isSample: false });
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/problems/${problemId}/test-cases`, { cache: "no-store" });
      const j = (await res.json().catch(() => null)) as {
        testCases?: TestCase[];
        error?: string;
      } | null;
      if (!res.ok) throw new Error(j?.error ?? `failed (${res.status})`);
      setCases(j?.testCases ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, [problemId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch(`/api/admin/problems/${problemId}/test-cases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = (await res.json().catch(() => null)) as { error?: string; id?: number } | null;
      if (!res.ok) throw new Error(j?.error ?? `failed (${res.status})`);
      setNotice(`Added test case #${j?.id}`);
      setForm({ input: "", expectedOutput: "", isSample: false });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "add failed");
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(caseId: number) {
    setBusy(caseId);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch(`/api/admin/problems/${problemId}/test-cases/${caseId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `failed (${res.status})`);
      }
      setNotice(`Deleted test case #${caseId}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleToggleSample(c: TestCase) {
    setBusy(c.id);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch(`/api/admin/problems/${problemId}/test-cases/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isSample: !c.isSample }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `failed (${res.status})`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "update failed");
    } finally {
      setBusy(null);
    }
  }

  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [bulkText, setBulkText] = useState("");
  const [bulkAdding, setBulkAdding] = useState(false);

  async function handleBulkAdd() {
    if (!bulkText.trim()) return;
    setBulkAdding(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch(`/api/admin/problems/${problemId}/test-cases/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: bulkText }),
      });
      const j = (await res.json().catch(() => null)) as { error?: string; addedCount?: number } | null;
      if (!res.ok) throw new Error(j?.error ?? `bulk add failed (${res.status})`);
      setNotice(`Added ${j?.addedCount ?? 0} test cases in bulk`);
      setBulkText("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "bulk add failed");
    } finally {
      setBulkAdding(false);
    }
  }

  return (
    <div className="mt-3 border border-kjborder rounded p-3 bg-kjbg/30">
      {notice && <p className="mb-2 text-xs font-mono text-kjprimary">{notice}</p>}
      {error && <p className="mb-2 text-xs font-mono text-red-400">{error}</p>}
      {loading ? (
        <p className="text-xs font-mono text-kjtext-muted">Loading test cases…</p>
      ) : cases.length === 0 ? (
        <p className="text-xs font-mono text-kjtext-muted">No test cases yet.</p>
      ) : (
        cases.map((c) => (
          <div key={c.id} className="flex items-center justify-between py-1.5 gap-3">
            <span className="text-xs font-mono text-kjtext">
              #{c.position} · {c.isSample ? "sample" : "hidden"} · in {c.input.length}B / out{" "}
              {c.expectedOutput.length}B
            </span>
            <span className="flex gap-2">
              <button onClick={() => void handleToggleSample(c)} disabled={busy === c.id} className={btnGhost}>
                {c.isSample ? "HIDE" : "SAMPLE"}
              </button>
              <button onClick={() => void handleDelete(c.id)} disabled={busy === c.id} className={btnGhost}>
                DEL
              </button>
            </span>
          </div>
        ))
      )}

      <div className="flex gap-2 mt-4 pt-3 border-t border-kjborder">
        <button
          type="button"
          onClick={() => setMode("single")}
          className={`px-3 py-1 text-xs font-mono rounded ${
            mode === "single" ? "bg-kjprimary/20 text-kjprimary border border-kjprimary/40" : "text-kjtext-muted"
          }`}
        >
          Single Add
        </button>
        <button
          type="button"
          onClick={() => setMode("bulk")}
          className={`px-3 py-1 text-xs font-mono rounded ${
            mode === "bulk" ? "bg-kjprimary/20 text-kjprimary border border-kjprimary/40" : "text-kjtext-muted"
          }`}
        >
          Bulk Import (CSV)
        </button>
      </div>

      {mode === "single" ? (
        <form onSubmit={(e) => void handleAdd(e)} className="grid sm:grid-cols-2 gap-2 mt-3">
          <textarea
            value={form.input}
            onChange={(e) => setForm({ ...form, input: e.target.value })}
            placeholder="stdin"
            required
            rows={2}
            className={inputCls}
          />
          <textarea
            value={form.expectedOutput}
            onChange={(e) => setForm({ ...form, expectedOutput: e.target.value })}
            placeholder="expected stdout"
            required
            rows={2}
            className={inputCls}
          />
          <label className="flex items-center gap-2 text-xs font-mono text-kjtext-muted">
            <input
              type="checkbox"
              checked={form.isSample}
              onChange={(e) => setForm({ ...form, isSample: e.target.checked })}
            />
            sample (visible to contestants)
          </label>
          <button type="submit" disabled={adding} className={btnGhost}>
            {adding ? "ADDING…" : "ADD TEST CASE"}
          </button>
        </form>
      ) : (
        <div className="space-y-2 mt-3">
          <p className="text-[11px] text-kjtext-muted">
            Format: <code className="text-kjprimary">input,expectedOutput,isSample</code> (one per line)
          </p>
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={"1 2,3,true\n4 5,9,false"}
            rows={4}
            className={`${inputCls} w-full`}
          />
          <button
            type="button"
            onClick={() => void handleBulkAdd()}
            disabled={bulkAdding || !bulkText.trim()}
            className={btnGhost}
          >
            {bulkAdding ? "IMPORTING…" : "BATCH IMPORT TEST CASES"}
          </button>
        </div>
      )}
    </div>
  );
}
