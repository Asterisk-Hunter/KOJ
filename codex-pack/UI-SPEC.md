# KOJ — UI Spec: Codeforces-grade, zero AI artifacts

Target: a judge a competitive programmer trusts on sight. Reference feel — **Codeforces
above LeetCode**: denser, more utilitarian, information always beating decoration. The SRS
already states the bar for v1: *"clean, minimal design similar to Codeforces. No complex
animations or heavy visual effects."* (`SRS.txt` §3.1).

Keep the existing dark theme (`app/globals.css`: `--color-kjbg #050505`,
`--color-kjprimary #00ff9d`, `--color-kjsurface`, `--color-kjtext`). You are refining within
it, **not rebranding it**. One accent colour, used for meaning only.

## Principles

1. **Data over decoration.** Numbers in monospace, right-aligned, tabular. Verdicts in a fixed
   colour vocabulary. Timestamps relative when recent, absolute when not.
2. **Dense but calm.** Codeforces sizes tables tightly and never animates them. Prefer a
   14-row visible table over a card grid of 6.
3. **One correct state, always visible.** Never show a spinner where a text status would do.
   Never show "—" when the truth is available.
4. **Honest interactions.** A button disables while working and reports the result in place.
   No toasts that vanish before they are read; no silent failures (a submit that returns 429
   must say "rate limited, retry in Ns" — the code already tracks `Retry-After`).
5. **Nothing implies a capability the viewer lacks.** See `ROLE-MATRIX.md`.

## Progress on this checklist (2026-09-22 pass)

Done **in the working tree only — not deployed** (Vercel builds from git, and this is
uncommitted; the live site still shows every artifact below). `curl https://koj-peach.vercel.app/`
still returns `terminalGlitch`, `terminal-crt-glow`, `scanline`, `text-glow`, `bg-grid` and
`IIITK Judge`. Commit + push, then re-run that `curl`, before claiming any of this is live
(defect D1 / `TASKS.md` P0-1):

- ✅ **A.1–A.3** `app/components/GlitchingTerminal.tsx` **deleted**; the fabricated boot log and
  every glitch/scanline/CRT animation are gone from the landing page. `app/page.tsx` was
  rewritten as a Codeforces-style text hero.
- ✅ **C.4** Brand unified on **KOJ** (nav, title, hero).
- ✅ **D.1** `/api/problems` no longer reports `status:"unsolved"` to anonymous callers.
- ✅ Language selector now offers the seven real languages (see `CONTEXT.md`).

Still open: A.4 (orphaned CSS), B (glyph polish), C.1–C.3 (marketing copy), D.2–D.4.
Everything below is unchanged as the target.

## De-slop checklist (concrete, verified targets)

### A. Decorative effects to remove or neutralise — `app/components/GlitchingTerminal.tsx`

The hero terminal was the single largest AI artifact on the site: a fake boot sequence
("Initializing KOJ Kernel v4.2...", "All systems operational."), a random `terminalGlitch`
keyframe animation that translated/hue-rotated the whole panel every 5 s, scanline overlay,
CRT vignette, pulsing text-shadow, and a fake mac-style window chrome with three coloured
dots. It advertised theatre, not competence.

- [x] Delete the glitch animation, scanline overlay, CRT vignette, and glow pulse.
- [x] Delete the invented boot log (it is fabricated status text — a lie on the landing page).
- [x] Either replace the panel with something true (e.g. a real recent-submission/verdict
      feed pulled from `/api/submissions` for a signed-in user) or remove it and let the
      sign-in + archive be the hero. → *removed; the hero is now text.*
- [ ] Remove `.terminal-crt-glow`, `.text-glow`, `.bg-grid` if nothing true uses them
      (`app/globals.css`), now that `GlitchingTerminal` is gone.

### B. Emoji and symbol audit (whole `app/`)

The codebase is already clean of decorative emoji — the only glyphs are `✓ ✗ ★ →`, which are
acceptable and Codeforces-like (the ICPC `★` first-blood marker in standings is legitimate).
Keep that discipline:

- [ ] No emoji in UI copy, error messages, toasts, or empty states. Ever.
- [ ] `✓`/`✗` only in verdict/test contexts (`app/submissions/[id]/page.tsx`,
      `app/problems/[id]/page.tsx`) — do not let them leak into buttons or headings.
- [ ] Retire cosmetic arrows in labels (e.g. `ADMIN CONSOLE →` in `Navigation.tsx`) in favour
      of plain uppercase labels.
- [ ] Replace the `#` glyph used as the Submissions nav "icon" with a real icon or nothing.

### C. Copy that sounds generated

- [ ] Kill superlatives: "Industry-standard problem creation suite", "Built for Competitive
      Excellence", "Enter App", "Get Started". Use domain vocabulary: "Create problem",
      "Sign in", "Dashboard", "Submit".
- [ ] Kill hedging and marketing in product surfaces; keep it in the (short) landing hero only.
- [ ] Error text must name the cause and the next action: `problemId must be a positive
      integer` is fine; "Something went wrong" is not.
- [x] Consistency: **KOJ** everywhere. ~~`Navigation.tsx` said "IIITK Judge"~~ — fixed; nav,
      title, hero and footer now all read KOJ.

### D. State and affordance correctness

- [x] `/api/problems` returned `status:"unsolved"` to anonymous visitors — anonymous callers
      now receive `status: null`.
- [ ] Every list has a real empty state with a next action (browse, create, register).
- [ ] Countdowns (contest timer, rate-limit cooldown) are accurate and legible; a frozen
      scoreboard must say that it is frozen and until when.
- [ ] Loading uses the existing `RouteLoading.tsx` / `loading.tsx` skeletons — no ad-hoc spinners.

## Components and conventions to follow

- Reuse: `Navigation.tsx`, `PageHeader.tsx`, `StatCard.tsx`, `RouteLoading.tsx`,
  `CodeMirrorEditor.tsx`.
- Tokens only: `kjbg`, `kjsurface`, `kjsurface-alt`, `kjcontainer`, `kjprimary`, `kjsecondary`,
  `kjtertiary`, `kjtext`, `kjtext-muted`, `kjborder`, `kjborder-bright`. No new hex colours
  outside the ICPC balloon palette in `app/api/rankings/route.ts`.
- Verdict vocabulary (fixed, reuse everywhere): `ACCEPTED`, `WRONG ANSWER`, `TIME LIMIT`,
  `MEMORY LIMIT`, `RUNTIME ERROR`, `COMPILATION ERROR`, `PRESENTATION ERROR`, `PENDING`,
  `RUNNING`, `INFRA ERROR` (the last one only when `judge_infra_error` is true, and it must
  never be phrased as the contestant's fault).
- Density targets: hall table rows ≈ 32–36 px, mono numerals, sticky header, problem labels
  as `A`/`B`/`C`, solved cells tinted, attempts shown as `+1`, `+2`, pending attempts as `?`.

## Acceptance for the UI pass

1. Landing page contains no fabricated status text and no animation loop.
2. Every verdict string in the app comes from the fixed vocabulary above.
3. No emoji anywhere in `app/`; `✓ ✗ ★` confined to verdict/standings contexts.
4. Every page renders correctly for signed-out, contestant, and admin (see `ROLE-MATRIX.md`),
   proven with screenshots kept outside the repo.
5. `npx tsc --noEmit && npm run lint && npm run build` green; no leftover test/scratch files.
