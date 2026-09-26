import { Button, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import { Check } from "lucide-react";
import { useTheme } from "@/features/theme";
import { useTranslation } from "react-i18next";
import { SunIcon, MoonIcon, MonitorIcon } from "@/components/icons";
import { Tooltip } from "@/components/ui";

interface ThemeToggleProps {
  variant?: "inline" | "dropdown";
}

export function ThemeToggle({ variant = "inline" }: ThemeToggleProps) {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  const themes = [
    { value: "light" as const, label: t("settings.light"), icon: SunIcon },
    { value: "dark" as const, label: t("settings.dark"), icon: MoonIcon },
    {
      value: "system" as const,
      label: t("settings.system"),
      icon: MonitorIcon,
    },
  ];

  const currentTheme = themes.find((t) => t.value === theme) || themes[0];
  const CurrentIcon = currentTheme.icon;

  // Dropdown variant - single button with a menu of themes
  if (variant === "dropdown") {
    const label = t("settings.themeDropdown", { theme: currentTheme.label });
    return (
      <MenuTrigger>
        <Tooltip content={label}>
          <Button
            className="p-2 hover:bg-muted rounded transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label={label}
          >
            <CurrentIcon className="w-5 h-5" />
          </Button>
        </Tooltip>
        <Popover
          placement="bottom end"
          className="bg-background border border-border rounded-lg shadow-lg py-1 min-w-30 z-50 dropdown-enter outline-none"
        >
          <Menu
            aria-label={label}
            selectionMode="single"
            selectedKeys={[theme]}
            onAction={(key) => setTheme(key as (typeof themes)[number]["value"])}
            className="outline-none"
          >
            {themes.map(({ value, label: themeLabel, icon: Icon }) => (
              <MenuItem
                key={value}
                id={value}
                textValue={themeLabel}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm cursor-pointer outline-none text-muted-foreground data-focused:bg-muted data-focused:text-foreground data-selected:text-foreground"
              >
                {({ isSelected }) => (
                  <>
                    <Icon className="w-4 h-4" />
                    <span className="flex-1">{themeLabel}</span>
                    <Check
                      className={`w-4 h-4 ${isSelected ? "opacity-100" : "opacity-0"}`}
                      aria-hidden="true"
                    />
                  </>
                )}
              </MenuItem>
            ))}
          </Menu>
        </Popover>
      </MenuTrigger>
    );
  }

  // Inline variant (default) - button group
  return (
    <div className="flex items-center gap-1 p-1 bg-muted rounded-lg w-fit">
      {themes.map(({ value, label, icon: Icon }) => (
        <Tooltip key={value} content={label}>
          <button
            type="button"
            onClick={() => setTheme(value)}
            className={`p-2 rounded-md transition-colors ${
              theme === value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            aria-label={label}
            aria-pressed={theme === value}
          >
            <Icon className="w-4 h-4" />
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
