import {
  VOICE_LANGUAGES,
  inactiveVoicePhrases,
  isVoiceEligible,
  normalizeCustomVoiceCommands,
  normalizeVoicePhraseList,
  type CustomVoiceCommands,
  type InactiveVoicePhrase,
} from "@/features/dictation/voice-commands";
import type { DictationLanguage } from "@/features/dictation/types";
import {
  isRecordableStep,
  isReservedOnWeb,
  normalizeShortcut,
  shortcutKey,
} from "@/lib/shortcut-keys";
import {
  COMMAND_IDS,
  ROUTE_CONTEXTS,
  commandIds,
  commandRegistryRevision,
  fixedShortcuts,
  getCommand,
  isCoreCommandId,
  isPluginCommandId,
  isSealedCommand,
  pluginBindingRank,
  pluginCommandRenames,
  resolvePluginCommandRename,
  resolveStoredCommandId,
  type CommandDefinition,
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

function def(id: CommandId): CommandDefinition {
  return getCommand(id);
}

/**
 * A stored id to the Command it names today, or null when it names nothing.
 * Unknown ids under `plugin.` are kept as they are: the preference is retained
 * for its Plugin's return (ADR 0024). Everything else unknown is dropped
 * (ADR 0012).
 */
function resolveId(rawId: string): CommandId | null {
  return resolveStoredCommandId(rawId);
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
  if (isSealedCommand(id)) return [];
  const override = custom[id];
  if (override !== undefined) return [...override];
  return defaultShortcuts(id, web);
}

/** One Plugin Shortcut a core or earlier Plugin binding already owns. */
export interface InactiveShortcutBinding {
  kind: "shortcut";
  id: CommandId;
  shortcut: Shortcut;
  collision: CollisionKind;
  /** The active Command whose binding owns the keys. */
  withId: CommandId;
}

/** One preference a Plugin declared but that another active binding already owns. */
export type InactiveBinding = InactiveShortcutBinding | InactiveVoicePhrase;

interface Activity {
  inactive: Map<CommandId, InactiveShortcutBinding[]>;
}

const activityCache = new WeakMap<
  CustomShortcuts,
  { web: boolean; revision: number; activity: Activity }
>();

/**
 * Which Plugin bindings are inactive right now (ADR 0024). Core bindings are
 * existing active bindings and always win; Plugin bindings then run in their
 * conflict rank, which an update keeps for a binding the Command already held
 * and assigns fresh to a binding new in the update. A binding whose keys are
 * already owned by an active binding in an overlapping Context stays inactive
 * and does not reserve its key.
 */
function activityFor(custom: CustomShortcuts, web: boolean): Activity {
  const revision = commandRegistryRevision();
  const cached = activityCache.get(custom);
  if (cached && cached.web === web && cached.revision === revision) return cached.activity;

  interface Candidate {
    id: CommandId;
    contexts: readonly ShortcutContext[];
    shortcut: Shortcut;
    plugin: boolean;
    rank: number;
    index: number;
  }
  const candidates: Candidate[] = [];
  let index = 0;
  for (const id of commandIds()) {
    const command = def(id);
    const plugin = isPluginCommandId(id);
    const editable = editableShortcuts(id, custom, web);
    const list = plugin ? editable : [...fixedShortcuts(id), ...editable];
    for (const shortcut of list) {
      candidates.push({
        id,
        contexts: command.contexts,
        shortcut,
        plugin,
        rank: plugin ? pluginBindingRank(id, shortcut) : -1,
        index: index++,
      });
    }
  }
  // Lower rank runs first; equal ranks keep registry and declaration order.
  candidates.sort((a, b) => a.rank - b.rank || a.index - b.index);

  const inactive = new Map<CommandId, InactiveShortcutBinding[]>();
  const accepted: Array<{
    id: CommandId;
    contexts: readonly ShortcutContext[];
    shortcut: Shortcut;
  }> = [];
  for (const candidate of candidates) {
    // A core binding is an existing active binding: it wins and never yields.
    if (!candidate.plugin) {
      accepted.push(candidate);
      continue;
    }
    const owner = accepted.find(
      (other) =>
        contextsOverlap(candidate.contexts, other.contexts) &&
        collision(other.shortcut, candidate.shortcut) !== null
    );
    if (owner === undefined) {
      accepted.push(candidate);
      continue;
    }
    const list = inactive.get(candidate.id) ?? [];
    list.push({
      kind: "shortcut",
      id: candidate.id,
      shortcut: candidate.shortcut,
      collision: collision(owner.shortcut, candidate.shortcut) as CollisionKind,
      withId: owner.id,
    });
    inactive.set(candidate.id, list);
  }

  const activity: Activity = { inactive };
  activityCache.set(custom, { web, revision, activity });
  return activity;
}

/** Every inactive Plugin binding right now, Shortcuts and Voice phrases. */
export function inactiveBindings(
  custom: CustomShortcuts,
  web: boolean,
  voice: CustomVoiceCommands = {}
): InactiveBinding[] {
  const shortcuts = [...activityFor(custom, web).inactive.values()].flat();
  return [...shortcuts, ...inactiveVoicePhrases(voice)];
}

export function isBindingActive(
  id: CommandId,
  shortcut: Shortcut,
  custom: CustomShortcuts,
  web: boolean
): boolean {
  if (!isPluginCommandId(id)) return true;
  const key = shortcutKey(shortcut);
  return !(activityFor(custom, web).inactive.get(id) ?? []).some(
    (binding) => shortcutKey(binding.shortcut) === key
  );
}

export function effectiveShortcuts(
  id: CommandId,
  custom: CustomShortcuts,
  web: boolean
): Shortcut[] {
  const editable = editableShortcuts(id, custom, web);
  if (!isPluginCommandId(id)) return [...fixedShortcuts(id), ...editable];
  return editable.filter((shortcut) => isBindingActive(id, shortcut, custom, web));
}

export function isFixedShortcut(id: CommandId, shortcut: Shortcut): boolean {
  const key = shortcutKey(shortcut);
  return fixedShortcuts(id).some((candidate) => shortcutKey(candidate) === key);
}

export function contextsOverlap(
  a: readonly ShortcutContext[],
  b: readonly ShortcutContext[]
): boolean {
  if (a.includes("global") || b.includes("global")) return true;
  // Two Commands in the same Context are live together, Plugin page Contexts
  // included (they are not listed in `ROUTE_CONTEXTS`).
  if (a.some((context) => b.includes(context))) return true;
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
  for (const otherId of commandIds()) {
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
        locked: isSealedCommand(otherId) || isFixedShortcut(otherId, shortcut),
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

/**
 * The core registry's Default Shortcut gate: two core Commands may never ship
 * the same keys. Plugin defaults are allowed to conflict; they stay inactive
 * (ADR 0024), so they are not checked here.
 */
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
      if (isSealedCommand(id)) continue;
      if (!Array.isArray(value)) continue;
      // The declared id's own preference wins over a renamed old entry, no
      // matter which one storage lists first.
      if (id !== rawId && custom[id] !== undefined) continue;

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
        // A Plugin phrase is kept whether or not its Plugin is running: a
        // conflict resolves to inactive (ADR 0024). Core entries keep ADR 0012.
        if (isCoreCommandId(id) && conflicts?.({ id, language, phrase, accepted: voice })) {
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
      if (isSealedCommand(id)) {
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
        // A Plugin binding is kept whether or not its Plugin is running: a
        // conflict resolves to inactive (ADR 0024). Core entries keep ADR 0012.
        if (isCoreCommandId(id) && findConflicts(id, normalized, custom, web).length > 0) {
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

/**
 * Moves retained preferences to a registered Plugin's renamed Command ids
 * (ADR 0024). A Plugin that is absent has no rename map, so its ids stay as
 * they are. Returns the same settings object when nothing changes.
 */
export function applyPluginRenames(settings: ShortcutSettings): ShortcutSettings {
  if (pluginCommandRenames().size === 0) return settings;
  let changed = false;

  const custom: Record<string, readonly Shortcut[]> = {};
  for (const [id, list] of Object.entries(settings.custom)) {
    if (list === undefined) continue;
    const next = resolvePluginCommandRename(id);
    if (next !== id) changed = true;
    // The declared id's own preference wins over a migrated old one.
    if (next === id || custom[next] === undefined) custom[next] = list;
  }

  const voice: Record<string, Partial<Record<DictationLanguage, readonly string[]>>> = {};
  for (const [id, languages] of Object.entries(settings.voice)) {
    if (languages === undefined) continue;
    const next = resolvePluginCommandRename(id);
    if (next !== id) changed = true;
    if (next === id || voice[next] === undefined) voice[next] = languages;
  }

  if (!changed) return settings;
  return { ...settings, custom: custom as CustomShortcuts, voice: voice as CustomVoiceCommands };
}
