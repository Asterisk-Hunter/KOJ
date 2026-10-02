export type RejudgeScope =
  | { kind: "submission"; id: number }
  | { kind: "problem"; id: number }
  | { kind: "contest"; id: number };

export type RejudgeScopeResult =
  | { ok: true; scope: RejudgeScope }
  | { ok: false; error: string };

export function parseRejudgeScope(value: unknown): RejudgeScopeResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "request body must be an object" };
  }

  const body = value as Record<string, unknown>;
  const keys = ["submissionId", "problemId", "contestId"] as const;
  const selected = keys.filter((key) => body[key] !== undefined);
  if (selected.length !== 1 || Object.keys(body).some((key) => !keys.includes(key as (typeof keys)[number]))) {
    return { ok: false, error: "provide exactly one of submissionId, problemId, or contestId" };
  }

  const key = selected[0];
  const id = body[key];
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
    return { ok: false, error: `${key} must be a positive integer` };
  }

  switch (key) {
    case "submissionId":
      return { ok: true, scope: { kind: "submission", id } };
    case "problemId":
      return { ok: true, scope: { kind: "problem", id } };
    case "contestId":
      return { ok: true, scope: { kind: "contest", id } };
    default: {
      const exhaustive: never = key;
      return exhaustive;
    }
  }
}
