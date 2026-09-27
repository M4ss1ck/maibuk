// Every Command the author can run from the keyboard, and the Shortcuts it
// ships with. Bindings name a Command by id and never carry keys: the keys
// that fire are these defaults merged with the author's Custom Shortcuts
// (ADR 0012), resolved in `shortcut-resolve.ts`.

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
export type ShortcutContext =
  | "global"
  | "bookList"
  | "bookEditor"
  | "coverDesigner"
  | "notes"
  | "canvas"
  | "ephemeral"
  | "editor"
  | "noteItem"
  | "chapterItem"
  | "canvasNode"
  | "image";

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
  /** Replaces `defaults` on the web build, where the browser keeps some keys. */
  web?: readonly Shortcut[];
  source?: ShortcutSource;
}

const FIXED_UNDO = "shortcuts.fixed.undo";
const FIXED_NAVIGATION = "shortcuts.fixed.navigation";
const FIXED_ESCAPE = "shortcuts.fixed.escape";
const FIXED_FIELD = "shortcuts.fixed.findField";
const FIXED_TAB = "shortcuts.fixed.tab";
const FIXED_FAMILY = "shortcuts.fixed.family";
const FIXED_ACTIVATE = "shortcuts.fixed.activate";

export const COMMANDS = {
  "global.gotoProjects": {
    labelKey: "shortcuts.gotoProjects",
    contexts: ["global"],
    defaults: [["g", "p"]],
  },
  "global.gotoNotes": {
    labelKey: "shortcuts.gotoNotes",
    contexts: ["global"],
    defaults: [["g", "n"]],
  },
  "global.gotoCanvas": {
    labelKey: "shortcuts.gotoCanvas",
    contexts: ["global"],
    defaults: [["g", "c"]],
  },
  "global.gotoEphemeral": {
    labelKey: "shortcuts.gotoEphemeral",
    contexts: ["global"],
    defaults: [["g", "e"]],
  },
  "global.gotoMetrics": {
    labelKey: "shortcuts.gotoMetrics",
    contexts: ["global"],
    defaults: [["g", "m"]],
  },
  "global.gotoSettings": {
    labelKey: "shortcuts.gotoSettings",
    contexts: ["global"],
    defaults: [["g", "s"]],
  },
  "global.toggleTheme": {
    labelKey: "shortcuts.toggleTheme",
    contexts: ["global"],
    defaults: [["g", "t"]],
  },
  "global.themeLight": { labelKey: "settings.light", contexts: ["global"], defaults: [] },
  "global.themeDark": { labelKey: "settings.dark", contexts: ["global"], defaults: [] },
  "global.themeSystem": { labelKey: "settings.system", contexts: ["global"], defaults: [] },
  "global.toggleShortcutHints": {
    labelKey: "shortcuts.toggleShortcutHints",
    contexts: ["global"],
    defaults: [["g", "h"]],
  },
  "global.syncNow": {
    labelKey: "shortcuts.syncNow",
    contexts: ["global"],
    defaults: [["Mod+Shift+y"]],
  },
  "global.showHelp": { labelKey: "shortcuts.showHelp", contexts: ["global"], defaults: [["?"]] },
  "global.toggleAlwaysOnTop": {
    labelKey: "shortcuts.toggleAlwaysOnTop",
    contexts: ["global"],
    defaults: [["Mod+Shift+p"]],
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

  "dictation.toggle": {
    labelKey: "dictation.toggle",
    contexts: ["global"],
    defaults: [["Mod+Shift+Space"]],
  },
  "dictation.stop": {
    labelKey: "dictation.stop",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [],
    fixed: [["Escape"]],
    fixedReasonKey: FIXED_ESCAPE,
    sealed: true,
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
  },
  "common.undo": {
    labelKey: "editor.undo",
    contexts: ["editor", "coverDesigner", "canvas"],
    source: "editor-keymap",
    defaults: [],
    fixed: [["Mod+z"]],
    fixedReasonKey: FIXED_UNDO,
  },
  "common.redo": {
    labelKey: "editor.redo",
    contexts: ["editor", "coverDesigner", "canvas"],
    source: "editor-keymap",
    defaults: [["Mod+y"]],
    fixed: [["Mod+Shift+z"]],
    fixedReasonKey: FIXED_UNDO,
  },
  "common.zoomIn": {
    labelKey: "shortcuts.zoomIn",
    contexts: ["editor", "canvas"],
    defaults: [["Mod++"], ["Mod+="]],
  },
  "common.zoomOut": {
    labelKey: "shortcuts.zoomOut",
    contexts: ["editor", "canvas"],
    defaults: [["Mod+-"]],
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
  },
  // Find in the open document, or focus the Notes search in the Notes Gallery.
  "common.find": {
    labelKey: "shortcuts.find",
    contexts: ["editor", "notes"],
    defaults: [["Mod+f"]],
  },

  "bookList.newBook": {
    labelKey: "shortcuts.newBook",
    contexts: ["bookList"],
    defaults: [["Mod+n"]],
    // Chromium and Firefox keep Ctrl+N for a new window in a browser tab.
    web: [["Alt+n"]],
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
    fixed: [["ArrowDown"], ["ArrowRight"]],
    fixedReasonKey: FIXED_NAVIGATION,
  },
  "bookList.moveSelectionPrevious": {
    labelKey: "shortcuts.moveSelectionPrevious",
    contexts: ["bookList"],
    defaults: [["k"]],
    fixed: [["ArrowUp"], ["ArrowLeft"]],
    fixedReasonKey: FIXED_NAVIGATION,
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
  "bookEditor.designCover": { labelKey: "nav.designCover", contexts: ["bookEditor"], defaults: [] },
  "bookEditor.bookSettings": {
    labelKey: "bookSettings.title",
    contexts: ["bookEditor"],
    defaults: [],
  },
  "bookEditor.addChapter": {
    labelKey: "chapters.addChapter",
    contexts: ["bookEditor"],
    defaults: [],
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
  "editor.uppercase": { labelKey: "editor.uppercase", contexts: ["editor"], defaults: [] },
  "editor.lowercase": { labelKey: "editor.lowercase", contexts: ["editor"], defaults: [] },
  "editor.alternatingCase": {
    labelKey: "editor.alternatingCase",
    contexts: ["editor"],
    defaults: [],
  },
  "editor.sentenceCase": { labelKey: "editor.sentenceCase", contexts: ["editor"], defaults: [] },
  "editor.titleCase": { labelKey: "editor.titleCase", contexts: ["editor"], defaults: [] },
  "editor.horizontalMirror": {
    labelKey: "editor.horizontalMirror",
    contexts: ["editor"],
    defaults: [],
  },
  "editor.upsideDown": { labelKey: "editor.upsideDown", contexts: ["editor"], defaults: [] },
  "editor.reverseText": { labelKey: "editor.reverseText", contexts: ["editor"], defaults: [] },
  "editor.leetspeak": { labelKey: "editor.leetspeak", contexts: ["editor"], defaults: [] },
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
  "editor.inspectInHtml": { labelKey: "editor.inspectInHtml", contexts: ["editor"], defaults: [] },
  "editor.addToDictionary": {
    labelKey: "editor.addToDictionary",
    contexts: ["editor"],
    defaults: [],
  },
  "editor.lookUp": { labelKey: "editor.lookUp", contexts: ["editor"], defaults: [] },
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
  },
  "editor.italic": {
    labelKey: "editor.italic",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+i"]],
  },
  "editor.underline": {
    labelKey: "editor.underline",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+u"]],
  },
  "editor.strikethrough": {
    labelKey: "editor.strikethrough",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+Shift+s"]],
  },
  "editor.highlight": {
    labelKey: "editor.highlight",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+Shift+h"]],
  },
  "editor.subscript": {
    labelKey: "editor.subscript",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+,"]],
  },
  "editor.superscript": {
    labelKey: "editor.superscript",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+."]],
  },
  "editor.code": {
    labelKey: "editor.code",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+e"]],
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
  },
  "editor.heading2": {
    labelKey: "editor.heading2",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+Alt+2"]],
  },
  "editor.heading3": {
    labelKey: "editor.heading3",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+Alt+3"]],
  },
  "editor.bulletList": {
    labelKey: "editor.bulletList",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+Shift+8"]],
  },
  "editor.numberedList": {
    labelKey: "editor.numberedList",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+Shift+7"]],
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
  },
  "editor.alignLeft": {
    labelKey: "editor.alignLeft",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+Shift+l"]],
  },
  "editor.alignCenter": {
    labelKey: "editor.alignCenter",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+Shift+e"]],
  },
  "editor.alignRight": {
    labelKey: "editor.alignRight",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+Shift+r"]],
  },
  "editor.alignJustify": {
    labelKey: "editor.alignJustify",
    contexts: ["editor"],
    source: "editor-keymap",
    defaults: [["Mod+Shift+j"]],
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
  },

  "image.editAlt": { labelKey: "editor.imageEditAlt", contexts: ["image"], defaults: [] },
  "image.copy": { labelKey: "editor.imageCopy", contexts: ["image"], defaults: [] },
  "image.save": { labelKey: "editor.imageSave", contexts: ["image"], defaults: [] },
  "image.alignLeft": { labelKey: "editor.alignLeft", contexts: ["image"], defaults: [] },
  "image.alignCenter": { labelKey: "editor.alignCenter", contexts: ["image"], defaults: [] },
  "image.alignRight": { labelKey: "editor.alignRight", contexts: ["image"], defaults: [] },
  "image.delete": { labelKey: "common.delete", contexts: ["image"], defaults: [] },

  "noteItem.rename": { labelKey: "common.rename", contexts: ["noteItem"], defaults: [] },
  "noteItem.togglePinned": {
    labelKey: "commands.noteItem.togglePinned",
    contexts: ["noteItem"],
    defaults: [],
  },
  "noteItem.duplicate": { labelKey: "notes.duplicate", contexts: ["noteItem"], defaults: [] },
  "noteItem.delete": { labelKey: "common.delete", contexts: ["noteItem"], defaults: [] },

  "chapterItem.edit": { labelKey: "chapters.editChapter", contexts: ["chapterItem"], defaults: [] },
  "chapterItem.delete": {
    labelKey: "chapters.deleteChapter",
    contexts: ["chapterItem"],
    defaults: [],
  },

  "canvasNode.connect": { labelKey: "canvas.connectTo", contexts: ["canvasNode"], defaults: [] },
  "canvasNode.delete": { labelKey: "common.delete", contexts: ["canvasNode"], defaults: [] },

  "notes.advancedFilters": {
    labelKey: "notes.advancedFilters",
    contexts: ["notes"],
    defaults: [["Mod+Shift+f"]],
  },
  "notes.enterList": {
    labelKey: "shortcuts.enterNotesList",
    contexts: ["notes"],
    defaults: [],
    fixed: [["ArrowDown"], ["ArrowRight"], ["ArrowUp"], ["ArrowLeft"]],
    fixedReasonKey: FIXED_NAVIGATION,
    sealed: true,
  },
  "notes.newNote": { labelKey: "notes.newNote", contexts: ["notes"], defaults: [] },
  "notes.addNoteToBook": { labelKey: "notes.addNoteToBook", contexts: ["notes"], defaults: [] },
  "notes.clearFilters": { labelKey: "notes.clearFilters", contexts: ["notes"], defaults: [] },

  "canvas.toolSelect": { labelKey: "canvas.toolSelect", contexts: ["canvas"], defaults: [["v"]] },
  "canvas.toolPen": { labelKey: "canvas.toolPen", contexts: ["canvas"], defaults: [["p"]] },
  "canvas.toolEraser": { labelKey: "canvas.toolEraser", contexts: ["canvas"], defaults: [["e"]] },
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
  },
  "canvas.backToGallery": {
    labelKey: "shortcuts.backToCanvasGallery",
    contexts: ["canvas"],
    defaults: [["Alt+ArrowLeft"]],
  },
  "canvas.newCanvas": { labelKey: "canvas.newCanvas", contexts: ["canvas"], defaults: [] },

  "ephemeral.clear": { labelKey: "ephemeral.clear", contexts: ["ephemeral"], defaults: [] },
  "ephemeral.createNote": {
    labelKey: "ephemeral.createNote",
    contexts: ["ephemeral"],
    defaults: [],
  },

  "coverDesigner.duplicate": {
    labelKey: "cover.duplicate",
    contexts: ["coverDesigner"],
    defaults: [["Mod+d"]],
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
} as const satisfies Record<string, CommandDef>;

export type CommandId = keyof typeof COMMANDS;

export const COMMAND_IDS = Object.keys(COMMANDS) as CommandId[];

export function getCommand(id: CommandId): CommandDef {
  return COMMANDS[id];
}

export function isCommandId(value: string): value is CommandId {
  return Object.getOwnPropertyDescriptor(COMMANDS, value) !== undefined;
}

/**
 * The Contexts each route shows, keyed by the path in `src/App.tsx`. Global
 * is on every route and not listed. A new screen adds one line here.
 */
export const ROUTE_CONTEXTS: Readonly<Record<string, readonly ShortcutContext[]>> = {
  "/": ["bookList"],
  "/notes": ["notes", "noteItem"],
  "/notes/:noteId": ["notes", "noteItem", "editor", "image"],
  "/canvas": ["canvas"],
  "/canvas/:canvasId": ["canvas", "canvasNode", "editor"],
  "/ephemeral": ["ephemeral", "editor", "image"],
  "/metrics": [],
  "/settings": [],
  "/embed": [],
  "/book/:bookId": ["bookEditor", "chapterItem", "noteItem", "editor", "image"],
  "/book/:bookId/cover": ["coverDesigner"],
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
  { id: "editor", labelKey: "shortcuts.sections.editor", contexts: ["editor", "image"] },
] as const satisfies readonly {
  id: string;
  labelKey: string;
  contexts: readonly ShortcutContext[];
}[];

export type ShortcutSectionId = (typeof SHORTCUT_SECTIONS)[number]["id"];

/** A Shared Command lives in "common"; any other Command in its Context's section. */
export function commandSection(id: CommandId): ShortcutSectionId {
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
