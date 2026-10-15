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
  readEchoesSettings,
  readEditorKinds,
  toggledEditorKind,
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

/** The runtime's own state; one per activation, so tests never share it. */
interface EchoRuntime {
  scope: EchoScope | null;
}

/** Wires the client to the report page, the Settings row, and the Command handlers. */
export function startEchoes(client: PluginClient, serve: EchoServe): void {
  const runtime: EchoRuntime = { scope: null };
  const editor = createEchoEditor(client);
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

/** Rows, and occurrences of one row, drawn per page; the host draws every row it is given. */
const ROW_PAGE = 200;

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
  onToggle: (rowId: string, open: boolean) => void;
  onIgnore: (row: EchoReportRow) => void;
  onOpen: (chapterId: string, from: number, to: number) => void;
  onMoreOccurrences: (rowId: string) => void;
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
      {isExpanded && occurrencesLeft > 0 ? (
        <ui.CollectionRow
          id={`${rowId}:more`}
          label={format(translate(language, "report.showMoreOccurrences"), {
            count: Math.min(ROW_PAGE, occurrencesLeft),
            left: occurrencesLeft,
          })}
          onAction={() => onMoreOccurrences(rowId)}
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

    const [initialized, setInitialized] = useState(false);
    const [books, setBooks] = useState<LibraryBook[]>([]);
    const [bookId, setBookId] = useState<string | null>(null);
    const [chapters, setChapters] = useState<LibraryChapter[]>([]);
    const [scopeKey, setScopeKey] = useState<string>(SCOPE_WHOLE);
    const [settings, setSettings] = useState<EchoSettings>(() => ({
      ...DEFAULT_ECHO_SETTINGS,
      ignore: [],
    }));
    const [report, setReport] = useState<EchoReport | null>(null);
    const [computing, setComputing] = useState(false);
    const [progress, setProgress] = useState<ReportProgress>({ done: 0, total: 0 });
    const [stale, setStale] = useState(false);
    const [tab, setTab] = useState<EchoKind>("nearby");
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
    const [reloadToken, setReloadToken] = useState(0);
    const [shown, setShown] = useState<Readonly<Record<EchoKind, number>>>(FIRST_PAGE);
    const [occurrenceLimits, setOccurrenceLimits] = useState<Readonly<Record<string, number>>>({});

    // The latest values the async flows read, kept in refs so they never close
    // over a stale render (the event handler and the compute effect both need
    // what the current selection is, not what it was when they were created).
    const bookIdRef = useRef<string | null>(null);
    const settingsRef = useRef<EchoSettings>(settings);
    const booksRef = useRef<LibraryBook[]>([]);
    const chaptersRef = useRef<readonly ReportChapter[]>([]);

    // Initial load: the stored settings, the Library's Books, and the scope the
    // Find echoes Command stored (else the first Book, Whole Book).
    useEffect(() => {
      let cancelled = false;
      void (async () => {
        const [stored, list] = await Promise.all([
          readEchoesSettings(client),
          client.library.books.list().catch((): LibraryBook[] => []),
        ]);
        if (cancelled) return;
        settingsRef.current = stored;
        setSettings(stored);
        booksRef.current = list;
        setBooks(list);
        const scope = runtime.scope;
        const scopedBook =
          scope !== null && list.some((book) => book.id === scope.bookId)
            ? scope.bookId
            : (list[0]?.id ?? null);
        bookIdRef.current = scopedBook;
        setBookId(scopedBook);
        setScopeKey(
          scope !== null && scope.chapterId !== undefined && scopedBook === scope.bookId
            ? scope.chapterId
            : SCOPE_WHOLE
        );
        setInitialized(true);
      })();
      return () => {
        cancelled = true;
      };
    }, [client, runtime]);

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
          if (!cancelled) setChapters(list);
        })
        .catch(() => {
          if (!cancelled) setChapters([]);
        });
      return () => {
        cancelled = true;
      };
    }, [client, initialized, bookId]);

    // Compute on open and whenever the Book, the scope, or a Refresh changes.
    // Detection reads the Book's own language; the app language is UI only.
    useEffect(() => {
      if (!initialized || bookId === null) return;
      const scope: ReportScope = scopeKey === SCOPE_WHOLE ? "book" : "chapter";
      const bookLanguage = booksRef.current.find((book) => book.id === bookId)?.language ?? "en";
      let cancelled = false;
      setComputing(true);
      setStale(false);
      setExpanded(new Set());
      setShown(FIRST_PAGE);
      setOccurrenceLimits({});
      void (async () => {
        try {
          const source: ReportSource =
            scope === "book"
              ? await bookSource(client, bookId)
              : { count: 1, load: () => loadChapter(client, scopeKey) };
          if (cancelled) return;
          const result = await computeReport(source, bookLanguage, settingsRef.current, {
            scope,
            onProgress: (next) => {
              if (!cancelled) setProgress(next);
            },
          });
          if (cancelled) return;
          chaptersRef.current = result.chapters;
          setReport(result.report);
        } catch {
          if (!cancelled) setReport(EMPTY_REPORT);
        } finally {
          if (!cancelled) setComputing(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [client, initialized, bookId, scopeKey, reloadToken]);

    // A `library.changed` that touches the shown Book only marks the report out
    // of date; it never recomputes or reorders (a list that moves under the
    // focused row breaks keyboard and screen-reader use).
    useEffect(() => {
      let active = true;
      let unsubscribe: (() => Promise<void>) | null = null;
      void client
        .on("library.changed", (payload) => {
          const current = bookIdRef.current;
          if (current !== null && touchesBook(payload, current)) setStale(true);
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
    }, [client]);

    const selectBook = useCallback((id: string) => {
      bookIdRef.current = id;
      setBookId(id);
      setScopeKey(SCOPE_WHOLE);
      setExpanded(new Set());
      setShown(FIRST_PAGE);
      setOccurrenceLimits({});
    }, []);

    const toggleRow = useCallback((rowId: string, open: boolean) => {
      setExpanded((current) => {
        const next = new Set(current);
        if (open) next.add(rowId);
        else next.delete(rowId);
        return next;
      });
    }, []);

    const ignoreRow = useCallback(
      (row: EchoReportRow) => {
        const next = {
          ...settingsRef.current,
          ignore: withIgnored(settingsRef.current.ignore, row.label),
        };
        settingsRef.current = next;
        setSettings(next);
        void writeEchoesSettings(client, next);
        // Remove the row now; the report is not recomputed for an ignore.
        setReport((current) =>
          current === null
            ? current
            : { ...current, [row.kind]: current[row.kind].filter((entry) => entry.key !== row.key) }
        );
      },
      [client]
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

    const showMoreRows = useCallback((kind: EchoKind) => {
      setShown((current) => ({ ...current, [kind]: current[kind] + ROW_PAGE }));
    }, []);

    const showMoreOccurrences = useCallback((rowId: string) => {
      setOccurrenceLimits((current) => ({
        ...current,
        [rowId]: (current[rowId] ?? ROW_PAGE) + ROW_PAGE,
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

    const activeChildren: ReactNode[] = rows.slice(0, shown[activeKind]).map((row) => {
      const rowId = `${activeKind}:${row.key}`;
      const isExpanded = expanded.has(rowId);
      const occurrenceLimit = occurrenceLimits[rowId] ?? ROW_PAGE;
      return (
        <EchoRowGroup
          key={rowId}
          row={row}
          rowId={rowId}
          isExpanded={isExpanded}
          occurrenceLimit={occurrenceLimit}
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
            onChange={(event) => setScopeKey(event.detail)}
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
          <ui.ProgressBar label={translate(language, "report.loading")} isIndeterminate />
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
                {rowsLeft > 0 ? (
                  <ui.Button variant="secondary" onPress={() => showMoreRows(activeKind)}>
                    {format(translate(language, "report.showMore"), {
                      count: Math.min(ROW_PAGE, rowsLeft),
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
    // Nothing is written before the stored value has been read, so a slow read
    // cannot be clobbered by the initial defaults.
    const hydrated = useRef(false);

    useEffect(() => {
      let cancelled = false;
      void Promise.all([readEchoesSettings(client), readEditorKinds(client)]).then(
        ([stored, kinds]) => {
          if (cancelled) return;
          hydrated.current = true;
          setSettings(stored);
          setEditorKinds(kinds);
        }
      );
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
      </ui.View>
    );
  }
  return DetectionSettings;
}
