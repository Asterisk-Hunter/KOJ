# Project Overview

## What is KOJ?

**KOJ (Kottayam Online Judge)** is a contest hosting platform with an integrated problem archive, built for IIIT Kottayam students and the competitive programming community.

> **Current status:** Durable judging uses a Postgres pull queue with Cloud Run workers. See `docs/status.md` for implemented features and work that still requires live infrastructure or owner coordination.

## Problem Statement

### Current state
- College contests depend on external platforms (Codeforces, AtCoder)
- Codeforces has experienced downtime during actual contests
- No institutional control over contest environment or problem curation
- Contest problems are lost after the event — no reusable archive

### Desired state
- Self-hosted platform under college control
- Problem archive that grows with each contest
- Reliable infrastructure for college-scale concurrent load (20–50 students)
- Transparent, understandable codebase that students can learn from or contribute to

### Why not just use Codeforces?

Codeforces is excellent but not self-hostable. We need institutional control, guaranteed uptime for internal events, and the ability to run contests without depending on external infrastructure availability. A college-scale system needs different tradeoffs than Codeforces (which optimizes for global contests of 10,000+ participants).

---

## Objectives

### Technical
1. Build a contest hosting platform that judges code submissions in seven languages
2. Keep judging separate from the web layer and deliver work through durable Postgres jobs with leases and retries
3. Create a problem lifecycle system where contest problems transition to a public archive post-contest (`draft → contest_active → published`)
4. Stream submission and contest status through bounded SSE views polling Postgres; Redis is only an optional read-side cache
5. Measure queue throughput and latency on the deployed Cloud Run/Neon stack before making capacity claims

### Educational (for SE course)
1. Demonstrate full software engineering process: requirements specification, design with UML, testing strategy, project management
2. Justify every architectural decision with reference to functional or non-functional requirements
3. Differentiate between architectural styles (layered, pipe-and-filter, event-driven, master-slave) with concrete examples from the codebase
4. Document design tradeoffs: what we chose to include (process-level sandboxing) vs. what we explicitly didn't (production-grade VM isolation)
5. Show testing taxonomy: unit, integration, validation, stress, alpha, beta, and regression testing (current local and CI checks are in `docs/testing.md`)

### Resume
1. Ship a real product used by real people (actual college contests with real students)
2. Demonstrate full-stack engineering: backend judge, API layer, frontend UI, database, real-time infrastructure
3. Show thoughtful architectural decisions and their justification
4. Provide concrete, verifiable metrics (N contests hosted, X problems archived, Y students participated)

---

## Target users

| Role | What they do | Status on `feat/sprint1-backend` |
|---|---|---|
| **Contestant** | Registers for contests, submits code, views leaderboard, practices archived problems | Implemented (`user_role=contestant`) |
| **Setter** | Creates problems, uploads test cases, sets time/memory limits, creates/edits/publishes contests | Implemented (`setter` in DB; problems via `requireSetter`, contests via `requireContestManager`) |
| **Admin** | Manages users, controls visibility and publishing, deletes problems, observability | Implemented (`admin` role in Neon; no Clerk Organizations gate) |

---

## Value proposition

After a contest ends, problems automatically publish to a public practice archive. This turns one-off contests into cumulative institutional knowledge — a growing problem bank that models SPOJ or Codeforces's problem archive, but built and owned by the college.

Status today: seed provides 8 published problems + 4 contests pre-linked (16 contest_problems). Contest lifecycle handlers publish linked problems when contests end; live data and contest operation remain deployment checks.

---

## Docs index

- Start here: `docs/context.md`
- Status (authoritative): `docs/status.md`
- Architecture: `docs/architecture.md`
- Features (implemented vs planned): `docs/features.md`
- Stack: `docs/stack.md`
- Testing: `docs/testing.md`
- Deployment: `docs/deployment.md`
- Glossary: `docs/glossary.md`
