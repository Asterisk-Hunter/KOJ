import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { problems, users } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function isAdminOrSetter(userId: string): Promise<boolean> {
  const authObj = await auth();
  let clerkAdmin = false;
  try {
    const hasFn = (authObj as unknown as { has?: (arg: unknown) => Promise<boolean> | boolean }).has;
    if (typeof hasFn === "function") {
      const res = hasFn.call(authObj, { role: "org:admin" });
      clerkAdmin = res instanceof Promise ? await res : Boolean(res);
    }
  } catch {
    clerkAdmin = false;
  }
  if (clerkAdmin) return true;
  const rows = await db.select().from(users).where(eq(users.clerkId, userId)).limit(1);
  if (rows.length === 0) return false;
  const role = rows[0].role;
  return role === "admin" || role === "problem_setter";
}

type Difficulty = "easy" | "medium" | "hard";

function validateDifficulty(v: unknown): Difficulty | null {
  if (typeof v !== "string") return null;
  const lower = v.toLowerCase();
  if (lower === "easy" || lower === "medium" || lower === "hard") return lower;
  return null;
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return jsonError("unauthorized", 401);
  }
  const authorized = await isAdminOrSetter(userId);
  if (!authorized) {
    return jsonError("forbidden", 403);
  }

  // Require real users row
  const userRows = await db.select().from(users).where(eq(users.clerkId, userId)).limit(1);
  if (userRows.length === 0) {
    return jsonError("user not found", 400);
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

  const inserted = await db
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
      status: "draft",
    })
    .returning({ id: problems.id });

  return NextResponse.json({ id: inserted[0].id }, { status: 201 });
}
