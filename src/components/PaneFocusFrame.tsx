import { useEffect, useRef, useState } from "react";
import { useFocusVisible } from "react-aria";
// The live modality at the moment focus moves; the hook's state can lag one
// render behind the keydown that moved it. A private export path, guarded by
// the PaneFocusFrame test like focus-commands guards its walker import.
import { isFocusVisible } from "react-aria/private/interactions/useFocusVisible";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/features/settings/store";
import { PANE_CYCLED_EVENT } from "@/lib/arrow-navigation";

const PANE = "[data-focus-pane]";
const SLIDE_MS = 180;
const BADGE_MS = 1500;

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

// One frame travels from the old Pane's outline to the new one. Two rect
// reads per Pane change, and only transform and opacity animate.
function slide(frame: HTMLElement, from: HTMLElement, to: HTMLElement): void {
  if (typeof frame.animate !== "function" || prefersReducedMotion()) return;
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  if (b.width === 0 || b.height === 0) return;
  frame.style.left = `${b.left}px`;
  frame.style.top = `${b.top}px`;
  frame.style.width = `${b.width}px`;
  frame.style.height = `${b.height}px`;
  frame.animate(
    [
      {
        transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})`,
        opacity: 1,
      },
      { transform: "none", opacity: 1, offset: 0.8 },
      { transform: "none", opacity: 0 },
    ],
    { duration: SLIDE_MS, easing: "ease-out" }
  );
}

interface Badge {
  name: string;
  top: number;
  left: number;
}

/**
 * Shows which Pane holds keyboard focus: a frame slides to a Pane the
 * keyboard moves into, the Pane then keeps a ring (`data-pane-active`) while
 * focus stays and the modality is keyboard, and F6 also names the Pane
 * briefly. Pointer input hides the ring. Mounted once beside GlobalShortcuts.
 */
export function PaneFocusFrame() {
  const { t } = useTranslation();
  const hideKeyboardHints = useSettingsStore((state) => state.hideKeyboardHints);
  const { isFocusVisible: keyboard } = useFocusVisible();
  const [pane, setPane] = useState<HTMLElement | null>(null);
  const [badge, setBadge] = useState<Badge | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      const next = target instanceof Element ? target.closest<HTMLElement>(PANE) : null;
      const previous = paneRef.current;
      paneRef.current = next;
      setPane(next);
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

  useEffect(() => {
    if (!pane || !keyboard) return;
    pane.setAttribute("data-pane-active", "");
    return () => pane.removeAttribute("data-pane-active");
  }, [pane, keyboard]);

  useEffect(() => {
    if (hideKeyboardHints) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onCycled = (event: Event) => {
      const cycled = (event as CustomEvent<HTMLElement>).detail;
      const name = cycled?.getAttribute("aria-label");
      if (!name) return;
      const rect = cycled.getBoundingClientRect();
      setBadge({ name, top: rect.top + 8, left: rect.left + 8 });
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
      <div
        ref={frameRef}
        aria-hidden="true"
        className="fixed z-50 pointer-events-none rounded-sm border-2 border-primary opacity-0 origin-top-left"
      />
      {badge && (
        <div
          aria-hidden="true"
          data-testid="pane-badge"
          className="pane-badge-enter fixed z-50 pointer-events-none rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground shadow-md"
          style={{ top: badge.top, left: badge.left }}
        >
          {t("panes.badge", { name: badge.name })}
        </div>
      )}
    </>
  );
}
