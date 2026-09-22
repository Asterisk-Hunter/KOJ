/** Scoring helpers extracted for unit testing. */

/** Verdicts that count as wrong submissions (ICPC/DOMjudge rules: CE does NOT incur penalty). */
export const WRONG_VERDICTS: ReadonlySet<string> = new Set([
  "wrong_answer",
  "time_limit_exceeded",
  "memory_limit_exceeded",
  "runtime_error",
  "presentation_error",
]);

/** Count wrong submissions *before* the first accepted in a chronological list. */
export function countWrongBefore(statuses: string[]): number {
  let count = 0;
  for (const s of statuses) {
    if (s === "accepted") break;
    if (WRONG_VERDICTS.has(s)) count++;
  }
  return count;
}

/** ICPC penalty minutes: first-AC time + 20 per wrong before it. */
export function penaltyMinutesForSolve(
  firstAcMinutes: number,
  wrongCount: number,
): number {
  return firstAcMinutes + 20 * wrongCount;
}
