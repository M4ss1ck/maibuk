import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { TUTORIAL_RELAUNCH_HINT_DURATION_MS } from "@/constants";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toast";
import { useModalStore } from "@/components/ui/modal-store";
import { useSettingsStore } from "@/features/settings/store";
import { useSyncStore } from "@/features/sync/store";
import { hasLaunchAutoSyncSettled, onLaunchAutoSyncSettled } from "@/features/sync/auto-sync";
import {
  authorLibraryIsEmpty,
  decideTutorialOffer,
  requestTutorial,
  type TutorialOffer as TutorialOfferDecision,
} from "@/features/tutorial/controller";
import { getSection } from "@/features/tutorial/sections";
import { useTutorialStore } from "@/features/tutorial/store";


function focusRouteHeading(): void {
  requestAnimationFrame(() => {
    const heading = document.querySelector<HTMLElement>("[data-route-heading]");
    if (!heading) return;
    if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
    heading.focus();
  });
}

/**
 * The first-launch offer: once per launch, after StartupRedirect has restored
 * the author's place (this renders inside it), once launch Auto Sync has
 * settled and nothing else is open or syncing.
 */
export function TutorialOffer() {
  const { t } = useTranslation();
  const location = useLocation();
  const status = useTutorialStore((state) => state.status);
  const modalOpen = useModalStore((state) => state.modalIds.length > 0);
  const syncing = useSyncStore((state) => state.syncStatus === "syncing");
  // Re-read on each render: signing in or turning Auto Sync on changes the answer.
  useSyncStore((state) => state.authStatus);
  useSettingsStore((state) => state.autoSync);
  const [launchRunSettled, setLaunchRunSettled] = useState(false);
  const settled = launchRunSettled || hasLaunchAutoSyncSettled();
  const [offer, setOffer] = useState<TutorialOfferDecision | null>(null);
  const decidedRef = useRef(false);

  useEffect(() => onLaunchAutoSyncSettled(() => setLaunchRunSettled(true)), []);

  useEffect(() => {
    if (decidedRef.current || !settled || status !== "idle" || modalOpen || syncing) return;
    decidedRef.current = true;
    void authorLibraryIsEmpty()
      .then((empty) => setOffer(decideTutorialOffer(empty)))
      .catch(() => {});
  }, [settled, status, modalOpen, syncing]);

  if (!offer) return null;

  const isContinue = offer.kind === "continue";

  const start = () => {
    setOffer(null);
    requestTutorial({
      origin: "offer",
      returnTo: location.pathname + location.search,
      resumeAt: isContinue ? offer.position : null,
    });
  };

  const notNow = () => {
    setOffer(null);
    useTutorialStore.getState().dismiss();
    toast.info(t("tutorial.relaunchHint"), { durationMs: TUTORIAL_RELAUNCH_HINT_DURATION_MS });
    focusRouteHeading();
  };

  return (
    <Modal
      isOpen
      onClose={notNow}
      title={isContinue ? t("tutorial.offer.continueTitle") : t("tutorial.offer.title")}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={notNow}>
            {t("tutorial.offer.notNow")}
          </Button>
          <Button type="button" onClick={start}>
            {isContinue ? t("tutorial.offer.continue") : t("tutorial.offer.start")}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-foreground">
        {isContinue
          ? t("tutorial.offer.continueBody", {
              section: t(getSection(offer.position.section).nameKey as "tutorial.sections.books"),
            })
          : t("tutorial.offer.body")}
      </p>
      <p className="mt-3 text-xs text-muted-foreground">{t("tutorial.relaunchHint")}</p>
    </Modal>
  );
}
