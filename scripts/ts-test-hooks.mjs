import { existsSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveFile(base) {
  for (const candidate of [base, `${base}.ts`, path.join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const target = resolveFile(path.join(root, specifier.slice(2)));
      if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
    }
    // Next 16 ships no package "exports" map, so bare ESM cannot resolve
    // "next/server" the way a bundler does — the runtime needs the .js path.
    if (specifier === "next/server" || specifier === "next/headers") {
      return nextResolve(`${specifier}.js`, context);
    }
    const extensionless =
      specifier.startsWith(".") && path.extname(specifier) === "" && context.parentURL;
    if (extensionless) {
      const target = resolveFile(fileURLToPath(new URL(specifier, context.parentURL)));
      if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
