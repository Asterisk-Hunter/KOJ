import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { problems, problemTestCases } from "@/db/schema";
import { ensureUserRow, jsonError, requireSetter } from "@/app/api/admin/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_CASES = 100;

type Difficulty = "easy" | "medium" | "hard";

function validateDifficulty(v: unknown): Difficulty | null {
  if (typeof v !== "string") return null;
  const lower = v.toLowerCase();
  if (lower === "easy" || lower === "medium" || lower === "hard") return lower;
  return null;
}

export async function POST(req: NextRequest) {
  const grant = await requireSetter();
  if (!grant.ok) {
    return grant.response;
  }

  const userId = grant.userId;
  const ok = await ensureUserRow(userId);
  if (!ok) {
    return jsonError("user not found or could not be synced", 400);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("invalid json", 400);
  }
  const b = body as Record<string, unknown>;

  const title = b.title;
  const statement = b.statement;
  const inputRaw = b.inputFormat ?? b.input ?? b.input_format;
  const outputRaw = b.outputFormat ?? b.output ?? b.output_format;
  const constraints = b.constraints;
  const difficultyRaw = b.difficulty;
  const tagsRaw = b.tags;
  const timeRaw = b.timeLimitMs ?? b.time_limit_ms ?? b.timeLimit ?? b.time;
  const memoryRaw = b.memoryLimitMb ?? b.memory_limit_mb ?? b.memoryLimit ?? b.memory;
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
  if (!Number.isInteger(memoryLimitMb) || memoryLimitMb < 16 || memoryLimitMb > 2048) {
    return jsonError("memoryLimitMb must be between 16 and 2048", 400);
  }

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
    if (testCasesRaw.length > MAX_CASES) {
      return jsonError(`at most ${MAX_CASES} test cases per problem`, 400);
    }
    for (let i = 0; i < testCasesRaw.length; i++) {
      const tc = testCasesRaw[i] as RawCase;
      if (!tc || typeof tc !== "object") {
        return jsonError(`test case at index ${i} is invalid`, 400);
      }
      if (typeof tc.input !== "string" || tc.input.length === 0) {
        return jsonError(`test case ${i + 1} input must be non-empty`, 400);
      }
      if (Buffer.byteLength(tc.input, "utf8") > MAX_FILE_BYTES) {
        return jsonError(`test case ${i + 1} input exceeds 10MB`, 400);
      }
      if (typeof tc.expectedOutput !== "string" || tc.expectedOutput.length === 0) {
        return jsonError(`test case ${i + 1} expectedOutput must be non-empty`, 400);
      }
      if (Buffer.byteLength(tc.expectedOutput, "utf8") > MAX_FILE_BYTES) {
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

  // Insert problem and test cases in a single transaction
  const result = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(problems)
      .values({
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

    return { id: problemId, testCaseCount: validatedCases.length };
  });

  return NextResponse.json(result, { status: 201 });
}
