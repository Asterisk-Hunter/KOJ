type ResultSource = {
  mode: "run" | "submit";
  status: string;
  errorMessage: string | null;
};

const VERDICTS = new Set([
  "pending", "running", "accepted", "wrong_answer", "time_limit_exceeded",
  "memory_limit_exceeded", "runtime_error", "compilation_error", "presentation_error",
]);

export function publicErrorMessage(row: ResultSource): string | null {
  if (row.mode === "run" || row.status === "compilation_error") return row.errorMessage;
  // Stored diagnostics can predate worker redaction. Runtime errors can include
  // secret stdin in a traceback; only compilation diagnostics are input-free.
  return row.errorMessage ? "Execution failed; test diagnostics are private." : null;
}

export function publicCaseResults(value: unknown, mode: "run" | "submit") {
  if (!Array.isArray(value)) return null;
  return value.slice(0, 100).flatMap((item: unknown) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.index !== "number" || !Number.isSafeInteger(row.index) || row.index < 0 ||
        typeof row.passed !== "boolean" || typeof row.verdict !== "string" || !VERDICTS.has(row.verdict) ||
        typeof row.runtime_ms !== "number" || !Number.isFinite(row.runtime_ms) || row.runtime_ms < 0) return [];
    // There is no immutable sample provenance in stored cases. Do not infer it
    // from today's test ordering or spread untrusted JSON into a response.
    return [{
      index: row.index,
      passed: row.passed,
      verdict: row.verdict,
      runtime_ms: row.runtime_ms,
      stdout: mode === "run" && typeof row.stdout === "string" ? row.stdout.slice(0, 4096) : "",
      stderr: mode === "run" && typeof row.stderr === "string" ? row.stderr.slice(0, 4096) : "",
    }];
  });
}
