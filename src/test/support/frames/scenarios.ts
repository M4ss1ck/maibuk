// The frame-rate lane's scenarios (issue #372): the interactions authors
// actually perform, each against a named seed Library. Data only; the
// drivers that perform them live in e2e/frames/drivers.ts, and every id here
// has a budget entry in budget.ts and a driver there (frame-scenarios.test.ts).

export type FrameSource = "chromium" | "probe" | "android";

export const FRAME_SOURCES: readonly FrameSource[] = ["chromium", "probe", "android"];

export interface FrameScenario {
  id: string;
  title: string;
  /** A name in SEED_LIBRARIES (e2e/support/seed/libraries.ts). */
  seed: string;
  /** What runs before measuring, so lazy loading and first paint stay out. */
  warmUp: string;
  /** What the measured window does. */
  measured: string;
  /** Default repetitions; `--repeat` overrides. */
  repetitions: number;
  /** Whether keystroke-to-next-frame is recorded. */
  recordsInput: boolean;
  /** Sources that do not run this scenario, each with why. */
  skip?: Partial<Record<FrameSource, string>>;
}

export const FRAME_SCENARIOS: readonly FrameScenario[] = [
  {
    id: "typing",
    title: "Typing burst in a long Chapter",
    seed: "perfLongChapter",
    warmUp:
      "Open the long Chapter, put the caret a dozen screens above its end, type one sentence.",
    measured: "Type 120 characters at 12 per second, the pace of a fast typist.",
    repetitions: 3,
    recordsInput: true,
  },
  {
    id: "scroll",
    title: "Scrolling a long Chapter",
    seed: "perfLongChapter",
    warmUp: "Open the long Chapter and wheel once down and back.",
    measured: "Wheel down 4,000 px in 100 px ticks, one per frame, then back up.",
    repetitions: 3,
    recordsInput: false,
  },
  {
    id: "canvas",
    title: "Canvas pan and zoom on a dense Canvas",
    seed: "perfDenseCanvas",
    warmUp: "Open the dense Canvas and wait for its first Text Node to render.",
    measured: "Drag the pane to pan and back at 125 Hz, then wheel-zoom out and back in.",
    repetitions: 3,
    recordsInput: false,
  },
  {
    id: "settings-outline",
    title: "Settings outline motion",
    seed: "empty",
    warmUp: "Open Settings and jump to General from the outline by keyboard.",
    measured:
      "Wheel the Settings page to the bottom and back; every section becomes current in turn and the outline moves.",
    repetitions: 3,
    recordsInput: false,
    skip: {
      android: "the outline only renders from a 58rem panel; a phone gets the section menu bar",
    },
  },
  {
    id: "sidebar-resize",
    title: "Sidebar resize",
    seed: "bookShelf",
    warmUp: "Open the Books gallery and drag the sidebar edge once.",
    measured: "Drag the sidebar edge 240 px right and back at 125 Hz, a mouse's report rate.",
    repetitions: 3,
    recordsInput: false,
    skip: {
      android: "phones have no resizable sidebar (it is a menu drawer below md)",
    },
  },
  {
    id: "chapter-reorder",
    title: "Keyboard Chapter reorder",
    seed: "perfLongChapter",
    warmUp:
      "Open the Book and start and cancel one keyboard reorder; each run starts on Log 1's Reorder button.",
    measured: "Start a keyboard reorder, ArrowDown past twenty Chapters and back up, Escape.",
    repetitions: 3,
    recordsInput: false,
  },
  {
    id: "palette",
    title: "Command Palette open and query",
    seed: "perfLongChapter",
    warmUp: "Open and close the Command Palette once.",
    measured: "Open the Command Palette, type a query letter by letter, clear it, close.",
    repetitions: 3,
    recordsInput: true,
  },
  {
    id: "arrow-leave-notes",
    title: "Arrow leave from a long Notes list",
    seed: "perfManyNotes",
    warmUp:
      "Open a Note from the Notes Gallery, Shift+F6 to the Notes list and ArrowRight past the row's buttons into the note's text.",
    measured:
      "Twenty times: Shift+F6 back to the Notes list (it lands on the last-used row button), then ArrowRight out of the row into the note's text. Each arrow that moves focus is timed in the page.",
    repetitions: 3,
    recordsInput: false,
    skip: {
      android:
        "a phone shows one Pane at a time (the lists are a drawer below md), so there is no Pane to cross into",
    },
  },
  {
    id: "arrow-leave-chapters",
    title: "Arrow leave from a long Chapter list",
    seed: "perfManyChapters",
    warmUp:
      "Open the Book of 100 Chapters, Shift+F6 to the Chapter list and ArrowRight past the row's buttons into the Chapter's text.",
    measured:
      "Twenty times: Shift+F6 back to the Chapter list (it lands on the last-used row button), then ArrowRight out of the row into the Chapter's text. Each arrow that moves focus is timed in the page.",
    repetitions: 3,
    recordsInput: false,
    skip: {
      android:
        "a phone shows one Pane at a time (the lists are a drawer below md), so there is no Pane to cross into",
    },
  },
  {
    id: "pane-slide",
    title: "Pane frame slide on F6",
    seed: "perfManyChapters",
    warmUp: "Open the Book of 100 Chapters and press F6 through every Pane once.",
    measured:
      "Press F6 24 times, 250 ms apart: each press slides the Pane frame (about 180 ms) to the next Pane and shows the badge.",
    repetitions: 3,
    recordsInput: false,
    skip: {
      android:
        "a phone shows one Pane at a time (the lists are a drawer below md), so there is no Pane to cross into",
    },
  },
];

export function scenariosFor(source: FrameSource, only?: string[]): FrameScenario[] {
  const unknown = (only ?? []).filter((id) => !FRAME_SCENARIOS.some((s) => s.id === id));
  if (unknown.length > 0) {
    throw new Error(
      `unknown scenario ${unknown.join(", ")}; known: ${FRAME_SCENARIOS.map((s) => s.id).join(", ")}`
    );
  }
  return FRAME_SCENARIOS.filter(
    (scenario) => !scenario.skip?.[source] && (!only?.length || only.includes(scenario.id))
  );
}
