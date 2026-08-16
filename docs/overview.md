# Project Overview

## What is KOJ?

**KOJ (Kottayam Online Judge)** is a contest hosting platform with an integrated problem archive, built for IIIT Kottayam students and the competitive programming community.

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
1. Build a working contest hosting platform that reliably judges code submissions across multiple languages
2. Implement a distributed judging architecture (judge isolated from web layer) that demonstrates architectural patterns
3. Create a problem lifecycle system where contest problems transition to a public archive post-contest
4. Implement real-time leaderboard updates using event-driven architecture (Supabase Realtime subscriptions)
5. Support concurrent contest load (30 simultaneous submissions) without performance degradation

### Educational (for SE course)
1. Demonstrate full software engineering process: requirements specification, design with UML, testing strategy, project management
2. Justify every architectural decision with reference to functional or non-functional requirements
3. Differentiate between architectural styles (layered, pipe-and-filter, event-driven, master-slave) with concrete examples from the codebase
4. Document design tradeoffs: what we chose to include (process-level sandboxing) vs. what we explicitly didn't (production-grade VM isolation)
5. Show testing taxonomy: unit, integration (bottom-up and top-down), validation, stress, alpha, beta, regression testing

### Resume
1. Ship a real product used by real people (actual college contests with real students)
2. Demonstrate full-stack engineering: backend judge, API layer, frontend UI, database, real-time infrastructure
3. Show thoughtful architectural decisions and their justification
4. Provide concrete, verifiable metrics (N contests hosted, X problems archived, Y students participated)

---

## Target users

| Role | What they do |
|---|---|
| **Contestant** | Registers for contests, submits code, views leaderboard, practices archived problems |
| **Problem Setter** | Creates problems, uploads test cases, sets time/memory limits |
| **Admin** | Creates contests, manages users, controls visibility and publishing |

---

## Value proposition

After a contest ends, problems automatically publish to a public practice archive. This turns one-off contests into cumulative institutional knowledge — a growing problem bank that models SPOJ or Codeforces's problem archive, but built and owned by the college.
