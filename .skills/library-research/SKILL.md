---
name: library-research
description: >-
  Decide how and where to research a library or API before writing code in this repo.
  Use when you need current docs, version-specific behavior, examples, or a bug fix for an
  external dependency (Next.js, Tailwind, Drizzle, FastAPI, psycopg, shadcn, Radix, etc.).
  Routes the work to the right tool (@librarian, firecrawl, websearch) and gives an evaluation
  checklist so we pick libraries that won't bite us later.
---

# Library Research

## Which tool for what
- **@librarian agent** — authoritative external docs, API references, official examples,
  version-specific behavior, bug investigations. Best for "how does X work / what changed in vN".
- **firecrawl_search / firecrawl_scrape** — broad web research, blog posts, GitHub READMEs,
  scraping a specific URL's markdown. Use for surveys ("best React UI libs 2026") and deep dives.
- **websearch** — quick current-event / recent-release lookups (exa-backed). Use for "latest
  version of X", "X vs Y 2026".
- **Local node_modules docs** — Next.js 16 ships `node_modules/next/dist/docs/` (see AGENTS.md).
  Read those BEFORE web research for Next-specific APIs — this version has breaking changes.

## Evaluation checklist (before adding a dependency)
1. **Maintenance:** recent commits/releases in the last ~6 months? Active issue responses?
2. **Adoption:** weekly npm downloads / GitHub stars as a sanity signal (not gospel).
3. **License:** MIT/Apache-2.0 preferred; flag GPL/copyleft or paid-only tiers.
4. **Accessibility:** for UI libs, does it ship WAI-ARIA + keyboard support? (Radix/Base UI do.)
5. **Fit:** does it solve our case or do we bend code to its abstraction? (See clean-code skill.)
6. **Footprint:** bundle size / native deps (e.g. `psycopg` vs `psycopg-binary`).

## Process
1. State the problem in one sentence.
2. Pick the tool above; prefer local docs for Next.js, @librarian for API specifics.
3. Capture the canonical URL + one concrete, actionable principle (not a quote).
4. If adding the dep: update `package.json` (or `api/requirements.txt`), pin a recent stable version.
5. Note the source in a comment or the relevant `.skills/*/SKILL.md` so future work is grounded.

## Don't
- Guess an API from training memory for fast-moving libs (Next 16, Tailwind 4, Drizzle) —
  verify first.
- Add a library to avoid 5 lines of duplication unless it earns its footprint (clean-code rule 9).
