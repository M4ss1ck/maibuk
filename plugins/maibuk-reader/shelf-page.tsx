/**
 * The Shelf page (#653): the Documents Reader remembers on this device, most
 * recently read first, as a grid of covers drawn with SDK components so Maibuk
 * owns focus, keyboard behavior, and accessibility. Each card offers Open and
 * Remove from Shelf as icon buttons, and, for a Missing Document, Locate again;
 * a Document the browser must ask about again offers Reopen. The empty state
 * explains what Reader does and offers the same Open file… button.
 *
 * The page holds no Document in memory beyond what it draws: opening one hands
 * its entry to the runtime, which stores `currentDocumentId` and opens the
 * Frame page. This module imports only `@/plugin-sdk` and its own files.
 */

import { useEffect, useState, type ComponentType } from "react";
import { ui, type PluginClient } from "@/plugin-sdk";
import { format, translate } from "./i18n";
import type { ShelfService } from "./library";
import { progressSummary, relativeTimestamp, type ShelfEntry, type ShelfProgress } from "./shelf";

/** What the runtime gives the page: the client, the Shelf service, and the open handoff. */
export interface ShelfPageDeps {
  client: PluginClient;
  library: ShelfService;
  onOpenDocument(entry: ShelfEntry): void;
}

/**
 * The app language as the SDK signals it: the current value at mount, then
 * every change, in React state so the page re-renders on a switch.
 */
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

/** The progress line for one row, localized, or null when nothing is known yet. */
function progressText(language: string, progress: ShelfProgress | null): string | null {
  const summary = progressSummary(progress);
  if (summary === null) return null;
  if (summary.kind === "page") {
    return format(translate(language, "shelf.progress.page"), {
      page: summary.page,
      count: summary.pageCount,
    });
  }
  return format(translate(language, "shelf.progress.percent"), { percent: summary.percent });
}

/** The state line for a Document the device can no longer read, or null when it is fine. */
function stateText(language: string, entry: ShelfEntry): string | null {
  switch (entry.state) {
    case "missing":
      return translate(language, "shelf.status.missing");
    case "needs-permission":
      return translate(language, "shelf.status.needsPermission");
    case "unreadable":
      return translate(language, "shelf.status.unreadable");
    default:
      return null;
  }
}

/**
 * The Shelf grid, scoped to its Surface: covers fill as many columns as the page
 * is wide, each card a cover over its title, details, and actions.
 */
export const SHELF_CSS = `
ul { display: grid; grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr)); gap: 1.5rem 1rem; }
li { display: flex; flex-direction: column; gap: 0.5rem; min-width: 0; }
li > :first-child { aspect-ratio: 2 / 3; width: 100%; overflow: hidden; border-radius: 0.375rem; background: var(--color-muted); display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 2px rgb(0 0 0 / 12%), 0 6px 16px rgb(0 0 0 / 8%); }
li > :first-child img { width: 100%; height: 100%; max-width: none; object-fit: cover; border-radius: 0; }
li > :first-child svg { width: 2.5rem; height: 2.5rem; }
li > button:first-child { height: auto; padding: 0; border: 0; cursor: pointer; transition: transform 120ms ease, box-shadow 120ms ease; }
li > button:first-child:hover { transform: translateY(-2px); box-shadow: 0 2px 4px rgb(0 0 0 / 14%), 0 10px 24px rgb(0 0 0 / 12%); }
li > div:nth-child(2) { gap: 0.125rem; }
li > div:nth-child(2) > p { overflow-wrap: anywhere; }
li > div:nth-child(2) > p:first-child { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; line-height: 1.3; }
li > div:last-child { margin-top: auto; gap: 0; }
`;

/** The pages the runtime serves by id. */
export const SHELF_PAGE_ID = "reader";

export function createShelfPage(deps: ShelfPageDeps): ComponentType {
  const { client, library, onOpenDocument } = deps;

  return function ShelfPage() {
    const language = useLanguage(client);
    const [shelf, setShelf] = useState<ShelfEntry[] | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
      let active = true;
      void library
        .refreshStates()
        .then((next) => {
          if (active) setShelf(next);
        })
        .catch(() => {
          void library.loadShelf().then((next) => {
            if (active) setShelf(next);
          });
        });
      return () => {
        active = false;
      };
    }, [library]);

    async function reload(): Promise<void> {
      setShelf(await library.loadShelf());
    }

    async function openFile(): Promise<void> {
      setNotice(null);
      setBusy(true);
      try {
        const entry = await library.openFileFlow();
        if (entry === null) return;
        await reload();
        onOpenDocument(entry);
      } catch {
        setNotice(translate(language, "shelf.openFailed"));
      } finally {
        setBusy(false);
      }
    }

    async function remove(entry: ShelfEntry): Promise<void> {
      setNotice(null);
      setShelf(await library.removeFromShelf(entry.id));
    }

    async function locate(entry: ShelfEntry): Promise<void> {
      setNotice(null);
      setBusy(true);
      try {
        const result = await library.locateAgain(entry.id);
        if (result.ok) {
          await reload();
        } else if (result.reason === "fingerprint-mismatch") {
          setNotice(translate(language, "shelf.locate.mismatch"));
        }
      } catch {
        setNotice(translate(language, "shelf.openFailed"));
      } finally {
        setBusy(false);
      }
    }

    async function reopen(entry: ShelfEntry): Promise<void> {
      setNotice(null);
      setBusy(true);
      try {
        if (await library.reopen(entry.id)) await reload();
        else setNotice(translate(language, "shelf.reopenFailed"));
      } finally {
        setBusy(false);
      }
    }

    /** One labelled icon button, its name doubling as the pointer's tooltip. */
    function action(label: string, icon: string, onPress: () => void) {
      return (
        <ui.Tooltip content={label}>
          <ui.IconButton label={label} icon={icon} isDisabled={busy} onPress={onPress} />
        </ui.Tooltip>
      );
    }

    function cover(entry: ShelfEntry) {
      return entry.coverDataUrl === undefined ? (
        <ui.Icon name="book-open-text" size="lg" tone="muted" />
      ) : (
        <ui.Image src={entry.coverDataUrl} alt={entry.title} />
      );
    }

    function cardActions(entry: ShelfEntry) {
      const removeButton = action(translate(language, "shelf.remove"), "trash-2", () => {
        void remove(entry);
      });
      switch (entry.state) {
        case "missing":
          return (
            <>
              {action(translate(language, "shelf.locate"), "file-search", () => void locate(entry))}
              {removeButton}
            </>
          );
        case "needs-permission":
          return (
            <>
              {action(translate(language, "shelf.reopen"), "lock-open", () => void reopen(entry))}
              {removeButton}
            </>
          );
        case "unreadable":
          return removeButton;
        default:
          return (
            <>
              {action(translate(language, "shelf.open"), "book-open", () => onOpenDocument(entry))}
              {removeButton}
            </>
          );
      }
    }

    const openFileButton = (
      <ui.Button
        variant="primary"
        icon="folder-open"
        isDisabled={busy}
        onPress={() => void openFile()}
      >
        {translate(language, "shelf.openFile")}
      </ui.Button>
    );

    if (shelf === null) {
      return (
        <ui.View direction="column" gap="md" padding="md">
          <ui.Heading level={2}>{translate(language, "page.shelf")}</ui.Heading>
          <ui.Text tone="muted">{translate(language, "shelf.loading")}</ui.Text>
        </ui.View>
      );
    }

    return (
      <ui.View direction="column" gap="lg" padding="md">
        <ui.View direction="row" gap="md" align="center" justify="between" wrap>
          <ui.Heading level={2}>{translate(language, "page.shelf")}</ui.Heading>
          {shelf.length === 0 ? null : openFileButton}
        </ui.View>

        {notice === null ? null : <ui.Status tone="warning">{notice}</ui.Status>}

        {shelf.length === 0 ? (
          <ui.EmptyState
            title={translate(language, "shelf.emptyTitle")}
            description={translate(language, "shelf.emptyDescription")}
            icon="book-open-text"
          >
            {openFileButton}
          </ui.EmptyState>
        ) : (
          <ui.Surface css={SHELF_CSS}>
            <ui.List marker="none">
              {shelf.map((entry) => {
                const progress = progressText(language, entry.progress);
                const state = stateText(language, entry);
                const meta = [entry.author, entry.format.toUpperCase()]
                  .filter((part) => part !== "")
                  .join(" · ");
                const when =
                  entry.lastReadAt === 0
                    ? null
                    : format(translate(language, "shelf.lastRead"), {
                        when: relativeTimestamp(language, entry.lastReadAt),
                      });
                return (
                  <ui.ListItem key={entry.id}>
                    {entry.state === "ok" ? (
                      // The cover opens the Document, like its Open button.
                      <ui.Button
                        variant="ghost"
                        isDisabled={busy}
                        onPress={() => onOpenDocument(entry)}
                      >
                        {cover(entry)}
                      </ui.Button>
                    ) : (
                      <ui.View>{cover(entry)}</ui.View>
                    )}
                    <ui.View direction="column">
                      <ui.Text weight="semibold">{entry.title}</ui.Text>
                      {meta === "" ? null : (
                        <ui.Text size="sm" tone="muted">
                          {meta}
                        </ui.Text>
                      )}
                      {state === null ? null : (
                        <ui.Text size="sm" tone="danger">
                          {state}
                        </ui.Text>
                      )}
                      {progress === null ? null : <ui.Text size="sm">{progress}</ui.Text>}
                      {when === null ? null : (
                        <ui.Text size="sm" tone="muted">
                          {when}
                        </ui.Text>
                      )}
                    </ui.View>
                    <ui.View direction="row" align="center">
                      {cardActions(entry)}
                    </ui.View>
                  </ui.ListItem>
                );
              })}
            </ui.List>
          </ui.Surface>
        )}
      </ui.View>
    );
  };
}
