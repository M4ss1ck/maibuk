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

export interface ShortcutSettings {
  version: 1;
  custom: CustomShortcuts;
  singleKeyEnabled: boolean;
}

export const DEFAULT_SHORTCUT_SETTINGS: ShortcutSettings = {
  version: 1,
  custom: {},
  singleKeyEnabled: true,
};

const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {};

function def(id: CommandId): CommandDef {
  return COMMANDS[id];
}

function resolveId(rawId: string): CommandId | null {
  const renamed = COMMAND_RENAMES[rawId] ?? rawId;
  return isCommandId(renamed) ? renamed : null;
}

function freshDefaults(): ShortcutSettings {
  return { version: 1, custom: {}, singleKeyEnabled: true };
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

  const version = record.version;
  if (version !== undefined && version !== 1) return freshDefaults();

  let working = record;
  for (let v = 1; MIGRATIONS[v]; v += 1) {
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

  return { version: 1, custom, singleKeyEnabled };
}

export interface ShortcutFile {
  app: "maibuk";
  kind: "shortcuts";
  version: 1;
  custom: CustomShortcuts;
}

export function serializeShortcutFile(custom: CustomShortcuts): string {
  const file: ShortcutFile = { app: "maibuk", kind: "shortcuts", version: 1, custom };
  return JSON.stringify(file, null, 2);
}

export type DropReason = "unknown" | "invalid" | "sealed" | "reserved" | "conflict";

export type LoadResult =
  | {
      ok: true;
      custom: CustomShortcuts;
      dropped: { id: string; shortcut?: Shortcut; reason: DropReason }[];
    }
  | { ok: false; error: "parse" | "kind" | "version" };

export function parseShortcutFile(text: string, web: boolean): LoadResult {
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
  if (file.version !== 1) return { ok: false, error: "version" };
  if (typeof file.custom !== "object" || file.custom === null || Array.isArray(file.custom)) {
    return { ok: false, error: "kind" };
  }

  // Loading replaces the author's Custom Shortcuts, so conflicts are checked
  // against what this file has accepted so far, not what is already stored.
  const custom: CustomShortcuts = {};
  const dropped: { id: string; shortcut?: Shortcut; reason: DropReason }[] = [];
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

  return { ok: true, custom, dropped };
}
