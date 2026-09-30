import { useEffect, useState } from "react";
import { useClickChoicesStore } from "@/lib/click-by-name";

interface BadgePosition {
  index: number;
  top: number;
  left: number;
}

/**
 * The numbered badges Click by Name shows when several controls share one
 * name. Mounted once in the app shell beside the Dictation live region; each
 * badge is plain digits at its choice's top-left, above overlays, and never
 * interactive.
 */
export function ClickBadges() {
  const choices = useClickChoicesStore((state) => state.choices);
  const [positions, setPositions] = useState<BadgePosition[]>([]);

  useEffect(() => {
    if (choices.length === 0) {
      setPositions([]);
      return;
    }
    const update = () => {
      setPositions(
        choices.map((el, index) => {
          const rect = el.getBoundingClientRect();
          return { index, top: rect.top, left: rect.left };
        })
      );
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [choices]);

  if (choices.length === 0) return null;

  return (
    <>
      {positions.map((position) => (
        <span
          key={position.index}
          aria-hidden="true"
          style={{ top: position.top, left: position.left, position: "fixed" }}
          className="pointer-events-none z-[100] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-primary px-1.5 py-0.5 font-sans text-xs font-bold tabular-nums text-primary-foreground shadow-lg ring-1 ring-black/20"
        >
          {position.index + 1}
        </span>
      ))}
    </>
  );
}
