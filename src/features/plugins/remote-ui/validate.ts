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
import type { RemoteReceiver } from "@remote-dom/core/receivers";
import { getPluginUiElement, PLUGIN_UI_LIMITS } from "@/plugin-sdk/ui-table";
import type { PluginUiLimits, PluginUiProp } from "@/plugin-sdk/ui-table";

export type PluginUiViolationCode =
  | "unknown-element"
  | "unknown-prop"
  | "invalid-prop"
  | "unknown-event"
  | "unknown-method"
  | "too-many-nodes"
  | "too-many-records";

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
}

const MAX_OPTIONS = 200;
const MAX_STRING = 1_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nodeCount(serialization: RemoteNodeSerialization): number {
  if (serialization.type !== NODE_TYPE_ELEMENT) return 1;
  return 1 + serialization.children.reduce((sum, child) => sum + nodeCount(child), 0);
}

function receiverNodeCount(node: {
  type: number;
  children?: readonly { type: number; children?: readonly unknown[] }[];
}): number {
  if (node.type !== NODE_TYPE_ELEMENT) return 1;
  return 1 + (node.children ?? []).reduce((sum, child) => sum + receiverNodeCount(child as never), 0);
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
  const tags = new Map<string, string>();
  let nodes = 0;
  let tripped = false;

  function refuse(violation: PluginUiViolation): false {
    if (tripped) return false;
    tripped = true;
    onViolation(violation);
    return false;
  }

  /** Validates one serialized element subtree, collecting its tags and size. */
  function checkSerialization(serialization: RemoteNodeSerialization, found: Map<string, string>): boolean {
    if (serialization.type === NODE_TYPE_ELEMENT) {
      const element = getPluginUiElement(serialization.element);
      if (element === undefined) {
        return refuse({
          code: "unknown-element",
          message: `The element ${serialization.element} is not part of the Maibuk UI kit`,
          tag: serialization.element,
        });
      }
      found.set(serialization.id, serialization.element);
      for (const name of Object.keys(serialization.attributes ?? {})) {
        return refuse({
          code: "unknown-prop",
          message: `${serialization.element} does not allow the attribute ${name}`,
          tag: serialization.element,
          prop: name,
        });
      }
      for (const [name, prop] of Object.entries(element.props)) {
        if (
          prop.required === true &&
          prop.kind !== "node" &&
          serialization.properties?.[name] === undefined
        ) {
          return refuse({
            code: "invalid-prop",
            message: `${serialization.element} is missing the required prop ${name}`,
            tag: serialization.element,
            prop: name,
          });
        }
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
      for (const child of serialization.children) {
        if (!checkSerialization(child, found)) return false;
      }
    }
    return true;
  }

  function applyRecords(records: readonly RemoteMutationRecord[]): void {
    const found = new Map<string, string>();
    const removedIds: string[] = [];
    let delta = 0;

    for (const record of records) {
      switch (record[0]) {
        case MUTATION_TYPE_INSERT_CHILD: {
          const child = record[2];
          if (!checkSerialization(child, found)) return;
          delta += nodeCount(child);
          break;
        }
        case MUTATION_TYPE_REMOVE_CHILD: {
          const parent = receiver.get({ id: record[1] });
          const children =
            parent !== undefined && "children" in parent
              ? (parent.children as readonly unknown[])
              : undefined;
          const child = children?.[record[2]];
          if (child !== undefined) {
            delta -= receiverNodeCount(child as never);
            collectIds(child as never, removedIds);
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
          const tag = tags.get(id);
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
          break;
        }
      }
    }

    if (nodes + delta > limits.maxNodes) {
      refuse({
        code: "too-many-nodes",
        message: `The interface has more than ${limits.maxNodes} elements`,
      });
      return;
    }

    for (const [id, tag] of found) tags.set(id, tag);
    for (const id of removedIds) tags.delete(id);
    nodes += delta;
    receiver.connection.mutate(records);
  }

  function collectIds(
    node: { id: string; type: number; children?: readonly unknown[] },
    out: string[]
  ): void {
    out.push(node.id);
    if (node.type === NODE_TYPE_ELEMENT) {
      for (const child of node.children ?? []) collectIds(child as never, out);
    }
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
