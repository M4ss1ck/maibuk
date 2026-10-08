import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, History } from "lucide-react";
import { Button as AriaButton, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import { Tooltip } from "@/components/ui";

interface HistoryMenuButtonProps {
  onOpenPanel: () => void;
  onSaveVersion: () => void;
  saveVersionShortcut: string;
  panelShortcut: string;
}

export function HistoryMenuButton({
  onOpenPanel,
  onSaveVersion,
  saveVersionShortcut,
  panelShortcut,
}: HistoryMenuButtonProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="relative inline-flex items-center rounded-lg border border-border bg-card">
      <Tooltip content={t("versions.title")} shortcut="bookEditor.versionHistory">
        <button
          type="button"
          onClick={onOpenPanel}
          className="inline-flex h-9 w-9 items-center justify-center rounded-l-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={t("versions.openHistory")}
        >
          <History className="h-4 w-4" />
        </button>
      </Tooltip>
      <MenuTrigger isOpen={menuOpen} onOpenChange={setMenuOpen}>
        <AriaButton
          className="inline-flex h-9 w-7 items-center justify-center rounded-r-lg border-l border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={t("common.more")}
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </AriaButton>
        <Popover
          placement="bottom end"
          className="z-50 mt-1 min-w-56 rounded-lg border border-border bg-card py-1 shadow-lg focus:outline-none"
        >
          <Menu
            aria-label={t("versions.title")}
            onAction={(key) => (key === "save" ? onSaveVersion() : onOpenPanel())}
            className="outline-none"
          >
            <MenuItem
              id="save"
              data-command="bookEditor.saveVersion"
              textValue={t("versions.saveVersion")}
              className="flex w-full cursor-pointer items-center justify-between gap-3 rounded px-3 py-2 text-left text-sm text-foreground outline-none data-focused:bg-muted"
            >
              <span>{t("versions.saveVersion")}</span>
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {saveVersionShortcut}
              </kbd>
            </MenuItem>
            <MenuItem
              id="history"
              data-command="bookEditor.versionHistory"
              textValue={t("versions.showHistory")}
              className="flex w-full cursor-pointer items-center justify-between gap-3 rounded px-3 py-2 text-left text-sm text-foreground outline-none data-focused:bg-muted"
            >
              <span>{t("versions.showHistory")}</span>
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {panelShortcut}
              </kbd>
            </MenuItem>
          </Menu>
        </Popover>
      </MenuTrigger>
    </div>
  );
}
