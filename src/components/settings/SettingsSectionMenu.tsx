import { useTranslation } from "react-i18next";
import {
  Button as AriaButton,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  type Key,
} from "react-aria-components";
import { Check, ChevronDown } from "lucide-react";
import { SETTINGS_SECTIONS } from "@/components/settings/settings-sections";
import type { SettingsSectionId } from "@/components/settings/SettingsSection";

interface SettingsSectionMenuProps {
  present: readonly SettingsSectionId[];
  current: string | null;
  /** 0 to 1, how far down the Settings page is scrolled. */
  progress: number;
  onJump: (section: SettingsSectionId) => void;
}

/**
 * The outline on a narrow screen: a sticky "Settings / Section" bar whose
 * section name opens a menu of every section. It never reuses the main
 * navigation's menu button.
 */
export function SettingsSectionMenu({
  present,
  current,
  progress,
  onJump,
}: SettingsSectionMenuProps) {
  const { t } = useTranslation();
  const translate = t as unknown as (key: string) => string;
  const label = (id: string | null) => {
    const section = SETTINGS_SECTIONS.find((candidate) => candidate.id === id);
    return section ? translate(section.labelKey) : "";
  };

  // The Menu returns focus to its trigger as it closes; jump after that so
  // focus lands on the section heading.
  const onAction = (key: Key) =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => onJump(String(key) as SettingsSectionId))
    );

  return (
    <div className="@min-[58rem]:hidden sticky top-0 z-20 bg-background/90 backdrop-blur border-b border-border">
      <div className="flex items-center gap-1 px-4 h-11 text-sm">
        <span className="text-muted-foreground">{t("settings.title")}</span>
        <span className="text-muted-foreground" aria-hidden="true">
          /
        </span>
        <MenuTrigger>
          <AriaButton
            aria-label={t("settings.outline.jumpTo", { section: label(current) })}
            className="flex min-w-0 items-center gap-1 rounded-lg px-2 py-1 font-medium outline-none hover:bg-muted/10 data-[focus-visible]:ring-2 data-[focus-visible]:ring-primary"
          >
            <span className="truncate">{label(current)}</span>
            <ChevronDown className="w-4 h-4 shrink-0" aria-hidden="true" />
          </AriaButton>
          <Popover
            placement="bottom start"
            className="w-64 max-h-[60vh] overflow-auto scrollbar-themed rounded-lg border border-border bg-card shadow-lg"
          >
            <Menu
              aria-label={t("settings.outline.label")}
              onAction={onAction}
              className="p-1 outline-none"
            >
              {present.map((id) => (
                <MenuItem
                  key={id}
                  id={id}
                  textValue={label(id)}
                  data-command-exempt="moves within the Settings page; the Command Palette already finds every Settings row"
                  className="flex items-center justify-between rounded px-3 py-2 text-sm outline-none cursor-default data-[focused]:bg-muted/15"
                >
                  {label(id)}
                  {id === current && <Check className="w-4 h-4 text-primary" aria-hidden="true" />}
                </MenuItem>
              ))}
            </Menu>
          </Popover>
        </MenuTrigger>
      </div>
      <div
        aria-hidden="true"
        className="h-0.5 bg-primary origin-left"
        style={{ transform: `scaleX(${progress})` }}
      />
    </div>
  );
}
