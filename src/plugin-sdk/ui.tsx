/**
 * The plugin-side SDK for host-rendered UI (ADR 0021). A Plugin writes
 * React/JSX with these components; Remote DOM serializes the resulting tree to
 * the host, which renders Maibuk's own React Aria components. The Plugin never
 * imports Remote DOM, and never sees a host component.
 *
 * Every component is built from `ui-table.ts`, the one table the host's
 * validator and renderer also read, so a tag that renders here is a tag the
 * host accepts. Properties are declared with their names only: React sets them
 * as properties on the custom element and Remote DOM carries their real types,
 * while the generated `PluginUiElementProps` types the JSX.
 *
 * This entry bundles into Plugins (inside the sandbox Worker), so it imports
 * only `src/plugin-sdk/` and Remote DOM. The Worker's polyfill must be loaded
 * before `installPluginUiElements()` runs; the host never imports this file.
 */

import { createRemoteElement } from "@remote-dom/core/elements";
import { createRemoteComponent } from "@remote-dom/react";
import { useCallback, useState, type ComponentType } from "react";
import { PLUGIN_UI_TABLE } from "@/plugin-sdk/ui-table";
import type { PluginUiComponents, PluginUiElementProps } from "@/plugin-sdk/ui.generated";

export type { PluginUiComponents, PluginUiElementProps, PluginUiTag } from "@/plugin-sdk/ui.generated";
export { PLUGIN_UI_TAGS } from "@/plugin-sdk/ui.generated";
export { PLUGIN_UI_LIMITS, PLUGIN_UI_TABLE } from "@/plugin-sdk/ui-table";

interface RuntimeElement {
  tag: string;
  properties: string[];
  events: string[];
  methods: string[];
}

/** The runtime shape of each table row, as `createRemoteElement` needs it. */
function runtimeElements(): RuntimeElement[] {
  return PLUGIN_UI_TABLE.map((element) => ({
    tag: element.tag,
    // `children` is React's; it travels as child records, not as a property.
    properties: Object.entries(element.props)
      .filter(([, prop]) => prop.kind !== "node")
      .map(([name]) => name),
    events: element.events.map((event) => event.event),
    methods: [...element.methods],
  }));
}

/**
 * Defines every kit element. Idempotent, so a re-import (or a test file that
 * defines them itself) cannot throw. In a sandbox Worker this runs after the
 * Remote DOM polyfill provides `customElements`; on the web and in jsdom it is
 * the document's own registry.
 */
export function installPluginUiElements(): void {
  if (typeof customElements === "undefined") return;
  for (const { tag, properties, events, methods } of runtimeElements()) {
    if (customElements.get(tag) !== undefined) continue;
    const Element = createRemoteElement({ properties, events, methods });
    customElements.define(tag, Element);
  }
}

const components = new Map<string, ComponentType<Record<string, unknown>>>();

/**
 * Wraps an overlay that has an internal `openSeq` prop, so the host can read a
 * batched Plugin update that nets to no change as an answer: the wrapper owns
 * the counter in React state (not a ref, because a batched `setState` that nets
 * to no change lets React bail out before re-rendering the children), increments
 * it on every delivered `onOpenChange`, and passes it as `openSeq`. A Plugin's
 * own `openSeq` is overridden. Built once per tag, like the plain components.
 */
function withOpenSeq(
  Remote: ComponentType<Record<string, unknown>>,
  name: string
): ComponentType<Record<string, unknown>> {
  function WithOpenSeq(props: Record<string, unknown>) {
    const [openSeq, setOpenSeq] = useState(0);
    const onOpenChange = props.onOpenChange as ((event: unknown) => void) | undefined;
    const handle = useCallback(
      (event: unknown) => {
        setOpenSeq((count) => count + 1);
        onOpenChange?.(event);
      },
      [onOpenChange]
    );
    return <Remote {...props} onOpenChange={handle} openSeq={openSeq} />;
  }
  WithOpenSeq.displayName = name;
  return WithOpenSeq;
}

function buildComponents(): void {
  installPluginUiElements();
  for (const element of runtimeElements()) {
    if (components.has(element.tag)) continue;
    const row = PLUGIN_UI_TABLE.find((candidate) => candidate.tag === element.tag);
    const Element = customElements.get(element.tag);
    const remote = createRemoteComponent(
      element.tag as keyof HTMLElementTagNameMap,
      Element as never,
      {
        eventProps: Object.fromEntries(
          row?.events.map((event) => [event.prop, { event: event.event }]) ?? []
        ),
      } as never
    ) as ComponentType<Record<string, unknown>>;
    const component =
      row !== undefined && Object.keys(row.props).includes("openSeq")
        ? withOpenSeq(remote, row.component)
        : remote;
    components.set(element.tag, component);
  }
}

/**
 * The UI kit, keyed by component name: `ui.Button`, `ui.TextField`, and so on.
 * Building it is deferred until first use in a Worker, where `customElements`
 * only exists after the polyfill loads.
 */
export const ui: PluginUiComponents = new Proxy({} as PluginUiComponents, {
  get(_target, name: string) {
    if (components.size === 0) buildComponents();
    const element = PLUGIN_UI_TABLE.find((row) => row.component === name);
    if (element === undefined) return undefined;
    return components.get(element.tag);
  },
});

/** One element's props type, for a helper that takes any kit element. */
export type PluginUiProps<Tag extends keyof PluginUiElementProps> = PluginUiElementProps[Tag];
