"use client";

import { useState } from "react";

type ProblemOption = { id: number; title: string };
type Report = {
  problem: ProblemOption;
  method: {
    name: string;
    tokenShingleSize: number;
    windowSize: number;
    minimumSimilarityPercent: number;
    minimumSharedFingerprints: number;
  };
  limits: { candidates: number; sourceCharsPerCandidate: number };
  candidateCount: number;
  matches: Array<{
    first: { submissionId: number; username: string; language: string; submittedAt: string; truncated: boolean };
    second: { submissionId: number; username: string; language: string; submittedAt: string; truncated: boolean };
    similarity: number;
    sharedFingerprints: number;
  }>;
  advisory: string;
};

const fieldClass = "bg-kjsurface border border-kjborder rounded px-3 py-2 text-sm font-mono text-kjtext";

export default function PlagiarismReport({ problems }: { problems: ProblemOption[] }) {
  const [problemId, setProblemId] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function runReport() {
    if (!problemId) return;
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const response = await fetch(`/api/admin/plagiarism?problemId=${encodeURIComponent(problemId)}`, { cache: "no-store" });
      const result = (await response.json().catch(() => null)) as (Report & { error?: string }) | null;
      if (!response.ok) throw new Error(result?.error ?? `Report failed (${response.status})`);
      if (!result) throw new Error("The report response was invalid.");
      setReport(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create report.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <section className="bg-kjsurface border border-kjborder rounded-lg p-5 space-y-4">
        <div>
          <h2 className="font-mono text-sm text-kjtext">Post-contest similarity review</h2>
          <p className="mt-2 text-xs text-kjtext-muted">Compares recent judged submissions for one problem. No source code is shown or returned.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <select className={fieldClass} value={problemId} onChange={(event) => setProblemId(event.target.value)} aria-label="Choose problem">
            <option value="">Select problem…</option>
            {problems.map((problem) => <option key={problem.id} value={problem.id}>#{problem.id} — {problem.title}</option>)}
          </select>
          <button className="border border-kjprimary/40 text-kjprimary rounded px-4 py-2 text-xs font-mono disabled:opacity-50" disabled={!problemId || loading} onClick={() => void runReport()}>
            {loading ? "ANALYZING…" : "RUN REPORT"}
          </button>
        </div>
      </section>

      {error && <p role="alert" className="border border-red-500/30 bg-red-500/10 rounded p-4 text-xs font-mono text-red-400">{error}</p>}
      {report && (
        <section className="bg-kjsurface border border-kjborder rounded-lg overflow-hidden">
          <div className="p-5 border-b border-kjborder space-y-2">
            <h2 className="font-mono text-sm text-kjtext">Problem #{report.problem.id}: {report.problem.title}</h2>
            <p className="text-xs text-kjtext-muted">{report.candidateCount} candidates · top {report.limits.candidates} judged submissions · first {report.limits.sourceCharsPerCandidate.toLocaleString()} source characters each.</p>
            <p className="text-xs text-kjtext-muted">Normalized identifiers/numbers, then {report.method.tokenShingleSize}-token shingles and {report.method.windowSize}-shingle winnowing. Matches require ≥{report.method.minimumSimilarityPercent}% Jaccard similarity and ≥{report.method.minimumSharedFingerprints} shared fingerprints.</p>
          </div>
          {report.matches.length === 0 ? <p className="p-6 text-xs font-mono text-kjtext-muted">No pairs met the review threshold in this candidate sample.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead><tr>{["Similarity", "Submission A", "Submission B", "Shared fingerprints"].map((heading) => <th key={heading} className="px-4 py-3 text-[11px] uppercase tracking-widest font-mono text-kjtext-muted">{heading}</th>)}</tr></thead>
                <tbody>{report.matches.map((match) => <tr key={`${match.first.submissionId}-${match.second.submissionId}`} className="border-t border-kjborder/70">
                  <td className="px-4 py-3 font-mono text-sm text-kjprimary">{match.similarity}%</td>
                  <td className="px-4 py-3 text-xs font-mono text-kjtext">#{match.first.submissionId} · {match.first.username} <span className="text-kjtext-muted">({match.first.language}{match.first.truncated ? ", capped" : ""})</span></td>
                  <td className="px-4 py-3 text-xs font-mono text-kjtext">#{match.second.submissionId} · {match.second.username} <span className="text-kjtext-muted">({match.second.language}{match.second.truncated ? ", capped" : ""})</span></td>
                  <td className="px-4 py-3 text-xs font-mono text-kjtext-muted">{match.sharedFingerprints}</td>
                </tr>)}</tbody>
              </table>
            </div>
          )}
          <p className="px-5 py-4 border-t border-kjborder text-xs text-yellow-300/80">{report.advisory}</p>
        </section>
      )}
    </main>
  );
}
