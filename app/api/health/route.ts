import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const started = Date.now();
  try {
    await db.execute(sql`select 1 as ok`);
    return NextResponse.json({
      status: "ok",
      db: true,
      latencyMs: Date.now() - started,
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: "degraded",
        db: false,
        error: err instanceof Error ? err.message : "unknown",
        latencyMs: Date.now() - started,
      },
      { status: 200 },
    );
  }
}
