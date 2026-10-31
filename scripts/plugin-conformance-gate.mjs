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
 * The committed results the gate pins the Cargo.lock against (#447 D1): the
 * lane's own `docs/research/plugins-conformance.results.json`. A Tauri or wry
 * bump cannot merge without a fresh `pnpm conformance:plugins` that refreshes it.
 */
export const GATE_RESULTS_PATH = join(repoRoot, "docs/research/plugins-conformance.results.json");

/** The lockfile whose gated package versions the gate checks. */
export const CARGO_LOCK_PATH = join(repoRoot, "src-tauri/Cargo.lock");

/**
 * The platform slot a human records the Windows WebView2 Frame run under
 * (#454 unit U5, D6). It shares the results file's `platforms` map with the
 * lane's own `linux`/`android` slots; its absence means "not run", which keeps
 * the Frame off on Windows.
 */
export const WINDOWS_FRAME_PLATFORM = "windows";

/**
 * The Frame checks a Windows record must cover; the app's runtime gate
 * (`src/features/plugins/windows-frame-record.ts`) requires the same ids to
 * `pass`. Kept in step with that module by
 * `src/test/unit/plugin-conformance-gate.test.ts`.
 */
export const WINDOWS_FRAME_CHECK_IDS = [
  "frame-no-network",
  "frame-no-tauri-ipc",
  "frame-no-host-dom",
  "frame-theme-tokens",
  "frame-notice-visible",
  "frame-keyboard",
];

/** The check statuses the conformance schema defines (D1). */
const CONFORMANCE_CHECK_STATUSES = new Set(["pass", "fail", "unmeasured"]);

/**
 * Validates one committed `platforms.windows` slot (#454 D6). Returns the
 * problems found; an empty array means the slot is well-formed. A record is
 * "well-formed" whether it passed or failed — it carries `exit` 0 or 1, so a
 * genuine failure is a valid record — but it must name every field the audit
 * trail needs and list all {@link WINDOWS_FRAME_CHECK_IDS}.
 */
export function checkWindowsFrameRecord(record) {
  const where = `platforms.${WINDOWS_FRAME_PLATFORM}`;
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    return [`${where} must be an object`];
  }

  const problems = [];
  for (const field of ["ranAt", "appVersion", "commit", "ranBy"]) {
    if (typeof record[field] !== "string" || record[field].trim() === "") {
      problems.push(`${where}.${field} must be a non-empty string`);
    }
  }

  const engine = record.engine;
  if (engine === null || typeof engine !== "object" || Array.isArray(engine)) {
    problems.push(`${where}.engine must be an object`);
  } else {
    for (const field of ["name", "version", "userAgent"]) {
      if (typeof engine[field] !== "string") {
        problems.push(`${where}.engine.${field} must be a string`);
      }
    }
  }

  if (record.exit !== 0 && record.exit !== 1) {
    problems.push(`${where}.exit must be 0 or 1`);
  }

  if (!Array.isArray(record.checks)) {
    problems.push(`${where}.checks must be an array`);
    return problems;
  }
  const seen = new Set();
  for (const check of record.checks) {
    if (
      check === null ||
      typeof check !== "object" ||
      Array.isArray(check) ||
      typeof check.id !== "string" ||
      typeof check.detail !== "string" ||
      !CONFORMANCE_CHECK_STATUSES.has(check.status)
    ) {
      problems.push(`${where}.checks has a malformed check (needs id, status, detail)`);
      continue;
    }
    seen.add(check.id);
  }
  for (const id of WINDOWS_FRAME_CHECK_IDS) {
    if (!seen.has(id)) problems.push(`${where}.checks is missing "${id}"`);
  }
  return problems;
}

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

  // A committed Windows Frame record must be well-formed, or the gate teaches
  // CI to trust a slot the app would then read (#454 D6). The slot's absence
  // (not run yet) is fine and adds no problem.
  const platforms = resultsJson?.platforms;
  if (platforms !== null && typeof platforms === "object" && !Array.isArray(platforms)) {
    if (Object.hasOwn(platforms, WINDOWS_FRAME_PLATFORM)) {
      problems.push(...checkWindowsFrameRecord(platforms[WINDOWS_FRAME_PLATFORM]));
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
