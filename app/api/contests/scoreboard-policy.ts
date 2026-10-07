export type FreezeMode = "automatic" | "frozen" | "unfrozen";

export function getScoreboardFreezeAt(
  mode: FreezeMode,
  manualFrozenAt: Date | null,
  startsAt: Date,
  endsAt: Date,
): Date | null {
  if (mode === "unfrozen") return null;
  if (mode === "frozen") return manualFrozenAt;
  const autoFreezeAt = new Date(Math.max(startsAt.getTime(), endsAt.getTime() - 60 * 60 * 1000));
  return autoFreezeAt;
}

/** Explicit freezing must not reveal results already hidden by an active freeze. */
export function getManualFreezeAt(
  mode: FreezeMode,
  manualFrozenAt: Date | null,
  startsAt: Date,
  endsAt: Date,
  now: Date,
): Date {
  const current = getScoreboardFreezeAt(mode, manualFrozenAt, startsAt, endsAt);
  return current !== null && current <= now ? current : now;
}

export function selectRevealedSubmissionIds(
  submissions: readonly { id: number; submittedAt: Date }[],
  freezeAt: Date | null,
  revealCount: number,
): Set<number> {
  if (!freezeAt) return new Set(submissions.map((submission) => submission.id));
  const hiddenCandidates = [...submissions]
    .filter((submission) => submission.submittedAt >= freezeAt)
    .sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime() || a.id - b.id);
  const revealed = new Set<number>();
  const count = Math.max(0, Math.floor(revealCount));
  for (const submission of hiddenCandidates.slice(0, count)) revealed.add(submission.id);
  return revealed;
}
