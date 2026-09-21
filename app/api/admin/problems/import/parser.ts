/**
 * Industry-Standard CP Problem Importer & Parser
 * Supports:
 * 1. LeetCode (via LeetCode Public GraphQL API)
 * 2. Codeforces (via Codeforces Public REST API)
 * 3. Competitive Companion (Universal CP Extension JSON)
 * 4. Polygon / CSV / Delimited Test Cases
 */

export type ParsedTestCase = {
  input: string;
  expectedOutput: string;
  isSample: boolean;
  position: number;
};

export type ParsedProblem = {
  title: string;
  statement: string;
  inputFormat: string;
  outputFormat: string;
  constraints: string;
  explanation: string | null;
  difficulty: "easy" | "medium" | "hard";
  tags: string[];
  timeLimitMs: number;
  memoryLimitMb: number;
  testCases: ParsedTestCase[];
  sourceUrl?: string;
  sourcePlatform: "leetcode" | "codeforces" | "competitive-companion" | "polygon" | "custom";
};

/** Convert HTML tags commonly found in LeetCode statements into clean Markdown. */
export function htmlToMarkdown(html: string): string {
  if (!html) return "";

  let md = html;

  // Normalize newlines
  md = md.replace(/\r\n/g, "\n");

  // Code blocks: <pre><code>...</code></pre> or <pre>...</pre>
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, content: string) => {
    // Strip inner tags inside pre except text
    const cleanContent = content
      .replace(/<code[^>]*>/gi, "")
      .replace(/<\/code>/gi, "")
      .replace(/<strong[^>]*>/gi, "")
      .replace(/<\/strong>/gi, "")
      .replace(/<em[^>]*>/gi, "")
      .replace(/<\/em>/gi, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
    return `\n\n\`\`\`\n${cleanContent.trim()}\n\`\`\`\n\n`;
  });

  // Inline code: <code>...</code>
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, c: string) => `\`${c.trim()}\``);

  // Bold: <strong>...</strong> or <b>...</b>
  md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, c: string) => `**${c.trim()}**`);

  // Italic: <em>...</em> or <i>...</i>
  md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, c: string) => `*${c.trim()}*`);

  // Subscript / Superscript
  md = md.replace(/<sup>([\s\S]*?)<\/sup>/gi, (_, c: string) => `^(${c.trim()})`);
  md = md.replace(/<sub>([\s\S]*?)<\/sub>/gi, (_, c: string) => `_(${c.trim()})`);

  // List items
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, c: string) => `\n- ${c.trim()}`);
  md = md.replace(/<\/?[uo]l[^>]*>/gi, "\n");

  // Paragraphs and breaks
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n\n$1\n\n");
  md = md.replace(/<br\s*\/?>/gi, "\n");

  // HTML entities
  md = md
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&times;/g, "×")
    .replace(/&le;/g, "≤")
    .replace(/&ge;/g, "≥")
    .replace(/&ne;/g, "≠");

  // Remove any remaining HTML tags
  md = md.replace(/<[^>]+>/g, "");

  // Clean up excessive whitespace
  md = md.replace(/\n{3,}/g, "\n\n").trim();

  return md;
}

/** Extract LeetCode slug from URL or raw text */
export function extractLeetCodeSlug(input: string): string {
  const trimmed = input.trim();
  // Matches: https://leetcode.com/problems/two-sum/ or /problems/two-sum/
  const urlMatch = trimmed.match(/leetcode\.com\/problems\/([^/?#]+)/i);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1].toLowerCase();
  }
  // Matches raw slug, e.g. "two-sum" or "3sum"
  return trimmed.toLowerCase().replace(/[^a-z0-9-]/g, "");
}

/** Extract Codeforces contestId and index from URL or code (e.g. "4A", "158B", "https://codeforces.com/problemset/problem/4/A") */
export function extractCodeforcesId(input: string): { contestId: number; index: string } | null {
  const trimmed = input.trim();

  // URL matching: /problemset/problem/4/A or /contest/4/problem/A
  const urlMatch = trimmed.match(/(?:problemset\/problem|contest)\/(\d+)\/(?:problem\/)?([a-zA-Z0-9]+)/i);
  if (urlMatch && urlMatch[1] && urlMatch[2]) {
    return {
      contestId: parseInt(urlMatch[1], 10),
      index: urlMatch[2].toUpperCase(),
    };
  }

  // Shorthand matching: "4A", "158B", "1922C1"
  const shortMatch = trimmed.match(/^(\d+)\s*([a-zA-Z0-9]+)$/);
  if (shortMatch && shortMatch[1] && shortMatch[2]) {
    return {
      contestId: parseInt(shortMatch[1], 10),
      index: shortMatch[2].toUpperCase(),
    };
  }

  return null;
}

/** Parse LeetCode GraphQL response into KOJ Problem format */
export function parseLeetCodeData(slug: string, question: {
  title: string;
  content: string;
  difficulty: string;
  topicTags?: Array<{ name: string }>;
  exampleTestcaseList?: string[];
}): ParsedProblem {
  const title = question.title;
  const rawHtml = question.content ?? "";

  // Split constraints if present in the HTML
  let statementHtml = rawHtml;
  let constraintsMarkdown = "Standard contest memory and time limits apply.";

  const constraintsIndex = rawHtml.search(/<strong[^>]*>Constraints:?<\/strong>/i);
  if (constraintsIndex !== -1) {
    statementHtml = rawHtml.substring(0, constraintsIndex);
    const constraintsSection = rawHtml.substring(constraintsIndex);
    constraintsMarkdown = htmlToMarkdown(constraintsSection).replace(/^\*\*Constraints:?\*\*\s*/i, "").trim();
  }

  // Extract examples and sample outputs from <pre><strong>Input:</strong> ... <strong>Output:</strong> ...</pre>
  const testCases: ParsedTestCase[] = [];
  const exampleRegex = /<pre[^>]*>[\s\S]*?<strong>Input:<\/strong>\s*([\s\S]*?)<strong>Output:<\/strong>\s*([\s\S]*?)(?:<strong>Explanation:<\/strong>[\s\S]*?)?<\/pre>/gi;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = exampleRegex.exec(rawHtml)) !== null) {
    const rawIn = match[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').trim();
    const rawOut = match[2].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').trim();

    if (rawIn && rawOut) {
      testCases.push({
        input: rawIn,
        expectedOutput: rawOut,
        isSample: true,
        position: idx++,
      });
    }
  }

  // If regex didn't find outputs, but exampleTestcaseList exists
  if (testCases.length === 0 && Array.isArray(question.exampleTestcaseList)) {
    question.exampleTestcaseList.forEach((rawInput, i) => {
      testCases.push({
        input: rawInput.trim(),
        expectedOutput: "See problem description for expected output format.",
        isSample: true,
        position: i,
      });
    });
  }

  const difficultyMap: Record<string, "easy" | "medium" | "hard"> = {
    easy: "easy",
    medium: "medium",
    hard: "hard",
  };
  const diffLower = (question.difficulty || "medium").toLowerCase();
  const difficulty = difficultyMap[diffLower] ?? "medium";

  const tags = (question.topicTags || []).map((t) => t.name.toLowerCase().trim()).filter(Boolean);

  const cleanStatement = htmlToMarkdown(statementHtml);

  return {
    title,
    statement: cleanStatement || `Solve the ${title} problem.`,
    inputFormat: "Input is provided as function arguments / standard input according to problem specification.",
    outputFormat: "Return or output the result according to problem specification.",
    constraints: constraintsMarkdown || "See problem description.",
    explanation: null,
    difficulty,
    tags: tags.length > 0 ? tags : ["leetcode"],
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    testCases,
    sourceUrl: `https://leetcode.com/problems/${slug}/`,
    sourcePlatform: "leetcode",
  };
}

/** Parse Competitive Companion JSON format (universal browser extension for CP) */
export function parseCompetitiveCompanion(json: Record<string, unknown>): ParsedProblem {
  const name = typeof json.name === "string" ? json.name.trim() : "Imported Problem";
  const group = typeof json.group === "string" ? json.group.trim() : "";
  const url = typeof json.url === "string" ? json.url.trim() : "";
  const timeLimit = typeof json.timeLimit === "number" ? json.timeLimit : 1000;
  const memoryLimit = typeof json.memoryLimit === "number" ? json.memoryLimit : 256;

  const testsRaw = Array.isArray(json.tests) ? json.tests : [];
  const testCases: ParsedTestCase[] = [];

  for (let i = 0; i < testsRaw.length; i++) {
    const t = testsRaw[i] as { input?: string; output?: string };
    if (typeof t?.input === "string" && typeof t?.output === "string") {
      testCases.push({
        input: t.input,
        expectedOutput: t.output,
        isSample: true,
        position: i,
      });
    }
  }

  // Tags from group (e.g. "Codeforces - Codeforces Round 4 (Div. 2)")
  const tags: string[] = [];
  if (group) {
    const parts = group.split(/[-–—/]/).map((p) => p.trim().toLowerCase());
    for (const p of parts) {
      if (p && !tags.includes(p)) tags.push(p.slice(0, 30));
    }
  }
  if (tags.length === 0) tags.push("competitive-programming");

  const statement = `### ${name}\n\n` +
    (group ? `**Contest / Source:** ${group}\n\n` : "") +
    (url ? `**Original Problem URL:** [View on ${group || "Platform"}](${url})\n\n` : "") +
    `Read input from standard input (\`stdin\`) and print output to standard output (\`stdout\`).`;

  return {
    title: name,
    statement,
    inputFormat: "Standard input (stdin) containing test cases.",
    outputFormat: "Standard output (stdout) containing answers.",
    constraints: `Time limit: ${timeLimit}ms\nMemory limit: ${memoryLimit}MB`,
    explanation: null,
    difficulty: "medium",
    tags,
    timeLimitMs: Math.max(100, Math.min(10000, timeLimit)),
    memoryLimitMb: Math.max(16, Math.min(2048, memoryLimit)),
    testCases,
    sourceUrl: url || undefined,
    sourcePlatform: "competitive-companion",
  };
}

/** Parse CSV / Delimited test cases */
export function parseTestCasesFromText(text: string): ParsedTestCase[] {
  const cases: ParsedTestCase[] = [];
  const trimmed = text.trim();
  if (!trimmed) return cases;

  // Check if delimited by block markers:
  // === INPUT === or --- INPUT ---
  if (/(=+|-+)\s*INPUT/i.test(trimmed)) {
    // Parse delimiter blocks
    const pattern = /(?:(?:INPUT|IN)[\s:=*-]*\n([\s\S]*?))\n+(?:(?:OUTPUT|EXPECTED|OUT)[\s:=*-]*\n([\s\S]*?))(?=(?:\n+(=+|-+)\s*(?:INPUT|TEST|CASE)|$))/gi;
    let match: RegExpExecArray | null;
    let pos = 0;
    while ((match = pattern.exec(trimmed)) !== null) {
      const input = match[1].trim();
      const output = match[2].trim();
      if (input && output) {
        cases.push({
          input: input + "\n",
          expectedOutput: output + "\n",
          isSample: pos === 0,
          position: pos++,
        });
      }
    }
    if (cases.length > 0) return cases;
  }

  // Parse CSV / TSV
  const lines = trimmed.split("\n");
  let startIndex = 0;
  // Check header
  if (lines[0].toLowerCase().includes("input") && (lines[0].toLowerCase().includes("output") || lines[0].toLowerCase().includes("expected"))) {
    startIndex = 1;
  }

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Split on tab or comma (considering quotes)
    const delimiter = line.includes("\t") ? "\t" : ",";
    const parts = line.split(delimiter).map((p) => p.replace(/^["']|["']$/g, "").replace(/\\n/g, "\n").trim());

    if (parts.length >= 2 && parts[0] && parts[1]) {
      const isSample = parts[2] ? parts[2].toLowerCase() === "true" || parts[2] === "1" : cases.length === 0;
      cases.push({
        input: parts[0] + (parts[0].endsWith("\n") ? "" : "\n"),
        expectedOutput: parts[1] + (parts[1].endsWith("\n") ? "" : "\n"),
        isSample,
        position: cases.length,
      });
    }
  }

  return cases;
}
