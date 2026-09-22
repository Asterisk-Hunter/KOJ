# Testing Strategy

> Current branch `feat/sprint1-backend` has **no test runner installed** — strategy below is intended, with actual verification evidence at the bottom. See `docs/status.md` for remaining work.

## Test plan by type (intended)

| Type | Responsibility | Test cases | Metrics | Status |
|---|---|---|---|---|
| **Unit** | Judge module; problem status; penalty calc | TLE, MLE, RE, WA, AC; state transitions | 40+ tests, 85% coverage | Planned — judge verified manually via `POST /judge` |
| **Integration (bottom-up)** | Judge + Submission API + DB | Submit → judge → DB verdict | 15+ tests | Planned — smoke via `POST /api/submissions` |
| **Integration (top-down)** | Contest flow with stubbed judge | UI → API → judge stub → verdict | 10+ tests | Planned |
| **Validation** | Full system vs. SRS | Acceptance criteria checklist | Pass/fail | Partial — APIs smoke-tested |
| **Stress** | 30 concurrent submissions in 10s | Leaderboard lag, verdict correctness | ≤5s lag; 100% accuracy | Not run |
| **Alpha** | Internal team testing | Mock contest | Defect log | Not run |
| **Beta** | Real college contest | 20+ students, 50+ submissions | Feedback survey | Not run |
| **Regression** | After each sprint, re-run suite | All above | No new failures | No suite yet |

---

## Unit test focus: Judge module (40+ tests — planned)

| Verdict | Test case | What it validates |
|---|---|---|
| TLE | `while True: pass` | Wall timeout + `time_limit_ms` enforcement |
| MLE | `MemoryError` via alloc | `RLIMIT_AS` / MemoryError heuristic |
| RE | Division by zero | Returns `runtime_error`, not crash |
| WA | Wrong output | Whitespace-normalized comparison |
| AC | Correct solution | Happy path |
| CE | `def foo(` | `py_compile` capture |
| AC | Python solution | Multi-language gate (only python today) |

---

## Integration test: Full submission flow (intended)

```
1. Create problem with test cases (POST /api/admin/problems + DB)
2. Create contest, add problem (seed today; API planned)
3. Register contestant (POST /api/contests/[id]/register)
4. Submit code (POST /api/submissions mode=submit)
5. Wait for verdict (≤60s via maxDuration)
6. Verify verdict in DB (submissions.status)
7. Verify rankings updated (GET /api/rankings?contestId=)
```

---

## Stress test: 30 concurrent submissions (planned)

- Spawn 30 concurrent submissions in 10s
- Verify all 30 verdicts correct
- Verify rankings lag ≤5s after last verdict
- Verify no timeout errors

Requires Redis/SSE and judge queue — not run on Sprint 1.

---

## Test tools (intended vs actual)

| Tool | Layer | What it tests | Actual |
|---|---|---|---|
| pytest | Backend (Python) | Judge module, FastAPI routes | Not installed / not run — manual `POST /judge` smoke only |
| Jest | Frontend (TypeScript) | Component rendering, state | Not installed |
| Playwright | E2E | Full contest flow: register → submit → verdict → rankings | Not installed |

`package.json` has no `jest`/`vitest`/`playwright` config. Per `AGENTS.md` §1.5, any ad-hoc test files must be deleted before committing.

---

## Actual verification evidence (this branch, as of 2026-09-06)

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | Pass |
| Lint | `npm run lint` | Pass (no new errors) |
| Build | `npm run build` | Pass |
| FastAPI judge — AC | `POST /judge` correct solution | `accepted` |
| FastAPI judge — WA | correct program, wrong expected | `wrong_answer` |
| FastAPI judge — TLE | `while True` loop, `time_limit_ms=1000` | `time_limit_exceeded` |
| FastAPI judge — CE | `def foo(` syntax error | `compilation_error` (PyCompileError truncated) |
| Next APIs — smoke | `GET /api/problems`, `GET /api/contests`, `GET /api/rankings?contestId=` | Seeded counts correct (8 problems, 4 contests) + standings computed |
| Auth — admin gate | `GET /api/admin/summary` as non-admin | 403 `forbidden` |
| Auth — submissions | `POST /api/submissions` without session | 401 `unauthorized` |
| Audit | `npm audit` | 1 high / 4 moderate unresolved |

**`npm audit` note:** fixes require breaking Drizzle major upgrades; intentionally deferred and tracked in `docs/status.md` Remaining work. Do not run `npm audit fix --force` without a migration plan.

---

## Remaining test infrastructure gap

1. Add runners: `jest`/`vitest` + `pytest` + `playwright` + CI
2. Unit tests for `api/app/judge.py` (AC/WA/TLE/MLE/RE/CE, normalization, truncation)
3. Integration tests for `POST /api/submissions` → judge → Neon (mock FastAPI + real DB)
4. Auth tests for `org:admin` vs `users.role` gate (`/api/admin/*`)
5. E2E with Clerk test users (sign-in → register → submit → rankings)
6. Stress test harness (30 concurrent) once Redis/SSE + queue exist
