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
  sourcePlatform: "leetcode" | "codeforces" | "atcoder" | "competitive-companion" | "polygon" | "custom";
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

/** Extract AtCoder contest and task id from URL or code (e.g. "abc340_a", "https://atcoder.jp/contests/abc340/tasks/abc340_a") */
export function extractAtCoderTaskId(input: string): { contestId: string; taskId: string } | null {
  const trimmed = input.trim();

  // URL matching: https://atcoder.jp/contests/abc340/tasks/abc340_a
  const urlMatch = trimmed.match(/atcoder\.jp\/contests\/([^/]+)\/tasks\/([^/?#]+)/i);
  if (urlMatch && urlMatch[1] && urlMatch[2]) {
    return {
      contestId: urlMatch[1].toLowerCase(),
      taskId: urlMatch[2].toLowerCase(),
    };
  }

  // Shorthand matching: "abc340_a", "arc170_b", "abc300_c"
  const shortMatch = trimmed.match(/^([a-zA-Z0-9]+)_([a-zA-Z0-9]+)$/i);
  if (shortMatch && shortMatch[1] && shortMatch[2]) {
    return {
      contestId: shortMatch[1].toLowerCase(),
      taskId: trimmed.toLowerCase(),
    };
  }

  return null;
}

/** Parse AtCoder problem HTML into KOJ Problem format */
export function parseAtCoderHtml(html: string, contestId: string, taskId: string): ParsedProblem {
  // Title extraction: <title>A - Arithmetic Progression</title>
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  let title = `${taskId.toUpperCase()}`;
  if (titleMatch && titleMatch[1]) {
    const rawTitle = titleMatch[1].replace(/- AtCoder.*/i, "").trim();
    if (rawTitle) title = rawTitle;
  }

  // Time Limit (sec) and Memory Limit (MiB / MB)
  const timeMatch = html.match(/Time Limit:\s*([\d.]+)\s*sec/i);
  const timeLimitMs = timeMatch ? Math.round(parseFloat(timeMatch[1]) * 1000) : 2000;

  const memMatch = html.match(/Memory Limit:\s*(\d+)\s*(?:MB|MiB)/i);
  const memoryLimitMb = memMatch ? parseInt(memMatch[1], 10) : 1024;

  // Sections
  const stmtMatch = html.match(/<h3>Problem Statement<\/h3>([\s\S]*?)<\/section>/i);
  const statementHtml = stmtMatch ? stmtMatch[1] : "";

  const constrMatch = html.match(/<h3>Constraints<\/h3>([\s\S]*?)<\/section>/i);
  const constraintsHtml = constrMatch ? constrMatch[1] : "";

  const inMatch = html.match(/<h3>Input<\/h3>([\s\S]*?)<\/section>/i);
  const inputHtml = inMatch ? inMatch[1] : "";

  const outMatch = html.match(/<h3>Output<\/h3>([\s\S]*?)<\/section>/i);
  const outputHtml = outMatch ? outMatch[1] : "";

  // Samples
  const testCases: ParsedTestCase[] = [];
  const inRegex = /<h3>Sample Input\s*(\d+)<\/h3>\s*<pre>([\s\S]*?)<\/pre>/gi;
  let match: RegExpExecArray | null;
  let pos = 0;

  while ((match = inRegex.exec(html)) !== null) {
    const num = match[1];
    const input = match[2].trim() + "\n";
    const outRegex = new RegExp(`<h3>Sample Output\\s*${num}</h3>\\s*<pre>([\\s\\S]*?)</pre>`, "i");
    const outMatch = outRegex.exec(html);
    if (outMatch) {
      testCases.push({
        input,
        expectedOutput: outMatch[1].trim() + "\n",
        isSample: true,
        position: pos++,
      });
    }
  }

  // Difficulty heuristic from task letter (e.g. abc340_a -> easy, _c -> medium, _e -> hard)
  let difficulty: "easy" | "medium" | "hard" = "medium";
  const letter = taskId.split("_")[1]?.toLowerCase() || "";
  if (letter === "a" || letter === "b") difficulty = "easy";
  else if (letter === "c" || letter === "d") difficulty = "medium";
  else if (letter >= "e") difficulty = "hard";

  const url = `https://atcoder.jp/contests/${contestId}/tasks/${taskId}`;

  return {
    title,
    statement: htmlToMarkdown(statementHtml) || `Solve the ${title} task from AtCoder ${contestId.toUpperCase()}.`,
    inputFormat: htmlToMarkdown(inputHtml) || "Standard input (stdin) format.",
    outputFormat: htmlToMarkdown(outputHtml) || "Standard output (stdout) format.",
    constraints: htmlToMarkdown(constraintsHtml) || "Standard contest constraints apply.",
    explanation: null,
    difficulty,
    tags: ["atcoder", contestId.toLowerCase(), `task-${letter}`],
    timeLimitMs: Math.max(100, Math.min(10000, timeLimitMs)),
    memoryLimitMb: Math.max(16, Math.min(2048, memoryLimitMb)),
    testCases,
    sourceUrl: url,
    sourcePlatform: "atcoder",
  };
}

/**
 * Automatically pairs multi-file uploads into structured test cases according to
 * industry standards (Codeforces Polygon, ICPC / Domjudge, and HackerRank / Kattis).
 *
 * Supported conventions:
 * 1. Polygon format: "01" (input) and "01.a" (output)
 * 2. Extension format: "01.in" / "01.out" or "01.ans"
 * 3. Prefix format: "input01.txt" / "output01.txt" or "in1.txt" / "out1.txt"
 * 4. Subfolder structure: "tests/01" and "tests/01.a"
 */
export function pairPolygonTestFiles(
  files: Array<{ name: string; content: string }>
): { paired: ParsedTestCase[]; unmatched: string[] } {
  // Normalize filenames (strip path prefixes like "tests/")
  const fileMap = new Map<string, { originalName: string; content: string }>();
  for (const f of files) {
    const base = f.name.split("/").pop() || f.name;
    fileMap.set(base, { originalName: f.name, content: f.content });
  }

  const paired: ParsedTestCase[] = [];
  const matchedFiles = new Set<string>();

  type Candidate = {
    baseKey: string;
    kind: "input" | "output";
    fileName: string;
    content: string;
  };

  const inputs: Candidate[] = [];
  const outputs = new Map<string, Candidate>();

  for (const [fileName, item] of fileMap.entries()) {
    // 1. Polygon format: e.g. "01.a" is output for "01"
    if (fileName.endsWith(".a")) {
      const key = fileName.slice(0, -2);
      outputs.set(key, { baseKey: key, kind: "output", fileName, content: item.content });
      continue;
    }

    // 2. Extension format: .in -> input, .out / .ans -> output
    const extMatch = fileName.match(/^(.*?)\.(in|out|ans|a)$/i);
    if (extMatch) {
      const stem = extMatch[1];
      const ext = extMatch[2].toLowerCase();
      if (ext === "in") {
        inputs.push({ baseKey: stem, kind: "input", fileName, content: item.content });
      } else {
        outputs.set(stem, { baseKey: stem, kind: "output", fileName, content: item.content });
      }
      continue;
    }

    // 3. Prefix format: input01.txt, in_01.txt, output01.txt, out_01.txt, ans_01.txt
    const prefixInMatch = fileName.match(/^(?:input|in)[-_]?(\d+)(?:\.txt)?$/i);
    if (prefixInMatch) {
      const key = prefixInMatch[1];
      inputs.push({ baseKey: key, kind: "input", fileName, content: item.content });
      continue;
    }
    const prefixOutMatch = fileName.match(/^(?:output|out|ans|answer)[-_]?(\d+)(?:\.txt)?$/i);
    if (prefixOutMatch) {
      const key = prefixOutMatch[1];
      outputs.set(key, { baseKey: key, kind: "output", fileName, content: item.content });
      continue;
    }

    // 4. Pure number or alphanumeric (e.g. "01", "02" in Polygon) -> treated as input if output "01.a" exists
    if (fileMap.has(`${fileName}.a`)) {
      inputs.push({ baseKey: fileName, kind: "input", fileName, content: item.content });
      continue;
    }
  }

  // Sort inputs naturally (e.g. 1, 2, 10 instead of 1, 10, 2)
  inputs.sort((a, b) => {
    return a.baseKey.localeCompare(b.baseKey, undefined, { numeric: true, sensitivity: "base" });
  });

  let pos = 0;
  for (const inItem of inputs) {
    const outItem = outputs.get(inItem.baseKey);
    if (outItem) {
      matchedFiles.add(inItem.fileName);
      matchedFiles.add(outItem.fileName);
      const isSample =
        pos === 0 ||
        inItem.fileName.toLowerCase().includes("sample") ||
        inItem.baseKey.toLowerCase().includes("sample");
      paired.push({
        input: inItem.content,
        expectedOutput: outItem.content,
        isSample,
        position: pos++,
      });
    }
  }

  const unmatched: string[] = [];
  for (const [name, item] of fileMap.entries()) {
    if (!matchedFiles.has(name)) {
      unmatched.push(item.originalName);
    }
  }

  return { paired, unmatched };
}

