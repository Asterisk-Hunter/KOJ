# KOJ Skills

Project-specific agent skills (SKILL.md bundles) that encode how we want this codebase built.
These are loaded by the coding agent to steer code generation and review. They are grounded in
web research done for this project (see each file's sources).

## What's here

| Skill | What it teaches | Trigger |
|---|---|---|
| `clean-code` | PonyFoo modular design + Ousterhout deep/shallow modules. Minimal, consistent interfaces; no premature abstraction. | refactor, "make cleaner", extract, code review |
| `api-design` | FastAPI + Next Route Handlers + Drizzle/Neon + REST (Microsoft/Zalando). Response models, deps, errors, migrations. | add endpoint, validation, error response |
| `frontend-ui` | Next 16 + Tailwind v4. shadcn/ui on Radix/Base UI, accessibility, responsive, tasteful motion. | UI, component, design, form, dashboard |
| `library-research` | Which tool to research with (@librarian / firecrawl / websearch) + dependency evaluation checklist. | "how does X work", pick a lib, version behavior |
| `skill-curation` | Where to find/install more skills (anthropics/skills, awesome-claude-skills, marketplaces) + format. | "more skills", "skill for X" |

## Sources researched (2026-08-12)
- PonyFoo — Modular Design Thinking: https://ponyfoo.com/articles/modular-design-thinking
- A Philosophy of Software Design (Ousterhout): https://web.stanford.edu/class/cs190/
- FastAPI docs: https://fastapi.tiangolo.com
- Microsoft REST API Guidelines: https://github.com/microsoft/api-guidelines
- Zalando RESTful API Guidelines: https://github.com/zalando/restful-api-guidelines
- Drizzle ORM: https://orm.drizzle.team
- shadcn/ui: https://ui.shadcn.com · Radix UI: https://www.radix-ui.com · Base UI: https://mui.com/base-ui
- Magic UI: https://magicui.design · Aceternity UI: https://ui.aceternity.com
- Agent Skills spec + anthropics/skills: https://agentskills.io · https://github.com/anthropics/skills
- awesome-claude-skills: https://github.com/ComposioHQ/awesome-claude-skills

## Note
The `api/*` Python files show LSP "import could not be resolved" in some editors until you
activate the venv (`api/.venv/Scripts/activate` + `pip install -r api/requirements.txt`). That's
expected — the deps are installed in the venv, not the workspace interpreter.
