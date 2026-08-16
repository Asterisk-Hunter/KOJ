# Project Management

## Team structure

| Role | Member | Modules | Documentation ownership |
|---|---|---|---|
| **Backend Lead / Judge** | (Strongest backend engineer) | Judge module, Submission API, Process isolation | SRS §Judge, §Submission; Unit test plan; Sequence diagram for verdict flow |
| **Backend / Contest** | (Backend #2) | Contest engine, Problem API, Problem lifecycle | SRS §Contest, §Problem; State machine diagrams; Integration test plan |
| **Frontend / Problem UI** | (Frontend #1) | Problem statement display, Submission form, Submission status | SRS §UI; React component design; Frontend unit tests |
| **Frontend / Leaderboard** | (Frontend #2) | Auth UI, Leaderboard, Realtime subscriptions | SRS §Auth, §Leaderboard; E2E test plan |
| **Cross-cutting (all)** | All members | SRS, UML diagrams, testing strategy, project management, presentation | |

**Weekly sync:**
- Tuesday: standup on progress, blockers, code review for merged PRs
- Friday: demo of completed features to the group, planning next sprint

---

## Sprint plan

### Sprint 1 (Weeks 1–4): Auth + Judge + Problem API
**Goal:** Core judge works, can create problems, can submit.
**Demo:** Submit a solution, see verdict.

### Sprint 2 (Weeks 5–8): Contest engine + Leaderboard + UI
**Goal:** Can host a contest, see live leaderboard.
**Demo:** Run a mini-contest with the team.

### Sprint 3 (Weeks 9–12): Archive + Polish + Testing + Docs
**Goal:** Auto-publish problems, full test suite, documentation.
**Demo:** Beta contest with real students.

---

## Risk register

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Sandbox escape | High — judge server compromised | Low — trusted users | Process-level isolation + documented boundary; accept for college use |
| Judge TLE variance | Medium — unfair verdicts | Medium — server load | Pin judge to dedicated core if possible; acknowledge variance in docs |
| Realtime lag | Medium — leaderboard stale | Medium — peak load | Redis cache invalidation + eventual consistency model; ≤5s target |
| Scope creep | High — missed deadlines | High — feature requests | Strict MVP scope; stretch goals explicitly deferred |
| Deployment failure | High — can't demo | Low — Docker Compose | Test deployment early (Week 4); have manual fallback |

---

## Estimation

- ~3000 LOC estimated (Python backend + TypeScript frontend)
- 4 people, 12 weeks, 3 sprints
- COCOMO: moderate effort, moderate schedule
- Risk buffer: 20% of each sprint reserved for integration bugs and未知未知 unknowns
