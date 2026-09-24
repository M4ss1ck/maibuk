import { useId, useLayoutEffect, useRef } from "react";
import { FocusScope } from "react-aria";
import { Dialog, Heading } from "react-aria-components";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { TutorialStep } from "@/features/tutorial/types";

export interface TutorialCardProps {
  step: TutorialStep;
  sectionName: string;
  /** 1-based position inside the section. */
  stepNumber: number;
  stepCount: number;
  canGoBack: boolean;
  /** The last step of the whole run: Next reads Finish. */
  isLast: boolean;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}

/**
 * One Tutorial step (ADR 0009): a React Aria dialog that takes focus when it
 * mounts and keeps Tab inside its own controls. Joyride only positions it.
 */
export function TutorialCard({
  step,
  sectionName,
  stepNumber,
  stepCount,
  canGoBack,
  isLast,
  onBack,
  onNext,
  onSkip,
}: TutorialCardProps) {
  const { t } = useTranslation();
  const bodyId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  // React Aria focuses a new dialog only after every CSS transition on the
  // page ends (measured 300-500 ms between steps in Chromium), leaving focus
  // on <body> meanwhile. The card mounts once per step, so it claims focus
  // at once, on Next, so Enter or Space walks through the steps; FocusScope
  // still keeps Tab inside it.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.contains(document.activeElement)) return;
    (nextRef.current ?? dialog).focus({ preventScroll: true });
  }, []);
  // Step keys are composed from the step id; the locale parity test proves they exist.
  const translate = t as unknown as (key: string) => string;

  return (
    <FocusScope contain autoFocus restoreFocus={false}>
      <Dialog
        ref={dialogRef}
        aria-describedby={bodyId}
        data-tutorial-card=""
        className="tutorial-card w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-border bg-card p-4 text-foreground shadow-xl outline-none"
      >
        <p className="mb-1 flex items-center justify-between gap-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <span className="text-primary">{sectionName}</span>
          <span>{t("tutorial.card.progress", { current: stepNumber, total: stepCount })}</span>
        </p>
        <Heading slot="title" className="text-lg font-semibold tracking-tight">
          {translate(step.titleKey)}
        </Heading>
        {step.image && (
          <img
            src={step.image.src}
            alt={translate(step.image.altKey)}
            className="mt-3 max-h-40 w-full rounded-md border border-border object-contain"
          />
        )}
        <p id={bodyId} className="mt-2 text-sm leading-relaxed text-foreground/90">
          {translate(step.bodyKey)}
        </p>
        {step.link && (
          <a
            href={step.link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-sm text-primary underline-offset-2 hover:underline"
          >
            {translate(step.link.labelKey)}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        )}
        <div className="mt-4 flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onSkip}>
            {t("tutorial.card.skip")}
          </Button>
          <span className="flex-1" />
          {canGoBack && (
            <Button type="button" variant="secondary" size="sm" onClick={onBack}>
              {t("tutorial.card.back")}
            </Button>
          )}
          <Button ref={nextRef} type="button" size="sm" onClick={onNext}>
            {isLast ? t("tutorial.card.finish") : t("tutorial.card.next")}
          </Button>
        </div>
      </Dialog>
    </FocusScope>
  );
}
