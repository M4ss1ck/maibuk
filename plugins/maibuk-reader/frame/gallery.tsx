/** @jsxImportSource preact */
/**
 * The Reader component gallery (#943 unit 5): a dev-only page that draws every
 * kit component and icon for screenshots. It is deliberately outside the Frame
 * entry's import graph and outside `assets/`, so `scripts/build-plugin.ts`
 * never bundles or copies it; `gallery.test.tsx` proves that with an in-memory
 * production bundle.
 *
 * Every section uses the kit's public API and the tokens in `kit.css`; the
 * gallery states no color of its own. Local state keeps the controls operable
 * so screenshots can show the states a reader reaches.
 */

import type { ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";
import {
  Button,
  Chip,
  Cover,
  Dialog,
  Icon,
  ICON_NAMES,
  IconButton,
  Menu,
  type MenuItem,
  Popover,
  ProgressCard,
  Segmented,
  Sheet,
  Slider,
  Switch,
} from "./kit";

/** Marks the gallery in its bundle, so the production exclusion test can look for it. */
export const GALLERY_MARKER = "Reader component gallery";

const LAYOUT_OPTIONS = [
  { value: "wide", label: "Wide" },
  { value: "narrow", label: "Narrow" },
] as const;

type LayoutOption = (typeof LAYOUT_OPTIONS)[number]["value"];

const READING_THEMES = ["light", "sepia", "dark", "black"] as const;

const READING_THEME_LABELS: Record<(typeof READING_THEMES)[number], string> = {
  light: "Light",
  sepia: "Sepia",
  dark: "Dark",
  black: "Black",
};

const HIGHLIGHTS = ["yellow", "green", "blue", "pink", "purple"] as const;

const MENU_ITEMS: readonly MenuItem[] = [
  { id: "find", label: "Find in Document", icon: "search", shortcut: "Ctrl+F" },
  { id: "contents", label: "Contents", icon: "contents", shortcut: "T" },
  { id: "highlight", label: "Highlight", icon: "highlight", shortcut: "H" },
];

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ComponentChildren;
}) {
  return (
    <section class="gallery-section" aria-labelledby={`gallery-${id}`}>
      <h2 id={`gallery-${id}`}>{title}</h2>
      {children}
    </section>
  );
}

export function Gallery() {
  const [layout, setLayout] = useState<LayoutOption>("wide");
  const [filterPressed, setFilterPressed] = useState(true);
  const [tags, setTags] = useState(["Fiction", "History"]);
  const [pageNumbers, setPageNumbers] = useState(true);
  const [continuous, setContinuous] = useState(false);
  const [fontSize, setFontSize] = useState(100);
  const [clicks, setClicks] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [lastAction, setLastAction] = useState("none");
  const [runningVisible, setRunningVisible] = useState(true);
  const [reportVisible, setReportVisible] = useState(false);
  const popoverTrigger = useRef<HTMLButtonElement>(null);

  return (
    <main class="gallery">
      <header class="gallery-header">
        <h1>{GALLERY_MARKER}</h1>
        <p class="gallery-note">
          Dev-only. Query params: <code>theme=dark</code>,{" "}
          <code>reading=light|sepia|dark|black</code>, <code>eink=1</code>,{" "}
          <code>motion=reduce</code>.
        </p>
      </header>

      <Section id="icons" title="Icons">
        <p class="gallery-note">
          Icon inventory: 24 px grid, 1.75 stroke, round caps and joins, drawn at 20 px.
        </p>
        <div class="gallery-icon-grid">
          {ICON_NAMES.map((name) => (
            <div key={name} class="gallery-icon" data-icon-name={name}>
              <Icon name={name} />
              <span class="gallery-icon-name">{name}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section id="buttons" title="Buttons">
        <div class="gallery-grid">
          <Button variant="primary" onClick={() => setClicks((value) => value + 1)}>
            Primary
          </Button>
          <Button variant="secondary" onClick={() => setClicks((value) => value + 1)}>
            Secondary
          </Button>
          <Button variant="ghost" onClick={() => setClicks((value) => value + 1)}>
            Ghost
          </Button>
          <Button variant="destructive" onClick={() => setClicks((value) => value + 1)}>
            Destructive
          </Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
        </div>
        <p class="gallery-note">Buttons pressed: {clicks}</p>
      </Section>

      <Section id="icon-buttons" title="IconButtons">
        <div class="gallery-grid">
          {(
            [
              ["Back to Shelf", "back"],
              ["Next page", "fwd"],
              ["Find in Document", "search"],
              ["Bookmark", "bookmark"],
              ["Highlight", "highlight"],
              ["Note", "note"],
              ["Contents", "contents"],
              ["More", "more"],
            ] as const
          ).map(([label, icon]) => (
            <IconButton
              key={label}
              label={label}
              icon={icon}
              onClick={() => setClicks((v) => v + 1)}
            />
          ))}
        </div>
        <p class="gallery-note">Wide shows the tooltip after a short hover; Narrow never does.</p>
      </Section>

      <Section id="segmented" title="Segmented">
        <Segmented label="Layout" value={layout} options={LAYOUT_OPTIONS} onChange={setLayout} />
        <p class="gallery-note">Selected layout: {layout}</p>
      </Section>

      <Section id="chips" title="Chips">
        <div class="gallery-grid">
          <Chip pressed={filterPressed} onPressedChange={setFilterPressed}>
            Fiction
          </Chip>
          <Chip pressed={!filterPressed} onPressedChange={(pressed) => setFilterPressed(!pressed)}>
            History
          </Chip>
          {tags.map((tag) => (
            <Chip
              key={tag}
              removeLabel={`Remove ${tag}`}
              onRemove={() => setTags((current) => current.filter((value) => value !== tag))}
            >
              {tag}
            </Chip>
          ))}
        </div>
        {tags.length === 0 ? (
          <Button variant="ghost" onClick={() => setTags(["Fiction", "History"])}>
            Restore chips
          </Button>
        ) : null}
      </Section>

      <Section id="switch" title="Switch">
        <div class="gallery-switch-stack">
          <Switch label="Show page numbers" checked={pageNumbers} onChange={setPageNumbers} />
          <Switch label="Continuous scroll" checked={continuous} onChange={setContinuous} />
          <Switch label="Disabled option" checked={false} onChange={() => {}} disabled />
        </div>
      </Section>

      <Section id="slider" title="Slider">
        <Slider
          label="Font size"
          value={fontSize}
          min={50}
          max={200}
          step={10}
          onChange={setFontSize}
          decreaseLabel="Decrease font size"
          increaseLabel="Increase font size"
          formatValue={(value) => `${value}%`}
        />
      </Section>

      <Section id="sheet" title="Sheet">
        <div class="gallery-grid">
          <Button variant="secondary" onClick={() => setSheetOpen(true)}>
            Open sheet
          </Button>
        </div>
        <p class="gallery-note">
          Sheet draws below 600 px; Dialog and Popover draw at 600 px and wider.
        </p>
        <Sheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title="Reading options"
          doneLabel="Done"
        >
          <p class="gallery-note">A sheet slides up with a grab handle and a Done row.</p>
        </Sheet>
      </Section>

      <Section id="popover" title="Popover">
        <div class="gallery-grid">
          <Button ref={popoverTrigger} variant="secondary" onClick={() => setPopoverOpen(true)}>
            Open popover
          </Button>
        </div>
        <Popover
          open={popoverOpen}
          onClose={() => setPopoverOpen(false)}
          triggerRef={popoverTrigger}
          label="Look up"
        >
          <p>Look up the selected word or phrase.</p>
          <Button variant="ghost" onClick={() => setPopoverOpen(false)}>
            Close
          </Button>
        </Popover>
      </Section>

      <Section id="dialog" title="Dialog">
        <div class="gallery-grid">
          <Button variant="secondary" onClick={() => setDialogOpen(true)}>
            Open dialog
          </Button>
        </div>
        <Dialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          title="Import report"
          actions={
            <>
              <Button variant="secondary" onClick={() => setDialogOpen(false)}>
                Close
              </Button>
              <Button variant="primary" onClick={() => setDialogOpen(false)}>
                Save
              </Button>
            </>
          }
        >
          <p>3 Documents imported. 1 file could not be read.</p>
        </Dialog>
      </Section>

      <Section id="menu" title="Menu">
        <div class="gallery-grid">
          <Button variant="secondary" onClick={() => setMenuOpen(true)}>
            Open menu
          </Button>
        </div>
        <Menu
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          label="Document actions"
          items={MENU_ITEMS}
          onSelect={(id) => {
            const item = MENU_ITEMS.find((candidate) => candidate.id === id);
            setLastAction(item?.label ?? id);
          }}
        />
        <p class="gallery-note">Chosen: {lastAction}</p>
      </Section>

      <Section id="covers" title="Cover tones">
        <div class="gallery-cover-grid">
          {Array.from({ length: 8 }, (_, index) => (
            <figure key={index} class="gallery-cover">
              <Cover
                title={`Tone ${index + 1}`}
                author="Maibuk"
                format="EPUB"
                tone={index}
                width={88}
              />
              <figcaption>Tone {index + 1}</figcaption>
            </figure>
          ))}
          <figure class="gallery-cover">
            <Cover title="Importing" author="Maibuk" format="EPUB" pending width={88} />
            <figcaption>Pending</figcaption>
          </figure>
          <figure class="gallery-cover">
            <Cover title="Lost book" author="Maibuk" format="PDF" tone={2} missing width={88} />
            <figcaption>Missing</figcaption>
          </figure>
        </div>
      </Section>

      <Section id="progress" title="ProgressCard">
        <div class="gallery-progress-row">
          {runningVisible ? (
            <ProgressCard
              title="Importing 3 Documents"
              completed={2}
              total={5}
              countText="2 of 5"
              cancelLabel="Cancel"
              viewReportLabel="View report"
              onCancel={() => setRunningVisible(false)}
              onViewReport={() => setReportVisible(true)}
              complete={false}
            />
          ) : (
            <Button variant="ghost" onClick={() => setRunningVisible(true)}>
              Show running card
            </Button>
          )}
          <ProgressCard
            title="Import complete"
            completed={5}
            total={5}
            countText="5 of 5"
            cancelLabel="Cancel"
            viewReportLabel="View report"
            onCancel={() => setRunningVisible(true)}
            onViewReport={() => setReportVisible(true)}
            complete
          />
        </div>
        {reportVisible ? <p class="gallery-note">Import report ready.</p> : null}
      </Section>

      <Section id="reading-themes" title="Reading Themes">
        <p class="gallery-note">Reading Theme swatches: page, ink, and meta for each palette.</p>
        <div class="gallery-theme-grid">
          {READING_THEMES.map((theme) => (
            <div key={theme} class="gallery-theme-swatch" data-reading-theme={theme}>
              <span class="gallery-theme-name">{READING_THEME_LABELS[theme]}</span>
              <span class="gallery-theme-meta">page · ink · meta</span>
            </div>
          ))}
        </div>
      </Section>

      <Section id="highlights" title="Highlights">
        <p class="gallery-note">
          Highlight fills and E-ink underlines: the stored color never changes, and E-ink adds the
          underline style.
        </p>
        <div class="gallery-highlight-grid">
          {HIGHLIGHTS.map((color) => (
            <div key={color} class="gallery-highlight-row">
              <span class={`gallery-highlight gallery-highlight--${color}`}>{color}</span>
              <span class="gallery-note">fill</span>
              <span class={`gallery-underline gallery-underline--${color}`}>{color}</span>
              <span class="gallery-note">E-ink underline</span>
            </div>
          ))}
        </div>
      </Section>
    </main>
  );
}
