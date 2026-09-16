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

type Problem = {
  id: number;
  title: string;
  statement: string;
  inputFormat: string;
  outputFormat: string;
  constraints: string;
  explanation: string;
  difficulty: "easy" | "medium" | "hard";
  tags: string[];
  timeLimitMs: number;
  memoryLimitMb: number;
  status: "draft" | "published" | "contest_active";
  testCases?: TestCase[];
};

const inputCls =
  "bg-kjsurface border border-kjborder rounded px-3 py-2 text-sm font-mono text-kjtext w-full";
const btnPrimary =
  "bg-kjprimary text-kjbg font-mono text-xs font-bold tracking-widest px-4 py-2 rounded disabled:opacity-50";
const btnGhost =
  "border border-kjborder rounded px-3 py-1.5 text-[11px] font-mono text-kjtext-muted hover:text-kjtext disabled:opacity-50";

interface ProblemManagerProps {
  problemId: number;
  onClose: () => void;
  onSaved?: () => void;
}

export default function ProblemManagerSection({
  problemId,
  onClose,
  onSaved,
}: ProblemManagerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);

  const [formData, setFormData] = useState<Partial<Problem>>({});
  const [savingProblem, setSavingProblem] = useState(false);

  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [expandedTc, setExpandedTc] = useState<Record<number, boolean>>({});
  const [editingTc, setEditingTc] = useState<number | null>(null);
  const [tcFormData, setTcFormData] = useState<Partial<TestCase>>({});
  const [newTcData, setNewTcData] = useState({
    input: "",
    expectedOutput: "",
    isSample: false,
    position: 0,
  });
  const [savingTc, setSavingTc] = useState(false);
  const [deletingTc, setDeletingTc] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/problems/${problemId}`, {
        cache: "no-store",
      });
      const j = (await res.json().catch(() => null)) as Problem | { error: string } | null;
      if (!res.ok) {
        throw new Error((j as { error: string })?.error ?? `failed (${res.status})`);
      }
      const prob = j as Problem;
      setProblem(prob);
      setFormData(prob);
      setTestCases(prob.testCases || []);
      setNewTcData(prev => ({ ...prev, position: (prob.testCases || []).length }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load problem");
    } finally {
      setLoading(false);
    }
  }, [problemId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleProblemChange = (field: keyof Problem, value: string | number) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveProblem = async () => {
    setSavingProblem(true);
    setError(null);
    setNotice(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { testCases, id, ...patchData } = formData;
      if (typeof patchData.tags === "string") {
        patchData.tags = (patchData.tags as string)
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
      }
      if (typeof patchData.timeLimitMs === "string") {
        patchData.timeLimitMs = parseInt(patchData.timeLimitMs, 10);
      }
      if (typeof patchData.memoryLimitMb === "string") {
        patchData.memoryLimitMb = parseInt(patchData.memoryLimitMb, 10);
      }

      const res = await fetch(`/api/admin/problems/${problemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchData),
      });
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(j?.error ?? `failed (${res.status})`);
      setNotice("Problem updated successfully");
      if (onSaved) onSaved();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to save problem");
    } finally {
      setSavingProblem(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!problem) return;
    const newStatus = problem.status === "draft" ? "published" : "draft";
    setSavingProblem(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/problems/${problemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(j?.error ?? `failed (${res.status})`);
      setNotice(`Problem ${newStatus}`);
      if (onSaved) onSaved();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to update status");
    } finally {
      setSavingProblem(false);
    }
  };

  const handleAddTestCase = async () => {
    setSavingTc(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/problems/${problemId}/test-cases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newTcData,
          position:
            typeof newTcData.position === "string"
              ? parseInt(newTcData.position, 10)
              : newTcData.position,
        }),
      });
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(j?.error ?? `failed (${res.status})`);
      setNotice("Test case added");
      setNewTcData({
        input: "",
        expectedOutput: "",
        isSample: false,
        position: testCases.length + 1,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to add test case");
    } finally {
      setSavingTc(false);
    }
  };

  const handleUpdateTestCase = async (caseId: number) => {
    setSavingTc(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/admin/problems/${problemId}/test-cases/${caseId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...tcFormData,
            position:
              typeof tcFormData.position === "string"
                ? parseInt(tcFormData.position, 10)
                : tcFormData.position,
          }),
        },
      );
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(j?.error ?? `failed (${res.status})`);
      setNotice("Test case updated");
      setEditingTc(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to update test case");
    } finally {
      setSavingTc(false);
    }
  };

  const handleDeleteTestCase = async (caseId: number) => {
    if (!window.confirm("Delete this test case?")) return;
    setDeletingTc(caseId);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/admin/problems/${problemId}/test-cases/${caseId}`,
        {
          method: "DELETE",
        },
      );
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(j?.error ?? `failed (${res.status})`);
      setNotice("Test case deleted");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to delete test case");
    } finally {
      setDeletingTc(null);
    }
  };

  if (loading) {
    return <div className="p-4 text-kjtext-muted font-mono">Loading...</div>;
  }
  if (!problem) {
    return (
      <div className="p-4 text-red-400 font-mono">Failed to load problem</div>
    );
  }

  return (
    <div className="border border-kjborder bg-kjsurface rounded-lg p-6 space-y-8 font-mono">
      <div className="flex items-center justify-between border-b border-kjborder pb-4">
        <h2 className="text-lg font-bold text-kjtext">
          Manage Problem: {problem.title} (#{problem.id})
        </h2>
        <div className="flex items-center gap-4">
          {problem.status === "contest_active" ? (
            <span className="text-xs border border-kjborder bg-kjsurface px-2 py-1 rounded text-kjtext-muted opacity-50 uppercase cursor-not-allowed">
              LOCKED (CONTEST)
            </span>
          ) : (
            <button
              onClick={handleToggleStatus}
              disabled={savingProblem}
              className={btnGhost}
            >
              {problem.status === "draft" ? "PUBLISH" : "UNPUBLISH"}
            </button>
          )}
          <button onClick={onClose} className={btnGhost}>
            CLOSE
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 text-red-400 text-sm rounded">
          {error}
        </div>
      )}
      {notice && (
        <div className="p-3 bg-kjprimary/5 text-kjprimary text-sm rounded">
          {notice}
        </div>
      )}

      {/* Problem Edit Form */}
      <div className="space-y-4">
        <h3 className="text-kjtext-muted text-sm font-bold uppercase tracking-wider mb-4 border-b border-kjborder pb-2">
          Problem Details
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-kjtext-muted mb-1">
              Title
            </label>
            <input
              type="text"
              className={inputCls}
              value={formData.title ?? ""}
              onChange={(e) => handleProblemChange("title", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-kjtext-muted mb-1">
              Difficulty
            </label>
            <select
              className={inputCls}
              value={formData.difficulty ?? "easy"}
              onChange={(e) => handleProblemChange("difficulty", e.target.value)}
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs text-kjtext-muted mb-1">
              Statement
            </label>
            <textarea
              className={inputCls}
              rows={4}
              value={formData.statement ?? ""}
              onChange={(e) => handleProblemChange("statement", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-kjtext-muted mb-1">
              Input Format
            </label>
            <textarea
              className={inputCls}
              rows={3}
              value={formData.inputFormat ?? ""}
              onChange={(e) => handleProblemChange("inputFormat", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-kjtext-muted mb-1">
              Output Format
            </label>
            <textarea
              className={inputCls}
              rows={3}
              value={formData.outputFormat ?? ""}
              onChange={(e) => handleProblemChange("outputFormat", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-kjtext-muted mb-1">
              Constraints
            </label>
            <textarea
              className={inputCls}
              rows={2}
              value={formData.constraints ?? ""}
              onChange={(e) => handleProblemChange("constraints", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-kjtext-muted mb-1">
              Explanation
            </label>
            <textarea
              className={inputCls}
              rows={2}
              value={formData.explanation ?? ""}
              onChange={(e) => handleProblemChange("explanation", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-kjtext-muted mb-1">
              Tags (comma separated)
            </label>
            <input
              type="text"
              className={inputCls}
              value={
                Array.isArray(formData.tags)
                  ? formData.tags.join(", ")
                  : formData.tags ?? ""
              }
              onChange={(e) => handleProblemChange("tags", e.target.value)}
            />
          </div>
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-xs text-kjtext-muted mb-1">
                Time Limit (ms)
              </label>
              <input
                type="number"
                className={inputCls}
                value={formData.timeLimitMs ?? 1000}
                onChange={(e) => handleProblemChange("timeLimitMs", e.target.value)}
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-kjtext-muted mb-1">
                Mem Limit (MB)
              </label>
              <input
                type="number"
                className={inputCls}
                value={formData.memoryLimitMb ?? 256}
                onChange={(e) => handleProblemChange("memoryLimitMb", e.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="flex justify-end pt-4">
          <button
            onClick={handleSaveProblem}
            disabled={savingProblem}
            className={btnPrimary}
          >
            {savingProblem ? "SAVING..." : "SAVE PROBLEM"}
          </button>
        </div>
      </div>

      {/* Test Cases Manager */}
      <div className="space-y-4 pt-6 border-t border-kjborder">
        <h3 className="text-kjtext-muted text-sm font-bold uppercase tracking-wider mb-4 border-b border-kjborder pb-2">
          Test Cases
        </h3>

        <div className="space-y-3">
          {testCases.map((tc) => (
            <div
              key={tc.id}
              className="border border-kjborder rounded bg-kjbg p-4 space-y-3"
            >
              {editingTc === tc.id ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-6">
                    <label className="flex items-center gap-2 text-xs text-kjtext">
                      <input
                        type="checkbox"
                        checked={tcFormData.isSample ?? false}
                        onChange={(e) =>
                          setTcFormData((p) => ({
                            ...p,
                            isSample: e.target.checked,
                          }))
                        }
                      />
                      Is Sample
                    </label>
                    <div className="flex items-center gap-2 text-xs text-kjtext">
                      <span>Position:</span>
                      <input
                        type="number"
                        className="bg-kjsurface border border-kjborder rounded px-2 py-1 w-16 text-kjtext"
                        value={tcFormData.position ?? 0}
                        onChange={(e) =>
                          setTcFormData((p) => ({
                            ...p,
                            position: parseInt(e.target.value, 10),
                          }))
                        }
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-kjtext-muted mb-1">
                        Input
                      </label>
                      <textarea
                        className={inputCls}
                        rows={5}
                        value={tcFormData.input ?? ""}
                        onChange={(e) =>
                          setTcFormData((p) => ({
                            ...p,
                            input: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-kjtext-muted mb-1">
                        Expected Output
                      </label>
                      <textarea
                        className={inputCls}
                        rows={5}
                        value={tcFormData.expectedOutput ?? ""}
                        onChange={(e) =>
                          setTcFormData((p) => ({
                            ...p,
                            expectedOutput: e.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      onClick={() => setEditingTc(null)}
                      className={btnGhost}
                    >
                      CANCEL
                    </button>
                    <button
                      onClick={() => handleUpdateTestCase(tc.id)}
                      disabled={savingTc}
                      className={btnPrimary}
                    >
                      {savingTc ? "SAVING..." : "SAVE TEST CASE"}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-kjtext-muted font-bold">
                        #{tc.position}
                      </span>
                      {tc.isSample && (
                        <span className="bg-kjprimary/10 text-kjprimary px-2 py-0.5 rounded text-[10px] font-bold border border-kjprimary/20">
                          SAMPLE
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          setExpandedTc((p) => ({ ...p, [tc.id]: !p[tc.id] }))
                        }
                        className={btnGhost}
                      >
                        {expandedTc[tc.id] ? "COLLAPSE" : "EXPAND"}
                      </button>
                      <button
                        onClick={() => {
                          setEditingTc(tc.id);
                          setTcFormData(tc);
                        }}
                        className={btnGhost}
                      >
                        EDIT
                      </button>
                      <button
                        onClick={() => handleDeleteTestCase(tc.id)}
                        disabled={deletingTc === tc.id}
                        className="border border-red-500/50 rounded px-3 py-1.5 text-[11px] font-mono text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                      >
                        {deletingTc === tc.id ? "..." : "DELETE"}
                      </button>
                    </div>
                  </div>

                  {expandedTc[tc.id] ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                      <div className="bg-kjsurface p-3 rounded whitespace-pre-wrap text-xs text-kjtext-muted border border-kjborder font-mono break-words">
                        <div className="text-[10px] font-bold text-kjtext mb-2 uppercase tracking-wider">Input</div>
                        {tc.input}
                      </div>
                      <div className="bg-kjsurface p-3 rounded whitespace-pre-wrap text-xs text-kjtext-muted border border-kjborder font-mono break-words">
                        <div className="text-[10px] font-bold text-kjtext mb-2 uppercase tracking-wider">Expected Output</div>
                        {tc.expectedOutput}
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-4 text-xs text-kjtext-muted truncate mt-2 bg-kjsurface/50 p-2 rounded border border-kjborder/50">
                      <div className="truncate flex-1 font-mono">
                        <span className="text-[10px] font-bold text-kjtext mr-2">IN:</span>
                        {tc.input.length > 60 ? tc.input.slice(0, 60) + "..." : tc.input}
                      </div>
                      <div className="truncate flex-1 font-mono">
                        <span className="text-[10px] font-bold text-kjtext mr-2">OUT:</span>
                        {tc.expectedOutput.length > 60 ? tc.expectedOutput.slice(0, 60) + "..." : tc.expectedOutput}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
          {testCases.length === 0 && (
            <div className="text-xs text-kjtext-muted italic py-6 text-center bg-kjbg rounded border border-kjborder border-dashed">
              No test cases added yet.
            </div>
          )}
        </div>

        <div className="border border-kjborder bg-kjsurface rounded-lg p-5 mt-6 space-y-4">
          <h4 className="text-sm font-bold text-kjtext uppercase tracking-wide border-b border-kjborder pb-2">
            Add New Test Case
          </h4>
          <div className="flex flex-wrap items-center gap-6">
            <label className="flex items-center gap-2 text-xs text-kjtext">
              <input
                type="checkbox"
                checked={newTcData.isSample}
                onChange={(e) =>
                  setNewTcData((p) => ({ ...p, isSample: e.target.checked }))
                }
              />
              Is Sample
            </label>
            <div className="flex items-center gap-2 text-xs text-kjtext">
              <span>Position:</span>
              <input
                type="number"
                className="bg-kjbg border border-kjborder rounded px-2 py-1 w-20 text-kjtext"
                value={newTcData.position}
                onChange={(e) =>
                  setNewTcData((p) => ({
                    ...p,
                    position: parseInt(e.target.value, 10),
                  }))
                }
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-kjtext-muted mb-1">
                Input
              </label>
              <textarea
                className={inputCls}
                rows={4}
                value={newTcData.input}
                onChange={(e) =>
                  setNewTcData((p) => ({ ...p, input: e.target.value }))
                }
                placeholder="Test case input..."
              />
            </div>
            <div>
              <label className="block text-xs text-kjtext-muted mb-1">
                Expected Output
              </label>
              <textarea
                className={inputCls}
                rows={4}
                value={newTcData.expectedOutput}
                onChange={(e) =>
                  setNewTcData((p) => ({
                    ...p,
                    expectedOutput: e.target.value,
                  }))
                }
                placeholder="Expected output..."
              />
            </div>
          </div>
          <div className="flex justify-end pt-3">
            <button
              onClick={handleAddTestCase}
              disabled={savingTc || !newTcData.input || !newTcData.expectedOutput}
              className={btnPrimary}
            >
              {savingTc ? "ADDING..." : "ADD TEST CASE"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
