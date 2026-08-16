# Testing Strategy

## Test plan by type

| Type | Responsibility | Test cases | Metrics |
|---|---|---|---|
| **Unit** | Judge module; problem state machine; penalty calculation | TLE, MLE, RE, WA, AC; state transitions | 40+ tests, 85% code coverage |
| **Integration (bottom-up)** | Judge + Submission API + DB | Submit → judge → DB verdict | 15+ tests |
| **Integration (top-down)** | Contest flow with stubbed judge | UI → API → judge stub → verdict | 10+ tests |
| **Validation** | Full system vs. SRS requirements | Run all acceptance criteria | Pass/fail checklist |
| **Stress** | 30 concurrent submissions in 10s | Leaderboard lag, verdict correctness under load | Max 5s lag; 100% verdict accuracy |
| **Alpha** | Internal team testing | Host a mock contest, find edge cases | Defect log |
| **Beta** | Real college contest | 20+ students, 50+ submissions | Feedback survey |
| **Regression** | After each sprint, re-run full test suite | All tests from above | No new failures |

---

## Unit test focus: Judge module (40+ tests)

| Verdict | Test case | What it validates |
|---|---|---|
| TLE | `while True` loop | CPU limit fires correctly |
| MLE | `alloc = []; while True: alloc.append(' ' * 1024)` | Memory limit fires correctly |
| RE | Division by zero | Returns RE, not crash |
| WA | Output with extra whitespace | Whitespace normalization works |
| AC | Simple correct solution | Happy path works |
| CE | Invalid C++ syntax | Compiler error captured correctly |
| AC | Python solution | Multi-language support works |

---

## Integration test: Full submission flow

```
1. Create problem with test cases (Problem API)
2. Create contest, add problem (Contest API)
3. Register contestant
4. Submit code (Submission API)
5. Wait for verdict (≤10s)
6. Verify verdict in DB
7. Verify Realtime event sent
8. Verify leaderboard updated
```

---

## Stress test: 30 concurrent submissions

- Spawn 30 concurrent submission requests in 10 seconds
- Verify all 30 verdicts are correct (match manual verification)
- Verify leaderboard lag ≤5 seconds after last verdict
- Verify no timeout errors

---

## Test tools

| Tool | Layer | What it tests |
|---|---|---|
| pytest | Backend (Python) | Judge module, Submission API, Contest API, Problem API |
| Jest | Frontend (TypeScript) | React component rendering, state logic |
| Playwright | E2E | Full contest flow: register → join → submit → see verdict → check leaderboard |
