/**
 * Echoes' settings (#450 unit 2, #451 unit 2): the typed, validated shapes the
 * Settings row reads and writes in the Plugin's own storage.
 *
 * Detection (`settings`): the one shape the Settings row and the report reuse to
 * call `findEchoes`. A stored value is never trusted: anything missing or
 * malformed falls back to the default field by field, the nearby window is
 * clamped to the range detection accepts, and the ignore list is trimmed to
 * non-empty, unique words.
 *
 * Editor highlights (`editor`): the kinds the editor paints, nearby only until
 * the author turns the others on. They live under their own key so they never
 * inherit the detection switches' on-by-default (decision 3).
 *
 * Read and write are best-effort; a refused storage call leaves the row usable.
 *
 * Imports only `@/plugin-sdk` (the storage API type) and this Plugin's files.
 */

import type { PluginClient } from "@/plugin-sdk";
import { parseEchoPalette } from "./colors";
import {
  DEFAULT_ECHO_SETTINGS,
  type EchoKind,
  type EchoSettings,
  NEARBY_WINDOW_MAX,
  NEARBY_WINDOW_MIN,
} from "./find-echoes";

/** The one storage key Echoes' detection settings live under. */
export const ECHOES_SETTINGS_KEY = "settings";

/** The one storage key Echoes' editor highlight kinds live under. */
export const ECHOES_EDITOR_KEY = "editor";

/** The one storage key the "Color highlights by echo" switch lives under (#532). */
export const ECHOES_COLOR_KEY = "color";

/** The one storage key the Echo color Palette lives under (#533). */
export const ECHOES_PALETTE_KEY = "palette";

/** The one storage key the "Toggle echo highlights" switch lives under: one switch for every editor. */
export const ECHOES_HIGHLIGHTS_KEY = "highlights";

/** The kinds the editor highlights before the author changes anything: nearby only. */
export const DEFAULT_EDITOR_KINDS: readonly EchoKind[] = ["nearby"];

const ECHO_KIND_ORDER: readonly EchoKind[] = ["nearby", "overused", "phrase"];
const ECHO_KIND_SET: ReadonlySet<string> = new Set(ECHO_KIND_ORDER);

/** The known kinds in `value`, deduplicated and put back in a stable order. */
function orderKinds(value: Iterable<unknown>): EchoKind[] {
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry === "string" && ECHO_KIND_SET.has(entry)) seen.add(entry);
  }
  return ECHO_KIND_ORDER.filter((kind) => seen.has(kind));
}

/** The SDK storage surface the settings module needs. */
export type EchoesStorage = Pick<PluginClient, "storage">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** The window detection accepts, rounded; anything unparseable keeps the default. */
export function clampNearbyWindow(value: unknown): number {
  if (typeof value !== "number" && (typeof value !== "string" || value.trim() === "")) {
    return DEFAULT_ECHO_SETTINGS.nearbyWindow;
  }
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_ECHO_SETTINGS.nearbyWindow;
  const rounded = Math.round(numeric);
  if (rounded < NEARBY_WINDOW_MIN) return NEARBY_WINDOW_MIN;
  if (rounded > NEARBY_WINDOW_MAX) return NEARBY_WINDOW_MAX;
  return rounded;
}

/** The ignore list as one entry per word: trimmed, non-empty, unique, first spelling kept. */
function normalizeIgnore(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const words: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    const key = trimmed.toLowerCase();
    if (trimmed === "" || seen.has(key)) continue;
    seen.add(key);
    words.push(trimmed);
  }
  return words;
}

/** Validates anything read back into settings, defaulting field by field. */
export function parseEchoesSettings(value: unknown): EchoSettings {
  const record = isRecord(value) ? value : {};
  return {
    nearby: booleanOr(record.nearby, DEFAULT_ECHO_SETTINGS.nearby),
    overused: booleanOr(record.overused, DEFAULT_ECHO_SETTINGS.overused),
    phrases: booleanOr(record.phrases, DEFAULT_ECHO_SETTINGS.phrases),
    stemming: booleanOr(record.stemming, DEFAULT_ECHO_SETTINGS.stemming),
    nearbyWindow: clampNearbyWindow(record.nearbyWindow),
    ignore: normalizeIgnore(record.ignore),
  };
}

/** The `findEchoes` options these settings stand for, normalized. */
export function toFindEchoesOptions(settings: EchoSettings): EchoSettings {
  return {
    nearby: settings.nearby,
    overused: settings.overused,
    phrases: settings.phrases,
    stemming: settings.stemming,
    nearbyWindow: clampNearbyWindow(settings.nearbyWindow),
    ignore: normalizeIgnore(settings.ignore),
  };
}

/**
 * The `findEchoes` options the editor runs with (#451, decision 7): the
 * detection settings with the three kind switches forced to the kinds the editor
 * paints, so a kind the editor does not show is never detected. `settings` still
 * carries stemming, the nearby window, and the ignore list.
 */
export function toEditorFindOptions(
  settings: EchoSettings,
  editorKinds: readonly EchoKind[]
): EchoSettings {
  const enabled = new Set<EchoKind>(editorKinds);
  return {
    ...toFindEchoesOptions(settings),
    nearby: enabled.has("nearby"),
    overused: enabled.has("overused"),
    phrases: enabled.has("phrase"),
  };
}

/** Reads the settings, falling back to the defaults when the key is unset or the read fails. */
export async function readEchoesSettings(client: EchoesStorage): Promise<EchoSettings> {
  try {
    return parseEchoesSettings(await client.storage.get({ key: ECHOES_SETTINGS_KEY }));
  } catch {
    return parseEchoesSettings(undefined);
  }
}

/** Stores the settings under the one key; a refused write is ignored. */
export async function writeEchoesSettings(
  client: EchoesStorage,
  settings: EchoSettings
): Promise<void> {
  try {
    await client.storage.set({
      key: ECHOES_SETTINGS_KEY,
      value: toFindEchoesOptions(settings),
    });
  } catch {
    // Storage is best-effort: a refused write must not break the Settings row.
  }
}

/** The editor highlight kinds from a stored value, nearby only when unset or malformed. */
export function parseEditorKinds(value: unknown): EchoKind[] {
  if (!Array.isArray(value)) return [...DEFAULT_EDITOR_KINDS];
  return orderKinds(value);
}

/** Reads the editor kinds, falling back to nearby only when the read fails. */
export async function readEditorKinds(client: EchoesStorage): Promise<EchoKind[]> {
  try {
    return parseEditorKinds(await client.storage.get({ key: ECHOES_EDITOR_KEY }));
  } catch {
    return [...DEFAULT_EDITOR_KINDS];
  }
}

/** Stores the editor kinds under the one key; a refused write is ignored. */
export async function writeEditorKinds(
  client: EchoesStorage,
  kinds: readonly EchoKind[]
): Promise<void> {
  try {
    await client.storage.set({ key: ECHOES_EDITOR_KEY, value: orderKinds(kinds) });
  } catch {
    // Storage is best-effort: a refused write must not break the Settings row.
  }
}

/** One kind flipped on or off, the result kept in the stable kind order. */
export function toggledEditorKind(kinds: readonly EchoKind[], kind: EchoKind): EchoKind[] {
  const next = new Set(kinds);
  if (next.has(kind)) next.delete(kind);
  else next.add(kind);
  return orderKinds(next);
}

/** The "Color highlights by echo" value from a stored value: off unless it is `true` (#532). */
export function parseColorByEcho(value: unknown): boolean {
  return value === true;
}

/**
 * One value stored under its own key: read with the parser's default when the
 * key is unset or the read fails, written best-effort so a refused write never
 * breaks the Settings row.
 */
function keyedSetting<T>(key: string, parse: (value: unknown) => T) {
  return {
    async read(client: EchoesStorage): Promise<T> {
      try {
        return parse(await client.storage.get({ key }));
      } catch {
        return parse(undefined);
      }
    },
    async write(client: EchoesStorage, value: T): Promise<void> {
      try {
        await client.storage.set({ key, value });
      } catch {
        // Storage is best-effort: a refused write must not break the Settings row.
      }
    },
  };
}

/** The highlight switch from a stored value: on only when it is `true`, so anything else is off. */
export function parseHighlightsOn(value: unknown): boolean {
  return value === true;
}

const colorByEchoSetting = keyedSetting(ECHOES_COLOR_KEY, parseColorByEcho);
const echoPaletteSetting = keyedSetting(ECHOES_PALETTE_KEY, parseEchoPalette);
const highlightsOnSetting = keyedSetting(ECHOES_HIGHLIGHTS_KEY, parseHighlightsOn);

export const readColorByEcho = colorByEchoSetting.read;
export const writeColorByEcho = colorByEchoSetting.write;
export const readEchoPalette = echoPaletteSetting.read;
export const writeEchoPalette = echoPaletteSetting.write;
export const readHighlightsOn = highlightsOnSetting.read;
export const writeHighlightsOn = highlightsOnSetting.write;
