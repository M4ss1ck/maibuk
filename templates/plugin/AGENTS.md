# AGENTS.md: this Plugin repo

This repository is a Maibuk Plugin. Before you write anything, load the Maibuk
Plugin authoring skill that `node scripts/setup.mjs` links into
`.agents/skills/maibuk-plugin` and `.claude/skills/maibuk-plugin` (it arrives
with the Maibuk checkout, issue #457). The skill holds the authoring rules; this
file does not repeat them.

Run `pnpm check` before calling any work done. It builds, validates, typechecks,
lints, tests, checks the import boundary, packages, and checks the package
layout, and exits non-zero on the first failure.
