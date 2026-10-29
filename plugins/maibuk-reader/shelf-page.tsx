/**
 * The Shelf page (#653): the Documents Reader remembers on this device, most
 * recently read first, drawn with SDK components so Maibuk owns focus, keyboard
 * behavior, and accessibility. Each row offers Open, Remove from Shelf, and,
 * for a Missing Document, Locate again; a Document the browser must ask about
 * again offers Reopen. The empty state explains what Reader does and offers the
 * same Open file… button.
 *
 * The page holds no Document in memory beyond what it draws: opening one hands
 * its entry to the runtime, which stores `currentDocumentId` and opens the
 * Frame page. This module imports only `@/plugin-sdk` and its own files.
 */

import { useEffect, useState, type ComponentType } from "react";
import { ui, type PluginClient } from "@/plugin-sdk";
import { format, translate } from "./i18n";
import type { ReaderLibrary } from "./library";
import { progressSummary, relativeTimestamp, type ShelfEntry, type ShelfProgress } from "./shelf";

/** What the runtime gives the page: the client, the Shelf service, and the open handoff. */
export interface ShelfPageDeps {
  client: PluginClient;
  library: ReaderLibrary;
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

    function rowActions(entry: ShelfEntry) {
      const removeButton = (
        <ui.Button variant="ghost" onPress={() => void remove(entry)}>
          {translate(language, "shelf.remove")}
        </ui.Button>
      );
      switch (entry.state) {
        case "missing":
          return (
            <>
              <ui.Button
                variant="secondary"
                icon="file-search"
                isDisabled={busy}
                onPress={() => void locate(entry)}
              >
                {translate(language, "shelf.locate")}
              </ui.Button>
              {removeButton}
            </>
          );
        case "needs-permission":
          return (
            <>
              <ui.Button
                variant="secondary"
                icon="lock-open"
                isDisabled={busy}
                onPress={() => void reopen(entry)}
              >
                {translate(language, "shelf.reopen")}
              </ui.Button>
              {removeButton}
            </>
          );
        case "unreadable":
          return <>{removeButton}</>;
        default:
          return (
            <>
              <ui.Button
                variant="secondary"
                icon="book-open"
                isDisabled={busy}
                onPress={() => onOpenDocument(entry)}
              >
                {translate(language, "shelf.open")}
              </ui.Button>
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
          <ui.List marker="none">
            {shelf.map((entry) => {
              const progress = progressText(language, entry.progress);
              const state = stateText(language, entry);
              const meta = [entry.author, entry.format.toUpperCase()]
                .filter((part) => part !== "")
                .join(" · ");
              return (
                <ui.ListItem key={entry.id}>
                  <ui.View direction="row" gap="md" align="start">
                    {entry.coverDataUrl === undefined ? (
                      <ui.Icon name="book-open-text" size="lg" tone="muted" />
                    ) : (
                      <ui.Image src={entry.coverDataUrl} alt={entry.title} width={48} height={64} />
                    )}
                    <ui.View direction="column" gap="sm">
                      <ui.Text size="lg" weight="semibold">
                        {entry.title}
                      </ui.Text>
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
                      {entry.lastReadAt === 0 ? null : (
                        <ui.Text size="sm" tone="muted">
                          {format(translate(language, "shelf.lastRead"), {
                            when: relativeTimestamp(language, entry.lastReadAt),
                          })}
                        </ui.Text>
                      )}
                      <ui.View direction="row" gap="sm" wrap>
                        {rowActions(entry)}
                      </ui.View>
                    </ui.View>
                  </ui.View>
                </ui.ListItem>
              );
            })}
          </ui.List>
        )}
      </ui.View>
    );
  };
}
