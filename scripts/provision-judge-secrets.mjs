import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";
import pg from "pg";

const project = process.argv[2];
if (!project || !/^[a-z][a-z0-9-]{5,62}$/.test(project)) {
  throw new Error("Usage: node scripts/provision-judge-secrets.mjs PROJECT_ID");
}
dotenv.config({ path: ".env.local", quiet: true });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const sourceUrl = new URL(databaseUrl);
sourceUrl.searchParams.set("sslmode", "verify-full");

function gcloud(args, input) {
  const result = spawnSync("gcloud", [...args, `--project=${project}`, "--quiet"], {
    shell: process.platform === "win32",
    encoding: "utf8",
    input,
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`Cloud provisioning failed: ${args[0]} ${args[1]}`);
  return result.stdout.trim();
}

function ensureSecret(name) {
  const names = gcloud(["secrets", "list", "--format=value(name)"]);
  if (!names.split(/\r?\n/).some((value) => value === name || value.endsWith(`/${name}`))) {
    gcloud(["secrets", "create", name, "--replication-policy=automatic"]);
  }
}

const client = new pg.Client({ connectionString: sourceUrl.toString(), connectionTimeoutMillis: 5000 });
try {
  await client.connect();
  const configurations = [
    { role: "koj_judge_worker", secret: "koj-worker-database-url", account: "koj-worker", grants: [
      "GRANT SELECT ON public.problems, public.problem_test_cases, public.submissions, public.judge_jobs, public.judge_workers TO koj_judge_worker",
      "GRANT INSERT, UPDATE ON public.judge_jobs, public.judge_workers TO koj_judge_worker",
      "GRANT UPDATE (status, started_at, completed_at, passed_tests, total_tests, execution_time_ms, memory_used_mb, error_message, judge_infra_error, case_results) ON public.submissions TO koj_judge_worker",
      "GRANT USAGE, SELECT ON SEQUENCE public.judge_jobs_id_seq TO koj_judge_worker",
    ] },
    { role: "koj_judge_api", secret: "koj-api-database-url", account: "koj-api", grants: [
      "GRANT SELECT (id, status) ON public.submissions TO koj_judge_api",
      "GRANT INSERT ON public.judge_jobs TO koj_judge_api",
      "GRANT SELECT (status, submission_id) ON public.judge_jobs TO koj_judge_api",
      "GRANT USAGE, SELECT ON SEQUENCE public.judge_jobs_id_seq TO koj_judge_api",
    ] },
  ];
  for (const configuration of configurations) {
    ensureSecret(configuration.secret);
    const versions = gcloud(["secrets", "versions", "list", configuration.secret, "--filter=state:ENABLED", "--format=value(name)"]);
    if (!versions) {
      const password = randomBytes(32).toString("hex");
      await client.query("BEGIN");
      try {
        const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [configuration.role]);
        if (exists.rowCount) throw new Error("A database role already exists without a matching managed secret");
        const statement = await client.query("SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', $1::text, $2::text) AS statement", [configuration.role, password]);
        await client.query(statement.rows[0].statement);
        await client.query(`GRANT USAGE ON SCHEMA public TO ${configuration.role}`);
        for (const grant of configuration.grants) await client.query(grant);
        await client.query(`ALTER ROLE ${configuration.role} SET statement_timeout = '15s'`);
        await client.query(`ALTER ROLE ${configuration.role} SET idle_in_transaction_session_timeout = '30s'`);
        const restrictedUrl = new URL(sourceUrl);
        restrictedUrl.username = configuration.role;
        restrictedUrl.password = password;
        gcloud(["secrets", "versions", "add", configuration.secret, "--data-file=-"], restrictedUrl.toString());
        await client.query("COMMIT");
      } catch {
        await client.query("ROLLBACK");
        throw new Error("Could not provision the restricted judge database role");
      }
    }
    await client.query(`GRANT USAGE ON SCHEMA public TO ${configuration.role}`);
    for (const grant of configuration.grants) await client.query(grant);
    gcloud(["secrets", "add-iam-policy-binding", configuration.secret, `--member=serviceAccount:${configuration.account}@${project}.iam.gserviceaccount.com`, "--role=roles/secretmanager.secretAccessor"]);
    console.log(`${configuration.secret}: provisioned with resource-scoped access`);
  }
  ensureSecret("koj-internal-secret");
  if (!gcloud(["secrets", "versions", "list", "koj-internal-secret", "--filter=state:ENABLED", "--format=value(name)"])) {
    gcloud(["secrets", "versions", "add", "koj-internal-secret", "--data-file=-"], randomBytes(32).toString("hex"));
  }
  gcloud(["secrets", "add-iam-policy-binding", "koj-internal-secret", `--member=serviceAccount:koj-api@${project}.iam.gserviceaccount.com`, "--role=roles/secretmanager.secretAccessor"]);
  console.log("koj-internal-secret: provisioned; no secret values were logged");
} catch {
  console.error("Judge secret provisioning failed; inspect resource permissions without printing credentials.");
  process.exitCode = 1;
} finally {
  await client.end();
}
