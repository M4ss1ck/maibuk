/**
 * The Plugin-side mutation observer (#788): every structural change a tick makes
 * reaches the host's `RemoteReceiver` with indexes that are right where each
 * record lands, so the host's tree equals the Plugin's DOM after every tick.
 * Remote DOM's own `RemoteMutationObserver` reads indexes from the DOM as it is
 * when the callback runs (Shopify/remote-dom#560), so a tick that removes one
 * child and inserts another below it makes the host remove the wrong node.
 */

import { describe, expect, it, vi } from "vitest";
import {
  MUTATION_TYPE_INSERT_CHILD,
  MUTATION_TYPE_REMOVE_CHILD,
  ROOT_ID,
  type RemoteMutationRecord,
} from "@remote-dom/core";
import { remoteId } from "@remote-dom/core/elements";
import { RemoteReceiver } from "@remote-dom/core/receivers";
import type { RemoteReceiverNode, RemoteReceiverRoot } from "@remote-dom/core/receivers";
import { PluginUiMutationObserver } from "@/plugin-sdk/ui-observer";

/** The host's tree as nested ids, the way the receiver holds it. */
function hostTree(node: RemoteReceiverRoot | RemoteReceiverNode): unknown[] {
  return "children" in node
    ? node.children.map((child) => ("children" in child ? [child.id, hostTree(child)] : child.id))
    : [];
}

/** The Plugin's DOM as nested ids, in the same shape as `hostTree`. */
function domTree(node: Node): unknown[] {
  return Array.from(node.childNodes).map((child) =>
    child.nodeType === Node.ELEMENT_NODE ? [remoteId(child), domTree(child)] : remoteId(child)
  );
}

/**
 * Waits until the host's tree equals the Plugin's DOM: the observer's records
 * reach it on a microtask after the mutations, never synchronously.
 */
function synced(receiver: RemoteReceiver, container: Node, message?: string): Promise<void> {
  return vi.waitFor(
    () => {
      expect(hostTree(receiver.root), message).toEqual(domTree(container));
    },
    { interval: 1 }
  );
}

function observed() {
  const receiver = new RemoteReceiver();
  const container = document.createElement("div");
  const observer = new PluginUiMutationObserver(receiver.connection);
  observer.observe(container);
  return { receiver, container, observer };
}

function elements(count: number, tag = "span"): HTMLElement[] {
  return Array.from({ length: count }, () => document.createElement(tag));
}

describe("PluginUiMutationObserver", () => {
  it("removes the right child when the same tick inserts another one above it", async () => {
    const { receiver, container, observer } = observed();
    const [a, b, c, d] = elements(4);
    container.append(a, b, c, d);
    await synced(receiver, container);

    // React's commit for #788: drop C (index 2), then insert X at index 1.
    const x = document.createElement("span");
    c.remove();
    container.insertBefore(x, b);
    await synced(receiver, container);

    expect(hostTree(receiver.root)).toEqual([a, x, b, d].map((node) => [remoteId(node), []]));
    observer.disconnect();
  });

  it("keeps children added under a new parent in the same tick", async () => {
    const { receiver, container, observer } = observed();
    const [header, footer] = elements(2, "div");
    container.append(header, footer);
    await synced(receiver, container);

    const field = document.createElement("span");
    const [first, second] = elements(2);
    container.insertBefore(field, footer);
    footer.append(first);
    footer.append(second);
    first.remove();
    await synced(receiver, container);

    expect(hostTree(receiver.root)).toEqual([
      [remoteId(header), []],
      [remoteId(field), []],
      [remoteId(footer), [[remoteId(second), []]]],
    ]);
    observer.disconnect();
  });

  it("moves a node between parents and within one parent", async () => {
    const { receiver, container, observer } = observed();
    const [left, right] = elements(2, "div");
    const [a, b, c] = elements(3);
    left.append(a, b);
    right.append(c);
    container.append(left, right);
    await synced(receiver, container);

    right.prepend(b);
    left.append(a);
    container.prepend(right);
    await synced(receiver, container);

    expect(hostTree(receiver.root)).toEqual([
      [
        remoteId(right),
        [
          [remoteId(b), []],
          [remoteId(c), []],
        ],
      ],
      [remoteId(left), [[remoteId(a), []]]],
    ]);
    observer.disconnect();
  });

  it("re-sends only the moved child when a reorder moves the first child to the end", async () => {
    const receiver = new RemoteReceiver();
    const sent: RemoteMutationRecord[] = [];
    const observer = new PluginUiMutationObserver({
      mutate(records) {
        sent.push(...records);
        receiver.connection.mutate(records);
      },
      call: (id, method, ...args) => receiver.connection.call(id, method, ...args),
    });
    const container = document.createElement("div");
    observer.observe(container);
    const [a, b, c, d] = elements(4);
    container.append(a, b, c, d);
    await synced(receiver, container);
    sent.length = 0;

    // A keyed list reorder: the host keeps B, C, and D mounted (and focused).
    container.append(a);
    await synced(receiver, container);

    expect(sent).toEqual([
      [MUTATION_TYPE_REMOVE_CHILD, ROOT_ID, 0],
      [MUTATION_TYPE_INSERT_CHILD, ROOT_ID, expect.objectContaining({ id: remoteId(a) }), 3],
    ]);
    observer.disconnect();
  });

  it("sends a text node's final data, and none for a node it already removed", async () => {
    const { receiver, container, observer } = observed();
    const text = document.createTextNode("one");
    const gone = document.createTextNode("gone");
    container.append(text, gone);
    await synced(receiver, container);

    text.data = "two";
    gone.data = "changed";
    gone.remove();
    await vi.waitFor(() => {
      expect(receiver.get({ id: remoteId(text) })).toMatchObject({ data: "two" });
    });

    expect(hostTree(receiver.root)).toEqual([remoteId(text)]);
    observer.disconnect();
  });

  it("matches the DOM after every tick of seeded random churn", async () => {
    // A small deterministic PRNG (mulberry32), so a failure reproduces.
    let seed = 788;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;

    const { receiver, container, observer } = observed();
    const parents = [container, ...elements(3, "div")];
    container.append(...parents.slice(1));
    await synced(receiver, container);

    for (let tick = 0; tick < 200; tick++) {
      const steps = 1 + Math.floor(random() * 8);
      for (let step = 0; step < steps; step++) {
        // Only parents that are still under the container, and never a parent
        // into its own subtree.
        const live = parents.filter((parent) => container.contains(parent));
        const parent = pick(live);
        const kids = Array.from(parent.childNodes);
        const roll = random();
        if (roll < 0.35 || kids.length === 0) {
          const node = random() < 0.2 ? document.createTextNode("t") : document.createElement("i");
          parent.insertBefore(node, kids.length === 0 ? null : pick([...kids, null]));
        } else if (roll < 0.6) {
          const node = pick(kids);
          if (!parents.includes(node as HTMLElement)) node.remove();
        } else {
          // A move: any child into any live parent that is not inside it.
          const node = pick(kids);
          const into = pick(live.filter((target) => !node.contains(target)));
          const siblings = Array.from(into.childNodes).filter((sibling) => sibling !== node);
          into.insertBefore(node, siblings.length === 0 ? null : pick([...siblings, null]));
        }
      }
      await synced(receiver, container, `after tick ${tick}`);
    }
    observer.disconnect();
  });
});
