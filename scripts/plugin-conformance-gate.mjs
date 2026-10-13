#!/usr/bin/env node
// The Plugin conformance lane's engine-version gate (issue #447, D2).
// The lane's recorded results are only valid on the Tauri/wry versions they were
// measured on, so the Vitest gate fails while `src-tauri/Cargo.lock` names other
// versions: a Tauri or wry bump cannot merge without a fresh `pnpm conformance:plugins`.
//
//   node scripts/plugin-conformance-gate.mjs [cargo.lock] [results.json]
//
// Reads no state beyond the two files; the pure functions below are what the
// lane imports and what the test exercises.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// `import.meta.dirname` is not rewritten by Vite, unlike `new URL(.., import.meta.url)`
// (which Vite turns into an asset reference the Node URL parser then rejects). The
// fallback covers a Node older than 20.11 running the CLI directly.
const scriptDir = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");

/**
 * The committed results the gate pins the Cargo.lock against. It currently points
 * at the #407 research file; switching the lane to its own committed results
 * (docs/research/plugins-conformance.results.json, #447 D1) is a one-line change
 * to this constant.
 */
export const GATE_RESULTS_PATH = join(
  repoRoot,
  "docs/research/plugins-engine-verification.results.json"
);

/** The lockfile whose gated package versions the gate checks. */
export const CARGO_LOCK_PATH = join(repoRoot, "src-tauri/Cargo.lock");

/**
 * The only `[[package]]` entries that count. `tauri-build`, `tauri-plugin-*` and
 * friends share the `tauri-` prefix but are not the Tauri runtime.
 */
export const GATED_PACKAGES = ["tauri", "wry"];

/**
 * Reads the versions of the gated packages from Cargo.lock text.
 * A gated package the lock does not name maps to null; a gated package that
 * appears with two versions throws, because the lock is inconsistent and the
 * gate cannot tell which one the results pinned.
 */
export function readCargoLockVersions(text) {
  const versions = new Map();
  let name = null;
  let version = null;
  const flush = () => {
    if (name !== null && GATED_PACKAGES.includes(name)) {
      if (!versions.has(name)) versions.set(name, new Set());
      versions.get(name).add(version);
    }
    name = null;
    version = null;
  };
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "[[package]]") {
      flush();
      continue;
    }
    const nameMatch = trimmed.match(/^name = "(.*)"$/);
    if (nameMatch) name = nameMatch[1];
    const versionMatch = trimmed.match(/^version = "(.*)"$/);
    if (versionMatch) version = versionMatch[1];
  }
  flush();

  const result = {};
  for (const pkg of GATED_PACKAGES) {
    const found = versions.get(pkg);
    if (!found) {
      result[pkg] = null;
    } else if (found.size > 1) {
      throw new Error(`${pkg} appears with two versions in Cargo.lock: ${[...found].join(", ")}`);
    } else {
      result[pkg] = [...found][0];
    }
  }
  return result;
}

/**
 * Checks Cargo.lock text against the parsed results JSON. Returns
 * `{ ok, problems }`; `problems` is empty exactly when `ok` is true.
 */
export function checkConformanceGate(cargoLockText, resultsJson) {
  let lock;
  try {
    lock = readCargoLockVersions(cargoLockText);
  } catch (error) {
    return { ok: false, problems: [error.message] };
  }

  const stack = resultsJson?.stack ?? {};
  const problems = [];
  for (const pkg of GATED_PACKAGES) {
    const lockVersion = lock[pkg];
    const recorded = stack[pkg];
    if (lockVersion === null) {
      problems.push(`Cargo.lock has no "${pkg}" package`);
    } else if (recorded == null) {
      problems.push(`results have no stack.${pkg}`);
    } else if (lockVersion !== recorded) {
      problems.push(`${pkg}: Cargo.lock has ${lockVersion} but the results recorded ${recorded}`);
    }
  }
  return { ok: problems.length === 0, problems };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lockPath = process.argv[2] ?? CARGO_LOCK_PATH;
  const resultsPath = process.argv[3] ?? GATE_RESULTS_PATH;
  const { ok, problems } = checkConformanceGate(
    readFileSync(lockPath, "utf8"),
    JSON.parse(readFileSync(resultsPath, "utf8"))
  );
  if (ok) {
    console.log(`plugin conformance gate: Cargo.lock matches ${resultsPath}`);
  } else {
    for (const problem of problems) console.error(`plugin conformance gate: ${problem}`);
    process.exit(1);
  }
}
