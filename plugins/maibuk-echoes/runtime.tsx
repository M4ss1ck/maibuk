/**
 * The Echoes runtime: the report page and the detection Settings row it serves,
 * plus the Command handlers it answers. Kept apart from `index.tsx` (the Worker
 * bootstrap) so a test can drive the same logic over the polyfill-free Remote UI
 * entry the test kit uses (`@/plugin-sdk/ui-serve`), without loading the
 * Worker's Remote DOM polyfill into jsdom. Imports only `@/plugin-sdk` (and its
 * subpaths) and its own files.
 *
 * The page reads the scope the `Find echoes` Command stored, so opening the page
 * from a Chapter Item Menu lands on that Chapter. The Settings row is the
 * `detection` row's body, mounted by the host under the row's Plugin-local id.
 */

import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  PLUGIN_COMMAND_RUN_REQUEST,
  PLUGIN_UI_LIMITS,
  ui,
  type HostRequestHandler,
  type PluginClient,
} from "@/plugin-sdk";
import {
  DEFAULT_ECHO_PALETTE,
  ECHO_PALETTE_IDS,
  ECHO_PALETTES,
  type EchoPaletteId,
  parseEchoPalette,
} from "./colors";
import { createEchoEditor, type EchoEditorController } from "./editor";
import {
  DEFAULT_ECHO_SETTINGS,
  type EchoKind,
  type EchoSettings,
  NEARBY_WINDOW_MAX,
  NEARBY_WINDOW_MIN,
} from "./find-echoes";
import { type EchoKey, format, translate } from "./i18n";
import { languageSupport } from "./language";
import { createReportCache, reportCacheKey, type ReportCache } from "./report-cache";
import {
  computeReport,
  clampText,
  ECHO_KINDS,
  EMPTY_REPORT,
  fitChapterTitles,
  fitOptions,
  occurrenceContext,
  ROW_DESCRIPTION_MAX,
  ROW_LABEL_MAX,
  type EchoReport,
  type EchoReportRow,
  type ReportChapter,
  type ReportProgress,
  type ReportScope,
  type ReportSource,
} from "./report";
import {
  clampNearbyWindow,
  DEFAULT_EDITOR_KINDS,
  readColorByEcho,
  readEchoPalette,
  readEchoesSettings,
  readEditorKinds,
  toggledEditorKind,
  writeColorByEcho,
  writeEchoPalette,
  writeEchoesSettings,
  writeEditorKinds,
} from "./settings";

/** The report page id, exactly as the manifest declares it. */
export const REPORT_PAGE_ID = "report";

/** The Settings row whose body the Plugin draws, exactly as the manifest declares its id. */
export const SETTINGS_ROW_ID = "detection";

/** The Command-local ids the manifest declares. */
export const OPEN_ECHOES = "openEchoes";
export const FIND_ECHOES = "findEchoes";
export const TOGGLE_HIGHLIGHTS = "toggleHighlights";
export const NEXT_ECHO = "nextEcho";
export const PREVIOUS_ECHO = "previousEcho";

/** What the report is scoped to: a Book, or one Chapter inside it. */
export interface EchoScope {
  bookId: string;
  chapterId?: string;
}

/**
 * The host's Remote UI and request entry (`servePluginUi`), Worker or test. The
 * two SDK entries share this shape, so the runtime takes whichever the caller
 * supplies.
 */
export type EchoServe = (
  client: Pick<PluginClient, "onHostRequest">,
  options: {
    pages: Record<string, ComponentType>;
    settingsRows?: Record<string, ComponentType>;
    onHostRequest?: HostRequestHandler;
  }
) => void;

/** The item a targeted Command was invoked on, as the host captured it. */
interface EchoCommandTarget {
  kind?: string;
  id?: string;
}

/**
 * The report page's last-shown state, kept on the runtime so a revisit paints it
 * at once instead of showing the loading screen again. `scopeSeen` is the
 * `runtime.scope` object the selection was last derived from, by identity: a
 * `Find echoes` run since then makes a new object, so the page knows to apply it
 * the way a cold open would.
 */
interface RememberedPage {
  settings: EchoSettings;
  books: LibraryBook[];
  /** The selected Book's Chapters, so the scope picker and row titles paint at once. */
  chapters: LibraryChapter[];
  bookId: string | null;
  scopeKey: string;
  scopeSeen: EchoScope | null;
}

/** The runtime's own state; one per activation, so tests never share it. */
interface EchoRuntime {
  scope: EchoScope | null;
  /** The reports computed so far, kept until the runtime ends. */
  reports: ReportCache;
  /**
   * How many touching changes each Book has seen. A compute reads it before
   * and after, so a change that lands while it runs keeps its report out of date.
   */
  changes: Map<string, number>;
  /** The report page's remembered state, or null before its first open. */
  page: RememberedPage | null;
}

/** Wires the client to the report page, the Settings row, and the Command handlers. */
export function startEchoes(client: PluginClient, serve: EchoServe): void {
  const runtime: EchoRuntime = {
    scope: null,
    reports: createReportCache(),
    changes: new Map(),
    page: null,
  };
  const editor = createEchoEditor(client);
  // Subscribed once for the runtime's life: a change marks every kept report of
  // the Book it touches out of date, whether or not its page is open.
  void client
    .on("library.changed", (payload) => {
      if ("scope" in payload) {
        for (const [bookId, count] of runtime.changes) runtime.changes.set(bookId, count + 1);
      } else if (payload.entity === "book") {
        runtime.changes.set(payload.id, (runtime.changes.get(payload.id) ?? 0) + 1);
      }
      for (const bookId of runtime.reports.bookIds()) {
        if (touchesBook(payload, bookId)) runtime.reports.markStale(bookId);
      }
    })
    .catch(() => {});
  serve(client, {
    pages: { [REPORT_PAGE_ID]: createReportPage(client, runtime) },
    settingsRows: { [SETTINGS_ROW_ID]: createDetectionSettings(client, editor) },
    onHostRequest: (method, params) => handleHostRequest(client, runtime, editor, method, params),
  });
}

function handleHostRequest(
  client: PluginClient,
  runtime: EchoRuntime,
  editor: EchoEditorController,
  method: string,
  params: unknown
): unknown {
  if (method === "health.check") return "pong";
  if (method === PLUGIN_COMMAND_RUN_REQUEST) return runEchoCommand(client, runtime, editor, params);
  throw new Error(`No handler for ${method}`);
}

/**
 * Answers one Command run. `Find echoes` stores the scope from the item the
 * host captured, then opens the report; `Open Echoes` is the report page's
 * navigating Command, so the host normally navigates without a `command.run`,
 * and answering it here keeps the page reachable the other way. The three
 * editor Commands go straight to the editor controller.
 */
async function runEchoCommand(
  client: PluginClient,
  runtime: EchoRuntime,
  editor: EchoEditorController,
  params: unknown
): Promise<null> {
  const { id, target } = (params ?? {}) as { id?: string; target?: EchoCommandTarget };
  if (id === TOGGLE_HIGHLIGHTS) {
    await editor.toggleHighlights();
    return null;
  }
  if (id === NEXT_ECHO) {
    await editor.nextEcho();
    return null;
  }
  if (id === PREVIOUS_ECHO) {
    await editor.previousEcho();
    return null;
  }
  if (id !== FIND_ECHOES && id !== OPEN_ECHOES) return null;
  if (id === FIND_ECHOES) runtime.scope = await scopeForTarget(client, target);
  await client.navigation.openPage({ pageId: REPORT_PAGE_ID });
  return null;
}

/** The scope a Command target implies: the Chapter and its Book. */
async function scopeForTarget(
  client: PluginClient,
  target: EchoCommandTarget | undefined
): Promise<EchoScope | null> {
  if (target === undefined || typeof target.id !== "string") return null;
  if (target.kind !== "chapter") return null;
  try {
    const chapter = await client.library.chapters.get({ chapterId: target.id });
    return chapter === null ? null : { bookId: chapter.bookId, chapterId: chapter.id };
  } catch {
    return null;
  }
}

/** A Book as the Library read returns it. */
type LibraryBook = Awaited<ReturnType<PluginClient["library"]["books"]["list"]>>[number];

/** A Chapter summary as the Library read returns it (no content). */
type LibraryChapter = Awaited<ReturnType<PluginClient["library"]["chapters"]["list"]>>[number];

/** The scope select's Whole Book value; every other value is a Chapter id. */
const SCOPE_WHOLE = "whole";

/** The report row Item Menu's one action value. */
const IGNORE_ACTION = "ignore";

/** Rows each tab draws per page; the host draws every row it is given. */
const ROW_PAGE = 200;

/**
 * Occurrences an expanded row draws per page. Smaller than ROW_PAGE: expanding
 * rebuilds the host's whole list, so this keeps a toggle near 100 ms.
 */
const OCCURRENCE_PAGE = 50;

/**
 * Rows the page draws at most, well under the host's maxNodes (10,000 elements
 * per Plugin UI): the top rows shown, plus the open row and its shown occurrences
 * and its Show more row. Show more offers only what fits under it.
 */
const DRAW_BUDGET = 5_000;

/**
 * How many steps the determinate first-compute bar moves in. Every step repaints
 * the whole page across the Remote UI connection, so a per-Chapter update would
 * spend more time repainting than reading on a long Book.
 */
const PROGRESS_STEPS = 10;

/**
 * How many more rows or occurrences a Show more press offers: one page, capped
 * by what is left and by the room the drawing budget still has. Never negative.
 */
export function offeredMore(page: number, left: number, room: number): number {
  return Math.max(0, Math.min(page, left, room));
}

/** The rows each kind draws before Show more is pressed. */
const FIRST_PAGE: Readonly<Record<EchoKind, number>> = {
  nearby: ROW_PAGE,
  overused: ROW_PAGE,
  phrase: ROW_PAGE,
};

/** One kind's UI: its tab title, its empty line, and the settings switch that enables it. */
const KIND_UI: Readonly<
  Record<EchoKind, { tab: EchoKey; empty: EchoKey; enabled: "nearby" | "overused" | "phrases" }>
> = {
  nearby: { tab: "tab.nearby", empty: "empty.nearby", enabled: "nearby" },
  overused: { tab: "tab.overused", empty: "empty.overused", enabled: "overused" },
  phrase: { tab: "tab.phrase", empty: "empty.phrase", enabled: "phrases" },
};

/** The editor-highlight switch label for each kind. */
const EDITOR_KIND_LABEL: Readonly<Record<EchoKind, EchoKey>> = {
  nearby: "settings.editor.nearby",
  overused: "settings.editor.overused",
  phrase: "settings.editor.phrase",
};

/** Adds a word to the ignore list unless it is already there, case-insensitively. */
function withIgnored(ignore: readonly string[], word: string): string[] {
  const trimmed = word.trim();
  const key = trimmed.toLowerCase();
  if (key === "" || ignore.some((entry) => entry.trim().toLowerCase() === key)) {
    return [...ignore];
  }
  return [...ignore, trimmed];
}

/** Reads one Chapter's text by id; a missing Chapter or a refused read is empty text. */
async function loadChapter(client: PluginClient, chapterId: string): Promise<ReportChapter> {
  try {
    const chapter = await client.library.chapters.get({ chapterId });
    return { id: chapterId, text: chapter?.content.text ?? "" };
  } catch {
    return { id: chapterId, text: "" };
  }
}

/** True when a `library.changed` payload touches the Book the report shows. */
function touchesBook(
  payload: { scope: "all" } | { entity: string; id: string },
  bookId: string
): boolean {
  if ("scope" in payload) return payload.scope === "all";
  return payload.entity === "book" && payload.id === bookId;
}

/**
 * The selection a Book list and a stored scope imply: the scoped Book when it is
 * still present, else the first Book; the scope is that Chapter when one is set.
 */
function selectionFor(
  books: readonly LibraryBook[],
  scope: EchoScope | null
): { bookId: string | null; scopeKey: string } {
  const bookId =
    scope !== null && books.some((book) => book.id === scope.bookId)
      ? scope.bookId
      : (books[0]?.id ?? null);
  return {
    bookId,
    scopeKey:
      scope !== null && scope.chapterId !== undefined && bookId === scope.bookId
        ? scope.chapterId
        : SCOPE_WHOLE,
  };
}

/**
 * True when two settings objects carry the same detection values: compared in
 * the report cache key's canonical form, so a new setting is never missed.
 */
function sameSettings(a: EchoSettings, b: EchoSettings): boolean {
  return reportCacheKey("", "", a) === reportCacheKey("", "", b);
}

/** True when two Book lists carry the same Books in the same order. */
function sameBooks(a: readonly LibraryBook[], b: readonly LibraryBook[]): boolean {
  // The title is what the Book select shows and the language drives detection,
  // so a rename or a language change is a change too.
  return (
    a.length === b.length &&
    a.every(
      (book, index) =>
        book.id === b[index].id &&
        book.title === b[index].title &&
        book.language === b[index].language
    )
  );
}

/** One occurrence row as the group draws it: its context label, Chapter title, and reveal range. */
interface EchoOccurrenceRow {
  key: string;
  label: string;
  description: string;
  chapterId: string | null;
  from: number;
  to: number;
}

interface EchoRowGroupProps {
  row: EchoReportRow;
  rowId: string;
  isExpanded: boolean;
  /** How many of the row's occurrences the page draws once it is expanded. */
  occurrenceLimit: number;
  language: string;
  summary: string;
  /** The report's Chapters, which the occurrences index into; one array per report. */
  chapters: readonly ReportChapter[];
  titleById: ReadonlyMap<string, string>;
  /** How many more occurrences the Show more row offers; 0 hides it. */
  moreOccurrences: number;
  onToggle: (rowId: string, open: boolean) => void;
  onIgnore: (row: EchoReportRow) => void;
  onOpen: (chapterId: string, from: number, to: number) => void;
  onMoreOccurrences: (rowId: string, count: number) => void;
}

/**
 * One top-level row, its shown occurrences, and its Show more row. Memoized so a
 * tab switch or a Show more press re-renders only the rows whose props changed:
 * every callback it gets is stable, and its Item Menu is stable per language.
 */
const EchoRowGroup = memo(function EchoRowGroup({
  row,
  rowId,
  isExpanded,
  occurrenceLimit,
  moreOccurrences,
  language,
  summary,
  chapters,
  titleById,
  onToggle,
  onIgnore,
  onOpen,
  onMoreOccurrences,
}: EchoRowGroupProps) {
  const menuItems = useMemo(
    () => [{ value: IGNORE_ACTION, label: translate(language, "ignore") }],
    [language]
  );
  // An expanded row's occurrences: the first `occurrenceLimit` only, so the
  // host draws at most that many rows for the one expansion. Built here, from
  // inputs that only change with the report, so the memo holds while expanded.
  const occurrences = useMemo((): EchoOccurrenceRow[] | undefined => {
    if (!isExpanded) return undefined;
    return row.occurrences.slice(0, occurrenceLimit).map((occurrence, index) => {
      const chapter = chapters[occurrence.chapter];
      return {
        key: String(index),
        label: clampText(occurrenceContext(chapter?.text ?? "", occurrence), ROW_LABEL_MAX),
        description:
          chapter === undefined
            ? ""
            : clampText(titleById.get(chapter.id) ?? "", ROW_DESCRIPTION_MAX),
        chapterId: chapter?.id ?? null,
        from: occurrence.from,
        to: occurrence.to,
      };
    });
  }, [isExpanded, row, occurrenceLimit, chapters, titleById]);
  const occurrencesLeft = row.occurrences.length - occurrenceLimit;
  return (
    <>
      <ui.CollectionRow
        id={rowId}
        label={clampText(row.label, ROW_LABEL_MAX)}
        description={summary}
        isExpandable
        isExpanded={isExpanded}
        onExpandedChange={(event) => onToggle(rowId, event.detail)}
        menuItems={menuItems}
        onMenuAction={() => onIgnore(row)}
      />
      {occurrences?.map((occurrence) => (
        <ui.CollectionRow
          key={`${rowId}:${occurrence.key}`}
          id={`${rowId}:${occurrence.key}`}
          // The echoed word alone would repeat row after row; the context
          // around this occurrence is the label that tells them apart, and the
          // Chapter it sits in is the right-aligned description.
          label={occurrence.label}
          description={occurrence.description}
          onAction={() => {
            if (occurrence.chapterId !== null) {
              onOpen(occurrence.chapterId, occurrence.from, occurrence.to);
            }
          }}
        />
      ))}
      {isExpanded && moreOccurrences > 0 ? (
        <ui.CollectionRow
          id={`${rowId}:more`}
          label={format(translate(language, "report.showMoreOccurrences"), {
            count: moreOccurrences,
            left: occurrencesLeft,
          })}
          onAction={() => onMoreOccurrences(rowId, moreOccurrences)}
        />
      ) : null}
    </>
  );
});

/**
 * The report page (#450, unit 3): a Book and scope header, the three kind tabs,
 * and their rows. It computes on open and whenever the Book or scope changes,
 * marks itself out of date on a `library.changed` that touches the Book (without
 * ever reordering on its own), and recomputes only when Refresh is pressed.
 */
function createReportPage(client: PluginClient, runtime: EchoRuntime): ComponentType {
  function ReportPage() {
    const language = useEchoLanguage(client);

    // The page state a previous visit left on the runtime, read once at mount so
    // this render starts from it rather than the loading screen. The remembered
    // selection is reused only while the runtime's scope has not moved since it
    // was derived; a `Find echoes` run since then wins and is applied here the
    // way a cold open applies it. The kept report, when one exists for the
    // resulting key, is painted on this first render with no compute.
    const [initial] = useState(() => {
      const remembered = runtime.page;
      const books = remembered?.books ?? [];
      const reuse = remembered !== null && runtime.scope === remembered.scopeSeen;
      const selection = reuse
        ? { bookId: remembered.bookId, scopeKey: remembered.scopeKey }
        : selectionFor(books, runtime.scope);
      const settings = remembered?.settings ?? { ...DEFAULT_ECHO_SETTINGS, ignore: [] };
      const kept =
        selection.bookId === null
          ? undefined
          : runtime.reports.get(reportCacheKey(selection.bookId, selection.scopeKey, settings));
      return {
        remembered: remembered !== null,
        scopeSeen: runtime.scope,
        books,
        chapters: remembered?.chapters ?? [],
        bookId: selection.bookId,
        scopeKey: selection.scopeKey,
        settings,
        kept,
      };
    });

    const [initialized, setInitialized] = useState(() => initial.remembered);
    const [books, setBooks] = useState<LibraryBook[]>(() => initial.books);
    const [bookId, setBookId] = useState<string | null>(() => initial.bookId);
    const [chapters, setChapters] = useState<LibraryChapter[]>(() => initial.chapters);
    const [scopeKey, setScopeKey] = useState<string>(() => initial.scopeKey);
    const [settings, setSettings] = useState<EchoSettings>(() => initial.settings);
    const [report, setReport] = useState<EchoReport | null>(() => initial.kept?.report ?? null);
    const [computing, setComputing] = useState(false);
    const [progress, setProgress] = useState<ReportProgress>({ done: 0, total: 0 });
    const [stale, setStale] = useState(() => initial.kept?.stale ?? false);
    const [tab, setTab] = useState<EchoKind>("nearby");
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
    // Bumped when the background load finds settings that differ from the ones
    // on screen, so the compute effect recomputes for the new cache key. An
    // in-page Ignore word changes settings too, but handles its own report, so
    // it must not bump this.
    const [settingsVersion, setSettingsVersion] = useState(0);
    const [reloadToken, setReloadToken] = useState(0);
    const [shown, setShown] = useState<Readonly<Record<EchoKind, number>>>(FIRST_PAGE);
    const [occurrenceLimits, setOccurrenceLimits] = useState<Readonly<Record<string, number>>>({});

    // The latest values the async flows read, kept in refs so they never close
    // over a stale render (the event handler and the compute effect both need
    // what the current selection is, not what it was when they were created).
    const bookIdRef = useRef<string | null>(initial.bookId);
    const scopeKeyRef = useRef<string>(initial.scopeKey);
    const settingsRef = useRef<EchoSettings>(initial.settings);
    const booksRef = useRef<LibraryBook[]>(initial.books);
    const chapterListRef = useRef<LibraryChapter[]>(initial.chapters);
    const chaptersRef = useRef<readonly ReportChapter[]>(initial.kept?.chapters ?? []);
    // The Refresh token the last compute saw: a new token is an author's Refresh,
    // which skips the cache; any other run (open, Book or scope change) may use it.
    const lastReloadToken = useRef(0);
    // The cache key and selection of the report on screen, for Ignore word.
    const displayed = useRef<{ key: string; bookId: string; scopeKey: string } | null>(null);

    // Records the page's current selection on the runtime, so the next mount
    // starts from it. Callers keep the refs in step before calling.
    const rememberPage = useCallback(() => {
      runtime.page = {
        settings: settingsRef.current,
        books: booksRef.current,
        chapters: chapterListRef.current,
        bookId: bookIdRef.current,
        scopeKey: scopeKeyRef.current,
        scopeSeen: runtime.scope,
      };
    }, [runtime]);

    // The initial load runs on every mount: the stored settings and the
    // Library's Books. Over a revisit it never shows a loading screen; it only
    // updates what actually changed, and the compute effect reacts to a settings
    // change through the cache key. When the remembered Book is gone it falls
    // back exactly as a cold open does; otherwise it keeps the selection.
    useEffect(() => {
      let cancelled = false;
      void (async () => {
        const [stored, list] = await Promise.all([
          readEchoesSettings(client),
          client.library.books.list().catch((): LibraryBook[] => []),
        ]);
        if (cancelled) return;
        if (!sameSettings(settingsRef.current, stored)) {
          settingsRef.current = stored;
          setSettings(stored);
          setSettingsVersion((version) => version + 1);
        }
        if (!sameBooks(booksRef.current, list)) {
          booksRef.current = list;
          setBooks(list);
        }
        const scope = runtime.scope;
        const keep =
          initial.remembered &&
          scope === initial.scopeSeen &&
          initial.bookId !== null &&
          list.some((book) => book.id === initial.bookId);
        if (!keep) {
          const selection = selectionFor(list, scope);
          bookIdRef.current = selection.bookId;
          scopeKeyRef.current = selection.scopeKey;
          setBookId(selection.bookId);
          setScopeKey(selection.scopeKey);
        }
        rememberPage();
        setInitialized(true);
      })();
      return () => {
        cancelled = true;
      };
    }, [client, runtime, initial, rememberPage]);

    // The scope select's Chapters, read whenever the Book changes.
    useEffect(() => {
      if (!initialized || bookId === null) {
        setChapters([]);
        return;
      }
      let cancelled = false;
      void client.library.chapters
        .list({ bookId })
        .then((list) => {
          if (cancelled) return;
          chapterListRef.current = list;
          setChapters(list);
          // Keep the remembered Chapters in step, so a revisit paints the scope
          // picker and the row titles from them.
          rememberPage();
        })
        .catch(() => {
          if (!cancelled) setChapters([]);
        });
      return () => {
        cancelled = true;
      };
    }, [client, initialized, bookId, rememberPage]);

    // Compute on open and whenever the Book, the scope, or a Refresh changes. A
    // kept report for the same Book, scope, and settings is shown as it is; only
    // a Refresh (a new token) recomputes it. Detection reads the Book's own
    // language; the app language is UI only.
    useEffect(() => {
      if (!initialized || bookId === null) return;
      const scope: ReportScope = scopeKey === SCOPE_WHOLE ? "book" : "chapter";
      const bookLanguage = booksRef.current.find((book) => book.id === bookId)?.language ?? "en";
      const key = reportCacheKey(bookId, scopeKey, settingsRef.current);
      const refreshed = lastReloadToken.current !== reloadToken;
      lastReloadToken.current = reloadToken;
      const kept = refreshed ? undefined : runtime.reports.get(key);
      displayed.current = { key, bookId, scopeKey };
      let cancelled = false;
      setStale(false);
      setExpanded(new Set());
      setShown(FIRST_PAGE);
      setOccurrenceLimits({});
      if (kept !== undefined) {
        chaptersRef.current = kept.chapters;
        setReport(kept.report);
        setStale(kept.stale);
        setComputing(false);
        return () => {
          cancelled = true;
        };
      }
      setComputing(true);
      if (!runtime.changes.has(bookId)) runtime.changes.set(bookId, 0);
      const changesBefore = runtime.changes.get(bookId);
      void (async () => {
        try {
          const source: ReportSource =
            scope === "book"
              ? await bookSource(client, bookId)
              : { count: 1, load: () => loadChapter(client, scopeKey) };
          if (cancelled) return;
          // The bar repaints the whole page across the Remote UI connection, so
          // on a long Book a per-Chapter update would spend more time repainting
          // than reading. It moves in at most `PROGRESS_STEPS` steps, plus the
          // final one.
          const step = Math.max(1, Math.ceil(source.count / PROGRESS_STEPS));
          let bucket = -1;
          const result = await computeReport(source, bookLanguage, settingsRef.current, {
            scope,
            onProgress: (next) => {
              if (cancelled) return;
              const nextBucket = Math.floor((next.done - 1) / step);
              if (next.done >= next.total || nextBucket !== bucket) {
                bucket = nextBucket;
                setProgress(next);
              }
            },
          });
          if (cancelled) return;
          chaptersRef.current = result.chapters;
          setReport(result.report);
          runtime.reports.set(key, {
            bookId,
            report: result.report,
            chapters: result.chapters,
            stale: runtime.changes.get(bookId) !== changesBefore,
          });
        } catch {
          if (!cancelled) setReport(EMPTY_REPORT);
        } finally {
          if (!cancelled) setComputing(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [client, runtime, initialized, bookId, scopeKey, settingsVersion, reloadToken]);

    // A `library.changed` that touches the shown Book only marks the report out
    // of date; it never recomputes or reorders (a list that moves under the
    // focused row breaks keyboard and screen-reader use).
    useEffect(() => {
      let active = true;
      let unsubscribe: (() => Promise<void>) | null = null;
      void client
        .on("library.changed", (payload) => {
          const current = bookIdRef.current;
          if (current !== null && touchesBook(payload, current)) {
            setStale(true);
            runtime.reports.markStale(current);
          }
        })
        .then((off) => {
          if (active) unsubscribe = off;
          else void off();
        })
        .catch(() => {});
      return () => {
        active = false;
        if (unsubscribe !== null) void unsubscribe();
      };
    }, [client, runtime]);

    const selectBook = useCallback(
      (id: string) => {
        bookIdRef.current = id;
        scopeKeyRef.current = SCOPE_WHOLE;
        setBookId(id);
        setScopeKey(SCOPE_WHOLE);
        setExpanded(new Set());
        setShown(FIRST_PAGE);
        setOccurrenceLimits({});
        rememberPage();
      },
      [rememberPage]
    );

    // The scope select's own change: the Chapter (or Whole Book) is remembered
    // too, so a revisit lands on it.
    const selectScope = useCallback(
      (key: string) => {
        scopeKeyRef.current = key;
        setScopeKey(key);
        rememberPage();
      },
      [rememberPage]
    );

    // One row open at a time: opening a row closes the rest, and their shown
    // occurrence counts go with them, so the drawn rows stay inside the budget.
    const toggleRow = useCallback((rowId: string, open: boolean) => {
      setExpanded(open ? new Set([rowId]) : new Set());
      if (open) {
        setOccurrenceLimits((current) => {
          const kept = current[rowId];
          if (kept === undefined) return Object.keys(current).length === 0 ? current : {};
          return { [rowId]: kept };
        });
      }
    }, []);

    const ignoreRow = useCallback(
      (row: EchoReportRow) => {
        const next = {
          ...settingsRef.current,
          ignore: withIgnored(settingsRef.current.ignore, row.label),
        };
        const shown = displayed.current;
        const kept = shown === null ? undefined : runtime.reports.get(shown.key);
        settingsRef.current = next;
        setSettings(next);
        rememberPage();
        void writeEchoesSettings(client, next);
        // Remove the row now; the report is not recomputed for an ignore. The
        // kept report moves to the key the new settings give, so a revisit still
        // omits the row without a compute. The displayed report and the kept one
        // are the same report, so the filter runs over the kept copy.
        const filter = (report: EchoReport): EchoReport => ({
          ...report,
          [row.kind]: report[row.kind].filter((entry) => entry.key !== row.key),
        });
        if (shown !== null && kept !== undefined) {
          const nextKey = reportCacheKey(shown.bookId, shown.scopeKey, next);
          const filtered = filter(kept.report);
          runtime.reports.delete(shown.key);
          runtime.reports.set(nextKey, { ...kept, report: filtered });
          displayed.current = { ...shown, key: nextKey };
          setReport(filtered);
        } else {
          setReport((current) => (current === null ? current : filter(current)));
        }
      },
      [client, runtime, rememberPage]
    );

    const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

    // The rows follow the deferred tab: the urgent `tab` moves the selection at
    // once, and the rows fill in on the next render, so a switch paints first.
    const shownTab = useDeferredValue(tab);

    // The loaded report Chapters carry only id and text; the Library list the
    // page already read carries the titles, so map id to title for the rows.
    const titleById = useMemo(
      () => new Map(chapters.map((chapter) => [chapter.id, chapter.title])),
      [chapters]
    );

    const openOccurrence = useCallback(
      (chapterId: string, from: number, to: number) => {
        void client.navigation.openEntity({
          entity: { kind: "chapter", id: chapterId },
          reveal: { from, to },
        });
      },
      [client]
    );

    const showMoreRows = useCallback((kind: EchoKind, count: number) => {
      setShown((current) => ({ ...current, [kind]: current[kind] + count }));
    }, []);

    const showMoreOccurrences = useCallback((rowId: string, count: number) => {
      setOccurrenceLimits((current) => ({
        ...current,
        [rowId]: (current[rowId] ?? OCCURRENCE_PAGE) + count,
      }));
    }, []);

    if (!initialized) {
      return (
        <ui.View direction="column" gap="md">
          <ui.ProgressBar label={translate(language, "report.loading")} isIndeterminate />
        </ui.View>
      );
    }

    if (books.length === 0) {
      return (
        <ui.View direction="column" gap="md">
          <ui.Text>{translate(language, "report.noBook")}</ui.Text>
        </ui.View>
      );
    }

    const rows = report?.[shownTab] ?? [];
    // A row names its Chapters by title, in Chapter order; a Chapter without a
    // title (or one the list no longer carries) falls back to its number.
    const chapterTitles = (indexes: readonly number[]): string[] =>
      indexes.map((index) => {
        const id = chaptersRef.current[index]?.id;
        const title = id === undefined ? undefined : titleById.get(id);
        return title !== undefined && title.trim() !== "" ? title : String(index + 1);
      });
    // A word echoed across many Chapters names only the titles that fit the
    // host's description cap, then how many it left out.
    const rowSummary = (row: EchoReportRow): string => {
      const template = translate(language, "report.summary", row.count);
      return fitChapterTitles(
        chapterTitles(row.chapterIndexes),
        (chapters) => format(template, { count: row.count, chapters }),
        (hidden) => format(translate(language, "report.moreChapters"), { count: hidden }),
        ROW_DESCRIPTION_MAX
      );
    };
    const scopeOptions = [
      { value: SCOPE_WHOLE, label: translate(language, "wholeBook") },
      ...chapters.map((chapter) => ({ value: chapter.id, label: chapter.title })),
    ];
    const tabItems = ECHO_KINDS.map((kind) => ({
      value: kind,
      label: translate(language, KIND_UI[kind].tab),
    }));

    // Detection reads the Book's own language; en/es are fully supported, any
    // other language runs without stop words or a stemmer, and the report says so.
    const bookLanguage = books.find((book) => book.id === bookId)?.language ?? "en";
    const limitedLanguage = languageSupport(bookLanguage) === "limited" ? bookLanguage : null;
    const activeKind = shownTab;
    const kindEnabled = settings[KIND_UI[activeKind].enabled];
    const rowsLeft = Math.max(0, rows.length - shown[activeKind]);
    // The rows the top Show more press may add: a page, within the budget left
    // after the open row's occurrence page and its Show more row (one each).
    const topMore = offeredMore(
      ROW_PAGE,
      rowsLeft,
      DRAW_BUDGET - OCCURRENCE_PAGE - 1 - shown[activeKind]
    );

    const activeChildren: ReactNode[] = rows.slice(0, shown[activeKind]).map((row) => {
      const rowId = `${activeKind}:${row.key}`;
      const isExpanded = expanded.has(rowId);
      const occurrenceLimit = occurrenceLimits[rowId] ?? OCCURRENCE_PAGE;
      // The open row's Show more row: a page, within the budget left after the
      // rows shown and the row's own shown occurrences and its Show more row.
      const moreOccurrences = isExpanded
        ? offeredMore(
            OCCURRENCE_PAGE,
            row.occurrences.length - occurrenceLimit,
            DRAW_BUDGET - shown[activeKind] - 1 - occurrenceLimit
          )
        : 0;
      return (
        <EchoRowGroup
          key={rowId}
          row={row}
          rowId={rowId}
          isExpanded={isExpanded}
          occurrenceLimit={occurrenceLimit}
          moreOccurrences={moreOccurrences}
          language={language}
          summary={rowSummary(row)}
          chapters={chaptersRef.current}
          titleById={titleById}
          onToggle={toggleRow}
          onIgnore={ignoreRow}
          onOpen={openOccurrence}
          onMoreOccurrences={showMoreOccurrences}
        />
      );
    });

    return (
      <ui.View direction="column" gap="md">
        <ui.View direction="row" gap="md" align="end">
          <ui.Select
            label={translate(language, "report.book")}
            options={fitOptions(
              books.map((book) => ({ value: book.id, label: book.title })),
              bookId ?? "",
              PLUGIN_UI_LIMITS.maxOptions
            )}
            selectedKey={bookId ?? ""}
            onChange={(event) => {
              if (event.detail !== "") selectBook(event.detail);
            }}
          />
          <ui.Select
            label={translate(language, "report.scope")}
            options={fitOptions(scopeOptions, scopeKey, PLUGIN_UI_LIMITS.maxOptions)}
            selectedKey={scopeKey}
            onChange={(event) => selectScope(event.detail)}
          />
        </ui.View>

        {limitedLanguage !== null ? (
          <ui.Text tone="muted">
            {format(translate(language, "report.limitedSupport"), { language: limitedLanguage })}
          </ui.Text>
        ) : null}

        {stale ? (
          <ui.View direction="row" gap="sm" align="center">
            <ui.Text tone="muted">{translate(language, "stale")}</ui.Text>
            <ui.Button variant="secondary" onPress={refresh}>
              {translate(language, "refresh")}
            </ui.Button>
          </ui.View>
        ) : null}

        {computing && report !== null ? (
          <ui.ProgressBar
            label={translate(language, "report.computing")}
            value={progress.done}
            maxValue={Math.max(1, progress.total)}
          />
        ) : null}

        {report === null ? (
          // The first compute runs with the page's header already drawn; the
          // determinate bar reports its progress instead of hiding the page.
          computing ? (
            <ui.ProgressBar
              label={translate(language, "report.computing")}
              value={progress.done}
              maxValue={Math.max(1, progress.total)}
            />
          ) : null
        ) : (
          <ui.Tabs
            label={translate(language, "report.tabs")}
            items={tabItems}
            selectedKey={tab}
            onChange={(event) => setTab(event.detail as EchoKind)}
          >
            {rows.length === 0 ? (
              <ui.Text tone="muted">
                {kindEnabled
                  ? translate(language, KIND_UI[activeKind].empty)
                  : translate(language, "kind.off")}
              </ui.Text>
            ) : (
              <ui.View direction="column" gap="sm">
                <ui.Collection
                  label={translate(language, KIND_UI[activeKind].tab)}
                  selectionMode="none"
                >
                  {activeChildren}
                </ui.Collection>
                {topMore > 0 ? (
                  <ui.Button variant="secondary" onPress={() => showMoreRows(activeKind, topMore)}>
                    {format(translate(language, "report.showMore"), {
                      count: topMore,
                      left: rowsLeft,
                    })}
                  </ui.Button>
                ) : null}
              </ui.View>
            )}
          </ui.Tabs>
        )}
      </ui.View>
    );
  }
  return ReportPage;
}

/** A whole-Book source: the Book's Chapters in order, each read on demand. */
async function bookSource(client: PluginClient, bookId: string): Promise<ReportSource> {
  const list = await client.library.chapters.list({ bookId });
  return {
    count: list.length,
    load: (index) => loadChapter(client, list[index].id),
  };
}

/**
 * The app language as the SDK signals it: the current value at mount, then
 * every change, in React state so the page re-renders on a switch.
 */
function useEchoLanguage(client: PluginClient): string {
  const [language, setLanguage] = useState("en");
  useEffect(() => {
    let active = true;
    const apply = (next: string) => {
      if (active) setLanguage(next);
    };
    void client.language
      .get()
      .then((value) => apply(value.language))
      .catch(() => {});
    let unsubscribe: (() => Promise<void>) | null = null;
    void client
      .on("language.changed", (payload) => apply(payload.language))
      .then((off) => {
        unsubscribe = off;
      })
      .catch(() => {});
    return () => {
      active = false;
      if (unsubscribe !== null) void unsubscribe();
    };
  }, [client]);
  return language;
}

/** The catalog key of each Palette's name, shown beside its swatches (#533). */
const PALETTE_LABEL: Readonly<Record<EchoPaletteId, EchoKey>> = {
  "okabe-ito": "palette.okabe-ito",
  vivid: "palette.vivid",
  soft: "palette.soft",
};

/**
 * The `detection` Settings row's body: one switch per echo kind the detection
 * supports, the stemming switch, the nearby-echo window, and the ignore list,
 * then the editor-highlight switches — the kinds the editor paints, nearby only
 * until the author turns the others on (#451, decision 3). Values load from the
 * Plugin's storage on mount and every change is written back, so the row
 * survives a reload; a change to the editor kinds also asks the controller to
 * recompute, so an open editor updates at once. Labels come from the runtime
 * catalogs.
 */

function createDetectionSettings(
  client: PluginClient,
  editor: Pick<EchoEditorController, "refresh">
): ComponentType {
  function DetectionSettings() {
    const language = useEchoLanguage(client);
    const [settings, setSettings] = useState<EchoSettings>(() => ({
      ...DEFAULT_ECHO_SETTINGS,
      ignore: [],
    }));
    const [editorKinds, setEditorKinds] = useState<readonly EchoKind[]>(DEFAULT_EDITOR_KINDS);
    // "Color highlights by echo" is off until the author turns it on (#532).
    const [colorByEcho, setColorByEcho] = useState(false);
    // The Palette the colors come from; the dropdown is disabled while coloring is off (#533).
    const [palette, setPalette] = useState<EchoPaletteId>(DEFAULT_ECHO_PALETTE);
    // Nothing is written before the stored value has been read, so a slow read
    // cannot be clobbered by the initial defaults.
    const hydrated = useRef(false);

    useEffect(() => {
      let cancelled = false;
      void Promise.all([
        readEchoesSettings(client),
        readEditorKinds(client),
        readColorByEcho(client),
        readEchoPalette(client),
      ]).then(([stored, kinds, color, storedPalette]) => {
        if (cancelled) return;
        hydrated.current = true;
        setSettings(stored);
        setEditorKinds(kinds);
        setColorByEcho(color);
        setPalette(storedPalette);
      });
      return () => {
        cancelled = true;
      };
    }, [client]);

    useEffect(() => {
      if (!hydrated.current) return;
      void writeEchoesSettings(client, settings);
    }, [client, settings]);

    // The kinds the editor paints are stored, then applied to an open editor at
    // once (#451): `refresh` recomputes when highlighting is on and is a no-op
    // otherwise.
    useEffect(() => {
      if (!hydrated.current) return;
      void writeEditorKinds(client, editorKinds).then(() => editor.refresh());
    }, [client, editor, editorKinds]);

    const update = useCallback((patch: Partial<EchoSettings>) => {
      setSettings((current) => ({ ...current, ...patch }));
    }, []);

    const toggleKind = useCallback((kind: EchoKind) => {
      setEditorKinds((current) => toggledEditorKind(current, kind));
    }, []);

    // The color switch is stored and repaints an open editor at once (#532).
    useEffect(() => {
      if (!hydrated.current) return;
      void writeColorByEcho(client, colorByEcho).then(() => editor.refresh());
    }, [client, editor, colorByEcho]);

    // The Palette is stored and repaints an open editor at once (#533).
    useEffect(() => {
      if (!hydrated.current) return;
      void writeEchoPalette(client, palette).then(() => editor.refresh());
    }, [client, editor, palette]);

    return (
      <ui.View direction="column" gap="md">
        <ui.Switch
          label={translate(language, "settings.nearby")}
          isSelected={settings.nearby}
          onChange={(event) => update({ nearby: event.detail })}
        />
        <ui.Switch
          label={translate(language, "settings.overused")}
          isSelected={settings.overused}
          onChange={(event) => update({ overused: event.detail })}
        />
        <ui.Switch
          label={translate(language, "settings.phrase")}
          isSelected={settings.phrases}
          onChange={(event) => update({ phrases: event.detail })}
        />
        <ui.Switch
          label={translate(language, "settings.stemming")}
          isSelected={settings.stemming}
          onChange={(event) => update({ stemming: event.detail })}
        />
        <ui.NumberField
          label={translate(language, "settings.nearbyWindow")}
          value={settings.nearbyWindow}
          // The field carries detection's own range so a typed value is clamped
          // on commit; the settings module clamps again as the storage guard,
          // so anything read from a stale or malformed store stays in range.
          minValue={NEARBY_WINDOW_MIN}
          maxValue={NEARBY_WINDOW_MAX}
          onChange={(event) => update({ nearbyWindow: clampNearbyWindow(event.detail) })}
        />
        <ui.MultiSelectCombobox
          label={translate(language, "settings.ignoreList")}
          options={[]}
          selectedKeys={settings.ignore}
          allowsCustomValue
          onChange={(event) => update({ ignore: [...event.detail] })}
        />
        <ui.Heading level={3}>{translate(language, "settings.editor.title")}</ui.Heading>
        <ui.Switch
          label={translate(language, EDITOR_KIND_LABEL.nearby)}
          isSelected={editorKinds.includes("nearby")}
          onChange={() => toggleKind("nearby")}
        />
        <ui.Switch
          label={translate(language, EDITOR_KIND_LABEL.overused)}
          isSelected={editorKinds.includes("overused")}
          onChange={() => toggleKind("overused")}
        />
        <ui.Switch
          label={translate(language, EDITOR_KIND_LABEL.phrase)}
          isSelected={editorKinds.includes("phrase")}
          onChange={() => toggleKind("phrase")}
        />
        <ui.Switch
          label={translate(language, "settings.editor.color")}
          isSelected={colorByEcho}
          onChange={(event) => setColorByEcho(event.detail)}
        />
        <ui.Select
          label={translate(language, "settings.editor.palette")}
          isDisabled={!colorByEcho}
          selectedKey={palette}
          options={ECHO_PALETTE_IDS.map((id) => ({
            value: id,
            label: translate(language, PALETTE_LABEL[id]),
            swatches: [...ECHO_PALETTES[id]],
          }))}
          onChange={(event) => setPalette(parseEchoPalette(event.detail))}
        />
      </ui.View>
    );
  }
  return DetectionSettings;
}
