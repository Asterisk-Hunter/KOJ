import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { apiGuardRule } from "./scripts/eslint-api-guard.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["app/api/**/route.ts"],
    plugins: { koj: { rules: { "api-guard": apiGuardRule } } },
    rules: { "koj/api-guard": "error" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "KOJ-agent-catchup/**",
  ]),
]);

export default eslintConfig;
