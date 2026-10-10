// Every Command the author can run from the keyboard, and the Shortcuts it
// ships with. Bindings name a Command by id and never carry keys: the keys
// that fire are these defaults merged with the author's Custom Shortcuts
// (ADR 0012), resolved in `shortcut-resolve.ts`.
//
// Commands contributed by Plugins are registered at runtime through
// `registerPluginCommands`: the host derives their ids as
// `plugin.<pluginId>.<localId>`, so a Plugin can never claim Maibuk's or
// another Plugin's Commands (ADR 0022). They are ordinary Commands everywhere
// else in this module and in the resolver.
import type { DictationLanguage } from "@/features/dictation/types";
import type { VoiceCommandSpec } from "@/features/dictation/voice-commands";
import { collapseContributionRenames } from "@/features/plugins/ids";
import { isRecordableStep, normalizeShortcut, shortcutKey } from "@/lib/shortcut-keys";

/**
 * One key combination: modifiers then a key, joined by "+". `Mod` is Cmd on
 * macOS and Ctrl elsewhere. Letters are lowercase; Shift is written only for
 * letters and named keys, since a shifted symbol is its own key ("?", "+").
 */
export type Step = string;
/** A Shortcut is one Step, or a sequence of two ("g" then "p"). */
export type Shortcut = readonly Step[];

/**
 * A part of the UI whose Commands can be live together. Which Contexts a
 * screen shows is declared per route in `ROUTE_CONTEXTS`; two Shortcuts can
 * conflict only when some route shows both of their Contexts.
 */
export const CORE_CONTEXTS = [
  "global",
  "bookList",
  "bookEditor",
  "coverDesigner",
  "notes",
  "canvas",
  "ephemeral",
  "editor",
  "noteItem",
  "chapterItem",
  "canvasNode",
  "image",
  "footnoteItem",
  "commandPalette",
] as const;

export type CoreShortcutContext = (typeof CORE_CONTEXTS)[number];

/**
 * `plugin` is reserved as a core Shortcut Context name forever: no Plugin page
 * may take it, so the namespace stays unambiguous (ADR 0022).
 */
export const PLUGIN_CONTEXT_NAME = "plugin";

export const PLUGIN_COMMAND_PREFIX = "plugin.";

/** A Plugin page's own Context, derived by the host from its page id. */
export type PluginContext = `${typeof PLUGIN_COMMAND_PREFIX}${string}`;

export type ShortcutContext = CoreShortcutContext | PluginContext;

/** Handled by the TipTap keymap inside the editor instead of a `useShortcuts` binding. */
export type ShortcutSource = "editor-keymap";

export interface CommandDef {
  labelKey: string;
  /** More than one Context makes it a Shared Command. */
  contexts: readonly ShortcutContext[];
  /** Default Shortcuts: the author can change or remove them. */
  defaults: readonly Shortcut[];
  /** Fixed Shortcuts: the platform or the focused control owns these keys. */
  fixed?: readonly Shortcut[];
  /** Why the Fixed Shortcuts cannot change, shown beside the lock. */
  fixedReasonKey?: string;
  /** A Sealed Command takes no Shortcuts beyond its Fixed ones. */
  sealed?: true;
  /** An i18n key whose value is an array of extra search terms for the Command Palette. */
  keywordsKey?: string;
  /** Replaces `defaults` on the web build, where the browser keeps some keys. */
  web?: readonly Shortcut[];
  source?: ShortcutSource;
  /** Declares Voice Commands for this Command; absent means its label answers (ADR 0016). */
  voice?: VoiceCommandSpec;
  /** The runner changes the route: with a dialog open it closes dialogs first. */
  navigates?: true;
  /** The runner opens a dialog whose text field takes the caret: a Voice Command waits for that field like a navigating one (the Dictation hand-off window). */
  opensDialog?: true;
}

/**
 * One Command contributed by a Plugin, after the host has derived its full id.
 * It carries the ordinary `CommandDef` fields minus the core-only ones: a
 * Plugin cannot declare Fixed or Sealed Commands, an i18n label key, or an
 * editor-keymap source (ADR 0022).
 */
export interface PluginCommandDef {
  /** The full id: `plugin.<pluginId>.<localId>`. */
  id: PluginCommandId;
  pluginId: string;
  localId: string;
  /** The label in the Plugin's default language. */
  label: string;
  /** Labels per Dictation Language the Plugin supplies; UI falls back to `label`. */
  labels: Readonly<Partial<Record<DictationLanguage, string>>>;
  defaultLanguage: DictationLanguage;
  /** Extra search terms for the Command Palette, already in the default language. */
  keywords?: readonly string[];
  contexts: readonly ShortcutContext[];
  defaults: readonly Shortcut[];
  web?: readonly Shortcut[];
  voice?: VoiceCommandSpec;
  navigates?: true;
  opensDialog?: true;
}

export type CommandDefinition = CommandDef | PluginCommandDef;

export function isPluginCommandDef(definition: CommandDefinition): definition is PluginCommandDef {
  return "pluginId" in definition;
}

/** A Command a Plugin declares; the host derives its full id from `pluginId`. */
export interface PluginCommandDeclaration {
  /** The Plugin-local id: `[a-z][a-zA-Z0-9]{0,47}`, unique in the Plugin. */
  id: string;
  /** The label in the Plugin's default language. */
  label: string;
  /** Labels per Dictation Language; only these languages get default Voice Command phrases. */
  labels?: Readonly<Partial<Record<DictationLanguage, string>>>;
  keywords?: readonly string[];
  /** Core Context names plus this Plugin's own page ids. */
  contexts: readonly string[];
  defaults?: readonly Shortcut[];
  web?: readonly Shortcut[];
  voice?: VoiceCommandSpec;
  navigates?: true;
  opensDialog?: true;
}

export interface PluginRegistration {
  commands: readonly PluginCommandDeclaration[];
  /** The language of `label` and `keywords`; supplied locales override them. */
  defaultLanguage: DictationLanguage;
  /** The Plugin's page local ids; each becomes its own Shortcut Context. */
  pages?: readonly string[];
  /** Same-Plugin Command renames: old local id → new local id (ADR 0024). */
  commandRenames?: Readonly<Record<string, string>>;
}

const FIXED_UNDO = "shortcuts.fixed.undo";
const FIXED_NAVIGATION = "shortcuts.fixed.navigation";
const FIXED_ESCAPE = "shortcuts.fixed.escape";
const FIXED_FIELD = "shortcuts.fixed.findField";
const FIXED_TAB = "shortcuts.fixed.tab";
const FIXED_FAMILY = "shortcuts.fixed.family";
const FIXED_ACTIVATE = "shortcuts.fixed.activate";
const FIXED_FOCUS_KEY = "shortcuts.fixed.focusKey";

export const COMMANDS = {
  "global.gotoProjects": {
    labelKey: "shortcuts.gotoProjects",
    contexts: ["global"],
    defaults: [["g", "p"]],
    navigates: true,
  },
  "global.gotoNotes": {
    labelKey: "shortcuts.gotoNotes",
    contexts: ["global"],
    defaults: [["g", "n"]],
    navigates: true,
  },
  "global.gotoCanvas": {
    labelKey: "shortcuts.gotoCanvas",
    contexts: ["global"],
    defaults: [["g", "c"]],
    navigates: true,
  },
  "global.gotoEphemeral": {
    labelKey: "shortcuts.gotoEphemeral",
    contexts: ["global"],
    defaults: [["g", "e"]],
    navigates: true,
    // The English model hears "Ephemeral" as "a femoral" (measured in the E2E
    // lane), so the Command also answers to a spelling it transcribes: "go to
    // a femoral". Both stay listed, and the label remains the first phrase.
    voice: {
      phrases: {
        en: ["go to ephemeral", "go to a femoral"],
      },
    },
  },
  "global.gotoMetrics": {
    labelKey: "shortcuts.gotoMetrics",
    contexts: ["global"],
    defaults: [["g", "m"]],
    navigates: true,
  },
  "global.gotoSettings": {
    labelKey: "shortcuts.gotoSettings",
    contexts: ["global"],
    defaults: [["g", "s"]],
    navigates: true,
    keywordsKey: "shortcuts.keywords.gotoSettings",
  },
  "global.toggleTheme": {
    labelKey: "shortcuts.toggleTheme",
    contexts: ["global"],
    defaults: [["g", "t"]],
    keywordsKey: "shortcuts.keywords.toggleTheme",
  },
  "global.themeLight": {
    labelKey: "settings.light",
    contexts: ["global"],
    defaults: [],
    voice: { phrases: { en: ["light theme"], es: ["tema claro"] } },
  },
  "global.themeDark": {
    labelKey: "settings.dark",
    contexts: ["global"],
    defaults: [],
    voice: { phrases: { en: ["dark theme"], es: ["tema oscuro"] } },
  },
  "global.themeSystem": {
    labelKey: "settings.system",
    contexts: ["global"],
    defaults: [],
    voice: { phrases: { en: ["system theme"], es: ["tema del sistema"] } },
  },
  "global.toggleShortcutHints": {
    labelKey: "shortcuts.toggleShortcutHints",
    contexts: ["global"],
    defaults: [["g", "h"]],
  },
  "global.syncNow": {
    labelKey: "shortcuts.syncNow",
    contexts: ["global"],
    defaults: [["Mod+Shift+y"]],
    keywordsKey: "shortcuts.keywords.syncNow",
  },
  "global.showHelp": {
    labelKey: "shortcuts.showHelp",
    contexts: ["global"],
    defaults: [["?"]],
    keywordsKey: "shortcuts.keywords.showHelp",
    voice: {
      phrases: {
        en: ["show shortcuts help", "show voice commands"],
        es: ["mostrar ayuda de atajos", "mostrar comandos de voz"],
      },
    },
  },
  "global.toggleAlwaysOnTop": {
    labelKey: "shortcuts.toggleAlwaysOnTop",
    contexts: ["global"],
    defaults: [["Mod+Alt+t"]],
    keywordsKey: "shortcuts.keywords.toggleAlwaysOnTop",
  },
  "global.openCommandPalette": {
    labelKey: "shortcuts.openCommandPalette",
    contexts: ["global"],
    defaults: [["F1"], ["Mod+Shift+p"]],
    web: [["F1"]],
  },
  "commandPalette.removeRecent": {
    labelKey: "commandPalette.removeFromRecent",
    contexts: ["commandPalette"],
    defaults: [["Shift+Delete"]],
  },
  "global.cyclePanesForward": {
    labelKey: "shortcuts.cyclePanesForward",
    contexts: ["global"],
    defaults: [["F6"]],
  },
  "global.cyclePanesBackward": {
    labelKey: "shortcuts.cyclePanesBackward",
    contexts: ["global"],
    defaults: [["Shift+F6"]],
  },
  "global.startTutorial": {
    labelKey: "shortcuts.startTutorial",
    contexts: ["global"],
    defaults: [["g", "u"]],
  },
  "global.openReleaseNotes": {
    labelKey: "shortcuts.openReleaseNotes",
    contexts: ["global"],
    defaults: [],
    keywordsKey: "shortcuts.keywords.openReleaseNotes",
  },

  "dictation.toggle": {
    labelKey: "dictation.toggle",
    contexts: ["global"],
    defaults: [["Mod+Shift+Space"]],
    keywordsKey: "shortcuts.keywords.dictationToggle",
  },
  // Bound by the Dictation Bar, so it is live only where the bar is shown.
  "dictation.toggleBar": {
    labelKey: "dictation.bar.toggle",
    contexts: ["global"],
    defaults: [],
  },
  "dictation.cycleLanguage": {
    labelKey: "dictation.cycleLanguage",
    contexts: ["global"],
    defaults: [],
  },
  // Live only while a phrase field holds the caret; it runs over the Voice
  // Commands dialog because it is global and never navigates.
  "dictation.recordPhrase": {
    labelKey: "dictation.recordPhrase",
    contexts: ["global"],
    defaults: [],
  },
  "dictation.stop": {
    labelKey: "dictation.stop",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [],
    fixed: [["Escape"]],
    fixedReasonKey: FIXED_ESCAPE,
    sealed: true,
    voice: { verbs: ["dictation"], targets: { en: ["dictation"], es: ["dictado"] } },
  },

  "tutorial.skip": {
    labelKey: "shortcuts.skipTutorial",
    contexts: ["global"],
    defaults: [],
    fixed: [["Escape"]],
    fixedReasonKey: FIXED_ESCAPE,
  },

  "common.save": {
    labelKey: "shortcuts.save",
    contexts: ["bookEditor", "notes", "coverDesigner"],
    defaults: [["Mod+s"]],
    voice: { phrases: { en: ["save now"], es: ["guardar ahora"] } },
  },
  "common.undo": {
    labelKey: "editor.undo",
    contexts: ["editor", "coverDesigner", "canvas"],
    source: "editor-keymap",
    defaults: [],
    fixed: [["Mod+z"]],
    fixedReasonKey: FIXED_UNDO,
    voice: { verbs: ["undo"], targets: { en: ["that"], es: ["eso"] } },
  },
  "common.redo": {
    labelKey: "editor.redo",
    contexts: ["editor", "coverDesigner", "canvas"],
    source: "editor-keymap",
    defaults: [["Mod+y"]],
    fixed: [["Mod+Shift+z"]],
    fixedReasonKey: FIXED_UNDO,
    voice: { verbs: ["redo"], targets: { en: ["that"], es: ["eso"] } },
  },
  "common.zoomIn": {
    labelKey: "shortcuts.zoomIn",
    contexts: ["editor", "canvas"],
    defaults: [["Mod++"], ["Mod+="]],
    voice: { phrases: { en: ["zoom in"], es: ["acercar vista"] } },
  },
  "common.zoomOut": {
    labelKey: "shortcuts.zoomOut",
    contexts: ["editor", "canvas"],
    defaults: [["Mod+-"]],
    voice: { phrases: { en: ["zoom out"], es: ["alejar vista"] } },
  },
  "common.delete": {
    labelKey: "shortcuts.deleteSelection",
    contexts: ["coverDesigner", "canvas"],
    defaults: [["Delete"], ["Backspace"]],
  },
  "common.back": {
    labelKey: "shortcuts.backFromEditor",
    contexts: ["bookEditor", "notes"],
    defaults: [["Backspace"]],
    navigates: true,
  },
  // Find in the open document, or focus the Notes search in the Notes Gallery.
  "common.find": {
    labelKey: "shortcuts.find",
    contexts: ["editor", "notes"],
    defaults: [["Mod+f"]],
    voice: { phrases: { en: ["find text"], es: ["buscar texto"] } },
  },

  "bookList.newBook": {
    labelKey: "shortcuts.newBook",
    contexts: ["bookList"],
    defaults: [["Mod+n"]],
    // Chromium and Firefox keep Ctrl+N for a new window in a browser tab.
    web: [["Alt+n"]],
    opensDialog: true,
  },
  "bookList.importEpub": { labelKey: "books.importEpub", contexts: ["bookList"], defaults: [] },
  "bookList.downloadApp": { labelKey: "nav.downloadApp", contexts: ["bookList"], defaults: [] },
  "bookList.jumpBooks": {
    labelKey: "shortcuts.jumpBooks",
    contexts: ["bookList"],
    defaults: [],
    fixed: [["1"], ["2"], ["3"], ["4"], ["5"], ["6"], ["7"], ["8"], ["9"]],
    fixedReasonKey: FIXED_FAMILY,
    sealed: true,
  },
  "bookList.moveSelectionNext": {
    labelKey: "shortcuts.moveSelectionNext",
    contexts: ["bookList"],
    defaults: [["j"]],
  },
  "bookList.moveSelectionPrevious": {
    labelKey: "shortcuts.moveSelectionPrevious",
    contexts: ["bookList"],
    defaults: [["k"]],
  },
  "bookList.openSelected": {
    labelKey: "shortcuts.openSelected",
    contexts: ["bookList"],
    defaults: [],
    fixed: [["Enter"]],
    fixedReasonKey: FIXED_ACTIVATE,
    sealed: true,
  },

  "bookEditor.saveVersion": {
    labelKey: "shortcuts.saveVersion",
    contexts: ["bookEditor"],
    defaults: [["Mod+Alt+s"]],
  },
  "bookEditor.versionHistory": {
    labelKey: "shortcuts.versionHistory",
    contexts: ["bookEditor"],
    defaults: [["g", "v"]],
  },
  "bookEditor.focusMode": {
    labelKey: "shortcuts.toggleFocusMode",
    contexts: ["bookEditor"],
    defaults: [["F11"], ["Mod+Shift+f"]],
  },
  "bookEditor.toggleSidebar": {
    labelKey: "shortcuts.toggleSidebar",
    contexts: ["bookEditor"],
    defaults: [["Mod+\\"]],
  },
  "bookEditor.leavePanel": {
    labelKey: "shortcuts.leavePanel",
    contexts: ["bookEditor"],
    defaults: [],
    fixed: [["Escape"]],
    fixedReasonKey: FIXED_ESCAPE,
    sealed: true,
  },
  "bookEditor.bookNotes": { labelKey: "nav.bookNotes", contexts: ["bookEditor"], defaults: [] },
  "bookEditor.exportBook": { labelKey: "nav.exportBook", contexts: ["bookEditor"], defaults: [] },
  "bookEditor.designCover": {
    labelKey: "nav.designCover",
    contexts: ["bookEditor"],
    defaults: [],
    navigates: true,
  },
  "bookEditor.bookSettings": {
    labelKey: "bookSettings.title",
    contexts: ["bookEditor"],
    defaults: [],
  },
  "bookEditor.addChapter": {
    labelKey: "chapters.addChapter",
    contexts: ["bookEditor"],
    defaults: [],
    voice: { phrases: { en: ["add chapter"], es: ["añadir capítulo"] } },
  },
  "bookEditor.importFiles": {
    labelKey: "chapters.importFiles",
    contexts: ["bookEditor"],
    defaults: [],
  },
  "bookEditor.toggleCompactView": {
    labelKey: "commands.bookEditor.toggleCompactView",
    contexts: ["bookEditor"],
    defaults: [],
  },
  "bookEditor.toggleOutline": {
    labelKey: "commands.bookEditor.toggleOutline",
    contexts: ["bookEditor"],
    defaults: [],
  },

  "editor.zoomReset": {
    labelKey: "shortcuts.zoomReset",
    contexts: ["editor"],
    defaults: [["Mod+0"]],
  },
  // Text transforms and editor actions reachable from the toolbar and its menus.
  "editor.uppercase": {
    labelKey: "editor.uppercase",
    contexts: ["editor"],
    defaults: [],
    voice: { phrases: { en: ["uppercase text"], es: ["poner en mayúsculas"] } },
  },
  "editor.lowercase": {
    labelKey: "editor.lowercase",
    contexts: ["editor"],
    defaults: [],
    voice: { phrases: { en: ["lowercase text"], es: ["poner en minúsculas"] } },
  },
  "editor.alternatingCase": {
    labelKey: "editor.alternatingCase",
    contexts: ["editor"],
    defaults: [],
    voice: { phrases: { en: ["alternating case"], es: ["mayúsculas alternas"] } },
  },
  "editor.sentenceCase": {
    labelKey: "editor.sentenceCase",
    contexts: ["editor"],
    defaults: [],
    voice: { phrases: { en: ["sentence case"], es: ["tipo oración"] } },
  },
  "editor.titleCase": {
    labelKey: "editor.titleCase",
    contexts: ["editor"],
    defaults: [],
    voice: { phrases: { en: ["title case"], es: ["tipo título"] } },
  },
  "editor.horizontalMirror": {
    labelKey: "editor.horizontalMirror",
    contexts: ["editor"],
    defaults: [],
  },
  "editor.upsideDown": { labelKey: "editor.upsideDown", contexts: ["editor"], defaults: [] },
  "editor.reverseText": { labelKey: "editor.reverseText", contexts: ["editor"], defaults: [] },
  "editor.leetspeak": {
    labelKey: "editor.leetspeak",
    contexts: ["editor"],
    defaults: [],
    voice: { phrases: { en: ["leetspeak text"], es: ["texto leetspeak"] } },
  },
  "editor.textColor": { labelKey: "editor.textColor", contexts: ["editor"], defaults: [] },
  "editor.pasteWithoutFormatting": {
    labelKey: "editor.pasteWithoutFormatting",
    contexts: ["editor"],
    defaults: [],
  },
  "editor.formatAsMarkdown": {
    labelKey: "editor.formatAsMarkdown",
    contexts: ["editor"],
    defaults: [],
  },
  "editor.inspectInHtml": {
    labelKey: "editor.inspectInHtml",
    contexts: ["editor"],
    defaults: [],
    voice: { phrases: { en: ["inspect html"], es: ["ver código"] } },
  },
  "editor.addToDictionary": {
    labelKey: "editor.addToDictionary",
    contexts: ["editor"],
    defaults: [],
  },
  "editor.lookUp": {
    labelKey: "editor.lookUp",
    contexts: ["editor"],
    defaults: [],
    voice: { phrases: { en: ["look up word"], es: ["buscar palabra"] } },
  },
  "editor.increaseFirstLineIndent": {
    labelKey: "editor.increaseFirstLineIndent",
    contexts: ["editor"],
    defaults: [],
  },
  "editor.decreaseFirstLineIndent": {
    labelKey: "editor.decreaseFirstLineIndent",
    contexts: ["editor"],
    defaults: [],
  },
  "editor.removeFormatting": {
    labelKey: "editor.removeFormatting",
    contexts: ["editor"],
    defaults: [],
  },
  "editor.insertImage": { labelKey: "editor.insertImage", contexts: ["editor"], defaults: [] },
  "editor.footnote": { labelKey: "editor.footnote", contexts: ["editor"], defaults: [] },
  "editor.horizontalRule": {
    labelKey: "editor.horizontalRule",
    contexts: ["editor"],
    defaults: [],
  },
  "editor.spellCheck": { labelKey: "editor.spellCheck", contexts: ["editor"], defaults: [] },
  "editor.viewHtml": { labelKey: "editor.viewHtml", contexts: ["editor"], defaults: [] },
  "editor.exportMarkdown": {
    labelKey: "editor.exportMarkdown",
    contexts: ["editor"],
    defaults: [],
  },
  "editor.exportPdf": { labelKey: "editor.exportPdf", contexts: ["editor"], defaults: [] },
  "editor.exportImage": { labelKey: "editor.exportImage", contexts: ["editor"], defaults: [] },
  "editor.bold": {
    labelKey: "editor.bold",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+b"]],
    voice: {
      verbs: ["formatOn", "formatOff"],
      targets: { en: ["bold", "boldface"], es: ["negrita", "negritas"] },
    },
  },
  "editor.italic": {
    labelKey: "editor.italic",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+i"]],
    voice: {
      verbs: ["formatOn", "formatOff"],
      targets: { en: ["italic", "italics"], es: ["cursiva", "cursivas"] },
    },
  },
  "editor.underline": {
    labelKey: "editor.underline",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+u"]],
    voice: {
      verbs: ["formatOn", "formatOff"],
      targets: { en: ["underline"], es: ["subrayado", "subrayada"] },
    },
  },
  "editor.strikethrough": {
    labelKey: "editor.strikethrough",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+Shift+s"]],
    voice: {
      verbs: ["formatOn", "formatOff"],
      targets: { en: ["strike", "strikethrough"], es: ["tachado", "tachada"] },
    },
  },
  "editor.highlight": {
    labelKey: "editor.highlight",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+Shift+h"]],
    voice: { phrases: { en: ["highlight text"], es: ["resaltar texto"] } },
  },
  "editor.subscript": {
    labelKey: "editor.subscript",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+,"]],
    voice: { phrases: { en: ["subscript text"], es: ["texto subíndice"] } },
  },
  "editor.superscript": {
    labelKey: "editor.superscript",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+."]],
    voice: { phrases: { en: ["superscript text"], es: ["texto superíndice"] } },
  },
  "editor.code": {
    labelKey: "editor.code",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+e"]],
    voice: {
      verbs: ["formatOn", "formatOff"],
      targets: { en: ["code", "inline code"], es: ["código", "código en línea"] },
    },
  },
  "editor.codeBlock": {
    labelKey: "editor.codeBlock",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+Alt+c"]],
  },
  "editor.heading1": {
    labelKey: "editor.heading1",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+Alt+1"]],
    voice: {
      verbs: ["block"],
      targets: { en: ["heading one", "heading 1"], es: ["título uno", "título 1"] },
    },
  },
  "editor.heading2": {
    labelKey: "editor.heading2",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+Alt+2"]],
    voice: {
      verbs: ["block"],
      targets: { en: ["heading two", "heading 2"], es: ["título dos", "título 2"] },
    },
  },
  "editor.heading3": {
    labelKey: "editor.heading3",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+Alt+3"]],
    voice: {
      verbs: ["block"],
      targets: { en: ["heading three", "heading 3"], es: ["título tres", "título 3"] },
    },
  },
  "editor.bulletList": {
    labelKey: "editor.bulletList",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+Shift+8"]],
    voice: {
      verbs: ["listOn", "listOff"],
      targets: {
        en: ["bullet list", "bulleted list", "bullets", "list"],
        es: ["lista", "lista con viñetas", "viñetas"],
      },
    },
  },
  "editor.numberedList": {
    labelKey: "editor.numberedList",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+Shift+7"]],
    voice: {
      verbs: ["listOn", "listOff"],
      targets: {
        en: ["numbered list", "number list", "ordered list"],
        es: ["lista numerada", "lista ordenada"],
      },
    },
  },
  "editor.taskList": {
    labelKey: "editor.taskList",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+Shift+9"]],
  },
  "editor.quote": {
    labelKey: "editor.quote",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+Shift+b"]],
    voice: {
      verbs: ["block"],
      targets: { en: ["quote", "block quote"], es: ["cita", "cita textual"] },
    },
  },
  "editor.alignLeft": {
    labelKey: "editor.alignLeft",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+Shift+l"]],
    voice: { verbs: ["align"], targets: { en: ["left"], es: ["izquierda"] } },
  },
  "editor.alignCenter": {
    labelKey: "editor.alignCenter",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+Shift+e"]],
    voice: { verbs: ["align"], targets: { en: ["center", "text"], es: ["centro", "texto"] } },
  },
  "editor.alignRight": {
    labelKey: "editor.alignRight",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+Shift+r"]],
    voice: { verbs: ["align"], targets: { en: ["right"], es: ["derecha"] } },
  },
  "editor.alignJustify": {
    labelKey: "editor.alignJustify",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+Shift+j"]],
    voice: {
      verbs: ["align"],
      targets: { en: ["justify", "justified"], es: ["justificado", "justificada"] },
    },
  },
  "editor.toggleHeadingCollapse": {
    labelKey: "editor.toggleHeadingCollapse",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+Alt+h"]],
  },
  "editor.increaseIndent": {
    labelKey: "editor.increaseIndent",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [],
    fixed: [["Tab"]],
    fixedReasonKey: FIXED_TAB,
  },
  "editor.decreaseIndent": {
    labelKey: "editor.decreaseIndent",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [],
    fixed: [["Shift+Tab"]],
    fixedReasonKey: FIXED_TAB,
  },
  "editor.insertLink": {
    labelKey: "editor.insertLink",
    contexts: ["editor"],
    defaults: [["Mod+k"]],
  },
  "editor.followLink": {
    labelKey: "editor.followLink",
    contexts: ["editor"],
    defaults: [["Mod+Enter"]],
  },
  "editor.dictionary": {
    labelKey: "editor.dictionary",
    contexts: ["editor"],
    defaults: [["Mod+Shift+d"]],
    voice: { phrases: { en: ["open dictionary"], es: ["abrir diccionario"] } },
  },
  "editor.insertSymbol": {
    labelKey: "shortcuts.insertSymbol",
    contexts: ["editor"],
    defaults: [["Mod+Shift+o"]],
  },
  "editor.toolbarSettings": {
    labelKey: "toolbar.settings.open",
    contexts: ["editor"],
    defaults: [["Mod+Shift+,"]],
  },
  "editor.focusSelectionToolbar": {
    labelKey: "editor.focusSelectionToolbar",
    contexts: ["editor"],
    defaults: [["Alt+F10"]],
  },
  "editor.findNext": {
    labelKey: "editor.findNext",
    contexts: ["editor"],
    defaults: [],
    fixed: [["Enter"]],
    fixedReasonKey: FIXED_FIELD,
  },
  "editor.findPrevious": {
    labelKey: "editor.findPrevious",
    contexts: ["editor"],
    defaults: [],
    fixed: [["Shift+Enter"]],
    fixedReasonKey: FIXED_FIELD,
  },
  "editor.closeFindReplace": {
    labelKey: "editor.closeFindReplace",
    contexts: ["editor"],
    defaults: [],
    fixed: [["Escape"]],
    fixedReasonKey: FIXED_FIELD,
    voice: { phrases: { en: ["close find"], es: ["cerrar búsqueda"] } },
  },

  "image.editAlt": { labelKey: "editor.imageEditAlt", contexts: ["image"], defaults: [] },
  "image.copy": { labelKey: "editor.imageCopy", contexts: ["image"], defaults: [] },
  "image.save": { labelKey: "editor.imageSave", contexts: ["image"], defaults: [] },
  "image.alignLeft": {
    labelKey: "editor.alignLeft",
    contexts: ["image"],
    defaults: [],
    voice: { phrases: { en: ["align image left"], es: ["alinear imagen a la izquierda"] } },
  },
  "image.alignCenter": {
    labelKey: "editor.alignCenter",
    contexts: ["image"],
    defaults: [],
    voice: { phrases: { en: ["center image"], es: ["centrar imagen"] } },
  },
  "image.alignRight": {
    labelKey: "editor.alignRight",
    contexts: ["image"],
    defaults: [],
    voice: { phrases: { en: ["align image right"], es: ["alinear imagen a la derecha"] } },
  },
  "image.delete": {
    labelKey: "common.delete",
    contexts: ["image"],
    defaults: [],
    voice: { phrases: { en: ["delete image"], es: ["eliminar imagen"] } },
  },

  "noteItem.rename": {
    labelKey: "common.rename",
    contexts: ["noteItem"],
    defaults: [],
    voice: { phrases: { en: ["rename note"], es: ["renombrar nota"] } },
  },
  "noteItem.togglePinned": {
    labelKey: "commands.noteItem.togglePinned",
    contexts: ["noteItem"],
    defaults: [],
  },
  "noteItem.duplicate": { labelKey: "notes.duplicate", contexts: ["noteItem"], defaults: [] },
  "noteItem.delete": {
    labelKey: "common.delete",
    contexts: ["noteItem"],
    defaults: [],
    voice: { phrases: { en: ["delete note"], es: ["eliminar nota"] } },
  },

  "chapterItem.edit": { labelKey: "chapters.editChapter", contexts: ["chapterItem"], defaults: [] },
  "chapterItem.delete": {
    labelKey: "chapters.deleteChapter",
    contexts: ["chapterItem"],
    defaults: [],
  },
  "chapterItem.setStatusDraft": {
    labelKey: "commands.chapterItem.setStatusDraft",
    contexts: ["chapterItem"],
    defaults: [],
  },
  "chapterItem.setStatusRevised": {
    labelKey: "commands.chapterItem.setStatusRevised",
    contexts: ["chapterItem"],
    defaults: [],
  },
  "chapterItem.setStatusFinal": {
    labelKey: "commands.chapterItem.setStatusFinal",
    contexts: ["chapterItem"],
    defaults: [],
  },

  "footnoteItem.edit": {
    labelKey: "editor.editFootnote",
    contexts: ["footnoteItem"],
    defaults: [],
  },
  "footnoteItem.delete": {
    labelKey: "editor.deleteFootnote",
    contexts: ["footnoteItem"],
    defaults: [],
  },

  "canvasNode.connect": { labelKey: "canvas.connectTo", contexts: ["canvasNode"], defaults: [] },
  "canvasNode.delete": {
    labelKey: "common.delete",
    contexts: ["canvasNode"],
    defaults: [],
    voice: { phrases: { en: ["delete from canvas"], es: ["eliminar del lienzo"] } },
  },

  "notes.advancedFilters": {
    labelKey: "notes.advancedFilters",
    contexts: ["notes"],
    defaults: [["Mod+Shift+f"]],
    voice: { phrases: { en: ["advanced filters"], es: ["filtros avanzados"] } },
  },
  "notes.newNote": {
    labelKey: "notes.newNote",
    contexts: ["notes"],
    defaults: [],
    navigates: true,
  },
  "notes.addNoteToBook": { labelKey: "notes.addNoteToBook", contexts: ["notes"], defaults: [] },
  "notes.clearFilters": { labelKey: "notes.clearFilters", contexts: ["notes"], defaults: [] },

  "canvas.toolSelect": {
    labelKey: "canvas.toolSelect",
    contexts: ["canvas"],
    defaults: [["v"]],
    voice: { phrases: { en: ["select tool"], es: ["herramienta de selección"] } },
  },
  "canvas.toolPen": {
    labelKey: "canvas.toolPen",
    contexts: ["canvas"],
    defaults: [["p"]],
    voice: { phrases: { en: ["pen tool"], es: ["herramienta de lápiz"] } },
  },
  "canvas.toolEraser": {
    labelKey: "canvas.toolEraser",
    contexts: ["canvas"],
    defaults: [["e"]],
    voice: { phrases: { en: ["eraser tool"], es: ["herramienta de borrador"] } },
  },
  "canvas.addTextNode": { labelKey: "canvas.addTextNode", contexts: ["canvas"], defaults: [["t"]] },
  "canvas.addNoteRef": { labelKey: "canvas.addNoteRef", contexts: ["canvas"], defaults: [["n"]] },
  "canvas.editTextNode": {
    labelKey: "canvas.editTextNode",
    contexts: ["canvas"],
    defaults: [["F2"]],
  },
  "canvas.fitView": { labelKey: "canvas.fitView", contexts: ["canvas"], defaults: [["Shift+1"]] },
  "canvas.lock": { labelKey: "canvas.lockInteractivity", contexts: ["canvas"], defaults: [["l"]] },
  "canvas.clearSelection": {
    labelKey: "shortcuts.clearSelection",
    contexts: ["canvas"],
    defaults: [],
    fixed: [["Escape"]],
    fixedReasonKey: FIXED_ESCAPE,
    voice: { phrases: { en: ["clear canvas selection"], es: ["quitar selección del lienzo"] } },
  },
  "canvas.backToGallery": {
    labelKey: "shortcuts.backToCanvasGallery",
    contexts: ["canvas"],
    defaults: [["Alt+ArrowLeft"]],
    navigates: true,
  },
  "canvas.newCanvas": {
    labelKey: "canvas.newCanvas",
    contexts: ["canvas"],
    defaults: [],
    navigates: true,
  },

  "ephemeral.clear": {
    labelKey: "ephemeral.clear",
    contexts: ["ephemeral"],
    defaults: [],
    voice: { phrases: { en: ["clear ephemeral"], es: ["vaciar efímero"] } },
  },
  "ephemeral.createNote": {
    labelKey: "ephemeral.createNote",
    contexts: ["ephemeral"],
    defaults: [],
    navigates: true,
  },

  "coverDesigner.duplicate": {
    labelKey: "cover.duplicate",
    contexts: ["coverDesigner"],
    defaults: [["Mod+d"]],
    voice: { phrases: { en: ["duplicate object"], es: ["duplicar objeto"] } },
  },
  "coverDesigner.sendBackward": {
    labelKey: "shortcuts.sendBackward",
    contexts: ["coverDesigner"],
    defaults: [["["]],
  },
  "coverDesigner.bringForward": {
    labelKey: "shortcuts.bringForward",
    contexts: ["coverDesigner"],
    defaults: [["]"]],
  },
  "coverDesigner.clearSelection": {
    labelKey: "shortcuts.clearSelection",
    contexts: ["coverDesigner"],
    defaults: [],
    fixed: [["Escape"]],
    fixedReasonKey: FIXED_ESCAPE,
    voice: { phrases: { en: ["clear cover selection"], es: ["quitar selección de la portada"] } },
  },
  "coverDesigner.nudgeUp": {
    labelKey: "shortcuts.nudgeUp",
    contexts: ["coverDesigner"],
    defaults: [],
    fixed: [["ArrowUp"]],
    fixedReasonKey: FIXED_NAVIGATION,
  },
  "coverDesigner.nudgeDown": {
    labelKey: "shortcuts.nudgeDown",
    contexts: ["coverDesigner"],
    defaults: [],
    fixed: [["ArrowDown"]],
    fixedReasonKey: FIXED_NAVIGATION,
  },
  "coverDesigner.nudgeLeft": {
    labelKey: "shortcuts.nudgeLeft",
    contexts: ["coverDesigner"],
    defaults: [],
    fixed: [["ArrowLeft"]],
    fixedReasonKey: FIXED_NAVIGATION,
  },
  "coverDesigner.nudgeRight": {
    labelKey: "shortcuts.nudgeRight",
    contexts: ["coverDesigner"],
    defaults: [],
    fixed: [["ArrowRight"]],
    fixedReasonKey: FIXED_NAVIGATION,
  },
  "coverDesigner.nudgeUpFar": {
    labelKey: "shortcuts.nudgeUpFar",
    contexts: ["coverDesigner"],
    defaults: [],
    fixed: [["Shift+ArrowUp"]],
    fixedReasonKey: FIXED_NAVIGATION,
  },
  "coverDesigner.nudgeDownFar": {
    labelKey: "shortcuts.nudgeDownFar",
    contexts: ["coverDesigner"],
    defaults: [],
    fixed: [["Shift+ArrowDown"]],
    fixedReasonKey: FIXED_NAVIGATION,
  },
  "coverDesigner.nudgeLeftFar": {
    labelKey: "shortcuts.nudgeLeftFar",
    contexts: ["coverDesigner"],
    defaults: [],
    fixed: [["Shift+ArrowLeft"]],
    fixedReasonKey: FIXED_NAVIGATION,
  },
  "coverDesigner.nudgeRightFar": {
    labelKey: "shortcuts.nudgeRightFar",
    contexts: ["coverDesigner"],
    defaults: [],
    fixed: [["Shift+ArrowRight"]],
    fixedReasonKey: FIXED_NAVIGATION,
  },

  "coverDesigner.addTextTitle": {
    labelKey: "commands.coverDesigner.addTextTitle",
    contexts: ["coverDesigner"],
    defaults: [],
  },
  "coverDesigner.addTextSubtitle": {
    labelKey: "commands.coverDesigner.addTextSubtitle",
    contexts: ["coverDesigner"],
    defaults: [],
  },
  "coverDesigner.addTextAuthor": {
    labelKey: "commands.coverDesigner.addTextAuthor",
    contexts: ["coverDesigner"],
    defaults: [],
  },
  "coverDesigner.addImage": {
    labelKey: "cover.addImage",
    contexts: ["coverDesigner"],
    defaults: [],
  },
  "coverDesigner.addShapeRect": {
    labelKey: "commands.coverDesigner.addShapeRect",
    contexts: ["coverDesigner"],
    defaults: [],
  },
  "coverDesigner.addShapeEllipse": {
    labelKey: "commands.coverDesigner.addShapeEllipse",
    contexts: ["coverDesigner"],
    defaults: [],
  },
  "coverDesigner.addShapeLine": {
    labelKey: "commands.coverDesigner.addShapeLine",
    contexts: ["coverDesigner"],
    defaults: [],
  },
  "coverDesigner.alignLeft": {
    labelKey: "cover.align.left",
    contexts: ["coverDesigner"],
    defaults: [],
    voice: { phrases: { en: ["align object left"], es: ["alinear objeto a la izquierda"] } },
  },
  "coverDesigner.alignHCenter": {
    labelKey: "cover.align.hcenter",
    contexts: ["coverDesigner"],
    defaults: [],
  },
  "coverDesigner.alignRight": {
    labelKey: "cover.align.right",
    contexts: ["coverDesigner"],
    defaults: [],
    voice: { phrases: { en: ["align object right"], es: ["alinear objeto a la derecha"] } },
  },
  "coverDesigner.alignTop": {
    labelKey: "cover.align.top",
    contexts: ["coverDesigner"],
    defaults: [],
  },
  "coverDesigner.alignVCenter": {
    labelKey: "cover.align.vcenter",
    contexts: ["coverDesigner"],
    defaults: [],
  },
  "coverDesigner.alignBottom": {
    labelKey: "cover.align.bottom",
    contexts: ["coverDesigner"],
    defaults: [],
  },
  "coverDesigner.toggleOverlays": {
    labelKey: "cover.toggleOverlays",
    contexts: ["coverDesigner"],
    defaults: [],
  },
  "coverDesigner.toggleSnapping": {
    labelKey: "cover.toggleSnapping",
    contexts: ["coverDesigner"],
    defaults: [],
  },
  "coverDesigner.exportPng": {
    labelKey: "cover.pngExport",
    contexts: ["coverDesigner"],
    defaults: [],
  },
  "coverDesigner.exportJpeg": {
    labelKey: "cover.jpgExport",
    contexts: ["coverDesigner"],
    defaults: [],
  },
  "coverDesigner.exportPdf": {
    labelKey: "cover.pdfExport",
    contexts: ["coverDesigner"],
    defaults: [],
  },

  // The browser's own keys, spoken as Voice Commands (ADR 0016). Never
  // handled by `useShortcuts`: their Fixed Shortcut is the platform key
  // itself, never intercepted.
  // The tiny English model mishears some short keys ("Press Tab" -> "Pressed
  // tab", "Press Enter" -> "Presenter"), so these Commands also answer to a
  // spelling the models transcribe. The label phrase stays listed first.
  "focus.next": {
    labelKey: "shortcuts.focus.next",
    contexts: ["global"],
    defaults: [],
    fixed: [["Tab"]],
    fixedReasonKey: FIXED_FOCUS_KEY,
    sealed: true,
    voice: {
      phrases: {
        en: ["press tab", "press the tab key"],
        es: ["pulsar tab", "pulsar la tecla tab"],
      },
    },
  },
  "focus.previous": {
    labelKey: "shortcuts.focus.previous",
    contexts: ["global"],
    defaults: [],
    fixed: [["Shift+Tab"]],
    fixedReasonKey: FIXED_FOCUS_KEY,
    sealed: true,
    voice: {
      phrases: {
        en: ["press shift tab", "press shift tab key"],
        es: ["pulsar mayús tab", "pulsar mayús y tab"],
      },
    },
  },
  "focus.up": {
    labelKey: "shortcuts.focus.up",
    contexts: ["global"],
    defaults: [],
    fixed: [["ArrowUp"]],
    fixedReasonKey: FIXED_FOCUS_KEY,
    sealed: true,
  },
  "focus.down": {
    labelKey: "shortcuts.focus.down",
    contexts: ["global"],
    defaults: [],
    fixed: [["ArrowDown"]],
    fixedReasonKey: FIXED_FOCUS_KEY,
    sealed: true,
  },
  "focus.left": {
    labelKey: "shortcuts.focus.left",
    contexts: ["global"],
    defaults: [],
    fixed: [["ArrowLeft"]],
    fixedReasonKey: FIXED_FOCUS_KEY,
    sealed: true,
  },
  "focus.right": {
    labelKey: "shortcuts.focus.right",
    contexts: ["global"],
    defaults: [],
    fixed: [["ArrowRight"]],
    fixedReasonKey: FIXED_FOCUS_KEY,
    sealed: true,
  },
  "focus.first": {
    labelKey: "shortcuts.focus.first",
    contexts: ["global"],
    defaults: [],
    fixed: [["Home"]],
    fixedReasonKey: FIXED_FOCUS_KEY,
    sealed: true,
  },
  "focus.last": {
    labelKey: "shortcuts.focus.last",
    contexts: ["global"],
    defaults: [],
    fixed: [["End"]],
    fixedReasonKey: FIXED_FOCUS_KEY,
    sealed: true,
  },
  "focus.activate": {
    labelKey: "shortcuts.focus.activate",
    contexts: ["global"],
    defaults: [],
    fixed: [["Enter"]],
    fixedReasonKey: FIXED_FOCUS_KEY,
    sealed: true,
    // The models hear "Press Enter" as "Presenter" (measured in the E2E lane),
    // so the Command also answers to a spelling they transcribe: "press enter
    // key". Both stay listed, and the label remains the first phrase.
    voice: {
      phrases: {
        en: ["press enter", "press enter key"],
        es: ["pulsar intro", "pulsar la tecla intro"],
      },
    },
  },
  "focus.toggle": {
    labelKey: "shortcuts.focus.toggle",
    contexts: ["global"],
    defaults: [],
    fixed: [["Space"]],
    fixedReasonKey: FIXED_FOCUS_KEY,
    sealed: true,
  },
  "focus.escape": {
    labelKey: "shortcuts.focus.escape",
    contexts: ["global"],
    defaults: [],
    fixed: [["Escape"]],
    fixedReasonKey: FIXED_FOCUS_KEY,
    sealed: true,
  },
} as const satisfies Record<string, CommandDef>;

export type CoreCommandId = keyof typeof COMMANDS;
/** A runtime Command id: `plugin.<pluginId>.<localId>`, derived by the host. */
export type PluginCommandId = `plugin.${string}.${string}`;
export type CommandId = CoreCommandId | PluginCommandId;

export const COMMAND_IDS = Object.keys(COMMANDS) as CoreCommandId[];

const PLUGIN_ID_SOURCE = "[a-z0-9-]{3,64}";
const LOCAL_ID_SOURCE = "[a-z][a-zA-Z0-9]{0,47}";
const PLUGIN_ID_PATTERN = new RegExp(`^${PLUGIN_ID_SOURCE}$`);
const LOCAL_ID_PATTERN = new RegExp(`^${LOCAL_ID_SOURCE}$`);
const PLUGIN_COMMAND_ID_PATTERN = new RegExp(
  `^plugin\\.(${PLUGIN_ID_SOURCE})\\.(${LOCAL_ID_SOURCE})$`
);

const CORE_CONTEXT_NAMES: ReadonlySet<string> = new Set(CORE_CONTEXTS);

export function isCoreContextName(value: string): value is CoreShortcutContext {
  return CORE_CONTEXT_NAMES.has(value);
}

/** A name no Plugin page may take: a core Context, or the reserved `plugin`. */
export function isReservedContextName(value: string): boolean {
  return CORE_CONTEXT_NAMES.has(value) || value === PLUGIN_CONTEXT_NAME;
}

export function isCoreCommandId(value: string): value is CoreCommandId {
  return Object.getOwnPropertyDescriptor(COMMANDS, value) !== undefined;
}

/** The shape of a Plugin Command id, whether or not that Plugin is registered. */
export function isPluginCommandId(value: string): value is PluginCommandId {
  return PLUGIN_COMMAND_ID_PATTERN.test(value);
}

export function pluginIdOfCommand(value: string): string | null {
  return PLUGIN_COMMAND_ID_PATTERN.exec(value)?.[1] ?? null;
}

export function localIdOfCommand(value: string): string | null {
  return PLUGIN_COMMAND_ID_PATTERN.exec(value)?.[2] ?? null;
}

interface RegisteredPlugin {
  pluginId: string;
  order: number;
  renames: Readonly<Record<string, string>>;
  defs: readonly PluginCommandDef[];
  byId: ReadonlyMap<PluginCommandId, PluginCommandDef>;
  commandRanks: ReadonlyMap<string, number>;
  bindingRanks: ReadonlyMap<string, number>;
  token: symbol;
}

const plugins = new Map<string, RegisteredPlugin>();
let registrationOrder = 0;
let nextBindingRank = 0;
let registryRevision = 0;
const registryListeners = new Set<() => void>();

function notifyRegistryChange(): void {
  registryRevision += 1;
  for (const listener of [...registryListeners]) listener();
}

export function commandRegistryRevision(): number {
  return registryRevision;
}

/** Runs after every register and unregister. Returns unregister. */
export function onCommandRegistryChange(listener: () => void): () => void {
  registryListeners.add(listener);
  return () => {
    registryListeners.delete(listener);
  };
}

function validateShortcuts(
  localId: string,
  shortcuts: readonly Shortcut[] | undefined
): Shortcut[] {
  return (shortcuts ?? []).map((shortcut) => {
    const normalized =
      Array.isArray(shortcut) && shortcut.length >= 1 && shortcut.length <= 2
        ? normalizeShortcut(shortcut)
        : null;
    if (normalized === null || !normalized.every((step) => isRecordableStep(step))) {
      throw new Error(`Plugin Command "${localId}" declares an invalid Shortcut`);
    }
    return normalized;
  });
}

/**
 * The conflict ranks of a registration's Commands and declared bindings. A
 * Command or binding that existed in the previous registration of the same
 * Plugin keeps its rank (a rename keeps it too); anything new is ranked after
 * every existing binding, so an update cannot take an active key (ADR 0024).
 */
function bindingRanksFor(
  previous: RegisteredPlugin | undefined,
  defs: readonly PluginCommandDef[],
  renames: Readonly<Record<string, string>>
): { commandRanks: Map<string, number>; bindingRanks: Map<string, number> } {
  const renamedFrom = new Map<string, string[]>();
  for (const [from, to] of Object.entries(renames)) {
    renamedFrom.set(to, [...(renamedFrom.get(to) ?? []), from]);
  }
  const commandRanks = new Map<string, number>();
  const bindingRanks = new Map<string, number>();
  for (const definition of defs) {
    const previousLocalIds = [definition.localId, ...(renamedFrom.get(definition.localId) ?? [])];
    let base: number | undefined;
    for (const localId of previousLocalIds) {
      const rank = previous?.commandRanks.get(localId);
      if (rank !== undefined && (base === undefined || rank < base)) base = rank;
    }
    commandRanks.set(definition.localId, base ?? nextBindingRank++);

    const keys = new Set(
      [...definition.defaults, ...(definition.web ?? [])].map((shortcut) => shortcutKey(shortcut))
    );
    for (const key of keys) {
      let rank: number | undefined;
      for (const localId of previousLocalIds) {
        const kept = previous?.bindingRanks.get(`${localId}\u0000${key}`);
        if (kept !== undefined && (rank === undefined || kept < rank)) rank = kept;
      }
      bindingRanks.set(`${definition.localId}\u0000${key}`, rank ?? nextBindingRank++);
    }
  }
  return { commandRanks, bindingRanks };
}

/**
 * Admits a Plugin's Commands into the shared registry. `pluginId` names the
 * owner; the host derives every full id as `plugin.<pluginId>.<localId>`, so a
 * declaration can never name another owner's Command. Refuses what a Plugin
 * Command may not be: Fixed, Sealed, a label key, or an editor-keymap source.
 * Registering the same Plugin again updates it in place, keeping its place in
 * the conflict order. Returns unregister.
 */
export function registerPluginCommands(
  pluginId: string,
  registration: PluginRegistration
): () => void {
  if (!PLUGIN_ID_PATTERN.test(pluginId)) {
    throw new Error(`Invalid Plugin id "${pluginId}"`);
  }

  const pageSet = new Set<string>();
  for (const page of registration.pages ?? []) {
    if (!LOCAL_ID_PATTERN.test(page)) throw new Error(`Invalid Plugin page id "${page}"`);
    if (isReservedContextName(page)) {
      throw new Error(`Plugin page id "${page}" is a reserved Shortcut Context name`);
    }
    if (pageSet.has(page)) throw new Error(`Duplicate Plugin page id "${page}"`);
    pageSet.add(page);
  }

  const declared = new Set<string>();
  const defs: PluginCommandDef[] = [];
  for (const declaration of registration.commands) {
    const raw = declaration as unknown as Record<string, unknown>;
    for (const refused of ["fixed", "sealed", "fixedReasonKey", "source"] as const) {
      if (raw[refused] !== undefined) {
        throw new Error(`Plugin Command "${declaration.id}" cannot declare ${refused}`);
      }
    }
    if (!LOCAL_ID_PATTERN.test(declaration.id)) {
      throw new Error(`Plugin Command id "${declaration.id}" is outside this Plugin's namespace`);
    }
    if (declared.has(declaration.id)) {
      throw new Error(`Duplicate Plugin Command id "${declaration.id}"`);
    }
    declared.add(declaration.id);

    const contexts = declaration.contexts.map((context): ShortcutContext => {
      if (isCoreContextName(context)) return context;
      if (pageSet.has(context)) {
        return `${PLUGIN_COMMAND_PREFIX}${pluginId}.${context}` as PluginContext;
      }
      throw new Error(`Plugin Command "${declaration.id}" declares unknown Context "${context}"`);
    });

    defs.push({
      id: `${PLUGIN_COMMAND_PREFIX}${pluginId}.${declaration.id}` as PluginCommandId,
      pluginId,
      localId: declaration.id,
      label: declaration.label,
      labels: declaration.labels ?? {},
      defaultLanguage: registration.defaultLanguage,
      contexts,
      defaults: validateShortcuts(declaration.id, declaration.defaults),
      ...(declaration.keywords !== undefined ? { keywords: declaration.keywords } : {}),
      ...(declaration.web !== undefined
        ? { web: validateShortcuts(declaration.id, declaration.web) }
        : {}),
      ...(declaration.voice !== undefined ? { voice: declaration.voice } : {}),
      ...(declaration.navigates ? { navigates: declaration.navigates } : {}),
      ...(declaration.opensDialog ? { opensDialog: declaration.opensDialog } : {}),
    });
  }

  const token = Symbol(pluginId);
  const byId = new Map(defs.map((definition) => [definition.id, definition]));
  const previous = plugins.get(pluginId);
  const renames = collapseContributionRenames(
    registration.commandRenames ?? {},
    declared,
    "Command"
  );
  const { commandRanks, bindingRanks } = bindingRanksFor(previous, defs, renames);
  plugins.set(pluginId, {
    pluginId,
    order: previous?.order ?? registrationOrder++,
    renames,
    defs,
    byId,
    commandRanks,
    bindingRanks,
    token,
  });
  notifyRegistryChange();

  return () => {
    const current = plugins.get(pluginId);
    if (current?.token !== token) return;
    plugins.delete(pluginId);
    notifyRegistryChange();
  };
}

function registeredPlugins(): RegisteredPlugin[] {
  return [...plugins.values()].sort((a, b) => a.order - b.order);
}

/** Every live Command: the core registry in order, then each Plugin in turn. */
export function commandIds(): CommandId[] {
  const ids: CommandId[] = [...COMMAND_IDS];
  for (const plugin of registeredPlugins()) {
    for (const definition of plugin.defs) ids.push(definition.id);
  }
  return ids;
}

export function getCoreCommand(id: CoreCommandId): CommandDef {
  return COMMANDS[id];
}

export function getCommand(id: CommandId): CommandDefinition {
  if (isCoreCommandId(id)) return COMMANDS[id];
  const pluginId = pluginIdOfCommand(id);
  const definition = pluginId === null ? undefined : plugins.get(pluginId)?.byId.get(id);
  if (definition === undefined) throw new Error(`Unknown Command "${id}"`);
  return definition;
}

export function isCommandId(value: string): value is CommandId {
  if (isCoreCommandId(value)) return true;
  const pluginId = pluginIdOfCommand(value);
  return pluginId !== null && plugins.get(pluginId)?.byId.has(value as PluginCommandId) === true;
}

/**
 * Applies a registered Plugin's rename map to a stored id. A Plugin that is
 * absent keeps its stored ids as they are: the preference is retained for its
 * return (ADR 0024).
 */
export function resolvePluginCommandRename(value: string): string {
  const pluginId = pluginIdOfCommand(value);
  if (pluginId === null) return value;
  const localId = localIdOfCommand(value);
  const renamed = localId === null ? undefined : plugins.get(pluginId)?.renames[localId];
  return renamed === undefined ? value : `${PLUGIN_COMMAND_PREFIX}${pluginId}.${renamed}`;
}

/** The rename maps of every registered Plugin, for settings migration. */
export function pluginCommandRenames(): ReadonlyMap<string, Readonly<Record<string, string>>> {
  return new Map(registeredPlugins().map((plugin) => [plugin.pluginId, plugin.renames]));
}

/**
 * The conflict rank of one Plugin binding; lower runs first. A key the
 * registration does not declare keeps its Command's rank, which is the rank of
 * the binding the Command already held.
 */
export function pluginBindingRank(id: PluginCommandId, shortcut: Shortcut): number {
  const pluginId = pluginIdOfCommand(id);
  const localId = localIdOfCommand(id);
  const plugin = pluginId === null ? undefined : plugins.get(pluginId);
  if (plugin === undefined || localId === null) return Number.MAX_SAFE_INTEGER;
  const declared = plugin.bindingRanks.get(`${localId}\u0000${shortcutKey(shortcut)}`);
  return declared ?? plugin.commandRanks.get(localId) ?? Number.MAX_SAFE_INTEGER;
}

/**
 * A stored id to the Command it names today, or null when it names nothing.
 * Unknown ids under `plugin.` are kept as they are (ADR 0024), and everything
 * else unknown is dropped (ADR 0012).
 */
export function resolveStoredCommandId(rawId: string): CommandId | null {
  const renamed = resolvePluginCommandRename(COMMAND_RENAMES[rawId] ?? rawId);
  if (isCommandId(renamed)) return renamed;
  return isPluginCommandId(renamed) ? renamed : null;
}

/**
 * A Command's label: core Commands through i18n, Plugin Commands through their
 * labels. `translate` is the caller's i18next `t`; its overloaded type sends
 * TypeScript into TS2589 when it is checked against a plain signature, so it
 * is taken as unknown and guarded here.
 */
export function commandLabel(
  id: CommandId,
  translate: unknown,
  language?: DictationLanguage
): string {
  const definition = getCommand(id);
  if (!isPluginCommandDef(definition)) {
    const t = typeof translate === "function" ? (translate as (key: string) => unknown) : null;
    const label = t?.(definition.labelKey);
    return typeof label === "string" ? label : definition.labelKey;
  }
  if (language !== undefined && definition.labels[language] !== undefined) {
    return definition.labels[language];
  }
  return definition.label;
}

/** A Command's Fixed Shortcuts; Plugin Commands never have any (ADR 0022). */
export function fixedShortcuts(id: CommandId): readonly Shortcut[] {
  const definition = getCommand(id);
  return isPluginCommandDef(definition) ? [] : (definition.fixed ?? []);
}

export function isSealedCommand(id: CommandId): boolean {
  // A retained preference for an absent Plugin names no live Command.
  if (isPluginCommandId(id) && !isCommandId(id)) return false;
  const definition = getCommand(id);
  return !isPluginCommandDef(definition) && definition.sealed === true;
}

export function isEditorKeymapCommand(id: CommandId): boolean {
  const definition = getCommand(id);
  return !isPluginCommandDef(definition) && definition.source === "editor-keymap";
}

export function isNavigatingCommand(id: CommandId): boolean {
  const definition = getCommand(id);
  return definition.navigates === true || definition.opensDialog === true;
}

/**
 * The Contexts each route shows, keyed by the path in `src/App.tsx`. Global
 * is on every route and not listed. A new screen adds one line here.
 */
export const ROUTE_CONTEXTS: Readonly<Record<string, readonly ShortcutContext[]>> = {
  "/": ["bookList", "commandPalette"],
  "/notes": ["notes", "noteItem", "commandPalette"],
  "/notes/:noteId": ["notes", "noteItem", "editor", "image", "footnoteItem", "commandPalette"],
  "/canvas": ["canvas", "commandPalette"],
  "/canvas/:canvasId": ["canvas", "canvasNode", "editor", "commandPalette"],
  "/ephemeral": ["ephemeral", "editor", "image", "footnoteItem", "commandPalette"],
  "/metrics": ["commandPalette"],
  "/settings": ["commandPalette"],
  "/embed": [],
  "/book/:bookId": [
    "bookEditor",
    "chapterItem",
    "noteItem",
    "editor",
    "image",
    "footnoteItem",
    "commandPalette",
  ],
  "/book/:bookId/cover": ["coverDesigner", "commandPalette"],
};

/** The Shortcut Editor and the shortcut help list Commands in these sections, in order. */
export const SHORTCUT_SECTIONS = [
  { id: "common", labelKey: "shortcuts.sections.common", contexts: [] },
  { id: "global", labelKey: "shortcuts.sections.global", contexts: ["global"] },
  { id: "bookList", labelKey: "shortcuts.sections.bookList", contexts: ["bookList"] },
  {
    id: "bookEditor",
    labelKey: "shortcuts.sections.bookEditor",
    contexts: ["bookEditor", "chapterItem"],
  },
  {
    id: "coverDesigner",
    labelKey: "shortcuts.sections.coverDesigner",
    contexts: ["coverDesigner"],
  },
  { id: "notes", labelKey: "shortcuts.sections.notes", contexts: ["notes", "noteItem"] },
  { id: "canvas", labelKey: "shortcuts.sections.canvas", contexts: ["canvas", "canvasNode"] },
  { id: "ephemeral", labelKey: "shortcuts.sections.ephemeral", contexts: ["ephemeral"] },
  {
    id: "editor",
    labelKey: "shortcuts.sections.editor",
    contexts: ["editor", "image", "footnoteItem"],
  },
  {
    id: "commandPalette",
    labelKey: "shortcuts.sections.commandPalette",
    contexts: ["commandPalette"],
  },
  { id: "focus", labelKey: "shortcuts.sections.focus", contexts: [] },
  { id: "plugins", labelKey: "shortcuts.sections.plugins", contexts: [] },
] as const satisfies readonly {
  id: string;
  labelKey: string;
  contexts: readonly ShortcutContext[];
}[];

export type ShortcutSectionId = (typeof SHORTCUT_SECTIONS)[number]["id"];

/**
 * A Shared Command lives in "common", any other core Command in its Context's
 * section, and every Plugin Command in "plugins".
 */
export function commandSection(id: CommandId): ShortcutSectionId {
  if (isPluginCommandId(id)) return "plugins";
  if (id.startsWith("focus.")) return "focus";
  const contexts: readonly ShortcutContext[] = COMMANDS[id].contexts;
  if (contexts.length > 1) return "common";
  const section = SHORTCUT_SECTIONS.find((candidate) =>
    (candidate.contexts as readonly ShortcutContext[]).includes(contexts[0])
  );
  if (!section) throw new Error(`No shortcut section shows context ${contexts[0]}`);
  return section.id;
}

/**
 * Old Command id to its current id, so Custom Shortcuts stored under an old
 * id survive a rename (ADR 0012). Add an entry whenever a Command id changes.
 */
export const COMMAND_RENAMES: Readonly<Record<string, CommandId>> = {};
