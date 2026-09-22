# KOJ — Role Matrix

The rule, stated once: **the UI hides, the API enforces, and both must agree.** A control
that renders and then returns 403 is a bug (this is a real user complaint, not a style note).
A hidden control whose API lacks a gate is worse — it is a security hole.

Roles live in `users.role` (DB). Clerk Organizations are **not** consulted.

| Capability | contestant | problem_setter | contest_setter | admin | Enforced by |
|---|:--:|:--:|:--:|:--:|---|
| Browse `/problems`, `/contests`, `/rankings` | ✅ | ✅ | ✅ | ✅ | public routes in `proxy.ts` |
| Submit code (practice: `published`; contest: registered + live) | ✅ | ✅ | ✅ | ✅ | `app/api/submissions/route.ts` |
| Register for a contest | ✅ | ✅ | ✅ | ✅ | `POST /api/contests/[id]/register` |
| View own submission history + verdicts | ✅ | ✅ | ✅ | ✅ | `GET /api/submissions` (owner-scoped) |
| See `/problems/create` and the Studio | ❌ | ✅ | ❌ | ✅ | `requireSetter`; UI flag `canAuthor` |
| Create / edit problems, test cases, import | ❌ | ✅ | ❌ | ✅ | `requireSetter` |
| Create / edit contests, add contest problems, set status | ❌ | ❌ | ✅ | ✅ | `requireContestManager` |
| Manage users and roles (`/api/admin/users`) | ❌ | ❌ | ❌ | ✅ | `requireAdmin` (BR-03) |
| Moderate submissions, observability, recover stuck rows | ❌ | ❌ | ❌ | ✅ | `requireAdmin` |
| See `/api/admin/summary` | ❌ | ✅ | ✅ | ✅ | `requireStaff` |
| Enter `/admin` | ❌ | ✅ | ✅ | ✅ | `app/admin/layout.tsx` redirect + per-section role checks |
| See the `ADMIN` nav pill | ❌ | ✅ | ✅ | ✅ | `Navigation.tsx` gated on `canAccessAdmin` |
| `ADMIN_CLERK_IDS` env allowlist | — | — | — | ✅ | bootstrap only, `requireAdmin` fast path |

`GET /api/auth/me` is the single contract the UI reads:

```json
{ "authenticated": true, "role": "contestant",
  "canAccessAdmin": false, "canAuthor": false, "canManageContests": false }
```

- `canAccessAdmin` = `canAuthor || canManageContests`
- `canAuthor` = `admin | problem_setter`
- `canManageContests` = `admin | contest_setter`

## Page-by-page visibility contract

| Page | Signed out | Contestant | Setter | Contest setter | Admin |
|---|---|---|---|---|---|
| `/` | marketing + sign-in | — | — | — | — |
| `/dashboard` | redirect to sign-in | progress + next actions | + authoring entry point | + contest entry point | + admin entry point |
| `/problems` | archive only; **no** create/import affordance | archive + own status | + "create problem" CTA | archive | + create/import/manage |
| `/problems/[id]` | statement + samples | + editor, run/submit, history | + authoring hints for own drafts | — | + manage test cases |
| `/problems/create` | sign-in notice | 403 panel (never the Studio) | Studio | 403 panel | Studio |
| `/contests` | list + status | + register CTA on open contests | list | + create/manage contests | + full CRUD |
| `/contests/[id]` | info; problem list only when published | + register / enter arena | info | + manage | + manage |
| `/contests/[id]/arena` | redirect | registered only, contest-scoped | registered only | registered only | registered only |
| `/rankings` | standings | standings | standings | standings | standings |
| `/submissions` | redirect | own history | own history | own history | + moderation |
| `/admin` | redirect to sign-in | redirect out (403 panel at worst) | setter sections only | contest sections only | everything |

## Current gaps to close (P1-2)

1. `/problems` — verify no create/import control leaks to contestants or anonymous visitors,
   including in the empty state and in any "get started" copy.
2. Contest pages — check registration/lock messaging for contestants vs staff; staff should
   not be offered "Register" as if they were participants.
3. `/admin` — `problem_setter` and `contest_setter` must only ever see their own sections
   (`admin/page.tsx` already branches on `data?.role`; confirm the API cannot serve the
   others' data to a narrower role — `summary` is `requireStaff`, so its payload must stay
   free of admin-only aggregates for non-admins).
4. Copy audit: any sentence on a contestant-visible page that mentions drafts, test cases,
   setters, publishing, or moderation must go (e.g. `app/problems/create`'s description text
   currently reads as a setters-only advertisement and is only reachable when authorized —
   keep it that way).

## Verification protocol (do this for every UI change)

1. Signed out → in a private window.
2. `contestant` → a throwaway account with `users.role = 'contestant'`.
3. `problem_setter` / `contest_setter` → flip the DB role temporarily (never the Clerk side).
4. `admin` → the real admin account.
5. For each role, screenshot the page and record which controls rendered. Diff against the
   table above. Restore any DB role you changed.
