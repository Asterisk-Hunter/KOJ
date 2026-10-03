const SAFE_FIELD_NAMES = new Set([
  "title",
  "statement",
  "inputFormat",
  "outputFormat",
  "constraints",
  "explanation",
  "difficulty",
  "tags",
  "timeLimitMs",
  "memoryLimitMb",
  "outputComparator",
  "absoluteTolerance",
  "relativeTolerance",
  "checkerCode",
  "input",
  "expectedOutput",
  "isSample",
  "position",
  "status",
]);
const SAFE_ROLES = new Set(["admin", "setter", "contestant"]);
const SAFE_STATUSES = new Set([
  "draft",
  "published",
  "contest_active",
  "archived",
  "live",
  "ended",
  "active",
  "suspended",
  "pending",
  "running",
  "accepted",
  "wrong_answer",
  "time_limit_exceeded",
  "memory_limit_exceeded",
  "runtime_error",
  "compilation_error",
  "dead",
  "queued",
  "completed",
]);

export type AuditMetadataInput = Readonly<Record<string, string | number | boolean | null>>;
export type SafeAuditMetadata = Record<string, string | number | boolean>;

export function sanitizeAuditMetadata(value: unknown): SafeAuditMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const safe: SafeAuditMetadata = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "fields" && typeof entry === "string") {
      const fields = entry.split(",").filter((field) => SAFE_FIELD_NAMES.has(field));
      if (fields.length > 0) safe.fields = fields.join(",");
    } else if ((key === "role" || key === "previousRole" || key === "newRole") && typeof entry === "string" && SAFE_ROLES.has(entry)) {
      safe[key] = entry;
    } else if ((key === "status" || key === "previousStatus" || key === "newStatus") && typeof entry === "string" && SAFE_STATUSES.has(entry)) {
      safe[key] = entry;
    } else if (/^(?:[a-zA-Z]+Id|count|attempts)$/.test(key) && typeof entry === "number" && Number.isSafeInteger(entry)) {
      safe[key] = entry;
    } else if (/^(?:enabled|suspended|isSample)$/.test(key) && typeof entry === "boolean") {
      safe[key] = entry;
    }
  }
  return safe;
}

export function sanitizeAuditEventMetadata(value: AuditMetadataInput | undefined): AuditMetadataInput {
  return sanitizeAuditMetadata(value);
}
