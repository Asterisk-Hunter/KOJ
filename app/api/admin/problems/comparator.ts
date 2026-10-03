export const OUTPUT_COMPARATORS = ["exact", "float"] as const;

export type OutputComparator = (typeof OUTPUT_COMPARATORS)[number];

export const DEFAULT_OUTPUT_TOLERANCE = 0.000001;
export const MAX_OUTPUT_TOLERANCE = 1;

export function parseOutputComparator(value: unknown): OutputComparator | null {
  return typeof value === "string" && OUTPUT_COMPARATORS.includes(value as OutputComparator)
    ? (value as OutputComparator)
    : null;
}

export function parseOutputTolerance(value: unknown): number | null {
  if (typeof value === "string" && value.trim().length === 0) return null;
  const parsed = typeof value === "string" ? Number(value) : value;
  if (
    typeof parsed !== "number" ||
    !Number.isFinite(parsed) ||
    parsed < 0 ||
    parsed > MAX_OUTPUT_TOLERANCE
  ) {
    return null;
  }
  return parsed;
}
