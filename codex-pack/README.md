# KOJ Handoff Pack — start here

Everything an agent needs to take over **KOJ — Kottayam Online Judge** without guessing.
State is verified as of **2026-09-22** (Asia/Kolkata) against the live system, not against
the repo's own documentation (which had drifted — see `CONTEXT.md` "Documentation that lied").

## Read in this order

| Order | File | Why |
|---|---|---|
| 1 | `AGENT.md` | The working agreement: mission, hard rules, architecture, blocker protocol. |
| 2 | `CONTEXT.md` | What is actually live, what was broken, what is decided and frozen. |
| 3 | `TASKS.md` | Prioritised backlog — P0 is production-critical. |
| 4 | `SRS-TRACEABILITY.md` | Every `REQ-*` with implementation status and file-level evidence. |
| 5 | `UI-SPEC.md` | Codeforces-grade direction + the AI-artifact de-slop checklist. |
| 6 | `ROLE-MATRIX.md` | Who may see and do what, and where it is enforced. |
| 7 | `RUNBOOK.md` | Local run, judge run, deploy, migrate, rollback, smoke test. |
| 8 | `API-CONTRACT.md` | Route inventory with auth + validation behaviour. |
| 9 | `E2E-VERIFICATION.md` | Exactly what was tested live on 2026-09-22 and what is still unverified. |
| 10 | `BLOCKERS.md` | Copy-paste prompts for the things only the human can do. |

## Reference material

- `SRS.md` — requirement index with a pointer to the canonical document.
- `SRS.txt` — full text extraction of the approved SRS v1.0 (grep-able).
- `KOJ_SRS.pdf` — the canonical approved SRS (Group 3, IIIT Kottayam, 4 Aug 2026).
- `docs/` — the repo's own documentation as of the pack date (`docs/status.md` is the most
  detailed, but where it conflicts with `CONTEXT.md`, trust `CONTEXT.md`).
- `docs/screenshots/` — UI captures taken **before** this pass. Use them as the "before" side
  of the de-slop diff (`UI-SPEC.md`): the landing capture shows the fake terminal that has been
  removed locally, and it is still what production serves.
- `share.env` — current environment values (gitignored; never commit).

## What changed in this revision (2026-09-22, second pass)

This pack was refreshed after a working session that changed the live system.

> ⚠️ **Read this before anything else.** The judge changes are **live** (Cloud Run deploys from
> source). The frontend changes are **NOT live** — Vercel builds from git and they are
> uncommitted, so the public site still shows the fake terminal, the glitch CSS, the old brand
> and the fabricated anonymous problem status. `CONTEXT.md` → "Deployed vs working tree" has
> the `curl` evidence. Committing and pushing is `TASKS.md` P0-1, your first action.

| Change | Deployed | Evidence |
|---|---|---|
| **Judge restored.** It was 100% down (`docker binary not found on judge host`): Docker-only code deployed on Docker-less Cloud Run. Two backends now, `JUDGE_SANDBOX_MODE=auto\|docker\|rlimit`; production runs `rlimit`. | ✅ live | `CONTEXT.md` outage section; `/health` → `"sandbox":"rlimit"`; smoke 18/18 |
| **Languages 4 → 7.** Go, Rust and JavaScript/Node added (SRS TBD-03), verified live AC + TLE. | ✅ live | `CONTEXT.md`; `E2E-VERIFICATION.md` §4a |
| **Six sharp-edged judge bugs fixed** — task-counting `RLIMIT_NPROC`, `RLIMIT_AS` vs JVM/Go/Node, `RLIMIT_FSIZE` vs `rustc`, missing-toolchain-as-CE, Go's per-submission stdlib rebuild. | ✅ live | `CONTEXT.md` items 1–5; `AGENT.md` "sharp edges" |
| **UI de-slop started.** `GlitchingTerminal` (fake boot log + glitch/scanline/CRT) deleted; landing page rewritten; brand unified on KOJ; anonymous problem status no longer fabricated. | ❌ working tree only | `UI-SPEC.md` progress section; `app/page.tsx` |
| **Interactive Run stdout bug fixed.** `Run` showed `(no stdout)` beside an `accepted` badge — the runner never set `is_sample`, so the judge redacted every interactive case's output. | ❌ working tree only | `E2E-VERIFICATION.md` §5a — API-level proof, before/after |
| **Free-AC bug fixed.** A problem with no test cases returned `accepted` (0/0) for any code. Judge now reports `runtime_error` + `infra_error`; publish is refused without test cases (POST and PATCH). | ✅ live (`00016`) | `CONTEXT.md` "The free-AC bug"; smoke `PASS zero cases`; 19/19 total |
| **Editor draft persistence.** Submitting, checking `/submissions`, then returning re-seeded the starter template and threw away your code. Drafts are now kept per problem+language. | ❌ working tree only | `E2E-VERIFICATION.md` §5b — browser-verified end to end |
| Repo docs corrected where they claimed the judge was Python-only. | ❌ working tree only | `docs/features.md`, `docs/status.md`, `docs/qa-browser-report.md` |

## Ground truth rules

1. Live behaviour beats documentation beats comments. Where they disagree, the live system wins.
2. Nothing in this pack is aspirational. If a file states a limitation, it was reproduced.
3. `share.env` is the only place secrets are written, and only because it is gitignored.
   Never paste its contents into code, commits, chat, issues, or PR descriptions.
4. Any status claim you make back to the human must be produced by a command you ran or a
   click you made. "Should work" is not a status.
