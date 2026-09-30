import { useTranslation } from "react-i18next";
import { ArrowDown, Mic } from "lucide-react";
import type { TutorialIllustrationId } from "@/features/tutorial/types";

/**
 * A Tutorial card's illustration, drawn by the card from app tokens and i18n,
 * so it follows theme and locale. Only "dictation" exists today: the Dictation
 * button listening while the author speaks, and the line it writes.
 */
export function TutorialIllustration({ id }: { id: TutorialIllustrationId }) {
  const { t } = useTranslation();
  if (id !== "dictation") return null;
  return (
    <div
      role="img"
      aria-label={t("tutorial.illustrations.dictation.label")}
      className="max-h-40 w-full rounded-md border border-border bg-background p-3"
    >
      <div aria-hidden="true" className="flex w-full flex-col items-center gap-2">
        <div className="flex w-full items-center gap-2">
          <span className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Mic className="h-4 w-4" />
            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-destructive motion-safe:animate-pulse" />
          </span>
          <span className="min-w-0 flex-1 rounded-lg bg-muted/20 px-2 py-1 text-sm text-muted-foreground italic">
            “{t("tutorial.illustrations.dictation.spoken")}”
          </span>
        </div>
        <ArrowDown className="h-4 w-4 text-primary" />
        <p className="font-serif text-base text-foreground">
          {t("tutorial.illustrations.dictation.written")}
        </p>
      </div>
    </div>
  );
}
