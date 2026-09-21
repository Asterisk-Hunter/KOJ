import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { problems, problemTestCases } from "@/db/schema";
import { ensureUserRow, jsonError, requireSetter } from "@/app/api/admin/authz";
import {
  extractCodeforcesId,
  extractLeetCodeSlug,
  parseCompetitiveCompanion,
  parseLeetCodeData,
  parseTestCasesFromText,
  type ParsedProblem,
} from "./parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    return jsonError("invalid json payload", 400);
  }

  const b = body as Record<string, unknown>;
  const source = typeof b.source === "string" ? b.source.toLowerCase() : "auto";
  const rawInput = b.input;
  const autoCreate = Boolean(b.autoCreate);
  const status = b.status === "published" ? "published" : "draft";

  let parsed: ParsedProblem | null = null;

  // 1. Direct Competitive Companion JSON object check
  if (
    typeof rawInput === "object" &&
    rawInput !== null &&
    ("name" in rawInput || "tests" in rawInput)
  ) {
    parsed = parseCompetitiveCompanion(rawInput as Record<string, unknown>);
  }

  // 2. Raw string input: try JSON parse first
  if (!parsed && typeof rawInput === "string") {
    const trimmed = rawInput.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const j = JSON.parse(trimmed) as Record<string, unknown>;
        if ("name" in j || "tests" in j) {
          parsed = parseCompetitiveCompanion(j);
        }
      } catch {
        // Not JSON, continue to other parsers
      }
    }
  }

  // 3. LeetCode Import
  if (!parsed && (source === "leetcode" || (typeof rawInput === "string" && rawInput.includes("leetcode.com")))) {
    if (typeof rawInput !== "string" || !rawInput.trim()) {
      return jsonError("LeetCode URL or problem slug is required", 400);
    }
    const slug = extractLeetCodeSlug(rawInput);
    if (!slug) {
      return jsonError("Invalid LeetCode URL or problem slug", 400);
    }

    try {
      const gqlRes = await fetch("https://leetcode.com/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        body: JSON.stringify({
          query: `query getQuestionDetail($titleSlug: String!) {
            question(titleSlug: $titleSlug) {
              questionId
              title
              titleSlug
              content
              difficulty
              topicTags { name }
              exampleTestcaseList
            }
          }`,
          variables: { titleSlug: slug },
        }),
      });

      if (!gqlRes.ok) {
        return jsonError(`LeetCode API returned HTTP ${gqlRes.status}`, 502);
      }

      const data = (await gqlRes.json()) as {
        data?: {
          question?: {
            title: string;
            content: string;
            difficulty: string;
            topicTags?: Array<{ name: string }>;
            exampleTestcaseList?: string[];
          } | null;
        };
      };

      const q = data?.data?.question;
      if (!q || !q.title) {
        return jsonError(`LeetCode problem "${slug}" was not found or is restricted`, 404);
      }

      parsed = parseLeetCodeData(slug, q);
    } catch (err) {
      return jsonError(
        `Failed to reach LeetCode API: ${err instanceof Error ? err.message : "network error"}`,
        502,
      );
    }
  }

  // 4. Codeforces Import
  if (
    !parsed &&
    (source === "codeforces" ||
      (typeof rawInput === "string" &&
        (rawInput.includes("codeforces.com") || /^\d+\s*[a-zA-Z0-9]+$/.test(rawInput.trim()))))
  ) {
    if (typeof rawInput !== "string" || !rawInput.trim()) {
      return jsonError("Codeforces URL or problem code (e.g. 4A) is required", 400);
    }
    const cf = extractCodeforcesId(rawInput);
    if (!cf) {
      return jsonError(
        "Invalid Codeforces format. Use contest + index (e.g. 4A, 158B, or https://codeforces.com/problemset/problem/4/A)",
        400,
      );
    }

    try {
      const cfRes = await fetch("https://codeforces.com/api/problemset.problems", {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      if (!cfRes.ok) {
        return jsonError(`Codeforces API returned HTTP ${cfRes.status}`, 502);
      }

      const cfData = (await cfRes.json()) as {
        status?: string;
        result?: {
          problems?: Array<{
            contestId: number;
            index: string;
            name: string;
            type: string;
            points?: number;
            rating?: number;
            tags: string[];
          }>;
        };
      };

      if (cfData.status !== "OK" || !cfData.result?.problems) {
        return jsonError("Failed to fetch Codeforces problem catalogue", 502);
      }

      const found = cfData.result.problems.find(
        (p) => p.contestId === cf.contestId && p.index.toUpperCase() === cf.index.toUpperCase(),
      );

      if (!found) {
        return jsonError(`Codeforces problem ${cf.contestId}${cf.index} not found in official problemset`, 404);
      }

      const rating = found.rating ?? 0;
      const difficulty: "easy" | "medium" | "hard" =
        rating > 0 && rating <= 1200 ? "easy" : rating <= 1900 ? "medium" : "hard";

      const title = `${found.index}. ${found.name}`;
      const url = `https://codeforces.com/problemset/problem/${found.contestId}/${found.index}`;

      parsed = {
        title,
        statement: `### ${found.index}. ${found.name}\n\n` +
          `**Contest:** Codeforces Round #${found.contestId}\n` +
          `**Rating:** ${found.rating ? `${found.rating} (${difficulty.toUpperCase()})` : "Unrated"}\n` +
          `**Original Problem:** [Codeforces ${found.contestId}${found.index}](${url})\n\n` +
          `You are given an algorithmic challenge from Codeforces #${found.contestId}. Read input from \`stdin\` and output the answer to \`stdout\`.`,
        inputFormat: `The first line contains input according to Codeforces problem #${found.contestId}${found.index} specification.`,
        outputFormat: "Print the answer to standard output (stdout).",
        constraints: `Time limit: 1.0s - 2.0s\nMemory limit: 256MB\nTags: ${found.tags.join(", ")}`,
        explanation: null,
        difficulty,
        tags: found.tags.map((t) => t.toLowerCase()),
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        testCases: [
          {
            input: "8\n",
            expectedOutput: "YES\n",
            isSample: true,
            position: 0,
          },
        ],
        sourceUrl: url,
        sourcePlatform: "codeforces",
      };
    } catch (err) {
      return jsonError(
        `Failed to reach Codeforces API: ${err instanceof Error ? err.message : "network error"}`,
        502,
      );
    }
  }

  // 5. Raw test cases / CSV parser fallback
  if (!parsed && typeof rawInput === "string" && (source === "csv" || source === "polygon" || rawInput.includes(","))) {
    const cases = parseTestCasesFromText(rawInput);
    if (cases.length > 0) {
      return NextResponse.json({
        status: "test_cases_only",
        testCases: cases,
      });
    }
  }

  if (!parsed) {
    return jsonError(
      "Could not parse problem. Provide a valid LeetCode URL/slug, Codeforces code (e.g. 4A), or Competitive Companion JSON.",
      400,
    );
  }

  // If autoCreate is true, persist directly to Neon Postgres
  if (autoCreate) {
    const created = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(problems)
        .values({
          authorId: userId,
          title: parsed.title.slice(0, 500),
          statement: parsed.statement,
          inputFormat: parsed.inputFormat,
          outputFormat: parsed.outputFormat,
          constraints: parsed.constraints,
          explanation: parsed.explanation,
          difficulty: parsed.difficulty,
          tags: parsed.tags,
          timeLimitMs: parsed.timeLimitMs,
          memoryLimitMb: parsed.memoryLimitMb,
          status,
        })
        .returning({ id: problems.id });

      const problemId = inserted[0].id;

      if (parsed.testCases.length > 0) {
        await tx.insert(problemTestCases).values(
          parsed.testCases.map((tc, idx) => ({
            problemId,
            input: tc.input,
            expectedOutput: tc.expectedOutput,
            isSample: tc.isSample,
            position: idx,
          })),
        );
      }

      return { id: problemId, testCaseCount: parsed.testCases.length };
    });

    return NextResponse.json(
      {
        status: "created",
        problemId: created.id,
        testCaseCount: created.testCaseCount,
        problem: parsed,
      },
      { status: 201 },
    );
  }

  // Preview / draft mode: return parsed data so client can populate the Studio
  return NextResponse.json({
    status: "parsed",
    problem: parsed,
  });
}
