import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function findTests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findTests(entryPath);
    return entry.isFile() && entry.name.endsWith(".test.ts") ? [entryPath] : [];
  });
}

const typescriptTests = [
  ...findTests(path.join(root, "lib")),
  ...findTests(path.join(root, "app", "api")),
  ...findTests(path.join(root, "db")),
];
const typescriptResult = spawnSync(
  process.execPath,
  [
    "--experimental-strip-types",
    "--experimental-test-module-mocks",
    "--experimental-test-coverage",
    "--import",
    pathToFileURL(path.join(root, "scripts", "ts-test-hooks.mjs")).href,
    "--test",
    ...typescriptTests,
  ],
  { cwd: root, stdio: "inherit" },
);

if (typescriptResult.error) throw typescriptResult.error;
if (typescriptResult.status !== 0) process.exit(typescriptResult.status ?? 1);

const pythonCommands =
  process.platform === "win32"
    ? [
        { command: "python", args: [] },
        { command: "py", args: ["-3"] },
        { command: "python3", args: [] },
      ]
    : [
        { command: "python3", args: [] },
        { command: "python", args: [] },
      ];

// Coverage is report-only: pytest-cov is optional here, and nothing fails on a
// coverage number. Returns null when the interpreter itself is missing.
function pytestCovArgs(candidate) {
  // pytest finds plugins through distribution metadata, so check that rather
  // than `import pytest_cov`, which a partial uninstall can still satisfy.
  const probe = spawnSync(
    candidate.command,
    [
      ...candidate.args,
      "-c",
      "import importlib.metadata as m; m.version('pytest-cov')",
    ],
    { cwd: path.join(root, "api"), stdio: "ignore" },
  );
  if (probe.error?.code === "ENOENT") return null;
  return probe.status === 0 ? ["--cov=app", "--cov-report=term-missing"] : [];
}

let pythonResult;
let coverageNoticeShown = false;
for (const candidate of pythonCommands) {
  const covArgs = pytestCovArgs(candidate);
  if (covArgs === null) continue;
  if (covArgs.length === 0 && !coverageNoticeShown) {
    console.log(
      "pytest-cov not installed; Python tests run without coverage (pip install -r api/requirements-test.txt)",
    );
    coverageNoticeShown = true;
  }
  pythonResult = spawnSync(
    candidate.command,
    [...candidate.args, "-m", "pytest", "-q", ...covArgs, "-m", "not integration"],
    { cwd: path.join(root, "api"), stdio: "inherit" },
  );
  if (pythonResult.error?.code === "ENOENT") continue;
  break;
}

if (!pythonResult || pythonResult.error) {
  throw new Error("Python was not found; install Python and api/requirements.txt");
}
process.exit(pythonResult.status ?? 1);
