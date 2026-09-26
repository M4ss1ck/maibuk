import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { shift } from "@floating-ui/react";
import { useTranslation } from "react-i18next";
import type { EventData, Props as JoyrideProps, Step as JoyrideStep, TooltipRenderProps } from "react-joyride";
import { TutorialCard } from "@/components/tutorial/TutorialCard";
import { toast } from "@/components/ui/Toast";
import { useModalStore } from "@/components/ui/modal-store";
import { flushPendingEdits } from "@/features/sync/pending-edits";
import {
  cancelTutorialRequest,
  enterRequestedTutorial,
  exitTutorial,
  goToNextStep,
  goToPreviousStep,
  releaseTutorialRun,
  requestTutorial,
} from "@/features/tutorial/controller";
import {
  getSection,
  nextPosition,
  previousPosition,
  stepRoute,
} from "@/features/tutorial/sections";
import { useTutorialStore, type TutorialRun } from "@/features/tutorial/store";
import type { TutorialExitReason, TutorialOrigin } from "@/features/tutorial/types";
import { registerBackDismiss } from "@/lib/platform/backDismiss";
import { TUTORIAL_RELAUNCH_HINT_DURATION_MS } from "@/constants";
import { useShortcuts } from "@/lib/shortcuts";
import { SHORTCUTS } from "@/lib/shortcut-registry";

// Runs the Tutorial across screens (ADR 0009). React Joyride only draws the
// spotlight and places the card; the card is our React Aria dialog, and this
// runner owns navigation, pausing under Modals, Skip by Escape or the Android
// back button, and focus restore when the run ends.

/** How long a new screen gets to show a step's target before the card is centered. */
export const TUTORIAL_TARGET_WAIT_MS = 4000;
/** Joyride's own wait inside a screen before it reports a missing target. */
const JOYRIDE_TARGET_WAIT_MS = 1000;
/** The Tutorial's layer sits under Maibuk's Modals and toasts (z-50). */
const TUTORIAL_Z_INDEX = 40;
/** Where both Libraries have a screen: the switch happens with the author parked here. */
const NEUTRAL_ROUTE = "/";
/**
 * A step whose target fills most of the screen (the text, a Canvas) leaves no
 * room beside it; the card then slides over the target instead of off-screen.
 */
const KEEP_CARD_ON_SCREEN = { middleware: [shift({ crossAxis: true, padding: 16 })] };

type Phase =
  | "idle"
  | "flushing"
  | "entering"
  | "running"
  | "leaving"
  | "returning";

interface ReturnTarget {
  returnTo: string;
  origin: TutorialOrigin;
  trigger: HTMLElement | null;
  triggerKey: string | null;
  reason: TutorialExitReason | null;
}

export function tutorialTargetSelector(stepId: string): string {
  return `[data-tutorial="${stepId}"]`;
}

function pathnameOf(route: string): string {
  return new URL(route, "http://maibuk.local").pathname;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Resolves once `selector` matches, or after `timeoutMs` with false. */
function waitForElement(selector: string, timeoutMs: number, signal: AbortSignal): Promise<boolean> {
  if (document.querySelector(selector)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (found: boolean) => {
      observer.disconnect();
      clearTimeout(timer);
      resolve(found);
    };
    const observer = new MutationObserver(() => {
      if (document.querySelector(selector)) finish(true);
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    const timer = setTimeout(() => finish(false), timeoutMs);
    signal.addEventListener("abort", () => finish(false), { once: true });
  });
}

function focusElement(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  // Headings are not focusable by default; the author lands on them anyway.
  if (element.tabIndex < 0 && !element.hasAttribute("tabindex")) {
    element.setAttribute("tabindex", "-1");
  }
  element.focus();
  return document.activeElement === element;
}

async function restoreFocus(target: ReturnTarget): Promise<void> {
  await nextFrame();
  if (target.origin !== "offer" && target.trigger && focusElement(target.trigger)) return;
  if (target.origin !== "offer" && target.triggerKey) {
    const selector = `[data-tutorial-trigger="${target.triggerKey}"]`;
    const controller = new AbortController();
    if (await waitForElement(selector, 1000, controller.signal)) {
      const element = document.querySelector<HTMLElement>(selector);
      if (element && focusElement(element)) return;
    }
  }
  const heading = document.querySelector<HTMLElement>("[data-route-heading]");
  if (heading) focusElement(heading);
}

interface CardActions {
  run: TutorialRun;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}

const CardActionsContext = createContext<CardActions | null>(null);

interface StepData {
  sectionId: TutorialRun["position"]["section"];
  index: number;
}

// Defined once so Joyride never remounts the card because its component changed.
function JoyrideCard({ step }: TooltipRenderProps) {
  const { t } = useTranslation();
  const actions = useContext(CardActionsContext);
  const data = step.data as StepData | undefined;
  if (!actions || !data) return null;
  const section = getSection(data.sectionId);
  const position = { section: data.sectionId, step: data.index };
  return (
    <TutorialCard
      key={section.steps[data.index].id}
      step={section.steps[data.index]}
      sectionName={t(section.nameKey as "tutorial.sections.books")}
      stepNumber={data.index + 1}
      stepCount={section.steps.length}
      canGoBack={previousPosition(position, actions.run.only) !== null}
      isLast={nextPosition(position, actions.run.only) === null}
      onBack={actions.onBack}
      onNext={actions.onNext}
      onSkip={actions.onSkip}
    />
  );
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

export function TutorialRunner() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const status = useTutorialStore((state) => state.status);
  const run = useTutorialStore((state) => state.run);
  const modalOpen = useModalStore((state) => state.modalIds.length > 0);

  const [phase, setPhase] = useState<Phase>("idle");
  const [Joyride, setJoyride] = useState<ComponentType<JoyrideProps> | null>(null);
  const [readyRoute, setReadyRoute] = useState<string | null>(null);
  const [centered, setCentered] = useState<ReadonlySet<string>>(() => new Set());
  const returnRef = useRef<ReturnTarget | null>(null);
  const busyRef = useRef(false);
  const [portal] = useState<HTMLDivElement | null>(() =>
    typeof document === "undefined" ? null : document.createElement("div")
  );

  // Joyride deletes a portal it resolved from a selector string when it
  // unmounts, so it gets an element this runner owns (ADR 0009).
  useLayoutEffect(() => {
    if (!portal) return;
    portal.setAttribute("data-tutorial-portal", "");
    document.body.appendChild(portal);
    return () => portal.remove();
  }, [portal]);

  const finishReturn = useCallback(
    (target: ReturnTarget) => {
      releaseTutorialRun();
      setPhase("idle");
      setReadyRoute(null);
      setCentered(new Set());
      void restoreFocus(target);
      if (target.reason === "skipped") {
        toast.info(t("tutorial.relaunchHint"), { durationMs: TUTORIAL_RELAUNCH_HINT_DURATION_MS });
      }
    },
    [t]
  );

  // A run was requested: land what the open editors hold while they are
  // still on screen, so a failed save keeps the author where they were.
  useEffect(() => {
    if (status !== "entering" || phase !== "idle" || !run || busyRef.current) return;
    busyRef.current = true;
    const active = document.activeElement;
    const trigger = active instanceof HTMLElement && active !== document.body ? active : null;
    returnRef.current = {
      returnTo: run.returnTo,
      origin: run.origin,
      trigger,
      triggerKey: trigger?.closest("[data-tutorial-trigger]")?.getAttribute("data-tutorial-trigger") ?? null,
      reason: null,
    };
    setPhase("flushing");
    void import("react-joyride").then((module) => setJoyride(() => module.Joyride));
    flushPendingEdits().then(
      () => {
        busyRef.current = false;
        // Closes the soft keyboard on Android; the card takes focus next.
        (document.activeElement as HTMLElement | null)?.blur?.();
        setPhase("entering");
        navigate(NEUTRAL_ROUTE, { replace: true });
      },
      () => {
        busyRef.current = false;
        cancelTutorialRequest();
        setPhase("idle");
        toast.error(t("tutorial.startFailed"));
        if (returnRef.current) void restoreFocus(returnRef.current);
      }
    );
  }, [status, phase, run, navigate, t]);

  // The author's screens have closed: switch Libraries.
  useEffect(() => {
    if (phase !== "entering" || location.pathname !== NEUTRAL_ROUTE || busyRef.current) return;
    busyRef.current = true;
    enterRequestedTutorial().then(
      () => {
        busyRef.current = false;
        setCentered(new Set());
        setReadyRoute(null);
        setPhase("running");
      },
      () => {
        busyRef.current = false;
        toast.error(t("tutorial.startFailed"));
        const target = returnRef.current;
        if (!target) return setPhase("idle");
        setPhase("returning");
        navigate(target.returnTo, { replace: true });
      }
    );
  }, [phase, location.pathname, navigate, t]);

  const section = run ? getSection(run.position.section) : null;
  const route = section && run ? stepRoute(section, run.position.step) : null;

  // Each step is shown on its own screen; the Tutorial moves there itself.
  useEffect(() => {
    if (phase !== "running" || !route || location.pathname === route) return;
    navigate(route, { replace: true });
  }, [phase, route, location.pathname, navigate]);

  // A new screen may still be loading: wait for the step's target first.
  const currentStepId = section && run ? section.steps[run.position.step].id : null;
  useEffect(() => {
    if (phase !== "running" || !route || !currentStepId) return;
    if (location.pathname !== route || readyRoute === route) return;
    const controller = new AbortController();
    void waitForElement(
      tutorialTargetSelector(currentStepId),
      TUTORIAL_TARGET_WAIT_MS,
      controller.signal
    ).then(() => {
      if (!controller.signal.aborted) setReadyRoute(route);
    });
    return () => controller.abort();
  }, [phase, route, currentStepId, location.pathname, readyRoute]);

  const leave = useCallback(
    (reason: TutorialExitReason) => {
      if (phase !== "running" || !returnRef.current) return;
      returnRef.current.reason = reason;
      setPhase("leaving");
      navigate(NEUTRAL_ROUTE, { replace: true });
    },
    [phase, navigate]
  );

  // The Tutorial's screens have closed: switch back, then return the author.
  useEffect(() => {
    if (phase !== "leaving" || location.pathname !== NEUTRAL_ROUTE || busyRef.current) return;
    const target = returnRef.current;
    if (!target) return;
    busyRef.current = true;
    // Returning the author comes first; a failure after the switch back
    // leaves views stale, never the Tutorial Library active.
    void exitTutorial(target.reason ?? "closed")
      .catch((error) => console.error("Failed to leave the Tutorial Library:", error))
      .then(() => {
        busyRef.current = false;
        setPhase("returning");
        navigate(target.returnTo, { replace: true });
      });
  }, [phase, location.pathname, navigate]);

  useEffect(() => {
    const target = returnRef.current;
    if (phase !== "returning" || !target) return;
    if (location.pathname !== pathnameOf(target.returnTo)) return;
    returnRef.current = null;
    finishReturn(target);
  }, [phase, location.pathname, finishReturn]);

  const onNext = useCallback(() => {
    if (goToNextStep() === "finished") leave("finished");
  }, [leave]);
  const onBack = useCallback(() => goToPreviousStep(), []);
  const onSkip = useCallback(() => leave("skipped"), [leave]);

  useShortcuts([
    {
      id: "global.startTutorial",
      sequence: SHORTCUTS["global.startTutorial"].sequence,
      enabled: status === "idle",
      onTrigger: () => {
        requestTutorial({ origin: "shortcut", returnTo: location.pathname + location.search });
      },
    },
    {
      id: "tutorial.skip",
      keys: "escape",
      allowInInput: true,
      enabled: phase === "running",
      onTrigger: onSkip,
    },
  ]);

  // The Android back button Skips, like it dismisses every other overlay.
  useEffect(() => {
    if (phase !== "running") return;
    return registerBackDismiss(() => {
      onSkip();
      return true;
    });
  }, [phase, onSkip]);

  const cardActions = useMemo<CardActions | null>(
    () => (run ? { run, onBack, onNext, onSkip } : null),
    [run, onBack, onNext, onSkip]
  );

  const joyrideSteps = useMemo<JoyrideStep[]>(() => {
    if (!section || !route) return [];
    return section.steps.flatMap((step, index): JoyrideStep[] => {
      if (stepRoute(section, index) !== route) return [];
      const missing = centered.has(step.id);
      return [
        {
          id: step.id,
          target: missing ? "body" : tutorialTargetSelector(step.id),
          placement: missing ? "center" : "auto",
          content: null,
          data: { sectionId: section.id, index } satisfies StepData,
        },
      ];
    });
  }, [section, route, centered]);

  const handleEvent = useCallback((data: EventData) => {
    // A control this screen does not show right now (a collapsed sidebar, an
    // overflow menu): the same card, centered, without a highlight.
    if (data.type === "error:target_not_found" && data.step?.id) {
      const id = String(data.step.id);
      setCentered((previous) => new Set(previous).add(id));
    }
  }, []);

  if (phase === "idle" || !Joyride || !run || !section || !route || !cardActions) return null;
  if (phase !== "running") return null;

  const stepIndex = joyrideSteps.findIndex((step) => step.id === currentStepId);
  const reducedMotion = prefersReducedMotion();

  return (
    <CardActionsContext.Provider value={cardActions}>
      <Joyride
        key={`${section.id}|${route}|${[...centered].join(",")}`}
        run={readyRoute === route && location.pathname === route && !modalOpen}
        stepIndex={Math.max(stepIndex, 0)}
        steps={joyrideSteps}
        continuous
        onEvent={handleEvent}
        tooltipComponent={JoyrideCard}
        loaderComponent={null}
        floatingOptions={KEEP_CARD_ON_SCREEN}
        portalElement={portal ?? undefined}
        options={{
          skipBeacon: true,
          disableFocusTrap: true,
          dismissKeyAction: false,
          overlayClickAction: false,
          blockTargetInteraction: true,
          zIndex: TUTORIAL_Z_INDEX,
          targetWaitTimeout: JOYRIDE_TARGET_WAIT_MS,
          // Joyride skips scrolling entirely at 0 ms (measured: Settings targets
          // stayed below the fold), so reduced motion gets an instant 1 ms jump.
          scrollDuration: reducedMotion ? 1 : 300,
          overlayColor: "rgb(0 0 0 / 0.45)",
          spotlightRadius: 8,
          buttons: [],
        }}
      />
    </CardActionsContext.Provider>
  );
}

/**
 * While a run is under way the app beneath the Tutorial is inert: no pointer,
 * no Tab, no screen reader. The card and any Modal live outside it.
 */
export function TutorialBoundary({ children }: { children: ReactNode }) {
  const active = useTutorialStore((state) => state.status !== "idle");
  return (
    <div className="contents" inert={active || undefined} data-tutorial-boundary="">
      {children}
    </div>
  );
}
