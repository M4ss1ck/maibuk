import type { SettingsSectionDef } from "@/features/settings/rows";

export const EDITOR_SECTION = {
  id: "editor",
  labelKey: "settings.editor",
  rows: [
    {
      id: "spellCheck",
      labelKey: "settings.spellCheck",
      descriptionKey: "settings.spellCheckDescription",
      keywordsKey: "settings.keywords.spellCheck",
    },
    {
      id: "dictionaryOpenInBrowser",
      labelKey: "settings.dictionaryOpenInBrowser",
      descriptionKey: "settings.dictionaryOpenInBrowserDescription",
    },
    {
      id: "customDictionary",
      labelKey: "settings.customDictionary",
      descriptionKey: "settings.customDictionaryDescription",
    },
    {
      id: "showInlineFootnotes",
      labelKey: "settings.showInlineFootnotes",
      descriptionKey: "settings.showInlineFootnotesDescription",
    },
    {
      id: "showNotesChapter",
      labelKey: "settings.showNotesChapter",
      descriptionKey: "settings.showNotesChapterDescription",
    },
    {
      id: "hideKeyboardHints",
      labelKey: "settings.hideKeyboardHints",
      descriptionKey: "settings.hideKeyboardHintsDescription",
    },
    {
      id: "editorAutoClose",
      labelKey: "settings.editorAutoClose",
      descriptionKey: "settings.editorAutoCloseDescription",
    },
    {
      id: "pasteCleanupPreset",
      labelKey: "settings.pasteCleanup.preset.label",
      descriptionKey: "settings.pasteCleanup.preset.description",
      keywordsKey: "settings.keywords.pasteCleanupPreset",
    },
    {
      id: "pasteCleanupPromptMarkdown",
      labelKey: "settings.pasteCleanup.promptMarkdownLabel",
      descriptionKey: "settings.pasteCleanup.promptMarkdownDescription",
    },
    {
      id: "pasteCleanupAdvanced",
      labelKey: "settings.pasteCleanup.advanced",
      descriptionKey: "settings.pasteCleanup.description",
      reveal: { kind: "pasteCleanupAdvanced" },
    },
    {
      id: "pasteCleanupRules",
      labelKey: "settings.pasteCleanup.rules.title",
      descriptionKey: "settings.pasteCleanup.rules.description",
      reveal: { kind: "pasteCleanupAdvanced" },
    },
  ],
} as const satisfies SettingsSectionDef;
