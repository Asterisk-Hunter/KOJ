import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import dotenv from "dotenv";

const cloudProject = process.argv[2];
const apiUrl = process.argv[3];
const link = JSON.parse(readFileSync(".vercel/project.json", "utf8"));
if (cloudProject !== "project-8c50e5eb-7ddd-4a46-9c8" || link.projectId !== "prj_sPfNzijJxuKcLJj1wRaiWbWSt5NM") {
  throw new Error("Refusing to configure an unverified deployment project");
}
if (!apiUrl || !/^https:\/\/koj-api-(?:[a-z0-9-]+\.a|285568391757\.asia-southeast1)\.run\.app$/.test(apiUrl)) {
  throw new Error("Supply the verified KOJ Cloud Run service URL");
}
dotenv.config({ path: ".env.local", quiet: true });
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

function execute(command, args, input) {
  const result = spawnSync(command, args, {
    encoding: "utf8", input, shell: process.platform === "win32", windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`Deployment configuration failed: ${command} ${args[0]}`);
  return result.stdout.trim();
}

function cloud(args, input) {
  return execute("gcloud", [...args, `--project=${cloudProject}`, "--quiet"], input);
}

function managedSecret(name) {
  const names = cloud(["secrets", "list", "--format=value(name)"]);
  if (!names.split(/\r?\n/).some((value) => value === name || value.endsWith(`/${name}`))) {
    cloud(["secrets", "create", name, "--replication-policy=automatic"]);
  }
  if (!cloud(["secrets", "versions", "list", name, "--filter=state:ENABLED", "--format=value(name)"])) {
    cloud(["secrets", "versions", "add", name, "--data-file=-"], randomBytes(32).toString("hex"));
  }
  return cloud(["secrets", "versions", "access", "latest", `--secret=${name}`]);
}

const databaseUrl = new URL(process.env.DATABASE_URL);
databaseUrl.searchParams.set("sslmode", "verify-full");
const values = {
  DATABASE_URL: databaseUrl.toString(),
  FASTAPI_URL: apiUrl,
  JUDGE_INTERNAL_SECRET: managedSecret("koj-internal-secret"),
  RATE_LIMIT_SECRET: managedSecret("koj-web-rate-secret"),
  CRON_SECRET: managedSecret("koj-cron-secret"),
};
for (const [name, value] of Object.entries(values)) {
  execute("npx", ["--yes", "vercel@62.2.0", "env", "add", name, "production,preview", "--force", "--yes", "--sensitive", "--scope", "asterisk-hunters-projects"], value);
  console.log(`${name}: configured for KOJ production and preview`);
}
