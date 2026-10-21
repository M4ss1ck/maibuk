/**
 * The MCP Server page (#594, part 1): the setup snippets for each Agent, the
 * Copy button per snippet, the Make a new Key button, and the reconnect notice
 * a moved Plugin Endpoint raises. The page is host-rendered through the SDK's
 * `ui.*` components, so Maibuk owns focus and keyboard behavior.
 *
 * The Key and address live in a small store the runtime fills, so a new Key
 * made from the page or from the `newKey` Command, and an
 * `endpoint.addressChanged` event, re-render the snippets in place.
 *
 * This module imports only `@/plugin-sdk` and its own files. Part 2 adds the
 * live Connections list, the live indicator, and the Activity log where
 * `ConnectionsSection` sits.
 */

import { useEffect, useRef, useState, useSyncExternalStore, type ComponentType } from "react";
import { ui, type PluginClient } from "@/plugin-sdk";
import { translate, type McpKey } from "./i18n";
import { mcpUrl, snippet, SNIPPET_KINDS, type SnippetKind } from "./snippets";

/** The page id, exactly as the manifest declares it. */
export const CONNECT_PAGE_ID = "connect";

/** The Plugin storage key holding the address the snippets were last shown with. */
export const SHOWN_ADDRESS_STORAGE_KEY = "shownAddress";

/** The values the snippets are built from. */
export interface ConnectSnapshot {
  /** The stored Key, or null until the runtime has read or made one. */
  key: string | null;
  /** The Plugin Endpoint base, or null while it is not listening. */
  address: string | null;
}

/** The page's shared state; a change repaints the open page. */
export interface ConnectStore {
  get(): ConnectSnapshot;
  subscribe(listener: () => void): () => void;
  setKey(key: string | null): void;
  setAddress(address: string | null): void;
}

/** A store that starts empty and repaints its listeners on a real change. */
export function createConnectStore(): ConnectStore {
  let state: ConnectSnapshot = { key: null, address: null };
  const listeners = new Set<() => void>();
  function publish(next: ConnectSnapshot): void {
    if (next.key === state.key && next.address === state.address) return;
    state = next;
    for (const listener of listeners) listener();
  }
  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setKey(key) {
      publish({ ...state, key });
    },
    setAddress(address) {
      publish({ ...state, address });
    },
  };
}

/** What the page asks the runtime to do, shared with the Commands. */
export interface ConnectActions {
  /** Makes and stores a fresh Key, cutting off the old one. */
  makeNewKey(): Promise<void>;
  /** Copies one Agent's current snippet, the same text the page shows. */
  copy(kind: SnippetKind): Promise<void>;
}

/** How long the "Copied" confirmation stays on the page. */
const COPIED_MS = 2_000;

/**
 * Builds the `connect` page. The runtime hands it the store and the actions, so
 * the page and the Commands act on the same Key and address.
 */
export function createConnectPage(
  client: PluginClient,
  store: ConnectStore,
  actions: ConnectActions
): ComponentType {
  return function ConnectPage() {
    const language = useLanguage(client);
    const { key, address } = useSyncExternalStore(store.subscribe, store.get, store.get);
    const [copied, setCopied] = useState<SnippetKind | null>(null);
    const [notice, setNotice] = useState(false);
    const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // The "Copied" confirmation is brief; its timer goes with the page.
    useEffect(
      () => () => {
        if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
      },
      []
    );

    // A stored address that differs from the current one is a move: the
    // snippets were refreshed, but each Agent still holds the old one. The
    // first address is stored silently, so a fresh install shows no notice.
    useEffect(() => {
      let active = true;
      void (async () => {
        let stored: unknown;
        try {
          stored = await client.storage.get({ key: SHOWN_ADDRESS_STORAGE_KEY });
        } catch {
          return;
        }
        if (!active) return;
        if (typeof stored === "string" && stored !== "") {
          setNotice(address !== null && address !== stored);
          return;
        }
        if (address === null) return;
        try {
          await client.storage.set({ key: SHOWN_ADDRESS_STORAGE_KEY, value: address });
        } catch {
          // The Library is unavailable; the next visit stores the address.
        }
        if (active) setNotice(false);
      })();
      return () => {
        active = false;
      };
    }, [client, address]);

    const t = (key: McpKey) => translate(language, key);

    async function copy(kind: SnippetKind): Promise<void> {
      await actions.copy(kind);
      setCopied(kind);
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(null), COPIED_MS);
    }

    async function dismissNotice(): Promise<void> {
      if (address !== null) {
        try {
          await client.storage.set({ key: SHOWN_ADDRESS_STORAGE_KEY, value: address });
        } catch {
          // Hiding it still helps; the next visit compares again.
        }
      }
      setNotice(false);
    }

    return (
      <ui.View direction="column" gap="lg" padding="md">
        <ui.Heading level={2}>{t("heading")}</ui.Heading>
        <ui.Text>{t("intro")}</ui.Text>

        {notice ? (
          <ui.View direction="row" gap="md" align="center" wrap>
            <ui.Status tone="warning">{t("reconnect")}</ui.Status>
            <ui.Button variant="secondary" onPress={() => void dismissNotice().catch(() => {})}>
              {t("done")}
            </ui.Button>
          </ui.View>
        ) : null}

        {address === null ? (
          <ui.Status tone="info">{t("unavailable")}</ui.Status>
        ) : key === null ? (
          <ui.Status tone="info">{t("loading")}</ui.Status>
        ) : (
          <ui.View direction="column" gap="lg">
            {SNIPPET_KINDS.map((kind) => (
              <ui.View key={kind} direction="column" gap="sm">
                <ui.Heading level={3}>{t(kind)}</ui.Heading>
                <ui.Code block>{snippet(kind, { url: mcpUrl(address), key })}</ui.Code>
                <ui.View direction="row" gap="md" align="center">
                  <ui.Button
                    variant="secondary"
                    size="sm"
                    onPress={() => void copy(kind).catch(() => {})}
                  >
                    {t("copy")}
                  </ui.Button>
                  {copied === kind ? <ui.Status tone="success">{t("copied")}</ui.Status> : null}
                </ui.View>
              </ui.View>
            ))}
          </ui.View>
        )}

        <ui.View direction="row" gap="md" align="center" wrap>
          <ui.Button onPress={() => void actions.makeNewKey().catch(() => {})}>
            {t("newKey")}
          </ui.Button>
          <ui.Text tone="muted" size="sm">
            {t("newKeyNote")}
          </ui.Text>
        </ui.View>

        <ConnectionsSection />
      </ui.View>
    );
  };
}

/**
 * Part 2 (#594) mounts the live Connections list, the live indicator, and the
 * Activity log here. Nothing renders until then.
 */
function ConnectionsSection(): null {
  return null;
}

/** The app language as the SDK signals it: the current value, then every change. */
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
