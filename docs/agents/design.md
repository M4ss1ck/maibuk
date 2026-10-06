# Design and Styling

Read this before UI, styling, or layout work: a new screen, a component's markup or classes, `src/index.css`, or a design token. The keyboard, touch, and screenshot requirements for the same work are in `CODING_STANDARDS.md`, "Keyboard and accessibility".

## Design context

### Users

Indie book authors — power users who value minimalism and craft. They come to Maibuk in **creative flow** mode: they want to disappear into their writing, not manage a project. The interface should remove friction, stay out of the way during writing, and feel satisfying during the moments they do interact with it (organizing chapters, exporting, designing covers). These are people who chose a dedicated writing tool over Google Docs — they care about the experience.

### Brand personality

**Bold · Creative · Modern**

Maibuk is confident, not timid. It has opinions about how writing software should feel. It's modern without being trendy — no chasing aesthetic fads. It's creative in the sense that it respects the creative process: it knows when to be invisible (writing) and when to delight (interactions, transitions, feedback). It never feels corporate, generic, or template-driven.

### Aesthetic direction

- **Warm, grounded palette**: Stone-based neutrals (`stone-50` → `stone-950`) with user-customizable primary accent. The warmth is intentional — it avoids the cold, clinical feel of pure grays. Keep it.
- **Editorial confidence**: Typography-driven hierarchy, generous whitespace during writing, tight purposeful density in toolbars and sidebars. Think magazine editorial layout sensibility applied to a tool.
- **Own identity**: Maibuk should never look like "a React template" or "another Electron app." Every design decision should feel intentional. If a user showed the interface to someone, they should recognize it as _Maibuk_, not "some writing app."
- **No anti-references needed** — the directive is simply: never be generic.
- **Theme**: Light and dark modes via CSS variable swap (`.dark` class). No `dark:` Tailwind prefixes. The warm stone palette already provides good differentiation between themes.

### Design principles

1. **Flow first** — The writing experience is sacred. The editor should feel like a blank page with superpowers hidden beneath the surface. Progressive disclosure: simple by default, powerful on demand.
2. **Intentional density** — Toolbars, sidebars, and settings can be dense, but every element must earn its space. No decorative padding, no filler icons, no redundant labels. Tight where it should be tight, spacious where it should be spacious.
3. **Confident restraint** — Bold doesn't mean loud. The interface should feel decisive — clear hierarchy, strong primary actions, no ambiguity about what to do next. But it achieves this through restraint: fewer elements with more purpose, not more elements with less.
4. **Tangible feedback** — Every interaction should feel responsive and real. Save status, sync state, export progress, drag-and-drop reordering — these moments are where trust is built. Invest in making them feel right.
5. **Never generic** — Before adding any UI element, ask: "Would this look the same in a generic template?" If yes, reconsider. Maibuk's identity comes from the accumulation of small, intentional choices — a distinctive empty state, a satisfying hover effect, a well-crafted transition.

## Styling conventions

### Tailwind CSS 4 with semantic tokens

All styling uses Tailwind utility classes inline. There are **no separate CSS files per component**.

Design tokens are defined as CSS custom properties in `src/index.css` under `@theme`:

| Token                 | Light     | Dark      | Usage                        |
| --------------------- | --------- | --------- | ---------------------------- |
| `--color-primary`     | `#3b82f6` | `#60a5fa` | `bg-primary`, `text-primary` |
| `--color-primary-foreground` | `#000000` | `#000000` | `text-primary-foreground` on any `bg-primary` fill (derived from the accent at runtime; never `text-white`) |
| `--color-background`  | `#fafaf9` | `#1c1917` | `bg-background`              |
| `--color-foreground`  | `#1c1917` | `#fafaf9` | `text-foreground`            |
| `--color-muted`       | `#7a6f63` | `#44403c` | `bg-muted`                   |
| `--color-border`      | `#e7e5e4` | `#292524` | `border-border`              |
| `--color-card`        | `#ffffff` | `#292524` | `bg-card`                    |
| `--color-destructive` | `#ef4444` | `#f87171` | `bg-destructive`             |
| `--color-success`     | `#22c55e` | `#4ade80` | `text-success`               |

### Rules

- **Always use semantic tokens** (`bg-primary`, `text-foreground`, `border-border`) — never raw color values in components
- **Dark mode** is handled by toggling the `.dark` class on `<html>`, which swaps CSS variable values. No `dark:` prefixes needed in components
- **Spacing**: Use Tailwind spacing scale (`gap-2`, `px-4`, `py-2`). Custom spacing tokens: `--spacing-sidebar: 280px`, `--spacing-editor-max: 720px`
- **Typography**: Three font families defined — `font-sans` (Inter), `font-serif` (Literata), `font-mono`
- **Button variants**: `primary`, `secondary`, `ghost`, `destructive` — use the existing `Button` component, don't create ad-hoc button styles
- **Border radius**: Consistently `rounded-lg` across the codebase
- **Scroll boxes inside overlays**: add `scrollbar-themed` (`src/index.css`) so the scrollbar follows the theme instead of the OS default
- **Panel layout responds to its container, not the viewport**: content sits beside a resizable sidebar, so a viewport breakpoint (`md:`) does not describe the space a panel actually has. Mark the wrapper `@container` and use container variants (`@md:`, `@3xl:`) for anything laid out inside the main content area — see the notes filter panel in `src/pages/NotesGallery.tsx`. Viewport breakpoints stay correct for the outermost page shell
- **Touch compatibility**: No hover-only controls (`CODING_STANDARDS.md`, "Keyboard and accessibility", item 7). Use `pointer-coarse:` for touch-only visibility and larger touch targets, never a viewport breakpoint; desktop hover affordances stay as they are
- **Keyboard compatibility**: Any UI feature with interactive controls must meet "Keyboard and accessibility" and its test gate in `CODING_STANDARDS.md` — this is a definition-of-done item, not a styling preference
