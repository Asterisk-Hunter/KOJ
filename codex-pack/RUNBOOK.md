# KOJ — Runbook

Copy-paste operations. Everything here was executed on 2026-09-22 unless marked otherwise.

---

## 0. Environment

`cp share.env .env.local` (web) and copy the API section into `api/.env` (judge). Neither is
committed — `.env*` is gitignored. `share.env` contains the live values plus a marked
"ACTION REQUIRED" block for the Clerk instance mismatch (`BLOCKERS.md` #1).

Key variables: `DATABASE_URL`, `FASTAPI_URL`, `JUDGE_INTERNAL_SECRET` (identical on both
sides), Clerk keys + redirect paths, `CLERK_WEBHOOK_SECRET`, `REDIS_URL`/`REDIS_TOKEN`
(optional), `ADMIN_CLERK_IDS`, and for the judge `JUDGE_SANDBOX_MODE` (web side does not use it).

## 1. Local development

```bash
npm install
npm run dev                      # http://localhost:3000
curl -s localhost:3000/api/health
```

Local judge (optional — required if `FASTAPI_URL` points at localhost):

```bash
cd api
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
curl -s localhost:8000/health    # {"status":"ok","db":true,"sandbox":"docker|rlimit"}
```

`JUDGE_SANDBOX_MODE=auto` picks Docker when the CLI exists and the rlimit backend otherwise.
Force `rlimit` locally if Docker is installed but not running, otherwise every request will
fail closed with `judge sandbox unavailable` — that is by design, not a bug.

## 2. Pre-flight checks (always before handing work back)

```bash
npx tsc --noEmit && npm run lint && npm run build
python3 -m py_compile api/app/*.py       # only if api/ changed
```

No test runner exists. Delete every scratch script, fixture, and screenshot you created
(`AGENTS.md` rule 5) — `scripts/judge-smoke.py` lives in this pack, outside the repo.

## 3. Judge smoke test (any environment)

```bash
export JUDGE_URL=https://koj-judge-189400571693.asia-south1.run.app
export JUDGE_INTERNAL_SECRET="$(gcloud run services describe koj-judge \
  --region=asia-south1 --format=json \
  | python3 -c 'import sys,json;print([e["value"] for e in json.load(sys.stdin)["spec"]["template"]["spec"]["containers"][0]["env"] if e["name"]=="JUDGE_INTERNAL_SECRET"][0])')"
python3 scripts/judge-smoke.py                 # full matrix
python3 scripts/judge-smoke.py --quick         # python AC/WA/TLE only
```

Expected: **15/15** judge cases PASS (python AC/WA/CE/RE/TLE/MLE, c AC, c++ AC/TLE,
java AC, go AC/TLE, rust AC, javascript AC/TLE) plus the auth/health checks, and `sandbox`
reported as `rlimit` or `docker`. Go is the one to watch: a cold run is ~16 s and a warm one
under a second, so a consistent 10 s+ means `GOCACHE` is not being shared. Any
`infra_error=true` result means the judge cannot execute anything — escalate immediately;
it is the exact failure mode that took production down for a day.

## 4. Deploys

**Web (Vercel).** Pushing does not deploy. The human runs:

```bash
vercel --prod --yes
curl -s https://koj-peach.vercel.app/api/health
```

**Judge (Cloud Run).** Rebuilds from `api/` and preserves the existing env vars/limits:

```bash
gcloud run deploy koj-judge --source api --region=asia-south1 --quiet
curl -s https://koj-judge-189400571693.asia-south1.run.app/health
gcloud run services describe koj-judge --region=asia-south1 \
  --format='value(status.latestReadyRevisionName)'
```

Rollback the judge to the previous revision:

```bash
gcloud run services update-traffic koj-judge --region=asia-south1 \
  --to-revisions <previous-revision>=100
```

The judge image installs `gcc`, `g++`, `default-jdk-headless`, `golang`, `rustc` and
`nodejs` (see `api/Dockerfile`), so all **seven** languages work in the rlimit backend.
A missing toolchain does not silently fail: the judge raises `SandboxUnavailable` and the
submission is infra-flagged rather than marked as a contestant error, so check `/health`
and the logs after any image change. The build takes several minutes.

## 5. Database

```bash
npm run db:generate   # new migration from db/schema.ts
npm run db:migrate    # apply
npm run db:push       # direct push — WILL revert drifted defaults, review the diff first
npm run db:studio
npm run db:seed       # needs SEED_USER_CLERK_ID + SEED_USER_EMAIL
```

Ad-hoc inspection (never print the DSN):

```bash
node -e 'require("dotenv").config({path:".env.local",quiet:true});
const {Client}=require("pg");const c=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
c.connect().then(async()=>{console.table((await c.query("select status,count(*)::int from submissions group by 1")).rows);await c.end();});'
```

Known drift: Neon's `problems.time_limit_ms` default is `2000`, `db/schema.ts` says `1000`.
**Do not run `db:push` until that is reconciled** (defect D2).

## 6. Authenticated end-to-end smoke (the gap nobody has closed)

Do this as a real signed-in user — it is the only way to prove the UI wiring.

1. **Sign up** a throwaway account; confirm `/api/auth/me` returns `role:"contestant"` and a
   `users` row appears in Neon.
2. **Practice:** open a published problem → the editor loads with a starter template → Run on
   samples → Submit. Expect a real verdict (not "judge unavailable") within a few seconds,
   the verdict updating without a manual refresh (SSE), and the row appearing in
   `/submissions` with a working filter.
3. **Rate limit:** submit twice within 30 s → 429 surfaced as a visible countdown, then a
   successful submit after the cooldown.
4. **Contest:** register for the open contest → enter `/contests/[id]/arena` → submit a
   contest problem → confirm the standings update and your handle appears with the right
   penalty.
5. **Authoring (as problem_setter/admin):** create a problem → add sample + hidden test cases
   (including one ≥ 10 MB to see the cap refuse it) → publish → solve it as the contestant
   account → confirm acceptance.
6. **Roles:** as a contestant, confirm no ADMIN pill, no "create problem" CTA, and no
   `/admin` content; as staff, confirm the sections appear.
7. **Admin ops:** `/admin` metrics, submission moderation, and
   `POST /api/admin/submissions/recover` (which should clear any stuck `pending` rows).

Record what you saw per step (screenshot or raw response) in the handoff.

## 7. Troubleshooting

| Symptom | Cause | Action |
|---|---|---|
| Every verdict `runtime_error` + `infra_error` | judge cannot execute (no sandbox) | check `/health` → `sandbox`; if `docker` on Cloud Run, the deployment contract is being violated |
| `judge unavailable` (502) at submit | `FASTAPI_URL`/secret wrong, or judge unreachable | curl the judge `/health`; confirm `JUDGE_INTERNAL_SECRET` matches on both sides |
| Submission stuck `pending` | dispatch or judge crash mid-run | `POST /api/admin/submissions/recover`, then re-dispatch |
| `cannot_execute cc1plus` / `posix_spawn: EAGAIN` | `RLIMIT_NPROC` below the host's task count | this was fixed; do not reintroduce a fixed small value |
| Dev server says "Another next dev server is already running" | stale dev process | `pkill -f "next dev"`, then restart |
| Build fails: both `middleware` and `proxy` detected | someone added `middleware.ts` | delete it — Next 16 uses `proxy.ts` only |
