export type ToolbarGroupId =
  | "history"
  | "font"
  | "basic-marks"
  | "headings"
  | "find"
  | "line-height"
  | "highlight"
  | "script"
  | "text-color"
  | "link-code"
  | "lists"
  | "blockquote"
  | "indent"
  | "align"
  | "clear-formatting"
  | "text-case"
  | "table"
  | "image"
  | "scene-break"
  | "footnote"
  | "horizontal-rule"
  | "spellcheck"
  | "dictionary"
  | "symbols"
  | "html-view"
  | "export";

export type ToolbarSection = "start" | "end";

export interface ToolbarGroupPreference {
  kind: "group";
  id: ToolbarGroupId;
  toolbarVisible: boolean;
  floatingVisible: boolean;
}

export interface ToolbarDividerPreference {
  kind: "divider";
  id: string;
}

export type ToolbarEntry = ToolbarGroupPreference | ToolbarDividerPreference;

export interface ToolbarConfig {
  start: ToolbarEntry[];
  end: ToolbarEntry[];
}

/** Canonical left-to-right order. Also the "append new groups" order for normalize. */
export const ALL_GROUP_IDS = [
  "history",
  "font",
  "basic-marks",
  "headings",
  "find",
  "line-height",
  "highlight",
  "script",
  "text-color",
  "link-code",
  "lists",
  "blockquote",
  "indent",
  "align",
  "clear-formatting",
  "text-case",
  "table",
  "image",
  "scene-break",
  "footnote",
  "horizontal-rule",
  "spellcheck",
  "dictionary",
  "symbols",
  "html-view",
  "export",
] as const satisfies readonly ToolbarGroupId[];

export const FLOATING_ELIGIBLE_IDS: ReadonlySet<ToolbarGroupId> = new Set([
  "basic-marks",
  "headings",
  "highlight",
  "link-code",
]);

const GROUP_ID_SET = new Set<string>(ALL_GROUP_IDS);

/** `D` marks a default divider boundary; strings are group ids in default (Start) order. */
const DEFAULT_START_LAYOUT: (ToolbarGroupId | "D")[] = [
  "history",
  "D",
  "font",
  "D",
  "basic-marks",
  "D",
  "headings",
  "D",
  "find",
  "D",
  "line-height",
  "D",
  "highlight",
  "script",
  "text-color",
  "link-code",
  "D",
  "lists",
  "blockquote",
  "D",
  "indent",
  "D",
  "align",
  "D",
  "clear-formatting",
  "D",
  "text-case",
  "D",
  "table",
  "image",
  "scene-break",
  "footnote",
  "D",
  "horizontal-rule",
  "spellcheck",
  "dictionary",
  "symbols",
  "html-view",
  "D",
  "export",
];

let dividerCounter = 0;

export function makeDividerId(): string {
  const uuid =
    typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`;
  return `divider-${uuid}-${dividerCounter++}`;
}

function makeDefaultConfig(): ToolbarConfig {
  const start: ToolbarEntry[] = DEFAULT_START_LAYOUT.map((token) =>
    token === "D"
      ? { kind: "divider", id: makeDividerId() }
      : {
          kind: "group",
          id: token,
          toolbarVisible: true,
          floatingVisible: FLOATING_ELIGIBLE_IDS.has(token),
        }
  );
  return { start, end: [] };
}

function freezeToolbarConfig(config: ToolbarConfig): ToolbarConfig {
  config.start.forEach(Object.freeze);
  config.end.forEach(Object.freeze);
  Object.freeze(config.start);
  Object.freeze(config.end);
  return Object.freeze(config);
}

export const DEFAULT_TOOLBAR_CONFIG: ToolbarConfig = freezeToolbarConfig(makeDefaultConfig());

export function cloneToolbarConfig(config: ToolbarConfig): ToolbarConfig {
  return {
    start: config.start.map((entry) => ({ ...entry })),
    end: config.end.map((entry) => ({ ...entry })),
  };
}

export function resetToolbarConfig(): ToolbarConfig {
  return makeDefaultConfig();
}

export function normalizeToolbarConfig(value: unknown): ToolbarConfig {
  if (!value || typeof value !== "object") return makeDefaultConfig();
  const raw = value as Partial<ToolbarConfig>;
  if (!Array.isArray(raw.start) || !Array.isArray(raw.end)) {
    return makeDefaultConfig();
  }
  const seenGroups = new Set<ToolbarGroupId>();
  const seenDividers = new Set<string>();

  const normalizeLane = (lane: unknown): ToolbarEntry[] => {
    if (!Array.isArray(lane)) return [];
    const result: ToolbarEntry[] = [];
    for (const item of lane) {
      if (!item || typeof item !== "object") continue;
      const entry = item as Record<string, unknown>;
      if (entry.kind === "divider") {
        if (
          typeof entry.id !== "string" ||
          entry.id.trim().length === 0 ||
          seenDividers.has(entry.id)
        ) {
          continue;
        }
        seenDividers.add(entry.id);
        result.push({ kind: "divider", id: entry.id });
      } else if (entry.kind === "group") {
        const id = entry.id;
        if (
          typeof id !== "string" ||
          !GROUP_ID_SET.has(id) ||
          seenGroups.has(id as ToolbarGroupId)
        ) {
          continue;
        }
        seenGroups.add(id as ToolbarGroupId);
        result.push({
          kind: "group",
          id: id as ToolbarGroupId,
          toolbarVisible: typeof entry.toolbarVisible === "boolean" ? entry.toolbarVisible : true,
          floatingVisible:
            FLOATING_ELIGIBLE_IDS.has(id as ToolbarGroupId) &&
            (typeof entry.floatingVisible === "boolean" ? entry.floatingVisible : true),
        });
      }
    }
    return result;
  };

  const start = normalizeLane(raw.start);
  const end = normalizeLane(raw.end);

  for (const entry of DEFAULT_TOOLBAR_CONFIG.start) {
    if (entry.kind === "group" && !seenGroups.has(entry.id)) {
      start.push({ ...entry });
      seenGroups.add(entry.id);
    }
  }
  return { start, end };
}

function laneOf(config: ToolbarConfig, section: ToolbarSection): ToolbarEntry[] {
  return section === "start" ? config.start : config.end;
}

function withLane(
  config: ToolbarConfig,
  section: ToolbarSection,
  lane: ToolbarEntry[]
): ToolbarConfig {
  return section === "start"
    ? { start: lane, end: config.end }
    : { start: config.start, end: lane };
}

export function moveEntry(
  config: ToolbarConfig,
  section: ToolbarSection,
  index: number,
  direction: "up" | "down"
): ToolbarConfig {
  const lane = laneOf(config, section);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || index >= lane.length || target < 0 || target >= lane.length) {
    return config;
  }
  const next = lane.map((entry) => ({ ...entry }));
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return withLane(config, section, next);
}

export function moveEntryTo(
  config: ToolbarConfig,
  from: ToolbarSection,
  index: number,
  to: ToolbarSection,
  toIndex: number
): ToolbarConfig {
  const fromLane = laneOf(config, from);
  if (index < 0 || index >= fromLane.length) return config;
  const moved = { ...fromLane[index] };
  const nextFrom = fromLane.filter((_, itemIndex) => itemIndex !== index);
  if (from === to) {
    const clamped = Math.max(0, Math.min(toIndex, nextFrom.length));
    nextFrom.splice(clamped, 0, moved);
    return withLane(config, from, nextFrom);
  }
  const toLane = laneOf(config, to).map((entry) => ({ ...entry }));
  const clamped = Math.max(0, Math.min(toIndex, toLane.length));
  toLane.splice(clamped, 0, moved);
  return withLane(withLane(config, from, nextFrom), to, toLane);
}

export function transferEntry(
  config: ToolbarConfig,
  from: ToolbarSection,
  index: number
): ToolbarConfig {
  const to: ToolbarSection = from === "start" ? "end" : "start";
  return moveEntryTo(config, from, index, to, laneOf(config, to).length);
}

function mapGroups(
  config: ToolbarConfig,
  id: ToolbarGroupId,
  patch: Partial<ToolbarGroupPreference>
): ToolbarConfig {
  const apply = (lane: ToolbarEntry[]) =>
    lane.map((entry) =>
      entry.kind === "group" && entry.id === id ? { ...entry, ...patch } : entry
    );
  return { start: apply(config.start), end: apply(config.end) };
}

export function setGroupToolbarVisible(
  config: ToolbarConfig,
  id: ToolbarGroupId,
  visible: boolean
): ToolbarConfig {
  return mapGroups(config, id, { toolbarVisible: visible });
}

export function setGroupFloatingVisible(
  config: ToolbarConfig,
  id: ToolbarGroupId,
  visible: boolean
): ToolbarConfig {
  if (!FLOATING_ELIGIBLE_IDS.has(id)) return config;
  return mapGroups(config, id, { floatingVisible: visible });
}

export function addDivider(
  config: ToolbarConfig,
  section: ToolbarSection,
  index?: number
): ToolbarConfig {
  const lane = laneOf(config, section).map((entry) => ({ ...entry }));
  const at = index === undefined ? lane.length : Math.max(0, Math.min(index, lane.length));
  lane.splice(at, 0, { kind: "divider", id: makeDividerId() });
  return withLane(config, section, lane);
}

export function removeDivider(
  config: ToolbarConfig,
  section: ToolbarSection,
  dividerId: string
): ToolbarConfig {
  const lane = laneOf(config, section);
  const next = lane.filter((entry) => !(entry.kind === "divider" && entry.id === dividerId));
  if (next.length === lane.length) return config;
  return withLane(config, section, next);
}

export function deriveFloatingGroupIds(config: ToolbarConfig): ToolbarGroupId[] {
  return [...config.start, ...config.end]
    .filter(
      (entry): entry is ToolbarGroupPreference =>
        entry.kind === "group" && entry.floatingVisible && FLOATING_ELIGIBLE_IDS.has(entry.id)
    )
    .map((entry) => entry.id);
}

export function suppressOrphanDividers(entries: ToolbarEntry[]): ToolbarEntry[] {
  const result: ToolbarEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === "divider") {
      const previous = result[result.length - 1];
      if (!previous || previous.kind === "divider") continue;
      result.push(entry);
    } else {
      result.push(entry);
    }
  }
  while (result.length && result[result.length - 1].kind === "divider") {
    result.pop();
  }
  return result;
}
