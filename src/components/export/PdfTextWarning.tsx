/**
 * Warn before a PDF export whose text the PDF's built-in fonts cannot render
 * (issue #706): a character outside Windows-1252 comes out garbled, while the
 * EPUB and Markdown exports keep it. The check is the pure
 * `builtInFontsCanRender`; this hook only holds the export it interrupted.
 */

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { builtInFontsCanRender } from "@/features/export";

export function usePdfTextWarning() {
  const { t } = useTranslation();
  const [pending, setPending] = useState<(() => void) | null>(null);

  const guardPdfText = useCallback((text: string, run: () => void) => {
    if (builtInFontsCanRender(text)) run();
    else setPending(() => run);
  }, []);

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
              const run = pending;
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
    </Modal>
  );

  return { guardPdfText, pdfTextWarning };
}
