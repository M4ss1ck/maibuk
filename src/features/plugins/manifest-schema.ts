/**
 * The Plugin manifest as one Zod schema, and the JSON Schema generated from it
 * (`manifest.schema.json`, written by `scripts/generate-manifest-schema.ts` and
 * checked by `manifest-schema.test.ts`). Zod owns the structural rules, so the
 * shipped JSON Schema cannot drift from the runtime validator; the rules JSON
 * Schema cannot express (references between contributions, rename maps,
 * permission hosts, icon names, counts) run in `manifest-validate.ts`.
 *
 * Unknown fields are refused everywhere (a misspelled `permisions` must not
 * silently ship a Plugin with no Plugin Permissions), except `x-*` keys the
 * author's own tooling may use.
 */
import { z } from "zod";
import { LOCAL_ID_SOURCE, PLUGIN_ID_SOURCE } from "@/features/plugins/ids";
import { SEMVER_SOURCE } from "@/features/plugins/semver";
import type { SettingsPlatform } from "@/features/settings/rows";
import type { Language } from "@/features/settings/types";
import { VOICE_VOCABULARY, type VoiceVerbClass } from "@/features/dictation/voice-commands";

/** The languages a manifest's literal strings and its `locales/` files may use. */
export const MANIFEST_LANGUAGES = ["en", "es"] as const satisfies readonly Language[];

/** The platforms a Plugin can declare, matching the Settings row platforms. */
export const PLUGIN_PLATFORMS = [
  "desktop",
  "web",
  "android",
] as const satisfies readonly SettingsPlatform[];

/** The item kinds a contributed Command may act on (the v1 API entities). */
export const PLUGIN_TARGETS = ["book", "chapter", "note", "canvas", "canvasNode"] as const;

const VOICE_VERB_CLASSES = Object.keys(VOICE_VOCABULARY.en.verbs) as readonly VoiceVerbClass[];

const SEMVER_PATTERN = new RegExp(`^${SEMVER_SOURCE}$`);

/**
 * An object that refuses unknown fields except `x-*`, with one message per
 * offending key. The JSON Schema emitter drops refinements, so the generator
 * turns the `additionalProperties` it sees into the same rule.
 */
function strictObject<T extends z.ZodRawShape>(shape: T) {
  const known = new Set(Object.keys(shape));
  return z
    .object(shape)
    .catchall(z.unknown())
    .superRefine((value, ctx) => {
      for (const key of Object.keys(value)) {
        if (known.has(key) || key.startsWith("x-")) continue;
        ctx.addIssue({ code: "custom", message: `Unknown field "${key}"`, path: [key] });
      }
    });
}

const localId = z
  .string()
  .regex(new RegExp(`^${LOCAL_ID_SOURCE}$`), "must be a camelCase Plugin-local id")
  .describe("A camelCase id, unique within its contribution kind for this Plugin.");

const shortcutStep = z.string().min(1);
const shortcut = z.array(shortcutStep).min(1).max(2);
const shortcuts = z.array(shortcut);

const shortcutList = (description: string) => shortcuts.describe(description).optional();

/** Non-empty phrase or target lists per Dictation Language. */
const languageListMap = strictObject({
  en: z.array(z.string().min(1)).min(1).optional(),
  es: z.array(z.string().min(1)).min(1).optional(),
});

const voiceSpec = strictObject({
  verbs: z.array(z.enum(VOICE_VERB_CLASSES)).min(1).optional(),
  targets: languageListMap.optional(),
  phrases: languageListMap.optional(),
}).refine(
  (voice) =>
    voice.verbs !== undefined || voice.targets !== undefined || voice.phrases !== undefined,
  "voice must declare verbs, targets, or phrases"
);

const contributionPlatforms = z.array(z.enum(PLUGIN_PLATFORMS)).min(1);

const icon = z
  .string()
  .min(1)
  .describe("A Lucide icon name (kebab-case) or a relative .svg path inside the Plugin folder.");

const commandContribution = strictObject({
  id: localId,
  label: z.string().min(1).describe("The Command's label in the Plugin's default language."),
  keywords: z.array(z.string().min(1)).optional(),
  contexts: z
    .array(z.string().min(1))
    .min(1)
    .describe("Core Shortcut Context names plus this Plugin's own page ids."),
  defaults: shortcutList("Default Shortcuts, empty when the Command has none."),
  web: shortcutList("Shortcuts that replace the defaults on the web build."),
  voice: voiceSpec.optional(),
  targets: z.array(z.enum(PLUGIN_TARGETS)).min(1).optional(),
  navigates: z.literal(true).optional(),
  opensDialog: z.literal(true).optional(),
  platforms: contributionPlatforms.optional(),
});

const pageContribution = strictObject({
  id: localId,
  title: z.string().min(1),
  command: localId.describe("A Command that declares navigates: true."),
  platforms: contributionPlatforms.optional(),
});

const sidebarEntryContribution = strictObject({
  page: localId.describe("A declared page id; its title is the entry's label."),
  icon,
  platforms: contributionPlatforms.optional(),
});

const settingsRowContribution = strictObject({
  id: localId,
  label: z.string().min(1),
  description: z.string().min(1).optional(),
  keywords: z.array(z.string().min(1)).optional(),
  platforms: contributionPlatforms.optional(),
});

const toolbarButtonContribution = strictObject({
  id: localId,
  command: localId,
  icon,
  platforms: contributionPlatforms.optional(),
});

const itemMenuEntryContribution = strictObject({
  command: localId.describe("A declared Command with targets; its targets pick the menus."),
  platforms: contributionPlatforms.optional(),
});

const contributes = strictObject({
  commands: z.array(commandContribution).optional(),
  pages: z.array(pageContribution).optional(),
  sidebarEntries: z.array(sidebarEntryContribution).optional(),
  settingsRows: z.array(settingsRowContribution).optional(),
  toolbarButtons: z.array(toolbarButtonContribution).optional(),
  itemMenuEntries: z.array(itemMenuEntryContribution).optional(),
});

const renames = z
  .record(z.string(), z.string())
  .describe("Old local id to new local id, within this Plugin only.");

export function buildPluginManifestSchema(options: { builtIn: boolean }) {
  const reserved = options.builtIn ? "tutorial-" : "maibuk- and tutorial-";
  const id = z
    .string()
    .regex(
      new RegExp(`^(?!${options.builtIn ? "tutorial-" : "maibuk-|tutorial-"})${PLUGIN_ID_SOURCE}$`),
      `must be a lowercase slug of 3-64 characters that does not use the reserved ${reserved} prefixes`
    )
    .describe("The Plugin id: lowercase slug, stable across releases, never reused.");

  return strictObject({
    $schema: z.string().min(1).optional(),
    manifestVersion: z.literal(1).describe("The manifest file format version; always 1."),
    id,
    name: z.string().min(1),
    description: z.string().min(1),
    author: z.string().min(1),
    version: z
      .string()
      .regex(SEMVER_PATTERN, "must be a semver version")
      .describe("The Plugin's own version; it may go down on an update."),
    apiVersion: z
      .string()
      .min(1)
      .describe(
        "A semver range against the Plugin API, for example ^0.3 (which pins 0.3.x before API 1.0)."
      ),
    minAppVersion: z
      .string()
      .regex(SEMVER_PATTERN, "must be a semver version")
      .optional()
      .describe("The earliest Maibuk Release this Plugin tolerates."),
    homepage: z.string().optional(),
    entry: z.string().min(1).describe("A relative path to the Plugin's ES module entry file."),
    platforms: z.array(z.enum(PLUGIN_PLATFORMS)).min(1),
    lifecycle: z
      .enum(["persistent", "on-demand"])
      .describe(
        "persistent starts with the app; on-demand starts when a surface becomes reachable."
      ),
    defaultLanguage: z.enum(MANIFEST_LANGUAGES),
    permissions: strictObject({
      required: z
        .array(z.string())
        .describe("Plugin Permissions the author must approve to enable the Plugin."),
      optional: z.array(z.string()).describe("Plugin Permissions the author may deny one by one."),
    }),
    dataVersion: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("The Plugin data format version; defaults to 1."),
    customUi: z
      .boolean()
      .optional()
      .describe("Required when the Plugin draws its own UI with Frame."),
    contributes: contributes.optional(),
    commandRenames: renames.optional(),
    rowRenames: renames.optional(),
    buttonRenames: renames.optional(),
  }).describe("A Maibuk Plugin manifest (manifestVersion 1).");
}

/** The manifest schema for third-party Plugins; `maibuk-` and `tutorial-` are reserved. */
export const pluginManifestSchema = buildPluginManifestSchema({ builtIn: false });

/** The manifest schema for Built-in Plugins; only `tutorial-` stays reserved. */
export const builtInPluginManifestSchema = buildPluginManifestSchema({ builtIn: true });


/**
 * The JSON Schema an author's editor reads through `$schema`. It is generated
 * from `pluginManifestSchema`; the one transform is the unknown-key rule,
 * which Zod refinements cannot express: every `additionalProperties: {}` a
 * `catchall(z.unknown())` produced becomes `false` with `x-*` pattern keys.
 */
export function buildPluginManifestJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(pluginManifestSchema, {
    io: "input",
    target: "draft-2020-12",
  }) as Record<string, unknown>;
  return applyUnknownKeyRule(generated);
}

function applyUnknownKeyRule(node: unknown): Record<string, unknown> {
  const object = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(object)) {
    if (key === "additionalProperties" && isPlainEmptyObject(value)) {
      object.additionalProperties = false;
      const patterns = object.patternProperties as Record<string, unknown> | undefined;
      object.patternProperties = { "^x-": {}, ...patterns };
      continue;
    }
    if (Array.isArray(value)) {
      object[key] = value.map((item) =>
        typeof item === "object" && item !== null ? applyUnknownKeyRule(item) : item
      );
    } else if (typeof value === "object" && value !== null) {
      object[key] = applyUnknownKeyRule(value);
    }
  }
  return object;
}

function isPlainEmptyObject(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}
