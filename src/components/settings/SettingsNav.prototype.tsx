// PROTOTYPE: three Settings side-navigation variants, switchable via
// `?variant=` on /settings. Throwaway; lives on branch prototype-settings-toc.
//
// Question: what should a Settings outline look like on the right, over the
// ASCII field, and what replaces it on narrow screens WITHOUT reusing the main
// sidebar's hamburger menu?
//
//   A  Outline + chip strip      plain text outline / horizontal sticky chips
//   B  Editorial index + pill    numbered card with progress / floating pill → sheet
//   C  Live tree + breadcrumb    sections + rows with filter / sticky dropdown
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
import { Check, ChevronDown, List, Search } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { SETTINGS_SECTIONS, type SettingsRowId } from "@/components/settings/settings-sections";
import { currentSettingsPlatform, rowOnPlatform } from "@/features/settings/rows";
import { focusSettingsRow } from "@/features/settings/focus-row";

export const SETTINGS_NAV_VARIANTS = [
  { key: "A", name: "Outline + chip strip" },
  { key: "B", name: "Editorial index + pill" },
  { key: "C", name: "Live tree + breadcrumb" },
] as const;

type SectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

interface VariantProps {
  scrollerRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}

// The wide layout needs the 42rem content column plus the outline beside it.
// Literal `@min-[58rem]:` classes below: Tailwind cannot see interpolated ones.

function sectionElement(id: string) {
  const heading = document.querySelector<HTMLElement>(`[data-settings-section="${id}"]`);
  return { heading, block: heading?.closest<HTMLElement>("section") ?? heading };
}

/** Scroll spy over the section headings the screen actually renders. */
function useSectionSpy(scrollerRef: RefObject<HTMLDivElement | null>, offset: number) {
  const [present, setPresent] = useState<SectionId[]>([]);
  const [active, setActive] = useState<SectionId | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const ids = SETTINGS_SECTIONS.map((s) => s.id).filter((id) => sectionElement(id).heading);
    setPresent(ids);

    let frame = 0;
    const measure = () => {
      frame = 0;
      const top = scroller.getBoundingClientRect().top;
      const max = scroller.scrollHeight - scroller.clientHeight;
      setProgress(max > 0 ? scroller.scrollTop / max : 0);
      if (scroller.scrollTop >= max - 2) {
        setActive(ids[ids.length - 1] ?? null);
        return;
      }
      let current: SectionId | null = ids[0] ?? null;
      for (const id of ids) {
        const block = sectionElement(id).block;
        if (block && block.getBoundingClientRect().top - top <= offset + 8) current = id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [scrollerRef, offset]);

  const jumpTo = useCallback(
    (id: SectionId) => {
      const scroller = scrollerRef.current;
      const { heading, block } = sectionElement(id);
      if (!scroller || !block) return;
      const delta = block.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
      scroller.scrollTo({
        top: scroller.scrollTop + delta - offset,
        behavior: smooth ? "smooth" : "auto",
      });
      heading?.focus({ preventScroll: true });
    },
    [scrollerRef, offset]
  );

  return { present, active, progress, jumpTo };
}

// Section/row label keys are plain strings, not the typed key union.
function useTr() {
  const { t } = useTranslation();
  return (key: string) => String(t(key as never));
}

function useSectionLabel() {
  const tr = useTr();
  return (id: SectionId) => tr(SETTINGS_SECTIONS.find((s) => s.id === id)?.labelKey ?? id);
}

// ─── A: plain outline over the field / horizontal chip strip ────────────────

export function VariantA({ scrollerRef, children }: VariantProps) {
  const isWide = useContainerWide(scrollerRef);
  const { present, active, jumpTo } = useSectionSpy(scrollerRef, isWide ? 32 : 64);
  const label = useSectionLabel();
  const stripRef = useRef<HTMLDivElement>(null);

  // Keep the active chip in view inside the strip, never scrolling the page.
  useEffect(() => {
    const strip = stripRef.current;
    const chip = strip?.querySelector<HTMLElement>(`[data-chip="${active}"]`);
    if (!strip || !chip) return;
    strip.scrollTo({
      left: chip.offsetLeft - strip.clientWidth / 2 + chip.clientWidth / 2,
      behavior: "smooth",
    });
  }, [active]);

  return (
    <>
      <nav
        aria-label="Settings sections"
        className={`@min-[58rem]:hidden sticky top-0 z-20 bg-background/85 backdrop-blur border-b border-border`}
      >
        <div
          ref={stripRef}
          className="flex gap-1.5 overflow-x-auto px-4 py-2 [scrollbar-width:none]"
        >
          {present.map((id) => (
            <button
              key={id}
              type="button"
              data-chip={id}
              aria-current={id === active ? "true" : undefined}
              onClick={() => jumpTo(id)}
              className={`shrink-0 rounded-full px-3 py-1 text-sm transition-colors ${
                id === active
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/15 text-muted-foreground hover:text-foreground"
              }`}
            >
              {label(id)}
            </button>
          ))}
        </div>
      </nav>
      <div className="relative z-10 flex items-start">
        {children}
        <nav
          aria-label="Settings sections"
          className={`hidden @min-[58rem]:block sticky top-8 mt-10 mx-auto w-48 shrink-0`}
        >
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            On this page
          </p>
          <ul className="border-l border-border">
            {present.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  aria-current={id === active ? "true" : undefined}
                  onClick={() => jumpTo(id)}
                  className={`-ml-px block w-full border-l-2 py-1 pl-3 text-left text-sm transition-colors ${
                    id === active
                      ? "border-primary text-foreground font-medium"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label(id)}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </>
  );
}

// ─── B: numbered editorial card / floating pill + sheet ─────────────────────

export function VariantB({ scrollerRef, children }: VariantProps) {
  const { present, active, progress, jumpTo } = useSectionSpy(scrollerRef, 32);
  const label = useSectionLabel();
  const [sheetOpen, setSheetOpen] = useState(false);
  const activeIndex = active ? present.indexOf(active) : -1;
  const num = (i: number) => String(i + 1).padStart(2, "0");

  const chooseFromSheet = (id: SectionId) => {
    setSheetOpen(false);
    // Let the Modal restore focus to the pill first, then move it to the heading.
    requestAnimationFrame(() => requestAnimationFrame(() => jumpTo(id)));
  };

  const ringLength = 2 * Math.PI * 14;

  return (
    <>
      <div className="relative z-10 flex items-start">
        {children}
        <nav
          aria-label="Settings sections"
          className={`hidden @min-[58rem]:block sticky top-8 mt-8 ml-auto mr-8 w-60 shrink-0 rounded-lg border border-border bg-card/85 backdrop-blur-sm p-4 shadow-sm`}
        >
          <div className="flex items-baseline justify-between">
            <p className="font-serif text-lg">Contents</p>
            <p className="font-mono text-xs text-muted-foreground">
              {activeIndex >= 0 ? num(activeIndex) : "--"} / {num(present.length - 1)}
            </p>
          </div>
          <div className="mt-2 mb-3 h-0.5 rounded bg-border overflow-hidden">
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <ol className="space-y-0.5">
            {present.map((id, i) => (
              <li key={id}>
                <button
                  type="button"
                  aria-current={id === active ? "true" : undefined}
                  onClick={() => jumpTo(id)}
                  className={`group flex w-full items-baseline gap-3 rounded px-1.5 py-1 text-left transition-colors hover:bg-muted/10 ${
                    id === active ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  <span className={`font-mono text-[11px] ${id === active ? "text-primary" : ""}`}>
                    {num(i)}
                  </span>
                  <span className={id === active ? "font-semibold" : ""}>{label(id)}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
      </div>

      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        aria-label={`Settings sections, current: ${active ? label(active) : ""}`}
        className={`@min-[58rem]:hidden fixed right-4 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 flex items-center gap-2 rounded-full border border-border bg-card pl-1.5 pr-4 py-1.5 shadow-lg`}
      >
        <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true" className="-rotate-90">
          <circle cx="16" cy="16" r="14" fill="none" stroke="var(--color-border)" strokeWidth="3" />
          <circle
            cx="16"
            cy="16"
            r="14"
            fill="none"
            stroke="var(--color-primary)"
            strokeWidth="3"
            strokeDasharray={ringLength}
            strokeDashoffset={ringLength * (1 - progress)}
          />
        </svg>
        <span className="font-mono text-xs text-muted-foreground">
          {activeIndex >= 0 ? num(activeIndex) : "--"}
        </span>
        <span className="text-sm font-medium max-w-[10rem] truncate">
          {active ? label(active) : ""}
        </span>
      </button>

      <Modal isOpen={sheetOpen} onClose={() => setSheetOpen(false)} title="Contents">
        <ol className="space-y-0.5">
          {present.map((id, i) => (
            <li key={id}>
              <button
                type="button"
                aria-current={id === active ? "true" : undefined}
                onClick={() => chooseFromSheet(id)}
                className={`flex w-full items-baseline gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-muted/10 ${
                  id === active ? "bg-primary/10 text-foreground" : "text-muted-foreground"
                }`}
              >
                <span className={`font-mono text-xs ${id === active ? "text-primary" : ""}`}>
                  {num(i)}
                </span>
                <span className={id === active ? "font-semibold" : ""}>{label(id)}</span>
              </button>
            </li>
          ))}
        </ol>
      </Modal>
    </>
  );
}

// ─── C: section + row tree with filter / sticky breadcrumb dropdown ─────────

export function VariantC({ scrollerRef, children }: VariantProps) {
  const isWide = useContainerWide(scrollerRef);
  const { present, active, progress, jumpTo } = useSectionSpy(scrollerRef, isWide ? 32 : 64);
  const label = useSectionLabel();
  const tr = useTr();
  const [query, setQuery] = useState("");

  const tree = useMemo(() => {
    const platform = currentSettingsPlatform();
    const q = query.trim().toLocaleLowerCase();
    return SETTINGS_SECTIONS.filter((s) => present.includes(s.id)).flatMap((section) => {
      const rows = section.rows
        .filter((row) => rowOnPlatform(row, platform))
        .map((row) => ({ id: row.id as SettingsRowId, label: tr(row.labelKey) }));
      const sectionLabel = tr(section.labelKey);
      if (!q) return [{ id: section.id, label: sectionLabel, rows, open: section.id === active }];
      const sectionHit = sectionLabel.toLocaleLowerCase().includes(q);
      const hits = rows.filter((row) => row.label.toLocaleLowerCase().includes(q));
      if (!sectionHit && hits.length === 0) return [];
      return [{ id: section.id, label: sectionLabel, rows: sectionHit ? rows : hits, open: true }];
    });
  }, [present, active, query, tr]);

  return (
    <>
      <div
        className={`@min-[58rem]:hidden sticky top-0 z-20 bg-background/90 backdrop-blur border-b border-border`}
      >
        <div className="flex items-center gap-1 px-4 h-11 text-sm">
          <span className="text-muted-foreground">{tr("settings.title")}</span>
          <span className="text-muted-foreground">/</span>
          <MenuTrigger>
            <AriaButton
              aria-label="Jump to section"
              className="flex items-center gap-1 rounded-lg px-2 py-1 font-medium outline-none hover:bg-muted/10 data-[focus-visible]:ring-2 data-[focus-visible]:ring-primary"
            >
              {active ? label(active) : ""}
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
                  requestAnimationFrame(() => requestAnimationFrame(() => jumpTo(key as SectionId)))
                }
                className="p-1 outline-none"
              >
                {present.map((id) => (
                  <MenuItem
                    key={id}
                    id={id}
                    textValue={label(id)}
                    className="flex items-center justify-between rounded px-3 py-2 text-sm outline-none cursor-default data-[focused]:bg-muted/15"
                  >
                    {label(id)}
                    {id === active && <Check className="w-4 h-4 text-primary" />}
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
          className={`hidden @min-[58rem]:flex flex-col sticky top-6 mt-6 ml-auto mr-8 w-64 shrink-0 max-h-[calc(100vh-3rem)]`}
        >
          <label className="flex items-center gap-2 rounded-lg border border-border bg-background/90 px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-primary">
            <Search className="w-4 h-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === "Escape" && setQuery("")}
              placeholder="Filter settings"
              aria-label="Filter settings"
              className="w-full bg-transparent text-sm outline-none"
            />
          </label>
          <ul className="mt-3 overflow-auto scrollbar-themed pr-1 rounded-lg bg-background/70 backdrop-blur-[2px] py-2">
            {tree.map((section) => (
              <li key={section.id}>
                <button
                  type="button"
                  aria-current={section.id === active ? "true" : undefined}
                  aria-expanded={section.open}
                  onClick={() => jumpTo(section.id)}
                  className={`flex w-full items-center gap-2 px-3 py-1 text-left text-sm ${
                    section.id === active
                      ? "text-primary font-semibold"
                      : "text-foreground hover:text-primary"
                  }`}
                >
                  <List className="w-3.5 h-3.5 opacity-60" />
                  {section.label}
                </button>
                {section.open && (
                  <ul className="ml-[1.1rem] border-l border-border mb-1">
                    {section.rows.map((row) => (
                      <li key={row.id}>
                        <button
                          type="button"
                          onClick={() => focusSettingsRow(row.id)}
                          className="block w-full truncate py-0.5 pl-3 pr-2 text-left text-xs text-muted-foreground hover:text-foreground"
                        >
                          {row.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
            {tree.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted-foreground">No matches</li>
            )}
          </ul>
        </nav>
      </div>
    </>
  );
}

/** Mirrors the @min-[58rem] container query in JS, only to pick the scroll offset. */
function useContainerWide(scrollerRef: RefObject<HTMLDivElement | null>) {
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
