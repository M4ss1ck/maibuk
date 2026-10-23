import type { BootTheme } from "@/features/theme/types";

export const BOOT_THEME_KEY = "maibuk-boot-theme";
export const BOOT_THEME_VERSION = 1;

const MODES: Array<BootTheme["mode"]> = ["light", "dark", "system"];

function emptyBootTheme(): BootTheme {
  return { v: BOOT_THEME_VERSION, mode: "system", vars: {} };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The same rule the inline script applies: only custom-property strings. */
function readVars(value: Record<string, unknown>): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key.startsWith("--") && typeof entry === "string") vars[key] = entry;
  }
  return vars;
}

function readBootTheme(): BootTheme {
  try {
    if (typeof localStorage === "undefined") return emptyBootTheme();
    const raw = localStorage.getItem(BOOT_THEME_KEY);
    if (!raw) return emptyBootTheme();
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) return emptyBootTheme();
    const { v, mode, vars } = parsed;
    if (v !== BOOT_THEME_VERSION || !MODES.includes(mode as BootTheme["mode"])) {
      return emptyBootTheme();
    }
    if (!isPlainObject(vars)) return emptyBootTheme();
    return {
      v: BOOT_THEME_VERSION,
      mode: mode as BootTheme["mode"],
      vars: readVars(vars),
    };
  } catch {
    return emptyBootTheme();
  }
}

/**
 * Record what the first frame should paint, so the inlined boot script in
 * index.html reads it before the app loads. Best effort: storage may be
 * denied or full, and that must never break the caller.
 */
export function writeBootTheme(patch: {
  mode?: BootTheme["mode"];
  vars?: Record<string, string>;
}): void {
  try {
    const next = readBootTheme();
    if (patch.mode !== undefined) next.mode = patch.mode;
    if (patch.vars !== undefined) next.vars = patch.vars;
    localStorage.setItem(BOOT_THEME_KEY, JSON.stringify(next));
  } catch {
    // The snapshot only shortens the first paint; losing it is not an error.
  }
}
