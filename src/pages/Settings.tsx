import { useTheme } from "../features/theme";
import {
  useSettings,
  FONT_SIZE_OPTIONS,
  FONT_OPTIONS,
  EXPORT_FORMAT_OPTIONS,
  LANGUAGE_OPTIONS,
  type FontSize,
  type FontFamily,
  type ExportFormat,
  type Language,
} from "../features/settings";
import { Select, Switch } from "../components/ui";
import { APP_VERSION } from "../constants";
import { useTranslation } from "react-i18next";

export function Settings() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const {
    appFontSize,
    appFont,
    autoSave,
    language,
    defaultExportFormat,
    setAppFontSize,
    setAppFont,
    setAutoSave,
    setLanguage,
    setDefaultExportFormat,
  } = useSettings();

  return (
    <div className="p-8 max-w-2xl">
      <h2 className="text-2xl font-semibold mb-8">{t("settings.title")}</h2>

      {/* Appearance Settings */}
      <section className="mb-8">
        <h3 className="text-lg font-medium mb-4">{t("settings.appearance")}</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="font-medium">{t("settings.theme")}</p>
              <p className="text-sm text-muted-foreground">{t("settings.themeDescription")}</p>
            </div>
            <div className="flex items-center gap-1 p-1 bg-muted rounded-lg">
              <button
                onClick={() => setTheme("light")}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${theme === "light"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
                  }`}
              >
                {t("settings.light")}
              </button>
              <button
                onClick={() => setTheme("dark")}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${theme === "dark"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
                  }`}
              >
                {t("settings.dark")}
              </button>
              <button
                onClick={() => setTheme("system")}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${theme === "system"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
                  }`}
              >
                {t("settings.system")}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between py-2">
            <div>
              <p className="font-medium">{t("settings.fontSize")}</p>
              <p className="text-sm text-muted-foreground">{t("settings.fontSizeDescription")}</p>
            </div>
            <Select<FontSize>
              value={appFontSize}
              onChange={setAppFontSize}
              options={FONT_SIZE_OPTIONS}
            />
          </div>

          <div className="flex items-center justify-between py-2">
            <div>
              <p className="font-medium">{t("settings.font")}</p>
              <p className="text-sm text-muted-foreground">{t("settings.fontDescription")}</p>
            </div>
            <Select<FontFamily>
              value={appFont}
              onChange={setAppFont}
              options={FONT_OPTIONS}
            />
          </div>
        </div>
      </section>

      {/* General Settings */}
      <section className="mb-8">
        <h3 className="text-lg font-medium mb-4">{t("settings.general")}</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="font-medium">{t("settings.autoSave")}</p>
              <p className="text-sm text-muted-foreground">{t("settings.autoSaveDescription")}</p>
            </div>
            <Switch
              checked={autoSave}
              onChange={setAutoSave}
              label={t("settings.toggleAutoSave")}
            />
          </div>

          <div className="flex items-center justify-between py-2">
            <div>
              <p className="font-medium">{t("settings.language")}</p>
              <p className="text-sm text-muted-foreground">{t("settings.languageDescription")}</p>
            </div>
            <Select<Language>
              value={language}
              onChange={setLanguage}
              options={LANGUAGE_OPTIONS}
            />
          </div>
        </div>
      </section>

      {/* Export Settings */}
      <section className="mb-8">
        <h3 className="text-lg font-medium mb-4">{t("settings.export")}</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="font-medium">{t("settings.defaultFormat")}</p>
              <p className="text-sm text-muted-foreground">{t("settings.defaultFormatDescription")}</p>
            </div>
            <Select<ExportFormat>
              value={defaultExportFormat}
              onChange={setDefaultExportFormat}
              options={EXPORT_FORMAT_OPTIONS}
            />
          </div>
        </div>
      </section>

      {/* About */}
      <section>
        <h3 className="text-lg font-medium mb-4">{t("settings.about")}</h3>
        <div className="text-sm text-muted-foreground">
          <p>Maibuk {APP_VERSION}</p>
          <p className="mt-1">{t("app.description")}</p>
        </div>
      </section>
    </div>
  );
}
