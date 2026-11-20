## Summary

<!-- What changes, and why? -->

## Checklist

- [ ] Tests added or updated (Vitest); `pnpm exec vitest related <touched files> --run` and `pnpm test:guards` pass (CI runs the full suite)
- [ ] Keyboard and accessibility gate met: operable by keyboard alone, focus managed, labels localized, tested behaviorally (CODING_STANDARDS.md, "Keyboard and accessibility")
- [ ] E2E: matrix row added/updated in `e2e/coverage-matrix.ts` and `pnpm test:e2e -- specs/<file>` passed locally (which specs: )
- [ ] Both locales updated (`src/locales/en.json` and `src/locales/es.json`)
- [ ] Visual change: before/after screenshots, light and dark, attached (`pnpm screenshots`, see `e2e/README.md`), or no rendered UI changed
