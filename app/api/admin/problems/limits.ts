export const MAX_PROBLEM_MEMORY_MB = 1024;
export const MAX_TEST_CASES_PER_PROBLEM = 100;
export const MAX_TEST_CASE_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TEST_CASE_STORAGE_BYTES = 16 * 1024 * 1024;

export type TestCaseContent = { input: string; expectedOutput: string };
export type TestCaseLimitViolation = "file_size" | "case_count" | "storage_size";

export function testCaseStorageBytes(testCase: TestCaseContent): number {
  return Buffer.byteLength(testCase.input, "utf8") + Buffer.byteLength(testCase.expectedOutput, "utf8");
}

export function testCaseLimitViolation(
  currentCount: number,
  currentBytes: number,
  additions: readonly TestCaseContent[],
  removals: readonly TestCaseContent[] = [],
): TestCaseLimitViolation | null {
  if (additions.some((testCase) =>
    Buffer.byteLength(testCase.input, "utf8") > MAX_TEST_CASE_FILE_BYTES ||
    Buffer.byteLength(testCase.expectedOutput, "utf8") > MAX_TEST_CASE_FILE_BYTES
  )) {
    return "file_size";
  }
  if (currentCount - removals.length + additions.length > MAX_TEST_CASES_PER_PROBLEM) {
    return "case_count";
  }
  const nextBytes = currentBytes - removals.reduce((total, testCase) => total + testCaseStorageBytes(testCase), 0) +
    additions.reduce((total, testCase) => total + testCaseStorageBytes(testCase), 0);
  return nextBytes > MAX_TEST_CASE_STORAGE_BYTES ? "storage_size" : null;
}

export function testCaseLimitMessage(violation: TestCaseLimitViolation): string {
  switch (violation) {
    case "file_size":
      return "test case input and expected output must each be at most 10MB";
    case "case_count":
      return `at most ${MAX_TEST_CASES_PER_PROBLEM} test cases per problem`;
    case "storage_size":
      return `test case storage must be at most ${MAX_TEST_CASE_STORAGE_BYTES / (1024 * 1024)}MB per problem`;
    default: {
      const exhaustive: never = violation;
      return exhaustive;
    }
  }
}
