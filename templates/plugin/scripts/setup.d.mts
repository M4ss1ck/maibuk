// Types for the plain-JavaScript setup, so `tsc` can type-check its importer
// (the tooling test) without enabling `allowJs`; a sibling `.d.mts` keeps the
// tooling dependency-free at runtime, mirroring `maibuk.d.mts`.

/** Links the Plugin authoring skill from `checkout` into `root`; a missing skill warns and returns. */
export function linkSkill(checkout: string, root?: string): void;

/** Writes `maibuk.local.json`, generates the configs, and links the skill. Returns the exit code. */
export function main(argv?: string[]): Promise<number>;
