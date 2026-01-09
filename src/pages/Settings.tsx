import { useTheme } from "../features/theme";
import {
  useSettings,
  FONT_SIZE_OPTIONS,
  FONT_OPTIONS,
  EXPORT_FORMAT_OPTIONS,
  type FontSize,
  type FontFamily,
  type ExportFormat,
} from "../features/settings";
import { Select, Switch } from "../components/ui";

export function Settings() {
  const { theme, setTheme } = useTheme();
  const {
    appFontSize,
    appFont,
    autoSave,
    defaultExportFormat,
    setAppFontSize,
    setAppFont,
    setAutoSave,
    setDefaultExportFormat,
  } = useSettings();

  return (
    <div className="p-8 max-w-2xl">
      <h2 className="text-2xl font-semibold mb-8">Settings</h2>

      {/* Appearance Settings */}
      <section className="mb-8">
        <h3 className="text-lg font-medium mb-4">Appearance</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="font-medium">Theme</p>
              <p className="text-sm text-muted-foreground">Choose your preferred theme</p>
            </div>
            <div className="flex items-center gap-1 p-1 bg-muted rounded-lg">
              <button
                onClick={() => setTheme("light")}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${theme === "light"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
                  }`}
              >
                Light
              </button>
              <button
                onClick={() => setTheme("dark")}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${theme === "dark"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
                  }`}
              >
                Dark
              </button>
              <button
                onClick={() => setTheme("system")}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${theme === "system"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
                  }`}
              >
                System
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between py-2">
            <div>
              <p className="font-medium">Font Size</p>
              <p className="text-sm text-muted-foreground">Adjust the app text size</p>
            </div>
            <Select<FontSize>
              value={appFontSize}
              onChange={setAppFontSize}
              options={FONT_SIZE_OPTIONS}
            />
          </div>

          <div className="flex items-center justify-between py-2">
            <div>
              <p className="font-medium">Font</p>
              <p className="text-sm text-muted-foreground">Choose the app font</p>
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
        <h3 className="text-lg font-medium mb-4">General</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="font-medium">Auto-save</p>
              <p className="text-sm text-muted-foreground">Automatically save your work</p>
            </div>
            <Switch
              checked={autoSave}
              onChange={setAutoSave}
              label="Toggle auto-save"
            />
          </div>
        </div>
      </section>

      {/* Export Settings */}
      <section className="mb-8">
        <h3 className="text-lg font-medium mb-4">Export Defaults</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="font-medium">Default Format</p>
              <p className="text-sm text-muted-foreground">Preferred export format</p>
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
        <h3 className="text-lg font-medium mb-4">About</h3>
        <div className="text-sm text-muted-foreground">
          <p>Maibuk v0.1.1</p>
          <p className="mt-1">A cross-platform writing app for authors</p>
        </div>
      </section>
    </div>
  );
}
