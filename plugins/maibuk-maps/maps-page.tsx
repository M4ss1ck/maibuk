/**
 * The Maps page (#744): every Map, most recently changed first, as a grid of
 * preview cards drawn with SDK components, so Maibuk owns focus, keyboard
 * behavior, and accessibility. A Book filter narrows the grid ("All" also shows
 * Maps with no Book); New Map, Rename, and Delete each open a host dialog.
 *
 * The page reads only the index (`MapStore.list`), never a whole Map. The
 * filter lives on the runtime, so the Book Item Menu entry can set it before
 * the page opens. This module imports only `@/plugin-sdk` and its own files.
 */

import { useEffect, useRef, useState, type ComponentType } from "react";
import { ui, type PluginClient } from "@/plugin-sdk";
import { format, translate, type MapsKey } from "./i18n";
import { PAGE_PRESETS, type MapIndexEntry, type MapStore, type PagePreset } from "./maps";

/** The page id, exactly as the manifest declares it. */
export const MAPS_PAGE_ID = "maps";

/** The filter value that shows every Map. */
export const ALL_BOOKS = "all";

/** The Book select value for a Map with no Book. */
const NO_BOOK = "none";

/** The Book filter the runtime shares between the page and the Book Item Menu entry. */
export interface BookFilter {
  get(): string;
  set(bookId: string): void;
  subscribe(listener: (bookId: string) => void): () => void;
}

export function createBookFilter(): BookFilter {
  let current = ALL_BOOKS;
  const listeners = new Set<(bookId: string) => void>();
  return {
    get: () => current,
    set(bookId) {
      current = bookId;
      for (const listener of listeners) listener(bookId);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export interface MapsPageDeps {
  client: PluginClient;
  store: MapStore;
  filter: BookFilter;
}

/** A Book as the Library read returns it. */
type LibraryBook = Awaited<ReturnType<PluginClient["library"]["books"]["list"]>>[number];

const PAGE_KEYS: Readonly<Record<PagePreset, MapsKey>> = {
  portrait: "page.portrait",
  landscape: "page.landscape",
  spread: "page.spread",
  square: "page.square",
};

/** The app language: the current value at mount, then every change. */
function useLanguage(client: PluginClient): string {
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

/** The cards fill as many columns as the page is wide; previews keep a 3:2 frame. */
export const MAPS_CSS = `
ul { display: grid; grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr)); gap: 1.5rem 1rem; }
li { display: flex; flex-direction: column; gap: 0.5rem; min-width: 0; }
li > :first-child { aspect-ratio: 3 / 2; width: 100%; overflow: hidden; border-radius: 0.375rem; border: 1px solid var(--color-border); background: var(--color-muted); display: flex; align-items: center; justify-content: center; }
li > :first-child img { width: 100%; height: 100%; max-width: none; object-fit: contain; border-radius: 0; }
li > div:nth-child(2) { gap: 0.125rem; }
li > div:nth-child(2) > p { overflow-wrap: anywhere; }
li > div:last-child { margin-top: auto; gap: 0; }
`;

/** The dialog the page has open, if any. */
type Dialog =
  | { kind: "create"; name: string; bookKey: string; preset: PagePreset; error: string | null }
  | { kind: "rename"; entry: MapIndexEntry; name: string; error: string | null }
  | { kind: "delete"; entry: MapIndexEntry }
  | null;

type FormDialog = Extract<NonNullable<Dialog>, { kind: "create" | "rename" }>;

/** Whether the open dialog is the New Map or Rename form. */
function isForm(dialog: Dialog): dialog is FormDialog {
  return dialog?.kind === "create" || dialog?.kind === "rename";
}

export function createMapsPage(deps: MapsPageDeps): ComponentType {
  const { client, store, filter } = deps;

  return function MapsPage() {
    const language = useLanguage(client);
    const t = (key: MapsKey) => translate(language, key);
    const [maps, setMaps] = useState<MapIndexEntry[] | null>(null);
    const [books, setBooks] = useState<LibraryBook[] | null>(null);
    const [bookFilter, setBookFilter] = useState(filter.get());
    const [dialog, setDialog] = useState<Dialog>(null);
    const [notice, setNotice] = useState<MapsKey | null>(null);
    const [busy, setBusy] = useState(false);
    // Read by the dialog's submit, which stays enabled while a write runs:
    // disabling the focused button would drop focus out of the dialog.
    const writing = useRef(false);

    // The filter a Book Item Menu entry set lasts while the page is open; the
    // next visit from the sidebar starts at All again.
    useEffect(() => {
      const unsubscribe = filter.subscribe(setBookFilter);
      return () => {
        unsubscribe();
        filter.set(ALL_BOOKS);
      };
    }, []);

    useEffect(() => {
      let active = true;
      void store
        .list()
        .then((next) => {
          if (active) setMaps(next);
        })
        .catch(() => {
          if (!active) return;
          setMaps([]);
          setNotice("list.loadFailed");
        });
      void client.library.books
        .list({})
        .then((next) => {
          if (active) setBooks([...next].sort((a, b) => a.title.localeCompare(b.title)));
        })
        .catch(() => {});
      return () => {
        active = false;
      };
    }, []);

    const bookList = books ?? [];
    const bookTitles = new Map(bookList.map((book) => [book.id, book.title]));
    // A filter naming a Book the Library read no longer lists shows every Map
    // rather than none. Until that read lands (or if it fails), the filter holds.
    const activeFilter =
      bookFilter !== ALL_BOOKS && books !== null && !bookTitles.has(bookFilter)
        ? ALL_BOOKS
        : bookFilter;
    const shown =
      maps === null
        ? []
        : activeFilter === ALL_BOOKS
          ? maps
          : maps.filter((entry) => entry.bookId === activeFilter);

    /** Runs one write; an empty name becomes the dialog's field error, anything else a notice. */
    async function write(task: () => Promise<void>, onEmptyName: () => void): Promise<void> {
      if (writing.current) return;
      writing.current = true;
      setNotice(null);
      setBusy(true);
      try {
        await task();
        setMaps(await store.list());
        setDialog(null);
      } catch (error) {
        if (error instanceof Error && error.message === "empty-name") onEmptyName();
        else {
          setDialog(null);
          setNotice("list.saveFailed");
        }
      } finally {
        writing.current = false;
        setBusy(false);
      }
    }

    function openCreate(): void {
      setDialog({
        kind: "create",
        name: "",
        bookKey: activeFilter === ALL_BOOKS ? NO_BOOK : activeFilter,
        preset: "landscape",
        error: null,
      });
    }

    function submit(): void {
      if (dialog === null) return;
      const emptyName = () =>
        setDialog((current) =>
          isForm(current) ? { ...current, error: t("dialog.emptyName") } : current
        );
      if (dialog.kind === "create") {
        const { name, bookKey, preset } = dialog;
        void write(async () => {
          await store.create({ name, bookId: bookKey === NO_BOOK ? null : bookKey, preset });
        }, emptyName);
      } else if (dialog.kind === "rename") {
        const { entry, name } = dialog;
        void write(async () => {
          await store.rename(entry.id, name);
        }, emptyName);
      } else {
        const { entry } = dialog;
        void write(
          () => store.remove(entry.id),
          () => {}
        );
      }
    }

    function meta(entry: MapIndexEntry): string {
      const size = t(PAGE_KEYS[entry.preset]);
      const book = entry.bookId === null ? undefined : bookTitles.get(entry.bookId);
      return book === undefined ? size : `${book} · ${size}`;
    }

    function edited(entry: MapIndexEntry): string {
      const when = new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(
        entry.updatedAt
      );
      return format(t("list.edited"), { when });
    }

    function action(label: string, icon: string, onPress: () => void) {
      return (
        <ui.Tooltip content={label}>
          <ui.IconButton label={label} icon={icon} isDisabled={busy} onPress={onPress} />
        </ui.Tooltip>
      );
    }

    const newButton = (
      <ui.Button variant="primary" icon="plus" isDisabled={busy} onPress={openCreate}>
        {t("list.new")}
      </ui.Button>
    );

    if (maps === null) return <ui.Text tone="muted">{t("list.loading")}</ui.Text>;

    const filterOptions = [
      { value: ALL_BOOKS, label: t("list.filter.all") },
      ...bookList.map((book) => ({ value: book.id, label: book.title })),
    ];
    const bookOptions = [
      { value: NO_BOOK, label: t("create.noBook") },
      ...bookList.map((book) => ({ value: book.id, label: book.title })),
    ];
    const pageOptions = PAGE_PRESETS.map((preset) => ({
      value: preset,
      label: t(PAGE_KEYS[preset]),
    }));

    return (
      <ui.View direction="column" gap="lg">
        <ui.View direction="row" gap="md" align="end" justify="between" wrap>
          <ui.Select
            label={t("list.filter")}
            options={filterOptions}
            selectedKey={activeFilter}
            onChange={(event) => filter.set(event.detail)}
          />
          {maps.length === 0 ? null : newButton}
        </ui.View>

        {notice === null ? null : <ui.Status tone="warning">{t(notice)}</ui.Status>}

        {shown.length === 0 ? (
          <ui.EmptyState
            title={t(activeFilter === ALL_BOOKS ? "list.emptyTitle" : "list.emptyBookTitle")}
            description={t(
              activeFilter === ALL_BOOKS ? "list.emptyDescription" : "list.emptyBookDescription"
            )}
            icon="map"
          >
            {newButton}
          </ui.EmptyState>
        ) : (
          <ui.Surface css={MAPS_CSS}>
            <ui.List marker="none">
              {shown.map((entry) => (
                <ui.ListItem key={entry.id}>
                  <ui.View>
                    <ui.Image src={entry.preview} alt={entry.name} />
                  </ui.View>
                  <ui.View direction="column">
                    <ui.Text weight="semibold">{entry.name}</ui.Text>
                    <ui.Text size="sm" tone="muted">
                      {meta(entry)}
                    </ui.Text>
                    <ui.Text size="sm" tone="muted">
                      {edited(entry)}
                    </ui.Text>
                  </ui.View>
                  <ui.View direction="row" align="center">
                    {action(`${t("list.rename")} ${entry.name}`, "pencil", () =>
                      setDialog({ kind: "rename", entry, name: entry.name, error: null })
                    )}
                    {action(`${t("list.delete")} ${entry.name}`, "trash-2", () =>
                      setDialog({ kind: "delete", entry })
                    )}
                  </ui.View>
                </ui.ListItem>
              ))}
            </ui.List>
          </ui.Surface>
        )}

        <ui.Modal
          title={t(dialog?.kind === "rename" ? "rename.title" : "create.title")}
          isOpen={isForm(dialog)}
          onOpenChange={(event) => {
            if (!event.detail) setDialog(null);
          }}
        >
          {isForm(dialog) ? (
            <ui.View direction="column" gap="md">
              <ui.TextField
                label={t("create.name")}
                value={dialog.name}
                autoFocus
                isRequired
                errorMessage={dialog.error ?? undefined}
                onInput={(event) =>
                  setDialog((current) =>
                    isForm(current) ? { ...current, name: event.detail, error: null } : current
                  )
                }
              />
              {dialog.kind === "create" ? (
                <>
                  <ui.Select
                    label={t("create.book")}
                    options={bookOptions}
                    selectedKey={dialog.bookKey}
                    onChange={(event) =>
                      setDialog((current) =>
                        current?.kind === "create" ? { ...current, bookKey: event.detail } : current
                      )
                    }
                  />
                  <ui.RadioGroup
                    label={t("create.page")}
                    options={pageOptions}
                    selectedKey={dialog.preset}
                    onChange={(event) =>
                      setDialog((current) =>
                        current?.kind === "create"
                          ? { ...current, preset: event.detail as PagePreset }
                          : current
                      )
                    }
                  />
                </>
              ) : null}
              <ui.View direction="row" gap="sm" justify="end">
                <ui.Button variant="secondary" onPress={() => setDialog(null)}>
                  {t("dialog.cancel")}
                </ui.Button>
                <ui.Button variant="primary" onPress={submit}>
                  {t(dialog.kind === "create" ? "create.submit" : "rename.submit")}
                </ui.Button>
              </ui.View>
            </ui.View>
          ) : null}
        </ui.Modal>

        <ui.ConfirmDialog
          title={
            dialog?.kind === "delete"
              ? format(t("delete.title"), { name: dialog.entry.name })
              : t("delete.confirm")
          }
          description={t("delete.description")}
          confirmLabel={t("delete.confirm")}
          cancelLabel={t("dialog.cancel")}
          isDestructive
          isOpen={dialog?.kind === "delete"}
          onConfirm={submit}
          onOpenChange={(event) => {
            if (!event.detail)
              setDialog((current) => (current?.kind === "delete" ? null : current));
          }}
        />
      </ui.View>
    );
  };
}
