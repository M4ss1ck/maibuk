// The desktop frame source's pure helpers (issue #374). `pnpm bench:frames
// --source desktop` measures the real Tauri Linux release binary (WebKitGTK)
// through tauri-driver and WebKitWebDriver. This file holds the parts that need
// no process and no disk: locating the two driver binaries, the install hints
// shown when one is missing, the display server, and the stamp that proves the
// binary on disk was built by this lane. Nothing here spawns or writes.

export interface FindExecutableOptions {
  /** The environment variable that may name the binary's exact path. */
  envVar: string;
  env: Record<string, string | undefined>;
  home: string;
  /** Whether a path names an existing file. Injected so the lookup stays pure. */
  isFile: (path: string) => boolean;
}

/**
 * Finds an executable in the order the desktop source documents (Q9 of the
 * #374 design): the explicit env var, then each PATH directory, then
 * ~/.cargo/bin. Returns the first path that is a file, or null.
 */
export function findExecutable(name: string, opts: FindExecutableOptions): string | null {
  const { envVar, env, home, isFile } = opts;
  const fromEnv = env[envVar];
  if (fromEnv && isFile(fromEnv)) return fromEnv;
  const dirs = (env.PATH ?? "").split(":").filter((dir) => dir.length > 0);
  for (const dir of dirs) {
    const candidate = `${dir}/${name}`;
    if (isFile(candidate)) return candidate;
  }
  const cargo = `${home}/.cargo/bin/${name}`;
  return isFile(cargo) ? cargo : null;
}

export interface DesktopPrerequisite {
  name: string;
  envVar: string;
  install: string;
}

export const DESKTOP_PREREQUISITES: readonly DesktopPrerequisite[] = [
  { name: "tauri-driver", envVar: "TAURI_DRIVER", install: "cargo install tauri-driver --locked" },
  {
    name: "WebKitWebDriver",
    envVar: "WEBKIT_WEBDRIVER",
    install: "sudo apt install webkit2gtk-driver",
  },
];

export function missingPrerequisiteMessage(p: DesktopPrerequisite): string {
  return `${p.name} not found (looked in $${p.envVar}, PATH, ~/.cargo/bin): install it with \`${p.install}\``;
}

/**
 * What the frame lane writes next to the release binary it built, so a later
 * run can prove the binary is still its own before it measures it.
 *
 * `size` and `mtime` are in the stamp because bench:plugins builds the same
 * binary path (`src-tauri/target/release/maibuk`) with `VITE_PLUGIN_BENCH_DRIVER=1`
 * and never updates this stamp. A rebuild by that lane changes the file's size
 * or mtime, and the frame lane must refuse the binary rather than measure a
 * build with different frontend code under its own commit's name.
 */
export interface DesktopBuildStamp {
  lane: "frames";
  profile: "release";
  frontendFlags: Record<string, string>;
  commit: string;
  binarySize: number;
  binaryMtimeMs: number;
}

function isStamp(value: unknown): value is DesktopBuildStamp {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const flags = v.frontendFlags;
  return (
    typeof v.lane === "string" &&
    typeof v.profile === "string" &&
    typeof v.commit === "string" &&
    typeof v.binarySize === "number" &&
    typeof v.binaryMtimeMs === "number" &&
    typeof flags === "object" &&
    flags !== null &&
    Object.values(flags).every((flag) => typeof flag === "string")
  );
}

function sameFlags(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/**
 * Null when the stamp matches the expected build, else the reason it does not.
 * Checks run in order: a missing or malformed stamp, a stamp from another
 * lane or profile, a commit change, frontend flags that differ, and finally
 * a binary whose size or mtime changed since this lane built it.
 */
export function stampMismatch(stamp: unknown, expected: DesktopBuildStamp): string | null {
  if (!isStamp(stamp)) return "no stamp";
  if (stamp.lane !== expected.lane) return "built by another lane";
  if (stamp.profile !== expected.profile) {
    return `built with the ${stamp.profile} profile, expected ${expected.profile}`;
  }
  if (stamp.commit !== expected.commit) {
    return `built at commit ${stamp.commit}, now ${expected.commit}`;
  }
  if (!sameFlags(stamp.frontendFlags, expected.frontendFlags)) return "frontend flags differ";
  if (stamp.binarySize !== expected.binarySize || stamp.binaryMtimeMs !== expected.binaryMtimeMs) {
    return "the binary changed since the frame lane built it (another lane rebuilt it)";
  }
  return null;
}

/**
 * The display server the desktop run reads: the session type when the
 * session sets one, else Wayland or X11 from the display variables, else none.
 */
export function displayServer(env: Record<string, string | undefined>): string {
  if (env.XDG_SESSION_TYPE) return env.XDG_SESSION_TYPE;
  if (env.WAYLAND_DISPLAY) return "wayland";
  if (env.DISPLAY) return "x11";
  return "none";
}

/**
 * Whether the frame lane rebuilds the desktop binary, and why. Reuse needs a
 * binary on disk whose stamp still matches the expected build; any other
 * case builds, and the reason is what the lane prints before it does.
 */
export function desktopBuildDecision(
  reuse: boolean,
  binaryExists: boolean,
  stamp: unknown,
  expected: DesktopBuildStamp
): { build: boolean; reason: string } {
  if (!binaryExists) return { build: true, reason: "no desktop binary" };
  if (!reuse) return { build: true, reason: "no --reuse-build" };
  const mismatch = stampMismatch(stamp, expected);
  if (mismatch !== null) return { build: true, reason: mismatch };
  return { build: false, reason: "reusing" };
}
