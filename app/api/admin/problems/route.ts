import { withApiGuard } from "@/app/api/guard";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { problems, problemTestCases } from "@/db/schema";
import { ensureUserRow, jsonError, requireSetter } from "@/app/api/admin/authz";
import {
  DEFAULT_OUTPUT_TOLERANCE,
  parseOutputComparator,
  parseOutputTolerance,
} from "@/app/api/admin/problems/comparator";
import { parseCheckerCode } from "@/app/api/admin/problems/checker-code";
import {
  MAX_PROBLEM_MEMORY_MB,
  MAX_TEST_CASES_PER_PROBLEM,
  MAX_TEST_CASE_FILE_BYTES,
  testCaseLimitMessage,
  testCaseLimitViolation,
} from "@/app/api/admin/problems/limits";
import { recordAdminAuditEvent } from "@/app/api/admin/audit-logs/writer";
import { MAX_PROBLEM_AUTHORING_BODY_BYTES, readBoundedJsonObject } from "@/app/api/body-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Difficulty = "easy" | "medium" | "hard";

function validateDifficulty(v: unknown): Difficulty | null {
  if (typeof v !== "string") return null;
  const lower = v.toLowerCase();
  if (lower === "easy" || lower === "medium" || lower === "hard") return lower;
  return null;
}

async function handlePOST(req: NextRequest) {
  const grant = await requireSetter();
  if (!grant.ok) {
    return grant.response;
  }

  const userId = grant.userId;
  const ok = await ensureUserRow(userId);
  if (!ok) {
    return jsonError("user not found or could not be synced", 400);
  }

  const parsed = await readBoundedJsonObject(req, MAX_PROBLEM_AUTHORING_BODY_BYTES, "invalid json");
  if (!parsed.ok) return parsed.response;
  const b = parsed.value;

  const title = b.title;
  const statement = b.statement;
  const inputRaw = b.inputFormat ?? b.input ?? b.input_format;
  const outputRaw = b.outputFormat ?? b.output ?? b.output_format;
  const constraints = b.constraints;
  const difficultyRaw = b.difficulty;
  const tagsRaw = b.tags;
  const timeRaw = b.timeLimitMs ?? b.time_limit_ms ?? b.timeLimit ?? b.time;
  const memoryRaw = b.memoryLimitMb ?? b.memory_limit_mb ?? b.memoryLimit ?? b.memory;
  const comparatorRaw = b.outputComparator ?? "exact";
  const absoluteToleranceRaw = b.absoluteTolerance ?? DEFAULT_OUTPUT_TOLERANCE;
  const relativeToleranceRaw = b.relativeTolerance ?? DEFAULT_OUTPUT_TOLERANCE;
  const checkerCodeResult = parseCheckerCode(b.checkerCode);
  if (!checkerCodeResult.valid) {
    return jsonError("checkerCode must be Python source no larger than 64 KiB", 400);
  }
  const statusRaw = b.status;

  if (typeof title !== "string" || title.trim().length === 0) {
    return jsonError("title is required", 400);
  }
  if (title.trim().length > 500) {
    return jsonError("title too long", 400);
  }
  if (typeof statement !== "string" || statement.trim().length === 0) {
    return jsonError("statement is required", 400);
  }
  if (typeof inputRaw !== "string" || inputRaw.trim().length === 0) {
    return jsonError("inputFormat is required", 400);
  }
  if (typeof outputRaw !== "string" || outputRaw.trim().length === 0) {
    return jsonError("outputFormat is required", 400);
  }
  if (typeof constraints !== "string" || constraints.trim().length === 0) {
    return jsonError("constraints is required", 400);
  }
  const difficulty = validateDifficulty(difficultyRaw);
  if (!difficulty) {
    return jsonError("difficulty must be easy, medium, or hard", 400);
  }

  let tags: string[] = [];
  if (tagsRaw !== undefined) {
    if (!Array.isArray(tagsRaw)) {
      return jsonError("tags must be an array", 400);
    }
    for (const t of tagsRaw) {
      if (typeof t !== "string" || t.trim().length === 0) {
        return jsonError("tags must be non-empty strings", 400);
      }
    }
    tags = (tagsRaw as string[]).map((s) => s.trim());
  }

  let timeLimitMs: number;
  if (typeof timeRaw === "string") {
    const n = Number(timeRaw);
    if (!Number.isInteger(n)) return jsonError("timeLimitMs must be an integer", 400);
    timeLimitMs = n;
  } else if (typeof timeRaw === "number") {
    timeLimitMs = timeRaw;
  } else {
    return jsonError("timeLimitMs is required", 400);
  }
  if (!Number.isInteger(timeLimitMs) || timeLimitMs < 100 || timeLimitMs > 10000) {
    return jsonError("timeLimitMs must be between 100 and 10000", 400);
  }

  let memoryLimitMb: number;
  if (typeof memoryRaw === "string") {
    const n = Number(memoryRaw);
    if (!Number.isInteger(n)) return jsonError("memoryLimitMb must be an integer", 400);
    memoryLimitMb = n;
  } else if (typeof memoryRaw === "number") {
    memoryLimitMb = memoryRaw;
  } else {
    return jsonError("memoryLimitMb is required", 400);
  }
  if (!Number.isInteger(memoryLimitMb) || memoryLimitMb < 16 || memoryLimitMb > MAX_PROBLEM_MEMORY_MB) {
    return jsonError(`memoryLimitMb must be between 16 and ${MAX_PROBLEM_MEMORY_MB}`, 400);
  }

  const outputComparator = parseOutputComparator(comparatorRaw);
  if (!outputComparator) return jsonError("outputComparator must be exact or float", 400);
  const absoluteTolerance = parseOutputTolerance(absoluteToleranceRaw);
  if (absoluteTolerance === null) return jsonError("absoluteTolerance must be between 0 and 1", 400);
  const relativeTolerance = parseOutputTolerance(relativeToleranceRaw);
  if (relativeTolerance === null) return jsonError("relativeTolerance must be between 0 and 1", 400);

  const explanationRaw = b.explanation;
  let explanation: string | null = null;
  if (explanationRaw !== undefined && explanationRaw !== null) {
    if (typeof explanationRaw !== "string") return jsonError("explanation must be a string", 400);
    explanation = explanationRaw.trim().length === 0 ? null : explanationRaw;
  }

  const initialStatus: "draft" | "published" =
    statusRaw === "published" ? "published" : "draft";

  // Validate optional testCases
  type RawCase = { input: unknown; expectedOutput: unknown; isSample?: unknown; position?: unknown };
  const testCasesRaw = b.testCases ?? b.test_cases;
  const validatedCases: Array<{ input: string; expectedOutput: string; isSample: boolean; position: number }> = [];

  if (testCasesRaw !== undefined && testCasesRaw !== null) {
    if (!Array.isArray(testCasesRaw)) {
      return jsonError("testCases must be an array", 400);
    }
    if (testCasesRaw.length > MAX_TEST_CASES_PER_PROBLEM) {
      return jsonError(`at most ${MAX_TEST_CASES_PER_PROBLEM} test cases per problem`, 400);
    }
    for (let i = 0; i < testCasesRaw.length; i++) {
      const tc = testCasesRaw[i] as RawCase;
      if (!tc || typeof tc !== "object") {
        return jsonError(`test case at index ${i} is invalid`, 400);
      }
      if (typeof tc.input !== "string" || tc.input.length === 0) {
        return jsonError(`test case ${i + 1} input must be non-empty`, 400);
      }
      if (Buffer.byteLength(tc.input, "utf8") > MAX_TEST_CASE_FILE_BYTES) {
        return jsonError(`test case ${i + 1} input exceeds 10MB`, 400);
      }
      if (typeof tc.expectedOutput !== "string" || tc.expectedOutput.length === 0) {
        return jsonError(`test case ${i + 1} expectedOutput must be non-empty`, 400);
      }
      if (Buffer.byteLength(tc.expectedOutput, "utf8") > MAX_TEST_CASE_FILE_BYTES) {
        return jsonError(`test case ${i + 1} expectedOutput exceeds 10MB`, 400);
      }
      const isSample = typeof tc.isSample === "boolean" ? tc.isSample : false;
      const position = typeof tc.position === "number" && Number.isInteger(tc.position) && tc.position >= 0
        ? tc.position
        : i;

      validatedCases.push({
        input: tc.input,
        expectedOutput: tc.expectedOutput,
        isSample,
        position,
      });
    }
  }

  const caseLimitViolation = testCaseLimitViolation(0, 0, validatedCases);
  if (caseLimitViolation) return jsonError(testCaseLimitMessage(caseLimitViolation), 400);

  // Publishing an unjudgeable problem would hand out free accepts for it.
  if (initialStatus === "published" && validatedCases.length === 0) {
    return jsonError("publish requires at least one test case", 400);
  }

  // Insert problem and test cases in a single transaction
  const result = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(problems)
      .values({
        organizationId: grant.context.organizationId,
        authorId: userId,
        title: title.trim(),
        statement: (statement as string).trim(),
        inputFormat: (inputRaw as string).trim(),
        outputFormat: (outputRaw as string).trim(),
        constraints: (constraints as string).trim(),
        explanation,
        difficulty,
        tags,
        timeLimitMs,
        memoryLimitMb,
        outputComparator,
        absoluteTolerance,
        relativeTolerance,
        checkerCode: checkerCodeResult.checkerCode,
        status: initialStatus,
      })
      .returning({ id: problems.id });

    const problemId = inserted[0].id;

    if (validatedCases.length > 0) {
      await tx.insert(problemTestCases).values(
        validatedCases.map((c) => ({
          problemId,
          input: c.input,
          expectedOutput: c.expectedOutput,
          isSample: c.isSample,
          position: c.position,
        }))
      );
    }

    await recordAdminAuditEvent(tx, {
      organizationId: grant.context.organizationId,
      actorId: userId,
      action: "problem.created",
      entityType: "problem",
      entityId: problemId,
      metadata: { status: initialStatus, count: validatedCases.length },
    });

    return { id: problemId, testCaseCount: validatedCases.length };
  });

  return NextResponse.json(result, { status: 201 });
}

export const POST = withApiGuard(handlePOST);
