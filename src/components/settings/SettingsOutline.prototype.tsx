// PROTOTYPE: variant D, the chosen direction (branch prototype-settings-toc).
// Wide: A's plain outline with C's expanded rows and filter, no header, over
// a quieted ASCII field. Narrow: C's sticky breadcrumb dropdown.
//
// Selection rules:
//  - A clicked section or row is selected and stays selected until the author
//    scrolls by themselves.
//  - Otherwise the selected section is the first one whose top is inside the
//    visible area; when none starts there, the one covering the top. No row
//    is highlighted unless it was clicked.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import { Button as AriaButton, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { SETTINGS_SECTIONS, type SettingsRowId } from "@/components/settings/settings-sections";
import { currentSettingsPlatform, rowOnPlatform } from "@/features/settings/rows";
import { focusSettingsRow } from "@/features/settings/focus-row";

type SectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

interface Selection {
  section: SectionId | null;
  row: string | null;
}

// Height of the narrow breadcrumb bar (h-11 plus the 2px progress line).
const NARROW_BAR = 46;
// Where a jumped-to section lands below the visible top.
const LANDING_GAP = 24;
// A jump's scroll counts as finished after this long without scroll events.
const JUMP_SETTLE_MS = 150;
const JUMP_START_MS = 400;

function sectionBlock(id: string) {
  const heading = document.querySelector<HTMLElement>(`[data-settings-section="${id}"]`);
  return { heading, block: heading?.closest<HTMLElement>("section") ?? heading };
}

/** First element whose top is in [viewTop, viewBottom); else the last above viewTop. */
function pickFirstStartingInView<T>(
  items: readonly T[],
  topOf: (item: T) => number | null,
  viewTop: number,
  viewBottom: number
): T | null {
  let covering: T | null = null;
  for (const item of items) {
    const top = topOf(item);
    if (top === null) continue;
    if (top >= viewTop - 1 && top < viewBottom) return item;
    if (top < viewTop) covering = item;
  }
  return covering;
}

function useOutlineSpy(scrollerRef: RefObject<HTMLDivElement | null>, topInset: number) {
  const [present, setPresent] = useState<SectionId[]>([]);
  const [selection, setSelection] = useState<Selection>({ section: null, row: null });
  const [progress, setProgress] = useState(0);
  const pinned = useRef<Selection | null>(null);
  const jumping = useRef(false);
  const settleTimer = useRef(0);
  const settleRef = useRef<(ms: number) => void>(() => {});

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const ids = SETTINGS_SECTIONS.map((s) => s.id).filter((id) => sectionBlock(id).heading);
    setPresent(ids);

    let frame = 0;
    const measure = () => {
      frame = 0;
      const max = scroller.scrollHeight - scroller.clientHeight;
      setProgress(max > 0 ? scroller.scrollTop / max : 0);
      if (pinned.current) {
        setSelection(pinned.current);
        return;
      }
      const rect = scroller.getBoundingClientRect();
      const viewTop = rect.top + topInset;
      const viewBottom = rect.bottom;
      const section = pickFirstStartingInView(
        ids,
        (id) => sectionBlock(id).block?.getBoundingClientRect().top ?? null,
        viewTop,
        viewBottom
      );
      // Rows are never picked by scrolling, only by a click.
      setSelection((prev) =>
        prev.section === section && prev.row === null ? prev : { section, row: null }
      );
    };
    const settle = (ms: number) => {
      window.clearTimeout(settleTimer.current);
      settleTimer.current = window.setTimeout(() => {
        jumping.current = false;
      }, ms);
    };
    settleRef.current = settle;

    const onScroll = () => {
      if (jumping.current) {
        settle(JUMP_SETTLE_MS);
      } else if (pinned.current) {
        // The author scrolled after the jump finished: the spy takes over.
        pinned.current = null;
      }
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer.current);
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [scrollerRef, topInset]);

  const select = useCallback(
    (section: SectionId, row: SettingsRowId | null) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      pinned.current = { section, row };
      jumping.current = true;
      settleRef.current(JUMP_START_MS);
      setSelection({ section, row });

      if (row) {
        // The palette's path: opens collapsed areas, scrolls, focuses the control.
        focusSettingsRow(row);
        return;
      }
      const { heading, block } = sectionBlock(section);
      if (!block) return;
      const delta = block.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
      scroller.scrollTo({
        top: scroller.scrollTop + delta - topInset - LANDING_GAP,
        behavior: smooth ? "smooth" : "auto",
      });
      heading?.focus({ preventScroll: true });
    },
    [scrollerRef, topInset]
  );

  return { present, selection, progress, select };
}

function useTr() {
  const { t } = useTranslation();
  return useCallback((key: string) => String(t(key as never)), [t]);
}

function useIsWide(scrollerRef: RefObject<HTMLDivElement | null>) {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const observer = new ResizeObserver(() => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setWide(scroller.clientWidth >= 58 * rem);
    });
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [scrollerRef]);
  return wide;
}

export function VariantD({
  scrollerRef,
  children,
}: {
  scrollerRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const isWide = useIsWide(scrollerRef);
  const { present, selection, progress, select } = useOutlineSpy(
    scrollerRef,
    isWide ? 0 : NARROW_BAR
  );
  const tr = useTr();
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLUListElement>(null);

  const tree = useMemo(() => {
    const platform = currentSettingsPlatform();
    const q = query.trim().toLocaleLowerCase();
    return SETTINGS_SECTIONS.filter((s) => present.includes(s.id)).flatMap((section) => {
      const rows = section.rows
        .filter((row) => rowOnPlatform(row, platform))
        .map((row) => ({ id: row.id as SettingsRowId, label: tr(row.labelKey) }));
      const label = tr(section.labelKey);
      if (!q) return [{ id: section.id, label, rows, open: section.id === selection.section }];
      const sectionHit = label.toLocaleLowerCase().includes(q);
      const hits = rows.filter((row) => row.label.toLocaleLowerCase().includes(q));
      if (!sectionHit && hits.length === 0) return [];
      return [{ id: section.id, label, rows: sectionHit ? rows : hits, open: true }];
    });
  }, [present, selection.section, query, tr]);

  const sectionLabel = (id: SectionId | null) =>
    id ? tr(SETTINGS_SECTIONS.find((s) => s.id === id)?.labelKey ?? id) : "";

  // Keep the selected entry visible inside the outline without moving the page.
  useEffect(() => {
    const list = listRef.current;
    const target =
      list?.querySelector<HTMLElement>(`[data-outline-row="${selection.row}"]`) ??
      list?.querySelector<HTMLElement>(`[data-outline-section="${selection.section}"]`);
    if (!list || !target) return;
    const top = target.offsetTop - list.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top - 8;
    else if (top + target.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = top + target.offsetHeight - list.clientHeight + 8;
  }, [selection]);

  return (
    <>
      <div className="@min-[58rem]:hidden sticky top-0 z-20 bg-background/90 backdrop-blur border-b border-border">
        <div className="flex items-center gap-1 px-4 h-11 text-sm">
          <span className="text-muted-foreground">{tr("settings.title")}</span>
          <span className="text-muted-foreground">/</span>
          <MenuTrigger>
            <AriaButton
              aria-label="Jump to section"
              className="flex items-center gap-1 rounded-lg px-2 py-1 font-medium outline-none hover:bg-muted/10 data-[focus-visible]:ring-2 data-[focus-visible]:ring-primary"
            >
              {sectionLabel(selection.section)}
              <ChevronDown className="w-4 h-4" />
            </AriaButton>
            <Popover
              placement="bottom start"
              className="w-64 max-h-[60vh] overflow-auto scrollbar-themed rounded-lg border border-border bg-card shadow-lg"
            >
              <Menu
                aria-label="Settings sections"
                // The Menu restores focus to its trigger on close; jump after that.
                onAction={(key) =>
                  requestAnimationFrame(() =>
                    requestAnimationFrame(() => select(key as SectionId, null))
                  )
                }
                className="p-1 outline-none"
              >
                {present.map((id) => (
                  <MenuItem
                    key={id}
                    id={id}
                    textValue={sectionLabel(id)}
                    className="flex items-center justify-between rounded px-3 py-2 text-sm outline-none cursor-default data-[focused]:bg-muted/15"
                  >
                    {sectionLabel(id)}
                    {id === selection.section && <Check className="w-4 h-4 text-primary" />}
                  </MenuItem>
                ))}
              </Menu>
            </Popover>
          </MenuTrigger>
        </div>
        <div
          className="h-0.5 bg-primary origin-left"
          style={{ transform: `scaleX(${progress})` }}
        />
      </div>

      <div className="relative z-10 flex items-start">
        {children}
        <nav
          aria-label="Settings outline"
          data-ascii-quiet
          className="hidden @min-[58rem]:flex flex-col sticky top-8 mt-8 mx-auto w-64 shrink-0 max-h-[calc(100vh-4rem)]"
        >
          <div className="flex items-center gap-2 border-b border-border pb-1.5 focus-within:border-primary">
            <Search className="w-4 h-4 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && query) {
                  event.stopPropagation();
                  setQuery("");
                }
              }}
              placeholder="Search"
              aria-label="Search settings"
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <ul ref={listRef} className="mt-4 overflow-auto scrollbar-themed border-l border-border">
            {tree.map((section) => {
              const isSelected = section.id === selection.section;
              return (
                <li key={section.id}>
                  <button
                    type="button"
                    data-outline-section={section.id}
                    aria-current={isSelected && !selection.row ? "location" : undefined}
                    aria-expanded={section.open}
                    onClick={() => select(section.id, null)}
                    className={`-ml-px block w-full border-l-2 py-1 pl-3 text-left text-sm transition-colors ${
                      isSelected
                        ? "border-primary text-foreground font-medium"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {section.label}
                  </button>
                  {section.open && section.rows.length > 0 && (
                    <ul className="mb-1.5">
                      {section.rows.map((row) => {
                        const rowSelected = isSelected && row.id === selection.row;
                        return (
                          <li key={row.id}>
                            <button
                              type="button"
                              data-outline-row={row.id}
                              aria-current={rowSelected ? "location" : undefined}
                              onClick={() => select(section.id as SectionId, row.id)}
                              title={row.label}
                              className={`block w-full truncate py-0.5 pl-6 pr-2 text-left text-xs transition-colors ${
                                rowSelected
                                  ? "text-primary font-medium"
                                  : "text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {row.label}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
            {tree.length === 0 && (
              <li className="pl-3 py-1 text-sm text-muted-foreground">No matches</li>
            )}
          </ul>
        </nav>
      </div>
    </>
  );
}
