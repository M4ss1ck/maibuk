---
status: accepted (not implemented)
---

# Settings rows are declared by the section that renders them

The Command Palette (#226) must find every row of the Settings screen without a second catalog to keep in step. Each Settings section declares its rows (id, label, optional description, keywords, and platforms) beside the component that renders them, and the Settings page renders its sections from one ordered list that the Palette also reads. Every control sits in a row named by a typed id, which takes its label and anchor from the declaration. Action rows (Back up now, Customize shortcuts, Load Database File) are rows like any other. The settings store keeps no labels; it only classifies each of its keys as shown on a row or internal, so a new key does not compile until it is one or the other.

Completeness is enforced, not trusted: a render test in the web and desktop builds checks that every declared row renders exactly once on its platforms, and an orphan test fails on any labeled control or button on the Settings screen that is not inside a row. The whole screen moves to rows in one change; there is no partly indexed state.

## Considered Options

- A schema that generates the Settings UI (VS Code, Android preference screens): rejected. Backup, Paste Cleanup, Dictation, and Sync are custom layouts a schema would only wrap, and the generated part buys nothing the row declaration does not.
- Labels and sections as metadata on settings store keys: rejected. The Settings screen reads at least seven stores and services and has action buttons with no key, while about a third of the store's keys (sidebar widths, filters, last path) are UI state that no author would look for.
- Search the rendered Settings DOM (Chrome): rejected. The Palette opens away from Settings, so it would render the screen off-screen, and rows that depend on state would vanish from results.
- A hand-kept index with a guard test: rejected. It is the second catalog this decision exists to avoid.

## Consequences

- Adding a setting is one declaration in its section and one row in its render; forgetting either fails `tsc` or a test.
- A Palette result for a Settings row navigates to Settings and focuses that row's control. Changing a setting from inside the Palette can build on the same declarations later.
