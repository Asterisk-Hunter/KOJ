import { withApiGuard } from "@/app/api/guard";
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handleGET() {
  const started = Date.now();
  try {
    await db.execute(sql`select 1 as ok`);
    return NextResponse.json({
      status: "ok",
      db: true,
      latencyMs: Date.now() - started,
    });
  } catch {
    return NextResponse.json(
      {
        status: "degraded",
        db: false,
        error: "database check failed",
        latencyMs: Date.now() - started,
      },
      { status: 200 },
    );
  }
}

export const GET = withApiGuard(handleGET);
