---
name: clean-code
description: >-
  Apply PonyFoo-style modular design and "deep module" thinking when writing or
  reviewing TypeScript/Python in this repo. Use when creating modules, functions,
  components, or APIs, or when refactoring — favors minimal, consistent interfaces
  and warns against premature abstraction. Trigger on "make this cleaner", "refactor",
  "extract", "too abstract", or any code-review pass.
---

# Clean Code (PonyFoo / modular design)

Grounded in Nicolás Bevacqua's *Modular Design Thinking* (ponyfoo.com/articles/modular-design-thinking)
and John Ousterhout's *A Philosophy of Software Design* (web.stanford.edu/class/cs190/).

## Core thesis
Complexity is the silent killer. Modules hide complexity behind a clear interface so
you only reason about one level at a time. The goal is **readable, changeable** code —
collaboration beats cleverness.

## Rules (apply in this order)
1. **Single responsibility.** A function does one aspect of the work. Flow code calls
   aspect functions; it does not implement them inline.
2. **Design the API first, then implement.** Imagine the ideal call site. Optimize the
   common case; hide rare options behind an `options` object.
3. **Minimal surface.** Expose only what consumers need. Adding to an API is cheap;
   removing is expensive. Start small.
4. **Consistency.** Same shape everywhere (e.g. currency always in cents). Surprises are bugs.
5. **Flexible in, predictable out.** Accept several input shapes, always return one shape.
6. **Simplicity over cleverness.** More named variables > one-liners. Guard clauses /
   early returns > nested conditionals. Extract branches into named functions (`const`, not `let`).
7. **Test the interface, not the internals.** Tests stay brittle-free and let you rewrite impls.
8. **Docs as a smell test.** If a reader must open the implementation to understand usage,
   the interface or docs are wrong.
9. **Abstractions last.** Let patterns emerge from 2–3 real cases before extracting. A wrong
   abstraction warps simple code and is costly to undo. Prefer duplication over a bad abstraction.

## Red flags to fix
- Nested `if/else` pyramids → flip to guard clauses.
- `let` that could be `const` → extract into a function, make it `const`.
- A "clever" one-liner → unpack with intermediate variables.
- Abstraction added after the first repetition → wait for a third case.

## When reviewing
Ask: "If I touch this in 6 months, do I understand it without reading the deps?" If no,
simplify the interface or split the module.
