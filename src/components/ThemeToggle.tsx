import { useState, useRef, useEffect } from "react";
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
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Dropdown variant - single button with menu
  if (variant === "dropdown") {
    return (
      <div className="relative" ref={dropdownRef}>
        <Tooltip content={`Theme: ${currentTheme.label}`}>
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="p-2 hover:bg-muted rounded transition-colors"
            aria-label={`Theme: ${currentTheme.label}`}
          >
            <CurrentIcon className="w-5 h-5" />
          </button>
        </Tooltip>

        {isOpen && (
          <div className="absolute right-0 top-full mt-1 bg-background border border-border rounded-lg shadow-lg py-1 min-w-30 z-50 dropdown-enter">
            {themes.map(({ value, label, icon: Icon }) => (
              <button
                type="button"
                key={value}
                onClick={() => {
                  setTheme(value);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                  theme === value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
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
          >
            <Icon className="w-4 h-4" />
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
