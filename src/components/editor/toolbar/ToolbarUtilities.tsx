import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Settings2 } from "lucide-react";
import { Tooltip } from "@/components/ui";
import { Divider, ToolbarButton } from "@/components/editor/ToolbarButton";
import { WidthControl } from "@/components/editor/WidthControl";
import { ZoomControl } from "@/components/editor/ZoomControl";

interface ToolbarUtilityClusterProps {
  onShortcutsHelp: () => void;
  onToolbarSettings: () => void;
}

/** The Editor Toolbar's fixed buttons that open help and the Customize toolbar dialog. */
export function ToolbarUtilityCluster({
  onShortcutsHelp,
  onToolbarSettings,
}: ToolbarUtilityClusterProps) {
  const { t } = useTranslation();
  return (
    <>
      <ToolbarButton
        onClick={onShortcutsHelp}
        label={t("shortcuts.title")}
        shortcut="global.showHelp"
      >
        <span className="w-4 h-4 flex items-center justify-center font-bold">?</span>
      </ToolbarButton>
      <Divider />
      <ToolbarButton
        onClick={onToolbarSettings}
        label={t("toolbar.settings.open")}
        shortcut="editor.toolbarSettings"
      >
        <Settings2 className="w-4 h-4" />
      </ToolbarButton>
    </>
  );
}

interface ToolbarFixedUtilitiesProps {
  isExpanded: boolean;
  onToggleExpanded: () => void;
}

/** Content width, zoom and the expand toggle, which always end the Editor Toolbar. */
export function ToolbarFixedUtilities({
  isExpanded,
  onToggleExpanded,
}: ToolbarFixedUtilitiesProps) {
  const { t } = useTranslation();
  const label = isExpanded ? t("editor.hideToolbar") : t("editor.showToolbar");
  return (
    <div className="flex items-center gap-0.5">
      <WidthControl />
      <Divider />
      <ZoomControl />
      <Tooltip content={label}>
        <button
          type="button"
          onClick={onToggleExpanded}
          className="p-2 rounded hover:bg-muted transition-colors"
          aria-label={label}
        >
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </Tooltip>
    </div>
  );
}
