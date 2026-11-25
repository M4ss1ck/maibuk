/** @jsxImportSource preact */
/* The Reader Frame's Preact app (#942). It draws one root div inside
   `#app-root` whose data attributes are the appearance Maibuk draws with, and
   re-renders in place when the appearance changes, so the DOM UI `entry.ts`
   wires never reloads or reopens.

   The Frame is bundled as one classic script, so this file takes Preact's
   automatic runtime and nothing else. */

import { createContext, render } from "preact";
import { useContext, useLayoutEffect, useState } from "preact/hooks";
import type { Appearance } from "./types";

/** The appearance the Frame draws with until Maibuk hands it another. */
export const DEFAULT_APPEARANCE: Appearance = { colorScheme: "light", eink: false };

/** Calls `listener` on every appearance change; returns the unsubscribe. */
export type AppearanceSubscription = (listener: (appearance: Appearance) => void) => () => void;

/** The appearance every Frame component draws with. */
const AppearanceContext = createContext<Appearance>(DEFAULT_APPEARANCE);

/** The Frame's drawn root: its data attributes are the appearance it shows. */
function FrameRoot() {
  const appearance = useContext(AppearanceContext);
  return <div data-color-scheme={appearance.colorScheme} data-eink={String(appearance.eink)} />;
}

interface AppProps {
  appearance: Appearance;
  subscribe: AppearanceSubscription;
}

/** Holds the appearance in context and redraws when the Frame is told it changed. */
function App({ appearance, subscribe }: AppProps) {
  const [current, setCurrent] = useState(appearance);
  // A layout effect subscribes during mount, before any port message can
  // arrive: an ordinary effect lands on the next frame, and an `open` that
  // finished first would be lost.
  useLayoutEffect(() => subscribe(setCurrent), [subscribe]);
  return (
    <AppearanceContext.Provider value={current}>
      <FrameRoot />
    </AppearanceContext.Provider>
  );
}

/** Mounts the Preact app into `root` (the Frame's `#app-root`). */
export function mountApp(
  root: HTMLElement,
  appearance: Appearance,
  subscribe: AppearanceSubscription
) {
  render(<App appearance={appearance} subscribe={subscribe} />, root);
}
