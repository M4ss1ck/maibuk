import {
  VOICE_LANGUAGES,
  isVoiceEligible,
  normalizeCustomVoiceCommands,
  normalizeVoicePhraseList,
  type CustomVoiceCommands,
} from "@/features/dictation/voice-commands";
import type { DictationLanguage } from "@/features/dictation/types";
import {
  isRecordableStep,
  isReservedOnWeb,
  normalizeShortcut,
  shortcutKey,
} from "@/lib/shortcut-keys";
import {
  COMMANDS,
  COMMAND_IDS,
  COMMAND_RENAMES,
  ROUTE_CONTEXTS,
  isCommandId,
  type CommandDef,
  type CommandId,
  type Shortcut,
  type ShortcutContext,
} from "@/lib/shortcut-registry";

export type CustomShortcuts = Partial<Record<CommandId, readonly Shortcut[]>>;

export const SHORTCUT_SETTINGS_VERSION = 2;

export interface ShortcutSettings {
  version: typeof SHORTCUT_SETTINGS_VERSION;
  custom: CustomShortcuts;
  /** Custom Voice Commands per Command and Dictation Language (ADR 0014). */
  voice: CustomVoiceCommands;
  singleKeyEnabled: boolean;
}

export const DEFAULT_SHORTCUT_SETTINGS: ShortcutSettings = {
  version: SHORTCUT_SETTINGS_VERSION,
  custom: {},
  voice: {},
  singleKeyEnabled: true,
};

/** Each step turns version `v` into `v + 1`; tested with the old shape as input. */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {
  // Version 2 adds custom Voice Commands; every Custom Shortcut is kept.
  1: (raw) => ({ ...raw, version: 2, voice: {} }),
};

function def(id: CommandId): CommandDef {
  return COMMANDS[id];
}

function resolveId(rawId: string): CommandId | null {
  const renamed = COMMAND_RENAMES[rawId] ?? rawId;
  return isCommandId(renamed) ? renamed : null;
}

function freshDefaults(): ShortcutSettings {
  return structuredClone(DEFAULT_SHORTCUT_SETTINGS);
}

export function defaultShortcuts(id: CommandId, web: boolean): Shortcut[] {
  const command = def(id);
  return [...(web && command.web ? command.web : command.defaults)];
}

export function editableShortcuts(
  id: CommandId,
  custom: CustomShortcuts,
  web: boolean
): Shortcut[] {
  if (def(id).sealed) return [];
  const override = custom[id];
  if (override !== undefined) return [...override];
  return defaultShortcuts(id, web);
}

export function effectiveShortcuts(
  id: CommandId,
  custom: CustomShortcuts,
  web: boolean
): Shortcut[] {
  return [...(def(id).fixed ?? []), ...editableShortcuts(id, custom, web)];
}

export function isFixedShortcut(id: CommandId, shortcut: Shortcut): boolean {
  const key = shortcutKey(shortcut);
  return (def(id).fixed ?? []).some((fixed) => shortcutKey(fixed) === key);
}

export function contextsOverlap(
  a: readonly ShortcutContext[],
  b: readonly ShortcutContext[]
): boolean {
  if (a.includes("global") || b.includes("global")) return true;
  return Object.values(ROUTE_CONTEXTS).some(
    (contexts) =>
      a.some((context) => contexts.includes(context)) &&
      b.some((context) => contexts.includes(context))
  );
}

export type CollisionKind = "same" | "prefix";

export function collision(a: Shortcut, b: Shortcut): CollisionKind | null {
  if (a.length === b.length && a.every((step, index) => step === b[index])) return "same";
  if (a.length === 1 && b.length === 2 && a[0] === b[0]) return "prefix";
  if (b.length === 1 && a.length === 2 && b[0] === a[0]) return "prefix";
  return null;
}

export interface Conflict {
  id: CommandId;
  shortcut: Shortcut;
  kind: CollisionKind;
  locked: boolean;
}

export function findConflicts(
  id: CommandId,
  candidate: Shortcut,
  custom: CustomShortcuts,
  web: boolean
): Conflict[] {
  const contexts = def(id).contexts;
  const conflicts: Conflict[] = [];
  for (const otherId of COMMAND_IDS) {
    if (otherId === id) continue;
    const other = def(otherId);
    if (!contextsOverlap(contexts, other.contexts)) continue;
    for (const shortcut of effectiveShortcuts(otherId, custom, web)) {
      const kind = collision(candidate, shortcut);
      if (kind === null) continue;
      conflicts.push({
        id: otherId,
        shortcut,
        kind,
        locked: Boolean(other.sealed) || isFixedShortcut(otherId, shortcut),
      });
    }
  }
  return conflicts;
}

export interface DefaultConflict {
  a: CommandId;
  b: CommandId;
  shortcut: Shortcut;
  kind: CollisionKind;
}

export function findDefaultConflicts(web: boolean): DefaultConflict[] {
  const conflicts: DefaultConflict[] = [];
  for (let i = 0; i < COMMAND_IDS.length; i += 1) {
    const a = COMMAND_IDS[i];
    const aShortcuts = effectiveShortcuts(a, {}, web);
    for (let j = i + 1; j < COMMAND_IDS.length; j += 1) {
      const b = COMMAND_IDS[j];
      if (!contextsOverlap(def(a).contexts, def(b).contexts)) continue;
      const bShortcuts = effectiveShortcuts(b, {}, web);
      for (const shortcutA of aShortcuts) {
        for (const shortcutB of bShortcuts) {
          const kind = collision(shortcutA, shortcutB);
          if (kind === null) continue;
          if (isFixedShortcut(a, shortcutA) && isFixedShortcut(b, shortcutB)) continue;
          conflicts.push({ a, b, shortcut: shortcutA, kind });
        }
      }
    }
  }
  return conflicts;
}

export function normalizeShortcuts(raw: unknown): ShortcutSettings {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return freshDefaults();
  const record = raw as Record<string, unknown>;

  // A record with no version predates versioning and has the version 1 shape.
  const version = record.version ?? 1;
  if (typeof version !== "number" || !Number.isInteger(version)) return freshDefaults();
  if (version < 1 || version > SHORTCUT_SETTINGS_VERSION) return freshDefaults();

  let working = record;
  for (let v = version; v < SHORTCUT_SETTINGS_VERSION; v += 1) {
    working = MIGRATIONS[v](working);
  }

  const singleKeyEnabled =
    typeof working.singleKeyEnabled === "boolean" ? working.singleKeyEnabled : true;
  const custom: CustomShortcuts = {};
  const rawCustom = working.custom;

  if (typeof rawCustom === "object" && rawCustom !== null && !Array.isArray(rawCustom)) {
    for (const [rawId, value] of Object.entries(rawCustom as Record<string, unknown>)) {
      const id = resolveId(rawId);
      if (id === null) continue;
      if (def(id).sealed) continue;
      if (!Array.isArray(value)) continue;

      const shortcuts: Shortcut[] = [];
      const seen = new Set<string>();
      for (const item of value) {
        if (!Array.isArray(item) || !item.every((step) => typeof step === "string")) continue;
        const strings = item as string[];
        const normalized =
          strings.length >= 1 && strings.length <= 2 ? normalizeShortcut(strings) : null;
        if (normalized === null) continue;
        if (!normalized.every((step) => isRecordableStep(step))) continue;
        const key = shortcutKey(normalized);
        if (seen.has(key)) continue;
        seen.add(key);
        shortcuts.push(normalized);
      }

      if (value.length === 0) custom[id] = [];
      else if (shortcuts.length > 0) custom[id] = shortcuts;
    }
  }

  return {
    version: SHORTCUT_SETTINGS_VERSION,
    custom,
    voice: normalizeCustomVoiceCommands(working.voice),
    singleKeyEnabled,
  };
}

export const SHORTCUT_FILE_VERSION = 2;

export interface ShortcutFile {
  app: "maibuk";
  kind: "shortcuts";
  version: typeof SHORTCUT_FILE_VERSION;
  custom: CustomShortcuts;
  voice: CustomVoiceCommands;
}

export function serializeShortcutFile(
  custom: CustomShortcuts,
  voice: CustomVoiceCommands = {}
): string {
  const file: ShortcutFile = {
    app: "maibuk",
    kind: "shortcuts",
    version: SHORTCUT_FILE_VERSION,
    custom,
    voice,
  };
  return JSON.stringify(file, null, 2);
}

export type DropReason =
  | "unknown"
  | "invalid"
  | "sealed"
  | "reserved"
  | "conflict"
  | "notVoice"
  | "tooShort";

export interface DroppedBinding {
  id: string;
  shortcut?: Shortcut;
  /** A Voice Command phrase and its Dictation Language, for a dropped phrase. */
  phrase?: string;
  language?: DictationLanguage;
  reason: DropReason;
}

/**
 * Whether a phrase from the file clashes with a phrase of another kind: the
 * caller owns the Spoken Punctuation settings of this device, which the file
 * does not carry. `accepted` is what the file has kept so far.
 */
export type VoicePhraseCheck = (options: {
  id: CommandId;
  language: DictationLanguage;
  phrase: string;
  accepted: CustomVoiceCommands;
}) => boolean;

export type LoadResult =
  | {
      ok: true;
      custom: CustomShortcuts;
      voice: CustomVoiceCommands;
      dropped: DroppedBinding[];
    }
  | { ok: false; error: "parse" | "kind" | "version" };

function parseVoiceSection(
  raw: unknown,
  dropped: DroppedBinding[],
  conflicts?: VoicePhraseCheck
): CustomVoiceCommands {
  const voice: Partial<Record<CommandId, Partial<Record<DictationLanguage, string[]>>>> = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return voice;
  for (const [rawId, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = resolveId(rawId);
    if (id === null) {
      dropped.push({ id: rawId, reason: "unknown" });
      continue;
    }
    if (!isVoiceEligible(id)) {
      dropped.push({ id: rawId, reason: "notVoice" });
      continue;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      dropped.push({ id: rawId, reason: "invalid" });
      continue;
    }
    for (const language of VOICE_LANGUAGES) {
      const list = (value as Record<string, unknown>)[language];
      if (list === undefined) continue;
      if (!Array.isArray(list)) {
        dropped.push({ id: rawId, language, reason: "invalid" });
        continue;
      }
      // The Command's list starts empty, so its own defaults never count
      // against the phrases the file brings for it.
      const own: string[] = [];
      const languages = voice[id] ?? {};
      languages[language] = own;
      voice[id] = languages;
      for (const item of list) {
        if (typeof item !== "string") {
          dropped.push({ id: rawId, language, reason: "invalid" });
          continue;
        }
        const [phrase] = normalizeVoicePhraseList([item]);
        if (phrase === undefined) {
          dropped.push({ id: rawId, language, phrase: item, reason: "tooShort" });
          continue;
        }
        if (normalizeVoicePhraseList([...own, phrase]).length === own.length) continue;
        if (conflicts?.({ id, language, phrase, accepted: voice })) {
          dropped.push({ id: rawId, language, phrase, reason: "conflict" });
          continue;
        }
        own.push(phrase);
      }
      if (own.length === 0 && list.length > 0) delete languages[language];
    }
    if (voice[id] && Object.keys(voice[id] ?? {}).length === 0) delete voice[id];
  }
  return voice;
}

export function parseShortcutFile(
  text: string,
  web: boolean,
  voiceConflicts?: VoicePhraseCheck
): LoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "parse" };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return { ok: false, error: "kind" };
  const file = parsed as Record<string, unknown>;
  if (file.app !== "maibuk" || file.kind !== "shortcuts") return { ok: false, error: "kind" };
  if (file.version !== 1 && file.version !== SHORTCUT_FILE_VERSION) {
    return { ok: false, error: "version" };
  }
  if (typeof file.custom !== "object" || file.custom === null || Array.isArray(file.custom)) {
    return { ok: false, error: "kind" };
  }

  // Loading replaces the author's Custom Shortcuts, so conflicts are checked
  // against what this file has accepted so far, not what is already stored.
  const custom: CustomShortcuts = {};
  const dropped: DroppedBinding[] = [];
  const rawCustom = file.custom;

  if (typeof rawCustom === "object" && rawCustom !== null && !Array.isArray(rawCustom)) {
    for (const [rawId, value] of Object.entries(rawCustom as Record<string, unknown>)) {
      const id = resolveId(rawId);
      if (id === null) {
        dropped.push({ id: rawId, reason: "unknown" });
        continue;
      }
      if (def(id).sealed) {
        dropped.push({ id: rawId, reason: "sealed" });
        continue;
      }
      if (!Array.isArray(value)) {
        dropped.push({ id: rawId, reason: "invalid" });
        continue;
      }

      const kept: Shortcut[] = [];
      const seen = new Set<string>();
      for (const item of value) {
        if (!Array.isArray(item) || !item.every((step) => typeof step === "string")) {
          dropped.push({ id: rawId, reason: "invalid" });
          continue;
        }
        const strings = item as string[];
        const normalized =
          strings.length >= 1 && strings.length <= 2 ? normalizeShortcut(strings) : null;
        if (normalized === null || !normalized.every((step) => isRecordableStep(step))) {
          dropped.push({ id: rawId, shortcut: strings, reason: "invalid" });
          continue;
        }
        if (web && normalized.some((step) => isReservedOnWeb(step))) {
          dropped.push({ id: rawId, shortcut: normalized, reason: "reserved" });
          continue;
        }
        const key = shortcutKey(normalized);
        if (seen.has(key)) continue;
        if (findConflicts(id, normalized, custom, web).length > 0) {
          dropped.push({ id: rawId, shortcut: normalized, reason: "conflict" });
          continue;
        }
        seen.add(key);
        kept.push(normalized);
      }

      if (value.length === 0) custom[id] = [];
      else if (kept.length > 0) custom[id] = kept;
    }
  }

  // A version 1 file predates Voice Commands; it carries none.
  const voice = file.version === 1 ? {} : parseVoiceSection(file.voice, dropped, voiceConflicts);
  return { ok: true, custom, voice, dropped };
}
