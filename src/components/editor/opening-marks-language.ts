import { useCallback, useRef } from "react";

import { useSettingsStore } from "@/features/settings/store";

/**
 * The `openingMarksLanguage` getter for `createRichTextExtensions`: the
 * editor's text language while Opening Marks are on, else null. It keeps one
 * identity and reads both values per keystroke, so turning the setting on or
 * changing a Book's language applies without re-creating the editor.
 */
export function useOpeningMarksLanguage(language: string): () => string | null {
  const languageRef = useRef(language);
  languageRef.current = language;
  return useCallback(
    () => (useSettingsStore.getState().editorOpeningMarks ? languageRef.current : null),
    []
  );
}
