# Blockers — send these to the human verbatim

Each item is something an agent **cannot** do from inside this pack. Do not guess around any
of them; send the prompt as written (fill in the `<>`), then wait. If a new blocker appears,
add it here in the same shape so this file stays the single queue.

---

## #1 — Local dev must use the same Clerk instance as production (highest value)

```
BLOCKED: Local development signs in against an empty, orphan Clerk instance.

What I need you to do (exact steps):
1. Open Vercel → project "koj" → Settings → Environment Variables → Production →
   CLERK_SECRET_KEY → reveal and copy (starts with sk_test_).
   (Equivalent source: Clerk dashboard → the KOJ app on the *singular-longhorn-70*
   instance → API Keys → Secret Key. Vercel marks it "Sensitive" so `vercel env pull`
   cannot retrieve it — this copy step is unavoidable.)
2. Paste it here as: CLERK_SECRET_KEY=<value>
3. Confirm which Clerk account owns that instance (it is NOT the account the `clerk` CLI is
   logged into — see #2).

Why: production is built with publishable key ...singular-longhorn-70... while .env.local
carries ...exotic-blowfish-7545..., an app with 0 users. Local sign-in therefore creates
phantom accounts on the wrong instance, /api/auth/me returns no real role, and nothing about
auth can be reproduced or tested locally.

What I will do the moment you reply:
1. Update .env.local's CLERK_SECRET_KEY only (publishable key stays the working local one
   until you confirm both halves, so nothing is left in a mismatched state).
2. Restart the dev server, sign in, and prove GET /api/auth/me returns your real role.
3. If it matches production, also add the pair to share.env and note it in CONTEXT.md.

If you would rather not: local dev keeps working as an orphan instance — you can still test
contestant-level flows by signing up a throwaway user, but admin/setter testing must happen
against production, and auth bugs cannot be reproduced locally.
```

### #2 — Clerk CLI points at the wrong application

```
BLOCKED: `clerk` CLI is authenticated to "My Application" (0 users), not the KOJ instance.

What I need you to do (exact steps):
1. `clerk whoami` currently reports app app_3HzajyR1XtJl8gqfQ3adKse52nO with only a
   development instance and an empty user list.
2. Log the CLI into the account that owns singular-longhorn-70 (the Asterisk-Hunter /
   KOJ Clerk app): `clerk auth login`, then `clerk link` inside this repo and select the KOJ
   application.

Why: without this I cannot list users, grant roles, inspect instance settings, tail webhook
deliveries, or verify whether GitHub/Google OAuth is actually enabled (blocker #3).

What I will do the moment you reply:
1. Verify with `clerk users list` that the 7 production users appear.
2. Cross-check DB roles against Clerk users and report any mismatch.
3. Use it to unblock #3.

If you would rather not: role changes have to be made directly in Postgres (the agent can do
that) and OAuth verification has to be done by eye in a browser.
```

### #3 — Prove OAuth (GitHub / Google) works

```
BLOCKED: Nobody can confirm the OAuth providers are enabled on the live instance.

What I need you to do (exact steps):
1. In a private/incognito window open https://koj-peach.vercel.app/sign-in
2. Click "Continue with GitHub" → report what happens.
3. Repeat for "Continue with Google".
   (Expected: redirect out, consent, then land on /dashboard.)

Why: the SRS requires both (REQ-AUTH-02, High priority). Current docs claim they are enabled,
but that claim has never been reproduced and no test account exists. This is a High-priority
requirement that may be silently broken.

What I will do the moment you reply:
1. If both work: mark REQ-AUTH-02 verified in SRS-TRACEABILITY.md with your result.
2. If either fails: fix what is fixable in code, and if it is a dashboard setting, come back
   with the exact Clerk dashboard path and the toggle to flip.
```

### #4 — Deploy approvals (web + judge)

```
BLOCKED: I need approval to deploy to production.

What I need you to do:
1. Grant a standing "yes" for: `vercel --prod` (web) and
   `gcloud run deploy koj-judge --source api --region=asia-south1 --quiet` (judge)
   OR specify that each deploy must be approved individually.

Why: production changes cannot be verified without deploying. The judge was 100% down and
only a deploy could prove the fix.

What I will do the moment you reply:
1. Deploy, then curl the health endpoints and run the smoke test in scripts/judge-smoke.py.
2. Report the revision ids and the raw verdict output.
```

### #5 — Hardened judge host (optional, only if you want Docker-grade isolation)

```
BLOCKED: Docker sandbox needs a host that can run containers.

What I need you to do (pick one):
A. Approve a small GCE VM (e.g. e2-small, asia-south1) to run koj-judge with Docker, then I
   install the daemon, provision api/seccomp-koj.json to /etc/koj/, pre-pull the three
   sandbox images, and deploy with JUDGE_SANDBOX_MODE=docker.
B. Say "stay on rlimit" and I will instead spend the effort on the P1 list.

Why: the SRS permits process-level rlimit isolation (§2.5 constraint 3) and production is
working on it, but the container backend is the strictly stronger sandbox and is already
implemented and documented. This is a security posture decision plus a small recurring cost.

What I will do the moment you reply:
1. (A) Provision, deploy, re-run scripts/judge-smoke.py including the OOM/overflow cases, and
   confirm /health reports "sandbox":"docker".
2. (B) Record the decision in DEPLOYMENT_CONTRACT.md and CONTINUE with P1.
```

### #6 — Neon / migration approvals

```
BLOCKED: pending DB change.

What I need you to do: confirm the target branch/database and approve running
`npm run db:push` / `drizzle-kit migrate` against it, after I show you the exact SQL diff.

Why: P1-1 fixes real schema drift (time_limit_ms default is 1000 in db/schema.ts, 2000 in
Neon). Pushing without review could revert a live default that the SRS mandates.

What I will do the moment you reply: apply it, then verify through
information_schema.columns and re-run a submission to confirm limits still behave.
```

### #7 — Repository housekeeping

```
BLOCKED: I will not delete files without permission.

What I need you to do: approve deleting the untracked debris file `=3.2` in the repo root
(783 bytes of redirected `pip install` output — an accidental shell redirect), and approve
archiving/unlisting the duplicate problem "Two Sum" (id 12) and the demo contest
"Monsoon Mayhem — Archived" (id 3).

Why: all three make the public product look unmaintained.

What I will do the moment you reply: remove/archive them and confirm the public archive and
contest list contain only legitimate entries.
```

### #8 — Load-test permission

```
BLOCKED: the SRS performance claims are unmeasured.

What I need you to do: approve a load test against production (or tell me to run it against a
preview deployment instead) — roughly 10 concurrent judge requests and 50 concurrent page
requests, for a few minutes, from one machine.

Why: REQ-JUDGE-13, REQ-PERF-03 and REQ-PERF-04 are asserted in the SRS and have never been
measured. The judge is on Cloud Run with maxScale=5 × concurrency 4.

What I will do the moment you reply: run a repeatable harness, publish the table, and file
follow-ups for anything that misses the target.
```
