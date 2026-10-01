// PROTOTYPE: throwaway variant switcher. Never merge to main.
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface PrototypeSwitcherProps {
  variants: readonly { key: string; name: string }[];
  current: string;
}

const ARROW_OWNERS =
  'input, textarea, select, [contenteditable="true"], [role="slider"], [role="radio"], [role="tab"], [role="menuitem"], [role="option"], [role="row"], [role="gridcell"]';

export function PrototypeSwitcher({ variants, current }: PrototypeSwitcherProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const index = Math.max(
    0,
    variants.findIndex((variant) => variant.key === current)
  );

  const go = (delta: number) => {
    const next = variants[(index + delta + variants.length) % variants.length];
    const params = new URLSearchParams(location.search);
    params.set("variant", next.key);
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.(ARROW_OWNERS)) return;
      event.preventDefault();
      go(event.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!import.meta.env.DEV) return null;

  const active = variants[index];
  return (
    <div
      data-command-exempt="prototype switcher"
      className="fixed bottom-3 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-1 rounded-full bg-black text-white px-1.5 py-1 shadow-2xl ring-2 ring-fuchsia-500 font-mono text-xs"
    >
      <button
        type="button"
        onClick={() => go(-1)}
        aria-label="Previous variant"
        className="p-1.5 rounded-full hover:bg-white/20"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <span className="px-2 whitespace-nowrap">
        {active.key} ({active.name}) · {index + 1}/{variants.length}
      </span>
      <button
        type="button"
        onClick={() => go(1)}
        aria-label="Next variant"
        className="p-1.5 rounded-full hover:bg-white/20"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}
