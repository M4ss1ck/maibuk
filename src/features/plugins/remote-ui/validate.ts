/**
 * The connection validator (ADR 0021, section 3 of the Remote UI research):
 * Maibuk's layer in front of the Remote DOM receiver.
 *
 * `RemoteReceiver` stores whatever it is sent and performs no prop validation,
 * so the host wraps `receiver.connection` before handing it to the Plugin. The
 * wrapper validates a whole mutation batch before any record reaches the
 * receiver — Remote DOM does not roll back earlier records — and refuses the
 * batch whole when anything is unsupported. The same check covers element
 * names, prop names and values, event names, and methods, plus the Remote UI
 * budget. A violation is reported once and the Plugin is stopped with
 * `remote-ui-limit`; the connection ignores everything after that.
 */

import {
  NODE_TYPE_ELEMENT,
  UPDATE_PROPERTY_TYPE_ATTRIBUTE,
  UPDATE_PROPERTY_TYPE_EVENT_LISTENER,
  UPDATE_PROPERTY_TYPE_PROPERTY,
  MUTATION_TYPE_INSERT_CHILD,
  MUTATION_TYPE_REMOVE_CHILD,
  MUTATION_TYPE_UPDATE_PROPERTY,
  MUTATION_TYPE_UPDATE_TEXT,
  type RemoteConnection,
  type RemoteMutationRecord,
  type RemoteNodeSerialization,
} from "@remote-dom/core";
import type {
  RemoteReceiver,
  RemoteReceiverNode,
  RemoteReceiverRoot,
} from "@remote-dom/core/receivers";
import { getPluginUiElement, PLUGIN_UI_LIMITS } from "@/plugin-sdk/ui-table";
import type { PluginUiLimits, PluginUiProp } from "@/plugin-sdk/ui-table";

export type PluginUiViolationCode =
  | "unknown-element"
  | "unknown-prop"
  | "invalid-prop"
  | "unknown-event"
  | "unknown-method"
  | "too-many-nodes"
  | "too-many-records"
  | "too-many-batches";

/** One refused declaration, in plain language, for the stop reason and tests. */
export interface PluginUiViolation {
  code: PluginUiViolationCode;
  message: string;
  tag?: string;
  prop?: string;
}

export interface PluginUiValidatorOptions {
  receiver: RemoteReceiver;
  onViolation: (violation: PluginUiViolation) => void;
  limits?: PluginUiLimits;
  /**
   * The current time in milliseconds; the connection refuses a batch once the
   * limit is already met inside the last second. Injectable so tests control
   * time.
   */
  now?: () => number;
}

const MAX_OPTIONS = 200;
const MAX_STRING = 1_000_000;

/** The sliding window the batch-rate cap is measured over: one second. */
const BATCH_WINDOW_MS = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A working copy of the accepted tree, replayed record by record before a batch
 * is committed. `children` mirrors every parent's ordered child ids (the root
 * included), so a REMOVE_CHILD index resolves against the state the batch
 * itself has built so far, not the receiver's pre-batch state.
 */
interface TreeShadow {
  tags: Map<string, string>;
  children: Map<string, string[]>;
  nodes: number;
}

/**
 * What a batch has built so far, for the required-prop check that runs once the
 * whole batch has replayed: the ids of elements inserted in this batch (a
 * subtree's descendants included), and the prop names each id has had set by a
 * serialization or by an UPDATE_PROPERTY record in the same batch.
 */
interface BatchTracking {
  inserted: Set<string>;
  setProps: Map<string, Set<string>>;
}

/** Records that a batch set the prop `name` on the element `id`. */
function rememberProp(tracking: BatchTracking, id: string, name: string): void {
  let names = tracking.setProps.get(id);
  if (names === undefined) {
    names = new Set();
    tracking.setProps.set(id, names);
  }
  names.add(name);
}

function buildShadow(root: RemoteReceiverRoot): TreeShadow {
  const shadow: TreeShadow = { tags: new Map(), children: new Map(), nodes: 0 };
  function visit(node: RemoteReceiverRoot | RemoteReceiverNode): void {
    shadow.nodes += 1;
    const ids: string[] = [];
    if (node.type === NODE_TYPE_ELEMENT) shadow.tags.set(node.id, node.element);
    for (const child of "children" in node ? node.children : []) {
      ids.push(child.id);
      visit(child);
    }
    shadow.children.set(node.id, ids);
  }
  visit(root);
  // `visit` counts the receiver root, which is the host's `~` and not a Plugin
  // node, so `maxNodes` means that many Plugin nodes, not one fewer.
  shadow.nodes -= 1;
  return shadow;
}

/**
 * Removes a node and its descendants from the shadow, and drops each id from
 * the batch tracking as well: an id removed mid-batch is no longer inserted, so
 * re-inserting it later in the same batch must carry its required props again.
 */
function unindexSubtree(id: string, shadow: TreeShadow, tracking: BatchTracking): void {
  const children = shadow.children.get(id) ?? [];
  for (const child of children) unindexSubtree(child, shadow, tracking);
  shadow.children.delete(id);
  shadow.tags.delete(id);
  tracking.inserted.delete(id);
  tracking.setProps.delete(id);
  shadow.nodes -= 1;
}

function propertyProblem(prop: PluginUiProp, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  switch (prop.kind) {
    case "string": {
      if (typeof value !== "string") return "must be a string";
      if (value.length > (prop.maxLength ?? MAX_STRING)) return "is longer than allowed";
      if (prop.format === "data-url" && !value.startsWith("data:")) return "must be a data URL";
      if (prop.format === "url") {
        try {
          const url = new URL(value);
          if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "mailto:") {
            return "must be an http, https, or mailto URL";
          }
        } catch {
          return "is not a valid URL";
        }
      }
      return null;
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return "must be a number";
      if (prop.integer === true && !Number.isInteger(value)) return "must be a whole number";
      if (prop.minimum !== undefined && value < prop.minimum) return "is below its minimum";
      if (prop.maximum !== undefined && value > prop.maximum) return "is above its maximum";
      return null;
    }
    case "boolean":
      return typeof value === "boolean" ? null : "must be a boolean";
    case "enum":
      return typeof value === "string" && (prop.values ?? []).includes(value)
        ? null
        : "is not one of its allowed values";
    case "options": {
      if (!Array.isArray(value) || value.length > MAX_OPTIONS) return "is not a valid option list";
      const valid = value.every(
        (option) =>
          isRecord(option) && typeof option.value === "string" && typeof option.label === "string"
      );
      return valid ? null : "is not a valid option list";
    }
    case "keys": {
      if (!Array.isArray(value) || value.length > MAX_OPTIONS) return "is not a valid key list";
      return value.every((key) => typeof key === "string") ? null : "is not a valid key list";
    }
    case "node":
      return "is a child slot, not a value";
  }
}

export function createValidatedConnection(options: PluginUiValidatorOptions): RemoteConnection {
  const { receiver, onViolation } = options;
  const limits = options.limits ?? PLUGIN_UI_LIMITS;
  const now = options.now ?? (() => performance.now());
  let tags = new Map<string, string>();
  const batchTimes: number[] = [];
  let tripped = false;

  function refuse(violation: PluginUiViolation): false {
    if (tripped) return false;
    tripped = true;
    onViolation(violation);
    return false;
  }

  /** Validates one serialized subtree and registers it in the shadow tree. */
  function checkSerialization(
    serialization: RemoteNodeSerialization,
    shadow: TreeShadow,
    tracking: BatchTracking
  ): boolean {
    if (serialization.type === NODE_TYPE_ELEMENT) {
      const element = getPluginUiElement(serialization.element);
      if (element === undefined) {
        return refuse({
          code: "unknown-element",
          message: `The element ${serialization.element} is not part of the Maibuk UI kit`,
          tag: serialization.element,
        });
      }
      shadow.tags.set(serialization.id, serialization.element);
      tracking.inserted.add(serialization.id);
      for (const name of Object.keys(serialization.attributes ?? {})) {
        return refuse({
          code: "unknown-prop",
          message: `${serialization.element} does not allow the attribute ${name}`,
          tag: serialization.element,
          prop: name,
        });
      }
      // An explicit `undefined` is not a value: a required prop sent as
      // `undefined` is still missing, so only a real value counts as set.
      for (const [name, value] of Object.entries(serialization.properties ?? {})) {
        if (value !== undefined) rememberProp(tracking, serialization.id, name);
      }
      for (const [name, value] of Object.entries(serialization.properties ?? {})) {
        const prop = element.props[name];
        if (prop === undefined) {
          return refuse({
            code: "unknown-prop",
            message: `${serialization.element} does not have the prop ${name}`,
            tag: serialization.element,
            prop: name,
          });
        }
        const problem = propertyProblem(prop, value);
        if (problem !== null) {
          return refuse({
            code: "invalid-prop",
            message: `The prop ${serialization.element}.${name} ${problem}`,
            tag: serialization.element,
            prop: name,
          });
        }
      }
      for (const name of Object.keys(serialization.eventListeners ?? {})) {
        if (!element.events.some((event) => event.event === name)) {
          return refuse({
            code: "unknown-event",
            message: `${serialization.element} does not have the event ${name}`,
            tag: serialization.element,
            prop: name,
          });
        }
      }
      const ids: string[] = [];
      for (const child of serialization.children) {
        ids.push(child.id);
        if (!checkSerialization(child, shadow, tracking)) return false;
      }
      shadow.children.set(serialization.id, ids);
      shadow.nodes += 1;
    } else {
      shadow.children.set(serialization.id, []);
      shadow.nodes += 1;
    }
    return true;
  }

  /**
   * Replays the whole batch on a shadow of the accepted tree and commits it to
   * the receiver only when every record passes. Remote DOM applies records in
   * order and never rolls a batch back, so a partly-valid batch must be refused
   * whole; the shadow also lets a record read what earlier records in the same
   * batch just inserted or removed.
   */
  function applyRecords(records: readonly RemoteMutationRecord[]): void {
    const shadow = buildShadow(receiver.root);
    const tracking: BatchTracking = { inserted: new Set(), setProps: new Map() };

    for (const record of records) {
      switch (record[0]) {
        case MUTATION_TYPE_INSERT_CHILD: {
          const parentId = record[1];
          const child = record[2];
          const index = record[3];
          if (!checkSerialization(child, shadow, tracking)) return;
          const children = shadow.children.get(parentId);
          if (children === undefined) {
            return void refuse({
              code: "unknown-element",
              message: "A child was inserted under an element the interface never declared",
            });
          }
          const at = Math.max(0, Math.min(index ?? children.length, children.length));
          children.splice(at, 0, child.id);
          break;
        }
        case MUTATION_TYPE_REMOVE_CHILD: {
          const children = shadow.children.get(record[1]);
          const childId = children?.[record[2]];
          if (children !== undefined && childId !== undefined) {
            children.splice(record[2], 1);
            unindexSubtree(childId, shadow, tracking);
          }
          break;
        }
        case MUTATION_TYPE_UPDATE_TEXT:
          break;
        case MUTATION_TYPE_UPDATE_PROPERTY: {
          const id = record[1];
          const name = record[2];
          const value = record[3];
          const updateType = record[4] ?? UPDATE_PROPERTY_TYPE_PROPERTY;
          const tag = shadow.tags.get(id);
          const element = tag === undefined ? undefined : getPluginUiElement(tag);
          if (element === undefined) {
            return void refuse({
              code: "unknown-element",
              message: "A property was sent for an element the interface never inserted",
            });
          }
          if (updateType === UPDATE_PROPERTY_TYPE_EVENT_LISTENER) {
            if (!element.events.some((event) => event.event === name)) {
              return void refuse({
                code: "unknown-event",
                message: `${tag} does not have the event ${name}`,
                tag,
                prop: name,
              });
            }
            break;
          }
          if (updateType === UPDATE_PROPERTY_TYPE_ATTRIBUTE) {
            return void refuse({
              code: "unknown-prop",
              message: `${tag} does not allow the attribute ${name}`,
              tag,
              prop: name,
            });
          }
          const prop = element.props[name];
          if (prop === undefined) {
            return void refuse({
              code: "unknown-prop",
              message: `${tag} does not have the prop ${name}`,
              tag,
              prop: name,
            });
          }
          const problem = propertyProblem(prop, value);
          if (problem !== null) {
            return void refuse({
              code: "invalid-prop",
              message: `The prop ${tag}.${name} ${problem}`,
              tag,
              prop: name,
            });
          }
          // A later `undefined` clears an earlier set: the prop is no longer
          // present, so a required prop updated to `undefined` is missing.
          if (value === undefined) {
            tracking.setProps.get(id)?.delete(name);
          } else {
            rememberProp(tracking, id, name);
          }
          break;
        }
      }
    }

    // The required-prop check is deferred to the end of the batch: a real Plugin
    // Worker's `createRemoteComponent` sets props in a layout effect, so an
    // insert carries `properties: {}` and a same-batch UPDATE_PROPERTY carries a
    // required prop such as `label`. Refuse only when the batch ends with an
    // element it inserted (and never removed) still missing a required prop.
    for (const id of tracking.inserted) {
      const tag = shadow.tags.get(id);
      if (tag === undefined) continue;
      const element = getPluginUiElement(tag);
      if (element === undefined) continue;
      const set = tracking.setProps.get(id);
      for (const [name, prop] of Object.entries(element.props)) {
        if (prop.required !== true || prop.kind === "node") continue;
        if (set?.has(name) === true) continue;
        refuse({
          code: "invalid-prop",
          message: `${tag} is missing the required prop ${name}`,
          tag,
          prop: name,
        });
        return;
      }
    }

    if (shadow.nodes > limits.maxNodes) {
      refuse({
        code: "too-many-nodes",
        message: `The interface has more than ${limits.maxNodes} elements`,
      });
      return;
    }

    receiver.connection.mutate(records);
    tags = shadow.tags;
  }

  return {
    mutate(records) {
      if (tripped) return;
      if (records.length > limits.maxRecordsPerBatch) {
        refuse({
          code: "too-many-records",
          message: `The interface sent ${records.length} changes at once`,
        });
        return;
      }
      const t = now();
      while (batchTimes.length > 0 && batchTimes[0] <= t - BATCH_WINDOW_MS) {
        batchTimes.shift();
      }
      if (batchTimes.length >= limits.maxBatchesPerSecond) {
        refuse({
          code: "too-many-batches",
          message: `The interface sent more than ${limits.maxBatchesPerSecond} updates in a second`,
        });
        return;
      }
      batchTimes.push(t);
      applyRecords(records);
    },
    call(id, method, ...args) {
      if (tripped) return undefined;
      const tag = tags.get(id);
      const element = tag === undefined ? undefined : getPluginUiElement(tag);
      if (element === undefined || !element.methods.includes(method)) {
        refuse({
          code: "unknown-method",
          message: `${tag ?? "The element"} does not have the method ${method}`,
          tag,
          prop: method,
        });
        return undefined;
      }
      return receiver.connection.call(id, method, ...args);
    },
  };
}
