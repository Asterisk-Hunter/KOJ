import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
];
const typescriptResult = spawnSync(
  process.execPath,
  ["--experimental-strip-types", "--test", ...typescriptTests],
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

let pythonResult;
for (const candidate of pythonCommands) {
  pythonResult = spawnSync(
    candidate.command,
    [...candidate.args, "-m", "pytest", "-q", "-m", "not integration"],
    { cwd: path.join(root, "api"), stdio: "inherit" },
  );
  if (pythonResult.error?.code === "ENOENT") continue;
  break;
}

if (!pythonResult || pythonResult.error) {
  throw new Error("Python was not found; install Python and api/requirements.txt");
}
process.exit(pythonResult.status ?? 1);
