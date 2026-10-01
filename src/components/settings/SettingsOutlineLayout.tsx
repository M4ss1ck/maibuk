import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { SettingsOutline } from "@/components/settings/SettingsOutline";
import { SettingsSectionMenu } from "@/components/settings/SettingsSectionMenu";
import { useSettingsOutline } from "@/components/settings/useSettingsOutline";

// The outline sits beside the sections from this container width (the 42rem
// column plus the outline); below it the section menu bar takes over. Keep in
// step with the `@min-[58rem]` classes in both components.
const WIDE_REM = 58;
// Height of the section menu bar (h-11 plus its 2px progress line).
const MENU_BAR_PX = 46;

function useIsWide(scrollerRef: RefObject<HTMLElement | null>) {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const observer = new ResizeObserver(() => {
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setWide(scroller.clientWidth >= WIDE_REM * rem);
    });
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [scrollerRef]);
  return wide;
}

/**
 * The Settings sections with their outline. Owns the outline state, so a
 * scroll re-renders the outline and the menu bar, never `children`.
 */
export function SettingsOutlineLayout({
  scrollerRef,
  children,
}: {
  scrollerRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const isWide = useIsWide(scrollerRef);
  const { present, selection, progress, jumpTo } = useSettingsOutline(
    scrollerRef,
    isWide ? 0 : MENU_BAR_PX
  );

  return (
    <>
      <SettingsSectionMenu
        present={present}
        current={selection.section}
        progress={progress}
        onJump={(section) => jumpTo(section)}
      />
      <div className="relative z-10 flex items-start">
        {children}
        <SettingsOutline present={present} selection={selection} onJump={jumpTo} />
      </div>
    </>
  );
}
