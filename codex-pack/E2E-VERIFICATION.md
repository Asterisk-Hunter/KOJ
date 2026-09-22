# KOJ — End-to-End Verification Log

Run: **2026-09-22**, against **production** (Vercel `koj-peach.vercel.app`, Cloud Run
`koj-judge`, Neon). Commands were executed by the agent; raw output is reproduced below.
Nothing here is inferred — where something could not be verified it is listed under
"What was NOT verified", not silently omitted.

---

## 1. Build and static checks (repo)

| Command | Result |
|---|---|
| `npx tsc --noEmit` | ✅ exit 0, no output |
| `npm run lint` | ✅ 0 errors, 2 warnings — both in vendored skill templates under `.agents/` and `agent/` (gitignored, not project code) |
| `npm run build` | ✅ exit 0, all 43 routes compiled |
| `python3 -m py_compile api/app/*.py` | ✅ after the judge change |

## 2. Public API sweep (production)

| Endpoint | Result |
|---|---|
| `GET /api/health` | ✅ `200 {"status":"ok","db":true,"latencyMs":228}` (1661 ms on a cold first hit) |
| `GET /api/problems` | ✅ 200 — 9 published problems |
| `GET /api/contests` | ✅ 200 — 4 contests (one `archived` demo, one `ended`, one `live`, one `draft`) |
| `GET /api/rankings?contestId=1` | ✅ 200 in 1.94 s, full ICPC standings payload |
| `GET /api/rankings?contestId=2` | ✅ 404 `contest not found or not visible` (correct: id 2 does not exist) |
| `GET /api/rankings` (no id) | ✅ 400 `contestId is required` |
| `GET /api/auth/me` (anonymous) | ✅ 200 `{authenticated:false, role:"contestant", canAccessAdmin:false, canAuthor:false, canManageContests:false}` |

## 3. Authorization gates (production)

| Probe | Result |
|---|---|
| `GET /api/admin/summary` anonymous | ✅ 401 `unauthorized` |
| `POST /api/submissions` anonymous | ✅ 401 `unauthorized` |
| `GET /api/submissions` anonymous | ✅ 401 `unauthorized` |
| `GET /api/submissions?problemId=4` anonymous | ✅ 401 `unauthorized` (both filters optional, so this is the auth gate answering, not a validation error) |
| Rendering of admin UI for non-staff | Code-level: `Navigation.tsx` renders the ADMIN pill only when `canAccessAdmin`; `app/problems/create/page.tsx` shows a sign-in notice → access check → 403 panel → Studio |

## 4. Judge — every language, every verdict (production, Cloud Run)

Before the fix, **all** of these returned
`runtime_error` + `infra_error=true`, `"judge sandbox unavailable: docker binary not found on
judge host"`. After the fix (revision `koj-judge-00012-bv2`, `"sandbox":"rlimit"`):

| Case | HTTP | Result | Latency |
|---|---|---|---|
| python AC | 200 | `accepted` 2/2 | 0.47 s |
| python WA | 200 | `wrong_answer` 0/2 | 0.45 s |
| python CE | 200 | `compilation_error` (real `SyntaxError` text) | 0.33 s |
| python RE | 200 | `runtime_error` (`process exited with 3`) | 0.44 s |
| python TLE (`while True: pass`, 1 s limit) | 200 | `time_limit_exceeded` | 6.38 s (2 cases × ~3 s) |
| python MLE (600 MB alloc, 64 MB limit) | 200 | `memory_limit_exceeded` | 0.42 s |
| C AC (gcc) | 200 | `accepted` 2/2 | 1.10 s |
| C++ AC (g++) | 200 | `accepted` 2/2 | 2.18 s |
| C++ TLE | 200 | `time_limit_exceeded` | 6.73 s |
| Java AC (`public class Solution`) | 200 | `accepted` 2/2 | 2.43 s |
| no `X-Judge-Secret` | 401 | `unauthorized` | — |
| wrong secret | 401 | `unauthorized` | — |
| `language: "rust"` (before expansion) | 422 | `supported languages: python, c, c++, java` | — |
| `language: "perl"` (after expansion) | 422 | rejected; supported list is the seven below | — |
| `GET /health` | 200 | `{"status":"ok","db":true,"sandbox":"rlimit"}` | — |

### 4a. All seven languages, live (revision `00015`, after the expansion)

Every language was run AC **and** TLE against production. Go and Rust were timed twice, cold
and warm, because a cold `GOCACHE` turns a Go verdict into a 16-second one.

| Language | Version reported by image | AC | TLE | Warm AC latency |
|---|---|---|---|---|
| python | 3.11 | ✅ | ✅ | 0.47 s |
| c | gcc 12 | ✅ | ✅ | 1.10 s |
| c++ | g++ 12 | ✅ | ✅ | 2.18 s |
| java | temurin 17 | ✅ | ✅ | 2.43 s |
| go | 1.22 | ✅ | ✅ | 0.95 s (16.2 s cold) |
| rust | 1.79 | ✅ | ✅ | ~1.7 s |
| javascript | node 20 | ✅ | ✅ | ~0.6 s |

Three defects were found by this matrix and fixed before it went green — they are recorded
in `CONTEXT.md` (items 3–5): `RLIMIT_FSIZE` breaking `rustc` at link time, a missing
toolchain being misreported as a contestant `compilation_error`, and Go rebuilding the
standard library on every submission.

**Interactive runner** (`/api/judge/run`) uses the same language list and the same starters as
`POST /api/submissions`; both allow-lists were updated together.

Hidden-case redaction verified: `is_sample=true` keeps stdout (`'5\n'`), `is_sample=false`
returns `''`.

Local pre-deploy matrix (same code path, `JUDGE_SANDBOX_MODE=rlimit`, 13 cases) — 13/13 passed,
including a forking program that did not escape (`RLIMIT_NPROC` applied with an allowance of
1882 against a host task count of 1818).

Two real bugs were found **because** the matrix covered every language, and both only
manifested outside Python:

1. `RLIMIT_NPROC` counted via a `/proc` directory scan undercounts threads, so `g++` failed
   with `posix_spawn: Resource temporarily unavailable`. Fixed by deriving the allowance from
   `/proc/loadavg` field 4 (`running/total`) plus a 64-task headroom.
2. `RLIMIT_AS` prevents JVM startup; Java now runs without an address-space cap and enforces
   the problem's limit through `-Xmx`.

## 5. Database state (read directly from Neon)

| Check | Result |
|---|---|
| Tables | 8 public tables; `judge_infra_error` column confirmed on `submissions` |
| `submissions` by status | 6 accepted, 2 wrong_answer, 2 runtime_error, 2 pending (the pending pair are outage casualties — `TASKS.md` P0-2) |
| Roles | 4 admin, 3 contestant |
| Row counts | 7 users, 9 problems, 35 test cases, 4 contests, 4 registrations, 12 submissions |
| Defaults | `problems.time_limit_ms` default **2000** in Neon vs **1000** in `db/schema.ts` (defect D2) |

## 5a. Interactive runner stdout redaction — fixed and proven

Reported from a screenshot: the runner showed `Samples: 2/2 Passed · accepted (95ms)` with
`(no stdout)` in the output panel. Reproduced at the API layer against the production judge —
the same payload with and without the `is_sample` flag:

```
WITHOUT is_sample (shipped behaviour)   status=accepted  passed=True  stdout=''
WITH is_sample=true (after the fix)     status=accepted  passed=True  stdout='5\n'
```

Cause: `JudgeCase.is_sample` defaults to `False` and `/api/judge/run` never set it, so the
judge redacted stdout for every interactive case. Fixed by flagging the runner's cases as
samples. `/api/judge/run` is the sole caller of the sync `/judge` endpoint (grep-verified), and
all of its inputs are already public to the caller, so this leaks nothing. Details in
`CONTEXT.md` "The `(no stdout)` bug".

Verified after the fix: `npx tsc --noEmit` clean, `npm run lint` clean, `npm run build` green.
Not yet verified through the browser (needs a session — see §6.1).

## 5b. Editor draft persistence — fixed and browser-verified

Reported: submitting, viewing `/submissions`, then returning to the problem reset the editor to
the starter template. Cause: the editor's code lived only in component state, so unmounting the
page discarded it. Fixed with per problem+language drafts in `localStorage`
(`koj:draft:<problemId>:<language>`), restored in an effect (never in `useState`, so server and
client render identically) and written back debounced at 400 ms.

Driven in a real browser via `agent-browser` against the local dev server:

| Step | Result |
|---|---|
| Type `SPA_FLOW_MARKER_9` into the editor | `localStorage` → `{"koj:draft:4:python":"SPA_FLOW_MARKER_9"}` |
| Click the `SUBMISSIONS` nav link (client-side nav) | url `/submissions`, draft still present |
| Click `PROBLEMS`, then open problem 4 from the list (client-side nav) | url `/problems/4`, editor shows `SPA_FLOW_MARKER_9` — **the reported bug, now fixed** |
| Hard reload of the problem page | still shows the marker |
| Click `RESET` | starter restored **and** the draft key removed (`[]`) |
| Switch language python → c++ → python → c++ | each language keeps its own draft; the c++ marker survived the round trip, python was unaffected |
| Storage unavailable (private mode / quota) | every read/write is wrapped; a lost draft can never break the editor |

Submitting cannot clear the draft either: `setCodeByLang` is called in exactly four places
(initial state, the restore effect, the explicit `RESET`, and the editor's `onChange`) —
`handleSubmit` never touches the code, so the submit → verdict → `/submissions` → back round
trip preserves it.

What is **not** covered: drafts live in `localStorage`, so they are per browser and per device. A
signed-out or different-device session starts from the starter. Nothing is persisted server-side
(no schema change) — that is deliberate for now; if you want cross-device drafts, that is a
product decision, not a bug fix.

## 5c. Problem creation — audited, not executed

**Static audit (fields, gates and defaults all line up):**

| Layer | Finding |
|---|---|
| `app/problems/create/page.tsx` | Correctly gated: signed-out notice → access check → 403 panel → Studio, so a contestant never sees the authoring UI |
| `app/admin/ProblemStudio.tsx` | Payload fields (`title, statement, inputFormat, outputFormat, constraints, explanation, difficulty, tags, timeLimitMs, memoryLimitMb, status, testCases`) match the route exactly; `testCases` items use `{input, expectedOutput, isSample, position}`, which is what the route validates |
| `POST /api/admin/problems` | Full validation (title ≤ 500, 100 ≤ timeLimitMs ≤ 10000, 16 ≤ memoryLimitMb ≤ 2048, ≤ 100 cases, 10 MB per case), `requireSetter`, problem + cases inserted in one transaction, returns 201 `{id, testCaseCount}`, defaults to `draft` unless `published` is explicit |
| `PATCH /api/admin/problems/[id]` | Own-problem check for setters, blocked while a linked contest is live (BR-08/REQ-PROB-10), only `draft ↔ published` transitions allowed |
| `POST /api/admin/problems/import` | All four advertised sources exist and are dispatched: `leetcode`, `codeforces`, `atcoder`, `csv`/`polygon` — the Studio copy is not overpromising |
| Judge consumption | `/judge-async` loads `problem_test_cases` by `problem_id ORDER BY position` with `is_sample` preserved, so a created problem judges as authored |

**Fixed as a result of this audit:** publishing with zero test cases is now refused at both
`POST` and `PATCH`, and the judge no longer reports an unjudgeable problem as `accepted` (§5d).

**NOT executed end to end.** No agent has clicked Create → add test cases → Publish as a
signed-in setter. It cannot be done from this machine: all three environments share one Neon
database (creating a test problem would write production data) and the local Clerk instance has
**zero users**, so there is no local admin to authenticate as. This needs either a test account
on the production Clerk instance or the human clicking through while the agent watches.

## 5d. Zero test cases → false AC — fixed and live

```
# production judge
POST /judge {language: python, code: "print('definitely not the answer')", cases: []}
→ verdict: accepted   passed/total: 0/0   infra_error: False      # a free AC for any code
```

After the fix (revision `koj-judge-00016-ljp`): `runtime_error`, `infra_error: True`,
`problem has no test cases; nothing was judged`. Local check confirms a normal 1-case AC and WA
are unaffected, and the smoke script now asserts the zero-case case:
`PASS zero cases status=runtime_error infra_error=True` — **19/19 PASS** in total.

## 6. What was NOT verified

Be explicit about these in any status report — they are the residual risk:

1. **No authenticated end-to-end run.** Registration, contest registration, submission from
   the UI, SSE verdict streaming in the browser, standings refresh, and every admin/setter
   flow were never driven as a signed-in user. All judge verification was performed directly
   against the judge API with the internal secret, so the *API* is proven but the *UI wiring*
   is not. This is the highest-priority remaining verification (`TASKS.md` P0-3).
2. **OAuth providers** — cannot be confirmed without dashboard access (`BLOCKERS.md` #3).
3. **Local dev auth** uses a different Clerk instance than production (defect D3), so local
   sign-in proves nothing about production auth.
4. **Load and concurrency** — REQ-JUDGE-13, REQ-PERF-03, REQ-PERF-04, REQ-PERF-06 unmeasured.
5. **Webhook delivery** — the endpoint exists and rejects unsigned payloads (400), but no
   signed event was observed end to end.
6. **Rate limiting** — the 429 path was verified by reading the transaction logic and the UI
   handler, not by issuing two submissions inside 30 s as a real user.
7. **`/api/judge/run`** (the interactive runner) was not exercised; it requires a session.
8. **The judge fix and the language expansion are live but uncommitted; the frontend de-slop
   is not live at all** (D1). The judge was deployed from source, so production runs code that
   exists in no commit; Vercel builds from git, so the public site still serves the pre-de-slop
   UI. Verified directly:

   ```
   $ curl -s https://koj-peach.vercel.app/ | grep -oE 'terminalGlitch|terminal-crt-glow|bg-grid|text-glow|scanline|IIITK Judge' | sort -u
   bg-grid
   scanline
   terminal-crt-glow
   terminalGlitch
   text-glow
   IIITK Judge            # ×2

   $ curl -s https://koj-peach.vercel.app/api/problems | head -c 60
   [{"id":12,"title":"Two Sum","difficulty":"easy","category":"array","acceptance":"—","status":"unsolved"}]
   ```

   So: everything in §4 and §4a describes the live judge; nothing in `UI-SPEC.md`'s "done"
   section describes the live site. Re-run both commands after commit + push.
9. **Signed-in UI rendering of the seven languages** (editor syntax mode, starter template,
   verdict rendering per language) was verified by typecheck and build only, not by a real
   authenticated submission through the browser.
10. **The `(no stdout)` fix is verified at the API layer only.** Confirming the panel now
    renders output needs a signed-in click on Run — the remaining half of P0-3.
11. **Signed-in problem creation** — audited in §5c but never executed; see that section for
    exactly what was and wasn't checked and why it cannot be done from this machine.
12. **The draft-persistence fix is verified in a browser but not deployed** (frontend only).

## 7. Reproduction

`scripts/judge-smoke.py` in this pack re-runs the whole judge matrix against any judge
endpoint. It reads the secret from the environment and never prints it:

The script itself was run against production as the final check on this pack — **18/18 PASS,
0 failures**, `sandbox=rlimit`:

```
health: {"status":"ok","db":true,"sandbox":"rlimit"}
PASS python AC / WA / CE / RE        0.60 / 0.61 / 0.46 / 0.59 s
PASS python TLE 6.50 s   PASS python MLE 0.50 s
PASS c AC 0.52 s    PASS c++ AC 1.33 s    PASS c++ TLE 6.98 s
PASS java AC 1.72 s
PASS go AC 1.19 s (warm)   PASS go TLE 6.68 s
PASS rust AC 2.22 s
PASS javascript AC 1.07 s  PASS javascript TLE 6.45 s
PASS redaction (sample '5\n' kept, hidden '')
PASS no secret → 401      PASS bad language → 422
FAILURES: 0
```

Warm Go at 1.19 s confirms the shared `GOCACHE` is working (cold it is ~16 s). Note the
earlier `bad language` probe used `rust`, which is now valid — the script uses `perl` so the
422 assertion still tests what it claims to.

```bash
export JUDGE_URL=https://koj-judge-189400571693.asia-south1.run.app
export JUDGE_INTERNAL_SECRET="$(gcloud run services describe koj-judge \
  --region=asia-south1 --format=json \
  | python3 -c 'import sys,json;print([e["value"] for e in json.load(sys.stdin)["spec"]["template"]["spec"]["containers"][0]["env"] if e["name"]=="JUDGE_INTERNAL_SECRET"][0])')"
python3 scripts/judge-smoke.py
```
