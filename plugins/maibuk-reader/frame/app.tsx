/** @jsxImportSource preact */
/* The Reader Frame's Preact app (#942). It draws the toolbar, the search bar,
   the Contents panel and its tree, the page indicator, the message area, and
   the password prompt, and re-renders them in place when Maibuk's language or
   the reading state changes, so the UI `entry.ts` wires never reloads or
   reopens. The Contents and Find engines stay non-React: they keep writing the
   tree and the status line, while the app publishes their open state and owns
   the toggles' `aria-expanded` and post-close focus. The viewer/stage stays
   with `entry.ts`.

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
import type { Appearance } from "./types";

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

/** Everything the ported surfaces draw. */
export interface ChromeState {
  labels: ChromeLabels;
  toolbar: ToolbarState;
  pageIndicator: string;
  zoomLevel: string;
  message: MessageState;
  password: PasswordState;
  surfaces: SurfacesState;
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
}

/** The small bridge `entry.ts` hands the app: its state in, its actions out. */
export interface FrameBridge {
  current(): ChromeState;
  subscribe(listener: (state: ChromeState) => void): () => void;
  setLabels(labels: ChromeLabels): void;
  setToolbar(toolbar: ToolbarState): void;
  setPageIndicator(text: string): void;
  setZoomLevel(text: string): void;
  setMessage(message: MessageState): void;
  setPassword(password: PasswordState): void;
  setSurfaces(surfaces: SurfacesState): void;
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
function FrameRoot({ children }: { children?: ComponentChildren }) {
  const appearance = useContext(AppearanceContext);
  return (
    <div data-color-scheme={appearance.colorScheme} data-eink={String(appearance.eink)}>
      {children}
    </div>
  );
}

/** One icon button, named for screen readers and its tooltip. */
function IconButton(props: {
  id: string;
  label: string;
  onClick: () => void;
  pressed?: boolean;
  hidden?: boolean;
  expanded?: boolean;
  disabled?: boolean;
  buttonRef?: RefObject<HTMLButtonElement | null>;
  children: ComponentChildren;
}) {
  return (
    <button
      id={props.id}
      class="icon-button"
      type="button"
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.pressed}
      aria-expanded={props.expanded}
      aria-disabled={props.disabled ? "true" : undefined}
      hidden={props.hidden}
      ref={props.buttonRef}
      onClick={props.onClick}
    >
      {props.children}
    </button>
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
    <header>
      <div class="group">
        <IconButton id="back" label={labels.back} onClick={actions.back}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m12 19-7-7 7-7" />
            <path d="M19 12H5" />
          </svg>
        </IconButton>
        <IconButton
          id="contents-toggle"
          label={labels.contents}
          expanded={state.surfaces.contentsOpen}
          buttonRef={props.contentsToggleRef}
          onClick={actions.toggleContents}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 6h.01" />
            <path d="M3 12h.01" />
            <path d="M3 18h.01" />
            <path d="M8 6h13" />
            <path d="M8 12h13" />
            <path d="M8 18h13" />
          </svg>
        </IconButton>
        <IconButton
          id="find-toggle"
          label={labels.find}
          buttonRef={props.findToggleRef}
          onClick={actions.openFind}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </IconButton>
      </div>
      <div class="group pager">
        <IconButton
          id="page-previous"
          label={labels.previousPage}
          disabled={toolbar.previousDisabled}
          onClick={() => {
            if (!toolbar.previousDisabled) actions.previousPage();
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </IconButton>
        <span id="page-indicator" aria-live="polite">
          {state.pageIndicator}
        </span>
        <IconButton
          id="page-next"
          label={labels.nextPage}
          disabled={toolbar.nextDisabled}
          onClick={() => {
            if (!toolbar.nextDisabled) actions.nextPage();
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </IconButton>
      </div>
      <div class="group zoom">
        <IconButton id="zoom-out" label={zoomOutLabel} onClick={actions.zoomOut}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
            <path d="M8 11h6" />
          </svg>
        </IconButton>
        <span id="zoom-level">{state.zoomLevel}</span>
        <IconButton id="zoom-in" label={zoomInLabel} onClick={actions.zoomIn}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
            <path d="M8 11h6" />
            <path d="M11 8v6" />
          </svg>
        </IconButton>
        <span class="divider" aria-hidden="true" />
        <IconButton
          id="fit-width"
          label={labels.fitWidth}
          pressed={toolbar.fitWidthPressed}
          onClick={actions.fitWidth}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m18 8 4 4-4 4" />
            <path d="M2 12h20" />
            <path d="m6 8-4 4 4 4" />
          </svg>
        </IconButton>
        <IconButton
          id="fit-page"
          label={labels.fitPage}
          pressed={toolbar.fitPagePressed}
          onClick={actions.fitPage}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2v20" />
            <path d="m8 18 4 4 4-4" />
            <path d="m8 6 4-4 4 4" />
          </svg>
        </IconButton>
        <IconButton
          id="layout-toggle"
          label={labels.continuousScroll}
          pressed={toolbar.layoutPressed}
          onClick={actions.toggleContinuous}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="5" y="2" width="14" height="9" rx="1.5" />
            <rect x="5" y="13" width="14" height="9" rx="1.5" />
          </svg>
        </IconButton>
        <IconButton
          id="fullscreen-toggle"
          label={fullscreenLabel}
          pressed={toolbar.fullscreen}
          hidden={!toolbar.fullscreenAvailable}
          onClick={actions.toggleFullscreen}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <g class="when-windowed">
              <path d="M8 3H5a2 2 0 0 0-2 2v3" />
              <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
              <path d="M3 16v3a2 2 0 0 0 2 2h3" />
              <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
            </g>
            <g class="when-fullscreen">
              <path d="M8 3v3a2 2 0 0 1-2 2H3" />
              <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
              <path d="M3 16h3a2 2 0 0 1 2 2v3" />
              <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
            </g>
          </svg>
        </IconButton>
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
      <button
        id="search-previous"
        class="icon-button"
        type="button"
        aria-label={labels.searchPrevious}
        title={labels.searchPrevious}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m18 15-6-6-6 6" />
        </svg>
      </button>
      <button
        id="search-next"
        class="icon-button"
        type="button"
        aria-label={labels.searchNext}
        title={labels.searchNext}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <button
        id="search-close"
        class="icon-button"
        type="button"
        aria-label={labels.searchClose}
        title={labels.searchClose}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
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
      <button id="password-submit" type="button" onClick={submit}>
        {labels.passwordSubmit}
      </button>
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
  const focusRequest = chrome.surfaces.focus;
  useEffect(() => {
    if (!focusRequest) return;
    if (focusRequest.target === "contents") contentsToggleRef.current?.focus();
    else findToggleRef.current?.focus();
  }, [focusRequest]);

  // The surfaces live where the legacy markup held them: the bar between the
  // toolbar and `#body`, the panel inside `#body` beside the stage.
  const searchRoot = document.getElementById("search-root");
  const contentsRoot = document.getElementById("contents-root");
  // The message and password prompt live in `#viewer`, beside the stage the
  // legacy wiring draws; portals keep them in that same place and order.
  const viewer = document.getElementById("viewer");
  return (
    <AppearanceContext.Provider value={current}>
      <ChromeContext.Provider value={{ state: chrome, actions: bridge.actions }}>
        <FrameRoot>
          <Toolbar contentsToggleRef={contentsToggleRef} findToggleRef={findToggleRef} />
        </FrameRoot>
        {searchRoot ? createPortal(<SearchBar />, searchRoot) : null}
        {contentsRoot ? createPortal(<ContentsPanel />, contentsRoot) : null}
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
