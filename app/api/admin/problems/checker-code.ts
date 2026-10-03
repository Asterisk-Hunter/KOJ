export const MAX_SPECIAL_CHECKER_BYTES = 64 * 1024;

export type CheckerCodeParseResult =
  | { valid: true; checkerCode: string | null }
  | { valid: false };

export function parseCheckerCode(value: unknown): CheckerCodeParseResult {
  if (value === undefined || value === null) {
    return { valid: true, checkerCode: null };
  }
  if (typeof value !== "string") return { valid: false };
  if (value.trim().length === 0) return { valid: true, checkerCode: null };
  if (new TextEncoder().encode(value).byteLength > MAX_SPECIAL_CHECKER_BYTES) {
    return { valid: false };
  }
  return { valid: true, checkerCode: value };
}
