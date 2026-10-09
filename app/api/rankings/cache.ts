import { createHash } from "node:crypto";
import { MAX_STANDINGS_CELLS, MAX_STANDINGS_PROBLEMS, MAX_STANDINGS_ROWS } from "./limits";

export type StandingsPayload = {
  contest: {
    id: number; title: string; status: string; startsAt: string; endsAt: string;
    isFrozen: boolean; freezeMode: string; participation: "official" | "virtual";
    freezeMinutesRemaining: number; revealedAfterFreeze: number;
  };
  problems: Array<{ problemId: number; title: string; position: number; label: string;
    balloonColor: string; balloonName: string; balloonClass: string }>;
  summary: Array<{ problemId: number; label: string; totalSolved: number; totalAttempts: number;
    firstSolveMinutes: number | null; acceptanceRate: number }>;
  rows: Array<{ rank: number; username: string; solvedCount: number; penalty: number;
    perProblem: Array<{ problemId: number; status: "AC" | "WA" | "PENDING" | "--";
      attempts: number; penaltyMinutes: number | null; isFirstToSolve: boolean;
      timeMinutes: number | null; pendingAttempts: number }>;
    solved: Array<"AC" | "WA" | "PENDING" | "--"> }>;
};

export function standingsVersion(inputs: unknown): string {
  return createHash("sha256").update(JSON.stringify(inputs)).digest("hex");
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, names: string[]): boolean {
  return Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));
}
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const text = (value: unknown): value is string => typeof value === "string" && value.length <= 10000;
const nullableCount = (value: unknown) => value === null || count(value);
const status = (value: unknown) => value === "AC" || value === "WA" || value === "PENDING" || value === "--";

function sameStatuses(solved: unknown[], perProblem: unknown[]): boolean {
  return solved.every((s, i) => {
    const problem = perProblem[i];
    return status(s) && record(problem) && s === problem.status;
  });
}

function validPayload(value: unknown): value is StandingsPayload {
  if (!record(value) || !keys(value, ["contest", "problems", "summary", "rows"])) return false;
  const contest = value.contest;
  if (!record(contest) || !keys(contest, ["id", "title", "status", "startsAt", "endsAt", "isFrozen", "freezeMode",
    "participation", "freezeMinutesRemaining", "revealedAfterFreeze"]) || !count(contest.id) || contest.id === 0 ||
    !text(contest.title) || typeof contest.status !== "string" || !["live", "ended", "archived"].includes(contest.status) ||
    !text(contest.startsAt) || !Number.isFinite(Date.parse(contest.startsAt)) ||
    !text(contest.endsAt) || !Number.isFinite(Date.parse(contest.endsAt)) ||
    typeof contest.isFrozen !== "boolean" || typeof contest.freezeMode !== "string" || !["automatic", "frozen", "unfrozen"].includes(contest.freezeMode) ||
    (contest.participation !== "official" && contest.participation !== "virtual") ||
    !count(contest.freezeMinutesRemaining) || !count(contest.revealedAfterFreeze)) return false;
  if (!Array.isArray(value.problems) || value.problems.length > MAX_STANDINGS_PROBLEMS || !value.problems.every((p: unknown) =>
    record(p) && keys(p, ["problemId", "title", "position", "label", "balloonColor", "balloonName", "balloonClass"]) &&
    count(p.problemId) && p.problemId > 0 && count(p.position) && text(p.title) && text(p.label) &&
    text(p.balloonColor) && text(p.balloonName) && text(p.balloonClass))) return false;
  const problemIds = value.problems.map((p: { problemId: number }) => p.problemId);
  if (new Set(problemIds).size !== problemIds.length) return false;
  if (!Array.isArray(value.summary) || value.summary.length !== problemIds.length || !value.summary.every((s: unknown, i: number) =>
    record(s) && keys(s, ["problemId", "label", "totalSolved", "totalAttempts", "firstSolveMinutes", "acceptanceRate"]) &&
    s.problemId === problemIds[i] && text(s.label) && count(s.totalSolved) && count(s.totalAttempts) &&
    nullableCount(s.firstSolveMinutes) && count(s.acceptanceRate) && s.acceptanceRate <= 100)) return false;
  return Array.isArray(value.rows) && value.rows.length <= MAX_STANDINGS_ROWS &&
    value.rows.length * problemIds.length <= MAX_STANDINGS_CELLS && value.rows.every((r: unknown, i: number) =>
    record(r) && keys(r, ["rank", "username", "solvedCount", "penalty", "perProblem", "solved"]) && r.rank === i + 1 &&
    text(r.username) && count(r.solvedCount) && r.solvedCount <= problemIds.length && count(r.penalty) &&
    Array.isArray(r.perProblem) && r.perProblem.length === problemIds.length &&
    r.perProblem.every((p: unknown, j: number) => record(p) &&
      keys(p, ["problemId", "status", "attempts", "penaltyMinutes", "isFirstToSolve", "timeMinutes", "pendingAttempts"]) &&
      p.problemId === problemIds[j] && status(p.status) && count(p.attempts) && nullableCount(p.penaltyMinutes) &&
      typeof p.isFirstToSolve === "boolean" && nullableCount(p.timeMinutes) && count(p.pendingAttempts)) &&
    Array.isArray(r.solved) && r.solved.length === problemIds.length &&
    sameStatuses(r.solved, r.perProblem));
}

export function readStandingsCache(value: unknown, version: string, expectedContest: StandingsPayload["contest"], now: number): StandingsPayload | null {
  if (!record(value) || !keys(value, ["schema", "version", "expiresAt", "payload"]) || value.schema !== 1 ||
      value.version !== version || typeof value.expiresAt !== "number" || !Number.isFinite(value.expiresAt) ||
      now >= value.expiresAt || value.expiresAt > now + 8000 || !validPayload(value.payload)) return null;
  const actual = value.payload.contest;
  if (Object.entries(expectedContest).some(([key, expected]) => actual[key as keyof typeof actual] !== expected)) return null;
  return value.payload;
}

export function standingsCacheEntry(payload: StandingsPayload, version: string, expiresAt: number) {
  return { schema: 1, version, expiresAt, payload };
}
