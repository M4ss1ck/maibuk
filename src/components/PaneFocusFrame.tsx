import { useEffect, useRef, useState } from "react";
import { useFocusVisible } from "react-aria";
// The live modality at the moment focus moves; the hook's state can lag one
// render behind the keydown that moved it. A private export path, guarded by
// the PaneFocusFrame test like focus-commands guards its walker import.
import { isFocusVisible } from "react-aria/private/interactions/useFocusVisible";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/features/settings/store";
import { PANE_CYCLED_EVENT, PANE_SELECTOR } from "@/lib/arrow-navigation";

const SLIDE_MS = 180;
const BADGE_MS = 1500;

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function place(frame: HTMLElement, rect: DOMRect): void {
  frame.style.left = `${rect.left}px`;
  frame.style.top = `${rect.top}px`;
  frame.style.width = `${rect.width}px`;
  frame.style.height = `${rect.height}px`;
}

// The frame travels from the old Pane's outline to the new one. Two rect
// reads per Pane change, and only transform animates.
function slide(frame: HTMLElement, from: HTMLElement, to: HTMLElement): void {
  if (typeof frame.animate !== "function" || prefersReducedMotion()) return;
  const fromRect = from.getBoundingClientRect();
  const toRect = to.getBoundingClientRect();
  if (toRect.width === 0 || toRect.height === 0) return;
  place(frame, toRect);
  frame.animate(
    [
      {
        transform: `translate(${fromRect.left - toRect.left}px, ${fromRect.top - toRect.top}px) scale(${fromRect.width / toRect.width}, ${fromRect.height / toRect.height})`,
        opacity: 1,
      },
      { transform: "none", opacity: 1 },
    ],
    { duration: SLIDE_MS, easing: "ease-out" }
  );
}

interface Badge {
  /** The Pane it names; the badge goes as soon as focus leaves it. */
  pane: HTMLElement;
  name: string;
}

/**
 * Shows which Pane holds keyboard focus: a frame slides to a Pane the
 * keyboard moves into and stays over it as its ring while focus stays and the
 * modality is keyboard (the Pane carries `data-pane-active` meanwhile), and
 * F6 also names the Pane briefly. Pointer input hides the ring. Mounted once
 * beside GlobalShortcuts.
 */
export function PaneFocusFrame() {
  const { t } = useTranslation();
  const hideKeyboardHints = useSettingsStore((state) => state.hideKeyboardHints);
  const { isFocusVisible: keyboardModality } = useFocusVisible();
  const [pane, setPane] = useState<HTMLElement | null>(null);
  const [onResizeHandle, setOnResizeHandle] = useState(false);
  const [badge, setBadge] = useState<Badge | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      const next = target instanceof Element ? target.closest<HTMLElement>(PANE_SELECTOR) : null;
      const previous = paneRef.current;
      paneRef.current = next;
      // A resize handle sits on its Pane's edge, right where the ring is drawn:
      // it keeps its own focus ring alone. The Pane is still tracked, so the
      // next move slides from it.
      setPane(next);
      setOnResizeHandle(target instanceof Element && target.matches('[role="separator"]'));
      if (previous && next && previous !== next && frameRef.current && isFocusVisible()) {
        slide(frameRef.current, previous, next);
      }
    };
    const onFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget) return;
      paneRef.current = null;
      setPane(null);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  // The ring is the frame itself, kept over the active Pane: an outline on the
  // Pane would be painted over by its own children's backgrounds (a sticky
  // header hid its top edge). One observer, on the active Pane only.
  useEffect(() => {
    const frame = frameRef.current;
    if (!pane || !keyboardModality || onResizeHandle || !frame) return;
    pane.setAttribute("data-pane-active", "");
    const follow = () => place(frame, pane.getBoundingClientRect());
    follow();
    frame.style.opacity = "1";
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(follow) : null;
    observer?.observe(pane);
    window.addEventListener("resize", follow);
    return () => {
      pane.removeAttribute("data-pane-active");
      frame.style.opacity = "0";
      observer?.disconnect();
      window.removeEventListener("resize", follow);
    };
  }, [pane, keyboardModality, onResizeHandle]);

  useEffect(() => {
    if (badge && badge.pane !== pane) setBadge(null);
  }, [badge, pane]);

  useEffect(() => {
    if (hideKeyboardHints) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onCycled = (event: Event) => {
      const cycled = (event as CustomEvent<HTMLElement>).detail;
      const name = cycled?.getAttribute("aria-label");
      if (!name) return;
      setBadge({ pane: cycled, name });
      clearTimeout(timer);
      timer = setTimeout(() => setBadge(null), BADGE_MS);
    };
    document.addEventListener(PANE_CYCLED_EVENT, onCycled);
    return () => {
      document.removeEventListener(PANE_CYCLED_EVENT, onCycled);
      clearTimeout(timer);
      setBadge(null);
    };
  }, [hideKeyboardHints]);

  return (
    <>
      {/* Square-ish on purpose: it traces Pane edges, which have no radius. */}
      <div
        ref={frameRef}
        aria-hidden="true"
        // A test id because the frame is aria-hidden decoration with no name.
        data-testid="pane-frame"
        style={{ opacity: 0 }}
        className="fixed z-50 pointer-events-none rounded-sm border-2 border-primary/70 origin-top-left"
      />
      {badge && (
        // A test id because the badge is aria-hidden: screen readers already
        // hear the focused control, so it has no accessible name to query.
        // It sits in one fixed caption spot, like VoiceOver's caption panel,
        // never over the Pane's own controls where focus just landed.
        <div
          aria-hidden="true"
          data-testid="pane-badge"
          className="pane-badge-enter fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none rounded-lg bg-primary px-2 py-1 text-xs font-medium text-primary-foreground shadow-md"
        >
          {t("panes.badge", { name: badge.name })}
        </div>
      )}
    </>
  );
}
