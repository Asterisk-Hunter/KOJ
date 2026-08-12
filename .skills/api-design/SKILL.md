---
name: api-design
description: >-
  Design and implement backend APIs for this repo (Next.js Route Handlers under
  app/api/* and the separate FastAPI service under api/). Use when adding endpoints,
  response models, validation, error handling, or DB access via Drizzle/Neon. Grounds
  FastAPI + Drizzle + Postgres patterns and REST/HTTP conventions (Microsoft + Zalando
  guidelines). Trigger on "add an endpoint", "API", "route handler", "validation", "error response".
---

# API Design (FastAPI + Next Route Handlers + Drizzle/Neon)

## FastAPI (api/) — fastapi.tiangolo.com
- **Response models:** always define a Pydantic `response_model` on routes — gets typed
  responses + OpenAPI schema + strips unexpected fields.
- **Dependencies:** use `Depends()` for shared logic (auth, DB session, settings) instead of
  copy-paste in handlers.
- **Errors:** raise `HTTPException(status_code=...)` with a machine-readable body
  `{"error": "...", "detail": ...}`. Never return raw exceptions.
- **Validation:** Pydantic models at the boundary; never trust `request.json()` directly.
- **Path/query:** typed path params (`user_id: int`); optional query via `Optional` + default.
- **Health:** `/health` must degrade, not 500 (see api/app/main.py pattern).

## Next.js Route Handlers (app/api/*)
- Mark `export const runtime = "nodejs"` when touching `pg`/Neon (not edge).
- `export const dynamic = "force-dynamic"` for DB routes (no static caching).
- Return `NextResponse.json(...)`; wrap DB calls in try/catch and return `degraded` not 500.
- Keep handlers thin: call a service/repo function, don't inline SQL.

## REST / HTTP conventions
- Microsoft REST API Guidelines (github.com/microsoft/api-guidelines) + Zalando
  RESTful API Guidelines (github.com/zalando/restful-api-guidelines):
  - Nouns not verbs: `GET /notes`, `POST /notes`, `GET /notes/{id}`.
  - Use correct status codes (201 created, 400 bad request, 401/403 auth, 404, 422 validation, 500 only for truly unexpected).
  - Filter/sort/paginate via query params (`?limit=20&offset=0`).
  - Consistent error envelope; consistent date format (ISO 8601, UTC).
  - Version via path or header before breaking changes.

## Drizzle ORM (orm.drizzle.team) + Neon Postgres
- **Schema:** define tables in `db/schema.ts`; relations via `relations()`.
- **Queries:** use the `db` client from `db/index.ts` (single `pg.Pool`). Prefer
  `db.query.notes.findMany()` / `.findFirst()` over raw SQL for typed results.
- **Migrations:** generate with `npm run db:generate`, apply with `npm run db:migrate`
  (uses `db/migrations`). Use `db:push` only for throwaway dev schemas.
- **Performance:** select only needed columns; index FK/lookup columns; avoid N+1 —
  use `with` relations or `Promise.all` for independent fetches.
- **Postgres/Supabase:** enable Row Level Security for multi-tenant tables; run the
  database linter (supabase.com/docs/guides/database/database-linter); see
  supabase-postgres-best-practices skill for indexing/RLS detail.

## Checklist for a new endpoint
- [ ] Typed request (Pydantic / Zod) and typed response
- [ ] Correct HTTP status + consistent error envelope
- [ ] DB access through the shared client, no inline secrets
- [ ] Degrades gracefully (no 500 on DB blip)
- [ ] Documented in OpenAPI (FastAPI auto) or route comment (Next)
