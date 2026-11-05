import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import {
  PDF_FONT_CATALOG,
  PDF_FONT_NAME_KEYS,
  pdfFontSizeMb,
  usePdfFonts,
} from "@/features/pdf-fonts";
import { openExternal } from "@/lib/platform";

export function PdfFontsRow() {
  const { t } = useTranslation();
  const installed = usePdfFonts((state) => state.installed);
  const downloading = usePdfFonts((state) => state.downloading);
  const failed = usePdfFonts((state) => state.failed);
  const loaded = usePdfFonts((state) => state.loaded);
  const refresh = usePdfFonts((state) => state.refresh);
  const download = usePdfFonts((state) => state.download);
  const remove = usePdfFonts((state) => state.remove);

  useEffect(() => {
    if (!loaded) void refresh().catch(() => {});
  }, [loaded, refresh]);

  return (
    <div className="space-y-2">
      {PDF_FONT_CATALOG.map((font) => {
        const name = t(PDF_FONT_NAME_KEYS[font.id]);
        const isInstalled = installed.includes(font.id);
        const isDownloading = downloading.includes(font.id);
        const hasFailed = failed.includes(font.id);
        return (
          <fieldset
            key={font.id}
            aria-label={name}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"
          >
            <div className="min-w-48 flex-1">
              <div className="font-medium">{name}</div>
              <div className="text-sm text-muted-foreground">
                {t("settings.pdfFontSize", { size: pdfFontSizeMb(font) })} ·{" "}
                {t("settings.pdfFontLicense", { license: font.license })}
              </div>
              <button
                type="button"
                aria-label={t("settings.pdfFontSourceFor", { name })}
                className="text-sm font-medium text-primary underline-offset-2 hover:underline"
                onClick={() => void openExternal(font.source)}
              >
                {t("settings.pdfFontSource")}
              </button>
            </div>
            {hasFailed && (
              <p role="status" className="text-sm text-destructive">
                {t("settings.pdfFontDownloadFailed")}
              </p>
            )}
            {/* One button whose label follows the row's state, so focus stays on
                it while a download turns into Remove. */}
            <Button
              variant={isInstalled ? "ghost" : "primary"}
              size="sm"
              aria-disabled={isDownloading}
              className={isDownloading ? "cursor-not-allowed opacity-50" : ""}
              onClick={() => {
                if (isDownloading) return;
                if (isInstalled) void remove(font.id);
                else void download(font.id);
              }}
            >
              {t(
                isDownloading
                  ? "settings.pdfFontDownloading"
                  : isInstalled
                    ? "settings.pdfFontRemove"
                    : "settings.pdfFontDownload"
              )}
            </Button>
          </fieldset>
        );
      })}
    </div>
  );
}
