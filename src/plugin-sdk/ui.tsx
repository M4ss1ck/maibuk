/**
 * The plugin-side SDK for host-rendered UI (ADR 0021). A Plugin writes
 * React/JSX with these components; Remote DOM serializes the resulting tree to
 * the host, which renders Maibuk's own React Aria components. The Plugin never
 * imports Remote DOM, and never sees a host component.
 *
 * Every component is built from `ui-table.ts`, the one table the host's
 * validator and renderer also read, so a tag that renders here is a tag the
 * host accepts. Properties are declared with their names only: they are set as
 * properties on the custom element and Remote DOM carries their real types,
 * while the generated `PluginUiElementProps` types the JSX.
 *
 * Every prop and event handler reaches the element before the element is
 * attached, so its insert record already carries them (ADR 0027). React sets an
 * unknown prop on a custom element as a property while it builds the detached
 * subtree, so each component passes one `maibukProps` bundle and the element's
 * setter applies it. `@remote-dom/react`'s `createRemoteComponent` sets props in
 * a layout effect instead, after the commit has inserted every element, which
 * splits each insert from its required props on a large render.
 *
 * This entry bundles into Plugins (inside the sandbox Worker), so it imports
 * only `src/plugin-sdk/` and Remote DOM. The Worker's polyfill must be loaded
 * before `installPluginUiElements()` runs; the host never imports this file.
 */

import { createRemoteElement } from "@remote-dom/core/elements";
import { countRemoteElement } from "@/plugin-sdk/ui-node-budget";
import {
  createElement,
  forwardRef,
  useCallback,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
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

/** The one React prop each kit element takes: what to set on it, and which listeners. */
const KIT_PROPS = "maibukProps";

interface KitProps {
  properties: Record<string, unknown>;
  listeners: Record<string, EventListener | undefined>;
}

const NO_KIT_PROPS: KitProps = { properties: {}, listeners: {} };

/**
 * A kit element class: Remote DOM's element plus the `maibukProps` setter, which
 * applies only what changed since the last bundle. A prop that is no longer
 * passed is unset, and a prop the element does not declare goes to an attribute,
 * as `createRemoteComponent` did.
 */
function kitElement(definition: Omit<RuntimeElement, "tag">) {
  const Base = createRemoteElement(definition) as unknown as {
    new (): HTMLElement & Record<string, unknown>;
  };
  return class KitElement extends Base {
    #applied: KitProps = NO_KIT_PROPS;

    constructor() {
      super();
      // Counts every live element as it is made, so a Plugin past the limit
      // stops before its render finishes (#516, decision 2a).
      countRemoteElement();
    }

    get [KIT_PROPS](): KitProps {
      return this.#applied;
    }

    set [KIT_PROPS](next: KitProps) {
      const previous = this.#applied;
      this.#applied = next;
      for (const name of Object.keys(previous.properties)) {
        if (!(name in next.properties)) this.#setProperty(name, undefined);
      }
      for (const [name, value] of Object.entries(next.properties)) {
        if (previous.properties[name] !== value) this.#setProperty(name, value);
      }
      for (const event of new Set([
        ...Object.keys(previous.listeners),
        ...Object.keys(next.listeners),
      ])) {
        const before = previous.listeners[event];
        const after = next.listeners[event];
        if (before === after) continue;
        if (before !== undefined) this.removeEventListener(event, before);
        if (after !== undefined) this.addEventListener(event, after);
      }
    }

    #setProperty(name: string, value: unknown): void {
      if (name in this) this[name] = value;
      else if (value == null) this.removeAttribute(name);
      else this.setAttribute(name, String(value));
    }
  };
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
    customElements.define(tag, kitElement({ properties, events, methods }));
  }
}

/**
 * The React component for one kit element. Its props are split into the
 * element's properties and its event listeners (a table event's `prop`, such as
 * `onPress`, names the Remote DOM event it listens to) and handed over as one
 * `maibukProps` bundle; `children` render as the element's children.
 */
function kitComponent(
  tag: string,
  eventProps: Readonly<Record<string, string>>,
  name: string
): ComponentType<Record<string, unknown>> {
  const KitComponent = forwardRef<HTMLElement, Record<string, unknown>>(
    function KitComponent({ children, ...props }, ref) {
      const bundle: KitProps = { properties: {}, listeners: {} };
      for (const [prop, value] of Object.entries(props)) {
        const event = eventProps[prop];
        if (event === undefined) bundle.properties[prop] = value;
        else if (typeof value === "function") bundle.listeners[event] = value as EventListener;
      }
      return createElement(tag, { ref, [KIT_PROPS]: bundle }, children as ReactNode);
    }
  );
  KitComponent.displayName = name;
  return KitComponent as unknown as ComponentType<Record<string, unknown>>;
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
    const remote = kitComponent(
      element.tag,
      Object.fromEntries(row?.events.map((event) => [event.prop, event.event]) ?? []),
      row?.component ?? element.tag
    );
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
