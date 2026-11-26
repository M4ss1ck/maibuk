/** @jsxImportSource preact */
/* The Reader Frame's Preact app (#942, #944). It draws the toolbar, the search
   bar, the Contents panel and its tree, the page indicator, the message area,
   the password prompt, and the Shelf, and re-renders them in place when
   Maibuk's language, the reading state, or the Shelf changes, so the UI
   `entry.ts` wires never reloads or reopens. The Contents and Find engines stay
   non-React: they keep writing the tree and the status line, while the app
   publishes their open state and owns the toggles' `aria-expanded` and
   post-close focus. The viewer/stage stays with `entry.ts`.

   The Frame is bundled as one classic script, so this file takes Preact's
   automatic runtime and nothing else. */

import {
  type ComponentChildren,
  type RefObject,
  createContext,
  createPortal,
  options,
  render,
} from "preact";
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { Button, IconButton } from "./kit";
import { Shelf, type ShelfNotice, type ShelfRemoval } from "./shelf";
import type {
  Appearance,
  FrameShelfCommandId,
  FrameShelfLabels,
  FrameShelfState,
  ShelfViewSettings,
} from "./types";
import { useReducedMotion } from "./use-reduced-motion";

/** The appearance the Frame draws with until Maibuk hands it another. */
export const DEFAULT_APPEARANCE: Appearance = { colorScheme: "light", eink: false };

/** Calls `listener` on every appearance change; returns the unsubscribe. */
export type AppearanceSubscription = (listener: (appearance: Appearance) => void) => () => void;

/** The appearance every Frame component draws with. */
const AppearanceContext = createContext<Appearance>(DEFAULT_APPEARANCE);

/* The chrome is small, and a protocol message that changes it must show before
   the Frame answers the next message, so render synchronously instead of on a
   microtask. */
options.debounceRendering = (callback) => callback();

/** The labels the ported controls draw, as the Frame's catalogs render them. */
export interface ChromeLabels {
  back: string;
  contents: string;
  find: string;
  previousPage: string;
  nextPage: string;
  zoomIn: string;
  zoomOut: string;
  increaseFontSize: string;
  decreaseFontSize: string;
  fitWidth: string;
  fitPage: string;
  continuousScroll: string;
  fullScreen: string;
  exitFullScreen: string;
  passwordTitle: string;
  passwordLabel: string;
  passwordSubmit: string;
  passwordWrong: string;
  searchPlaceholder: string;
  searchNext: string;
  searchPrevious: string;
  searchClose: string;
}

/** The toolbar state `entry.ts` computes from the open Document. */
export interface ToolbarState {
  previousDisabled: boolean;
  nextDisabled: boolean;
  fitWidthPressed: boolean;
  fitPagePressed: boolean;
  layoutPressed: boolean;
  fullscreenAvailable: boolean;
  fullscreen: boolean;
  /** A reflowable Document turns the zoom buttons into font-size steps. */
  flowing: boolean;
}

/** The message area's state: the Missing and error surfaces share it. */
export interface MessageState {
  hidden: boolean;
  text: string;
  error: boolean;
}

/** The password prompt's state. */
export interface PasswordState {
  visible: boolean;
  wrong: boolean;
}

/** The two surfaces the non-React engines show and hide. */
export interface SurfacesState {
  contentsOpen: boolean;
  findOpen: boolean;
  /** A close that returns focus to a toggle; the token makes repeats fire. */
  focus: { target: "contents" | "find"; token: number } | null;
}

/** The Frame's two views: the Shelf, or one open Document. */
export type FrameView = "shelf" | "document";

/** Everything the ported surfaces draw. */
export interface ChromeState {
  view: FrameView;
  labels: ChromeLabels;
  toolbar: ToolbarState;
  pageIndicator: string;
  zoomLevel: string;
  message: MessageState;
  password: PasswordState;
  surfaces: SurfacesState;
  /** The Shelf the Worker last sent. */
  shelf: FrameShelfState;
  /** The Shelf's localized strings, or null until the Worker sends them. */
  shelfLabels: FrameShelfLabels | null;
  /** A failed Shelf action's dismissible notice. */
  shelfNotice: ShelfNotice | null;
  /** The Remove from Shelf confirmation, or null. */
  shelfRemoval: ShelfRemoval | null;
  /** The Shelf row whose Document menu is open. */
  menuDocumentId: string | null;
  /** The Shelf row that takes focus the next time the grid draws. */
  focusDocumentId: string | null;
  /** The Shelf's view, sort, filters, and search the Worker remembers (#945). */
  shelfView: ShelfViewSettings;
  /** The app language; it decides how the Shelf sorts names. */
  language: string;
  /** Bumped when a host Command asks to focus the Shelf's search. */
  shelfSearchRequest: number;
  /** Bumped when a host Command asks to open the Shelf's view and filter options. */
  shelfOptionsRequest: number;
}

/** What the ported controls ask `entry.ts` to do. */
export interface ChromeActions {
  back(): void;
  toggleContents(): void;
  openFind(): void;
  zoomIn(): void;
  zoomOut(): void;
  fitWidth(): void;
  fitPage(): void;
  toggleContinuous(): void;
  toggleFullscreen(): void;
  previousPage(): void;
  nextPage(): void;
  submitPassword(value: string): void;
  shelfCommand(id: FrameShelfCommandId, documentId?: string): void;
  shelfSelect(documentId: string): void;
  shelfRemove(documentId: string): void;
  /** The author changed the Shelf's view, sort, filters, or search. */
  shelfViewChange(settings: ShelfViewSettings): void;
}

/** The small bridge `entry.ts` hands the app: its state in, its actions out. */
export interface FrameBridge {
  current(): ChromeState;
  subscribe(listener: (state: ChromeState) => void): () => void;
  setView(view: FrameView): void;
  setLabels(labels: ChromeLabels): void;
  setToolbar(toolbar: ToolbarState): void;
  setPageIndicator(text: string): void;
  setZoomLevel(text: string): void;
  setMessage(message: MessageState): void;
  setPassword(password: PasswordState): void;
  setSurfaces(surfaces: SurfacesState): void;
  setShelf(shelf: FrameShelfState): void;
  setShelfLabels(labels: FrameShelfLabels | null): void;
  setShelfNotice(notice: ShelfNotice | null): void;
  setShelfRemoval(removal: ShelfRemoval | null): void;
  setMenuDocumentId(documentId: string | null): void;
  setFocusDocumentId(documentId: string | null): void;
  setShelfView(settings: ShelfViewSettings): void;
  setLanguage(language: string): void;
  requestShelfSearch(): void;
  requestShelfOptions(): void;
  actions: ChromeActions;
}

interface ChromeValue {
  state: ChromeState;
  actions: ChromeActions;
}

const ChromeContext = createContext<ChromeValue | null>(null);

/** The ported chrome's current state and the actions it fires. */
function useChrome(): ChromeValue {
  const value = useContext(ChromeContext);
  if (value === null) throw new Error("Reader chrome drawn outside its provider");
  return value;
}

/** The Frame's drawn root: its data attributes are the appearance it shows. */
export function FrameRoot({ children }: { children?: ComponentChildren }) {
  const appearance = useContext(AppearanceContext);
  const motion = useReducedMotion() ? "reduce" : "no-preference";
  const { colorScheme, eink } = appearance;

  // The Frame's chrome includes portals drawn outside this wrapper, so the
  // attributes also go on the Frame document's root, where every descendant
  // and any selector on the root can see them. The cleanup puts back whatever
  // the document carried before this root wrote its values.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = {
      "data-color-scheme": root.getAttribute("data-color-scheme"),
      "data-eink": root.getAttribute("data-eink"),
      "data-motion": root.getAttribute("data-motion"),
    };
    const restore = (name: string, value: string | null) => {
      if (value === null) root.removeAttribute(name);
      else root.setAttribute(name, value);
    };
    restore("data-color-scheme", colorScheme);
    restore("data-eink", String(eink));
    restore("data-motion", motion);
    return () => {
      for (const [name, value] of Object.entries(previous)) restore(name, value);
    };
  }, [colorScheme, eink, motion]);

  return (
    <div
      data-color-scheme={appearance.colorScheme}
      data-eink={String(appearance.eink)}
      data-motion={motion}
    >
      {children}
    </div>
  );
}

/** The toolbar: Back, Contents, Find, paging, zoom, fit, layout, full screen. */
function Toolbar(props: {
  contentsToggleRef: RefObject<HTMLButtonElement | null>;
  findToggleRef: RefObject<HTMLButtonElement | null>;
}) {
  const { state, actions } = useChrome();
  const { labels, toolbar } = state;
  const zoomOutLabel = toolbar.flowing ? labels.decreaseFontSize : labels.zoomOut;
  const zoomInLabel = toolbar.flowing ? labels.increaseFontSize : labels.zoomIn;
  const fullscreenLabel = toolbar.fullscreen ? labels.exitFullScreen : labels.fullScreen;
  return (
    // The Shelf draws its own header; the reading toolbar stays mounted so its
    // elements keep their ids, but hidden while the Shelf is the view.
    <header hidden={state.view === "shelf"}>
      <div class="group">
        <IconButton id="back" label={labels.back} icon="back" onClick={actions.back} />
        <IconButton
          id="contents-toggle"
          label={labels.contents}
          icon="contents"
          aria-expanded={state.surfaces.contentsOpen}
          buttonRef={props.contentsToggleRef}
          onClick={actions.toggleContents}
        />
        <IconButton
          id="find-toggle"
          label={labels.find}
          icon="search"
          buttonRef={props.findToggleRef}
          onClick={actions.openFind}
        />
      </div>
      <div class="group pager">
        <IconButton
          id="page-previous"
          label={labels.previousPage}
          icon="back"
          disabled={toolbar.previousDisabled}
          onClick={actions.previousPage}
        />
        <span id="page-indicator" aria-live="polite">
          {state.pageIndicator}
        </span>
        <IconButton
          id="page-next"
          label={labels.nextPage}
          icon="fwd"
          disabled={toolbar.nextDisabled}
          onClick={actions.nextPage}
        />
      </div>
      <div class="group zoom">
        <IconButton id="zoom-out" label={zoomOutLabel} icon="minus" onClick={actions.zoomOut} />
        <span id="zoom-level">{state.zoomLevel}</span>
        <IconButton id="zoom-in" label={zoomInLabel} icon="plus" onClick={actions.zoomIn} />
        <span class="divider" aria-hidden="true" />
        <IconButton
          id="fit-width"
          label={labels.fitWidth}
          icon="fitWidth"
          aria-pressed={toolbar.fitWidthPressed}
          onClick={actions.fitWidth}
        />
        <IconButton
          id="fit-page"
          label={labels.fitPage}
          icon="fitPage"
          aria-pressed={toolbar.fitPagePressed}
          onClick={actions.fitPage}
        />
        <IconButton
          id="layout-toggle"
          label={labels.continuousScroll}
          icon="continuous"
          aria-pressed={toolbar.layoutPressed}
          onClick={actions.toggleContinuous}
        />
        <IconButton
          id="fullscreen-toggle"
          label={fullscreenLabel}
          icon={toolbar.fullscreen ? "fullscreenExit" : "fullscreen"}
          aria-pressed={toolbar.fullscreen}
          hidden={!toolbar.fullscreenAvailable}
          onClick={actions.toggleFullscreen}
        />
      </div>
    </header>
  );
}

/** The search bar: the query, the status line, and the Find engine's controls. */
function SearchBar() {
  const { state } = useChrome();
  const { labels, surfaces } = state;
  return (
    <div id="search-bar" hidden={!surfaces.findOpen}>
      <input
        id="search-input"
        type="search"
        autocomplete="off"
        placeholder={labels.searchPlaceholder}
      />
      <span id="search-status" aria-live="polite" />
      <IconButton id="search-previous" label={labels.searchPrevious} icon="up" />
      <IconButton id="search-next" label={labels.searchNext} icon="down" />
      <IconButton id="search-close" label={labels.searchClose} icon="close" />
    </div>
  );
}

/** The Contents panel: its title and the tree the Contents engine draws into. */
function ContentsPanel() {
  const { state } = useChrome();
  return (
    <aside id="contents" hidden={!state.surfaces.contentsOpen} aria-labelledby="contents-title">
      <h2 id="contents-title">{state.labels.contents}</h2>
      <div id="contents-tree" role="tree" />
    </aside>
  );
}

/** The Missing and error surface. */
function MessageArea() {
  const { state } = useChrome();
  return (
    <p
      id="message"
      hidden={state.message.hidden}
      data-error={state.message.error ? "true" : undefined}
    >
      {state.message.text}
    </p>
  );
}

/** The password prompt: the Open button and Enter send it, never a form. */
function PasswordPrompt() {
  const { state, actions } = useChrome();
  const { password, labels } = state;
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!password.visible) return;
    setValue("");
    input.current?.focus();
  }, [password]);

  const submit = () => {
    if (value === "") {
      input.current?.focus();
      return;
    }
    actions.submitPassword(value);
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: the Frame's markup draws a group, not a form fieldset.
    <div
      id="password-form"
      role="group"
      aria-labelledby="password-title"
      hidden={!password.visible}
    >
      <h2 id="password-title">{labels.passwordTitle}</h2>
      <label for="password-input" id="password-label">
        {labels.passwordLabel}
      </label>
      <input
        id="password-input"
        type="password"
        autocomplete="off"
        ref={input}
        value={value}
        onInput={(event) => setValue(event.currentTarget.value)}
        onKeyDown={(event) => {
          // deprecated-api: Safari's IME-commit Enter has isComposing false; keyCode 229 is its only tell.
          if (event.isComposing || event.keyCode === 229) return;
          if (event.key === "Enter") submit();
        }}
      />
      <p id="password-error" hidden={!password.wrong}>
        {labels.passwordWrong}
      </p>
      <Button id="password-submit" onClick={submit}>
        {labels.passwordSubmit}
      </Button>
    </div>
  );
}

interface AppProps {
  appearance: Appearance;
  subscribe: AppearanceSubscription;
  bridge: FrameBridge;
}

/** Holds the appearance and the chrome state, and redraws when either changes. */
function App({ appearance, subscribe, bridge }: AppProps) {
  const [current, setCurrent] = useState(appearance);
  // A layout effect subscribes during mount, before any port message can
  // arrive: an ordinary effect lands on the next frame, and an `open` that
  // finished first would be lost.
  useLayoutEffect(() => subscribe(setCurrent), [subscribe]);
  const [chrome, setChrome] = useState<ChromeState>(() => bridge.current());
  useLayoutEffect(() => bridge.subscribe(setChrome), [bridge]);

  const contentsToggleRef = useRef<HTMLButtonElement>(null);
  const findToggleRef = useRef<HTMLButtonElement>(null);

  // A surface closing returns focus to its toolbar toggle. The request carries
  // a token so a repeated close fires again, and a silent reset sends none.
  // A layout effect, not an effect: Preact 11 defers effects through a timer,
  // and a focus return that lands late steals focus from a surface the author
  // just opened (the legacy wiring focused the button synchronously).
  const focusRequest = chrome.surfaces.focus;
  useLayoutEffect(() => {
    if (!focusRequest) return;
    if (focusRequest.target === "contents") contentsToggleRef.current?.focus();
    else findToggleRef.current?.focus();
  }, [focusRequest]);

  // The surfaces live where the legacy markup held them: the bar between the
  // toolbar and `#body`, the panel inside `#body` beside the stage.
  const searchRoot = document.getElementById("search-root");
  const contentsRoot = document.getElementById("contents-root");
  // The Shelf fills `#body` above the reading surface, the way the markup the
  // Worker once drew in the host did.
  const shelfRoot = document.getElementById("shelf-root");
  // The message and password prompt live in `#viewer`, beside the stage the
  // legacy wiring draws; portals keep them in that same place and order.
  const viewer = document.getElementById("viewer");
  const shelf =
    chrome.view === "shelf" && chrome.shelfLabels !== null ? (
      <Shelf
        state={chrome.shelf}
        labels={chrome.shelfLabels}
        notice={chrome.shelfNotice}
        removal={chrome.shelfRemoval}
        menuDocumentId={chrome.menuDocumentId}
        focusDocumentId={chrome.focusDocumentId}
        settings={chrome.shelfView}
        language={chrome.language}
        searchRequest={chrome.shelfSearchRequest}
        optionsRequest={chrome.shelfOptionsRequest}
        onSettingsChange={bridge.actions.shelfViewChange}
        onCommand={bridge.actions.shelfCommand}
        onSelect={bridge.actions.shelfSelect}
        onMenuChange={(documentId) => bridge.setMenuDocumentId(documentId)}
        onRemove={bridge.actions.shelfRemove}
        onRemoveClose={() => bridge.setShelfRemoval(null)}
        onNoticeClose={() => bridge.setShelfNotice(null)}
      />
    ) : null;
  return (
    <AppearanceContext.Provider value={current}>
      <ChromeContext.Provider value={{ state: chrome, actions: bridge.actions }}>
        <FrameRoot>
          <Toolbar contentsToggleRef={contentsToggleRef} findToggleRef={findToggleRef} />
        </FrameRoot>
        {searchRoot ? createPortal(<SearchBar />, searchRoot) : null}
        {contentsRoot ? createPortal(<ContentsPanel />, contentsRoot) : null}
        {shelf !== null && shelfRoot ? createPortal(shelf, shelfRoot) : null}
        {viewer ? createPortal(<MessageArea />, viewer) : null}
        {viewer ? createPortal(<PasswordPrompt />, viewer) : null}
      </ChromeContext.Provider>
    </AppearanceContext.Provider>
  );
}

/** Mounts the Preact app into `root` (the Frame's `#app-root`). */
export function mountApp(
  root: HTMLElement,
  appearance: Appearance,
  subscribe: AppearanceSubscription,
  bridge: FrameBridge
) {
  render(<App appearance={appearance} subscribe={subscribe} bridge={bridge} />, root);
}
