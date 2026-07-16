import type { Editor } from "@tiptap/react";
import { TooltipGroup } from "@/components/ui";
import { EditorToolbarGroups } from "@/components/editor/toolbar/EditorToolbarGroups";
import { deriveFloatingGroupIds } from "@/features/settings/toolbar-config";
import { useSettingsStore } from "@/features/settings/store";

interface FloatingFormattingGroupsProps {
  editor: Editor;
  onLinkClick: () => void;
}

export function FloatingFormattingGroups({ editor, onLinkClick }: FloatingFormattingGroupsProps) {
  const toolbarConfig = useSettingsStore((state) => state.toolbarConfig);
  const groupIds = deriveFloatingGroupIds(toolbarConfig);

  if (groupIds.length === 0) return null;

  return (
    <TooltipGroup>
      <EditorToolbarGroups
        editor={editor}
        groupIds={groupIds}
        iconSize="sm"
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
          openHtmlPanel: () => {},
        }}
      />
    </TooltipGroup>
  );
}
