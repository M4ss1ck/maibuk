# GitHub Copilot Repository Instructions

## Priority

- Follow repository conventions in AGENTS.md first.
- If any instruction conflicts with AGENTS.md, AGENTS.md wins.

## Working style (Superpowers-inspired)

1. **Brainstorm before coding**
   - Clarify intent, constraints, alternatives, and trade-offs.
   - Propose a short design and wait for approval on non-trivial work.
2. **Write a concrete plan**
   - Break work into small, verifiable tasks (prefer 2-10 minute chunks).
   - Include affected files and validation steps.
3. **Execute in small increments**
   - Implement one task at a time.
   - Keep edits minimal and focused.
4. **Verify before completion**
   - Run project checks relevant to the change.
   - Confirm behavior with concrete evidence.
5. **Review and report**
   - Summarize what changed, what was validated, and any risks/follow-ups.

## Maibuk-specific non-negotiables

- Use existing patterns and structure from AGENTS.md.
- Reuse existing UI primitives and hooks before creating new ones.
- Use i18n for user-facing strings (both English and Spanish keys).
- Keep styling with semantic Tailwind tokens (no raw color values).
- Use platform adapters in `src/lib/platform/` (avoid direct Tauri API imports).
- Prefer named exports for components (except existing project exceptions).

## Quality guardrails

- Avoid broad refactors unless requested.
- Preserve public APIs unless task requires change.
- Add only necessary comments; explain **why**, not **what**.
- Keep answers and commit-style summaries concise and actionable.
