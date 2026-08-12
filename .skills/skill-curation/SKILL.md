---
name: skill-curation
description: >-
  Find, evaluate, and install agent skills (SKILL.md bundles) for this project from the
  wider ecosystem. Use when the user asks for "more skills", "a skill for X", or wants to
  extend the agent's capabilities. Points to the canonical marketplaces/repos and the
  Agent Skills spec so we add vetted skills instead of reinventing them.
---

# Skill Curation

## Canonical sources (verified reachable)
- **anthropics/skills** — github.com/anthropics/skills. Official Agent Skills repo
  (168k★). Each skill is a folder with `SKILL.md`. Register as a marketplace in Claude Code:
  `/plugin marketplace add anthropics/skills`. Spec at agentskills.io.
- **awesome-claude-skills** — github.com/ComposioHQ/awesome-claude-skills (1000+ curated
  skills/plugins, cross-agent: Claude Code, Codex, Cursor, Gemini CLI). Also
  github.com/travisvn/awesome-claude-skills.
- **Marketplaces** — awesomeskill.ai and awesome-skills.com (curated SKILL.md collections,
  browse by category: frontend, testing, docs, dev-tools).

## Skill format (from anthropics/skills)
A skill = a folder with `SKILL.md`:
```
---
name: my-skill-name
description: What it does and when to use it
---

# My Skill Name
[instructions, examples, guidelines]
```
Only `name` + `description` are required in frontmatter. Keep instructions concrete.

## How to add a skill here
1. Search the sources above for the capability (e.g. "postgres", "testing", "docs").
2. Skim the `SKILL.md` — is it concrete, not generic? Does it fit our stack?
3. Drop it into `.skills/<name>/SKILL.md` (this repo's local skill dir) OR install via the
   Claude Code marketplace if you're in that environment.
4. Don't duplicate what already exists locally — check `.skills/` and the global
   `C:\Users\panne\.agents\skills` first (we already have frontend-design, vercel-react,
   typescript-best-practices, supabase, playwright-e2e-testing, web-design-guidelines).

## Local skills already present (don't recreate)
- frontend-design, web-design-guidelines — UI/UX
- vercel-react-best-practices — Next/React perf
- typescript-best-practices — TS typing
- supabase, supabase-postgres-best-practices — Postgres/RLS/indexing
- playwright-e2e-testing — E2E tests
- agent-browser — browser automation

## When to write a NEW local skill (vs install)
Write one when the knowledge is project-specific (our stack, our conventions) — e.g. the
clean-code, api-design, frontend-ui, library-research skills in this folder. Install upstream
skills when they're general and maintained by others.
