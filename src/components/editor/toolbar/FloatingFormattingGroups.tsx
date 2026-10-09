import type { Editor } from "@tiptap/react";
import { TooltipGroup } from "@/components/ui";
import { EditorToolbarGroups } from "@/components/editor/toolbar/EditorToolbarGroups";
import { deriveFloatingGroupIds } from "@/features/settings/toolbar-config";
import { useSettingsStore } from "@/features/settings/store";
import { useToolbarRegistryRevision } from "@/hooks/useToolbarRegistryRevision";

interface FloatingFormattingGroupsProps {
  editor: Editor;
  onLinkClick: () => void;
  /** Whether a command pulls focus into the editor; the bubble says no. */
  shouldFocusEditor?: () => boolean;
}

export function FloatingFormattingGroups({
  editor,
  onLinkClick,
  shouldFocusEditor,
}: FloatingFormattingGroupsProps) {
  const toolbarConfig = useSettingsStore((state) => state.toolbarConfig);
  // Recompute entry liveness when Plugins register or unregister their buttons.
  useToolbarRegistryRevision();
  const groupIds = deriveFloatingGroupIds(toolbarConfig);

  if (groupIds.length === 0) return null;

  return (
    <TooltipGroup>
      <EditorToolbarGroups
        editor={editor}
        groupIds={groupIds}
        iconSize="sm"
        shouldFocusEditor={shouldFocusEditor}
        callbacks={{
          spellCheckLanguage: "en",
          onSpellCheckLanguageChange: () => {},
          openFindReplace: () => {},
          isFindReplaceOpen: false,
          onToggleFindReplace: () => {},
          openImageDialog: () => {},
          openFootnote: () => {},
          openLinkDialog: onLinkClick,
          openDictionary: () => {},
          openSymbols: () => {},
          openHtmlPanel: () => {},
        }}
      />
    </TooltipGroup>
  );
}
