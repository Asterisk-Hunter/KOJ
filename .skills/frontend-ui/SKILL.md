---
name: frontend-ui
description: >-
  Build high-quality, accessible UI for this Next.js 16 + Tailwind v4 app. Use when
  creating or polishing components, pages, layouts, or design systems. Favors shadcn/ui
  on Radix/Base UI primitives, Tailwind v4 theming, WAI-ARIA accessibility, responsive
  layout, and tasteful motion. Trigger on "UI", "component", "design", "style", "form",
  "dashboard", "landing page", or any visual polish request.
---

# Frontend UI (Next.js 16 + Tailwind v4)

## Stack reality (verified in this repo)
- Next.js 16 App Router, React 19.2.8, Tailwind CSS 4.3.3 (v4 — no `tailwind.config.js`;
  theming lives in `app/globals.css` under `@theme inline { ... }`).
- PostCSS plugin: `@tailwindcss/postcss` (see `postcss.config.mjs`).

## Component layer (2026 consensus)
- **shadcn/ui** (ui.shadcn.com) — copy/paste components you OWN (no black box). Built on
  Radix UI primitives, styled with Tailwind. Add via `npx shadcn@latest add button`.
  Best default for app UIs.
- **Radix UI** (radix-ui.com) — 30+ accessible unstyled primitives (Dialog, Dropdown, Tabs,
  Popover). Keyboard nav, focus mgmt, ARIA, RTL built in. Underneath shadcn.
- **Base UI** (mui.com/base-ui) — MUI's actively-maintained primitive layer; shadcn offers
  it as an opt-in alternative since 2025. Use when Radix lags on a primitive.
- **Animation:** Magic UI (magicui.design, 150+ animated components, MIT) and Aceternity UI
  (ui.aceternity.com) for landing/marketing polish. Use sparingly — delight, not noise.
- **Avoid:** building accessible primitives from scratch. Stand on Radix/Base UI.

## Principles
1. **Accessibility first (WAI-ARIA).** Every interactive element: keyboard operable,
   focus-visible, labelled, sufficient contrast. Test with keyboard only.
2. **Own the code.** Prefer shadcn copy/paste over opaque npm UI kits — you can fix/theme it.
3. **Tailwind v4 theming.** Define design tokens in `@theme inline` in `globals.css`;
   don't reintroduce a JS config. Use CSS variables for light/dark.
4. **Responsive by default.** Mobile-first; `sm:`/`md:`/`lg:` breakpoints; fluid type/spacing.
5. **Consistent spacing & hierarchy.** 4/8px rhythm; clear visual hierarchy; one primary action.
6. **Motion with intent.** Micro-interactions via CSS/Motion; respect `prefers-reduced-motion`.
7. **Forms:** accessible labels, errors, disabled/loading states, focus management on submit.

## Workflow
- New primitive need → `npx shadcn@latest add <component>` (or hand-roll on Radix/Base UI).
- Marketing/landing flair → Magic UI / Aceternity blocks, trimmed to brand.
- Review with the `web-design-guidelines` skill and the `frontend-design` skill before shipping.

## Red flags
- `div` with onClick and no role/keyboard handler → use a real button / Radix primitive.
- Hard-coded colors instead of theme tokens → use `@theme` variables.
- Animation that ignores `prefers-reduced-motion` → gate it.
