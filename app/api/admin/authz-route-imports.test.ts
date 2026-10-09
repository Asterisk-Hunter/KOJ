import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const adminApiDir = path.dirname(fileURLToPath(import.meta.url));

// Every gate exported for route use. Adding one to authz.ts without wiring it
// here is caught by the export check below.
const GATES = [
  "requireAdmin",
  "requireSetter",
  "requireStaff",
  "requireContestManager",
  "requireOrganizationAdmin",
];

/**
 * Route handlers do not inherit the proxy matcher (AGENTS.md §4), so each one
 * must take a gate from the centralized authz module.
 */
function routeHandlers(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return routeHandlers(entryPath);
    return entry.isFile() && entry.name === "route.ts" ? [entryPath] : [];
  });
}

function importedFromAuthz(source: string): string[] {
  const names: string[] = [];
  const pattern = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"[^"]*\/authz"/g;
  for (const match of source.matchAll(pattern)) {
    names.push(...match[1].split(",").map((name: string) => name.trim().split(/\s+as\s+/)[0]));
  }
  return names;
}

test("every admin route handler imports a centralized authz gate", () => {
  const files = routeHandlers(adminApiDir);
  assert.ok(files.length > 0, `no route handlers found under ${adminApiDir}`);

  const ungated = files.filter((file: string) => {
    const imported = importedFromAuthz(readFileSync(file, "utf8"));
    return !imported.some((name) => GATES.includes(name));
  });

  assert.deepEqual(
    ungated.map((file: string) => path.relative(adminApiDir, file).split(path.sep).join("/")),
    [],
    "admin route handlers must import requireAdmin/requireSetter/requireStaff/requireContestManager/requireOrganizationAdmin from authz",
  );
});

test("authz exports the gates the route scan looks for", () => {
  const source = readFileSync(path.join(adminApiDir, "authz.ts"), "utf8");
  for (const gate of GATES) {
    assert.match(source, new RegExp(`export async function ${gate}\\b`), `${gate} must stay exported`);
  }
});
