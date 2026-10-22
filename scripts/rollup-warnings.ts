/**
 * The Rollup `onwarn` both bundles share: the app (`vite.config.ts`) and the
 * Plugin build (`scripts/build-plugin.ts`).
 *
 * It drops one warning: `INVALID_ANNOTATION` raised from a dependency under
 * `node_modules/`. Rollup emits it when a comment mentions `@__PURE__` in a
 * position it cannot apply, then removes the comment, so the bundle is the
 * same either way. zod 4 ships prose comments that name `@__PURE__`, which
 * printed two multi-line warnings on every dev and build run. We cannot edit a
 * dependency's comments, so the warning only buries the ones we can act on.
 * The same warning from our own source still prints: there the annotation is
 * ours, and a misplaced one is a real tree-shaking bug.
 */

/** The fields of a Rollup log this filter reads. */
interface RollupWarning {
  code?: string;
  id?: string;
}

/** Drops a dependency's `INVALID_ANNOTATION`; forwards every other warning. */
export function onRollupWarn<W extends RollupWarning>(warning: W, warn: (warning: W) => void): void {
  if (isDependencyAnnotationWarning(warning)) return;
  warn(warning);
}

/** Whether the warning is an `INVALID_ANNOTATION` raised from `node_modules/`. */
export function isDependencyAnnotationWarning(warning: RollupWarning): boolean {
  if (warning.code !== "INVALID_ANNOTATION") return false;
  return (warning.id ?? "").replace(/\\/g, "/").includes("/node_modules/");
}
