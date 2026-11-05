/**
 * Guards a PDF export whose text the built-in fonts cannot render: the author
 * either downloads a PDF font that covers the text, exports anyway, or cancels.
 * The EPUB and Markdown exports keep every character regardless.
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toast";
import { builtInFontsCanRender } from "@/features/export";
import {
  PDF_FONT_NAME_KEYS,
  pdfFontPlan,
  pdfFontSizeMb,
  type PdfFont,
  type PdfFontId,
  usePdfFonts,
} from "@/features/pdf-fonts";
import { useShortcuts } from "@/lib/shortcuts";

type PendingExport = { text: string; run: () => void };

export function usePdfTextWarning() {
  const { t } = useTranslation();
  const [pending, setPending] = useState<PendingExport | null>(null);
  const installed = usePdfFonts((state) => state.installed);
  const downloading = usePdfFonts((state) => state.downloading);
  const failed = usePdfFonts((state) => state.failed);

  const guardPdfText = useCallback((text: string, run: () => void) => {
    if (builtInFontsCanRender(text)) {
      run();
      return;
    }
    void (async () => {
      // The files are the truth: read them even when the store thinks they are
      // installed, so web storage eviction cannot skip the warning.
      try {
        await usePdfFonts.getState().refresh();
      } catch {
        // Storage that cannot answer counts as nothing installed.
      }
      if (pdfFontPlan(text, usePdfFonts.getState().installed).missing) {
        setPending({ text, run });
      } else {
        run();
      }
    })();
  }, []);

  const plan = pending === null ? null : pdfFontPlan(pending.text, installed);

  const downloadFont = useCallback(
    (id: PdfFontId, announce = false) => {
      const store = usePdfFonts.getState();
      if (store.installed.includes(id) || store.downloading.includes(id)) return;
      if (!announce) {
        void store.download(id);
        return;
      }
      toast.info(t("export.downloadPdfFontDownloading", { name: t(PDF_FONT_NAME_KEYS[id]) }));
      void store.download(id).then(() => {
        if (usePdfFonts.getState().installed.includes(id)) {
          toast.success(t("export.downloadPdfFontInstalled"));
        } else {
          toast.error(t("settings.pdfFontDownloadFailed"));
        }
      });
    },
    [t]
  );

  useShortcuts([
    { id: "export.downloadPdfFontLatin", onTrigger: () => downloadFont("latin", true) },
    { id: "export.downloadPdfFontCjk", onTrigger: () => downloadFont("cjk", true) },
  ]);

  useEffect(() => {
    if (pending === null || pdfFontPlan(pending.text, installed).missing) return;
    setPending(null);
    pending.run();
  }, [pending, installed]);

  function offerButton(font: PdfFont) {
    const isDownloading = downloading.includes(font.id);
    const hasFailed = failed.includes(font.id);
    return (
      <div key={font.id} className="mt-3 flex flex-wrap items-center gap-3">
        {/* One button whose label follows the row's state, so focus stays on
            it while the download runs. */}
        <Button
          variant="secondary"
          size="sm"
          aria-disabled={isDownloading}
          className={isDownloading ? "cursor-not-allowed opacity-50" : ""}
          onClick={() => {
            if (!isDownloading) downloadFont(font.id);
          }}
        >
          {t(
            isDownloading ? "export.pdfTextWarning.downloading" : "export.pdfTextWarning.download",
            {
              name: t(PDF_FONT_NAME_KEYS[font.id]),
              size: pdfFontSizeMb(font),
            }
          )}
        </Button>
        {hasFailed && (
          <p role="status" className="text-sm text-destructive">
            {t("export.pdfTextWarning.downloadFailed")}
          </p>
        )}
      </div>
    );
  }

  const pdfTextWarning = (
    <Modal
      isOpen={pending !== null}
      onClose={() => setPending(null)}
      title={t("export.pdfTextWarning.title")}
      role="alertdialog"
      footer={
        <>
          <Button variant="secondary" onClick={() => setPending(null)}>
            {t("export.pdfTextWarning.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              const run = pending?.run;
              setPending(null);
              run?.();
            }}
          >
            {t("export.pdfTextWarning.continue")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">{t("export.pdfTextWarning.body")}</p>
      {plan !== null && plan.offers.length > 0 && (
        <p className="mt-2 text-sm text-muted-foreground">
          {t("export.pdfTextWarning.downloadBody")}
        </p>
      )}
      {plan?.offers.map(offerButton)}
    </Modal>
  );

  return { guardPdfText, pdfTextWarning };
}
