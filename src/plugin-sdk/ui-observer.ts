/**
 * The Plugin-side mutation observer for a real DOM (#788): it turns a container's
 * DOM mutations into Remote DOM records whose indexes are right where each
 * record lands on the host.
 *
 * Remote DOM's `RemoteMutationObserver` reads each record's index from the DOM
 * as it is when the callback runs, after every mutation of the tick has already
 * happened (Shopify/remote-dom#560, fix PR #561). A React commit that removes
 * one child and inserts another above it in the same tick then sends the
 * removal one slot too far, and the host removes a node the Plugin kept. Drop
 * this file for the upstream observer once a release fixes that issue.
 *
 * This observer never trusts a record's position. It keeps, for every node the
 * host holds, that node's children in the order it last sent them. On each
 * delivery it reconciles every parent a record touched against the parent's
 * final children: first every removal (a child that left, or that a reorder
 * moved), then every insertion in final order. The records it sends therefore
 * rebuild exactly the final DOM, however the tick interleaved its mutations. An
 * inserted node is serialized whole in its final state, so nothing inside it is
 * sent twice.
 *
 * Only the host-side test path attaches through this (`observeContainer` in
 * `ui-serve.tsx`, and the Remote UI test harness). A Plugin Worker attaches
 * through the polyfill's `remote-root`, whose hooks report each mutation as it
 * happens, with the index right at that moment.
 */

import {
  connectRemoteNode,
  disconnectRemoteNode,
  remoteId,
  serializeRemoteNode,
  setRemoteId,
} from "@remote-dom/core/elements";
import {
  MUTATION_TYPE_INSERT_CHILD,
  MUTATION_TYPE_REMOVE_CHILD,
  MUTATION_TYPE_UPDATE_PROPERTY,
  MUTATION_TYPE_UPDATE_TEXT,
  ROOT_ID,
  type RemoteConnection,
  type RemoteMutationRecord,
} from "@remote-dom/core";

export class PluginUiMutationObserver {
  readonly #connection: RemoteConnection;
  readonly #observer: MutationObserver;
  /**
   * Every node the host holds (the observed container included), mapped to its
   * children in the order the host holds them. A text or comment node maps to
   * an empty list. A node is in here exactly while the host holds it.
   */
  readonly #sent = new Map<Node, Node[]>();

  constructor(connection: RemoteConnection) {
    this.#connection = connection;
    this.#observer = new MutationObserver((records) => {
      this.#deliver(records);
    });
  }

  /**
   * Starts sending `target`'s subtree as the host's root: its current children
   * now, and every change from here on.
   */
  observe(target: Node): void {
    setRemoteId(target, ROOT_ID);
    this.#sent.set(target, []);
    const records: RemoteMutationRecord[] = [];
    this.#insertMissing(target, records, new Set());
    if (records.length > 0) this.#connection.mutate(records);
    this.#observer.observe(target, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  }

  /** Stops observing; records still queued are dropped, as `MutationObserver` drops them. */
  disconnect(): void {
    this.#observer.disconnect();
    this.#sent.clear();
  }

  #deliver(mutations: readonly MutationRecord[]): void {
    const parents = new Set<Node>();
    const texts = new Set<Node>();
    const attributes = new Map<Element, Set<string>>();
    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        parents.add(mutation.target);
      } else if (mutation.type === "characterData") {
        texts.add(mutation.target);
      } else if (
        mutation.type === "attributes" &&
        mutation.attributeName !== null &&
        mutation.target instanceof Element &&
        // A custom element sends its own attributes through its connection.
        !mutation.target.tagName.includes("-")
      ) {
        const names = attributes.get(mutation.target) ?? new Set<string>();
        names.add(mutation.attributeName);
        attributes.set(mutation.target, names);
      }
    }

    const records: RemoteMutationRecord[] = [];
    // Every removal first, so a node that moved has left its old parent on the
    // host before its new parent inserts it.
    for (const parent of parents) this.#removeStale(parent, records);
    // Nodes serialized below carry their final state; later records skip them.
    const fresh = new Set<Node>();
    for (const parent of parents) this.#insertMissing(parent, records, fresh);

    for (const text of texts) {
      if (!this.#sent.has(text) || fresh.has(text)) continue;
      records.push([MUTATION_TYPE_UPDATE_TEXT, remoteId(text), text.textContent ?? ""]);
    }
    for (const [element, names] of attributes) {
      if (!this.#sent.has(element) || fresh.has(element)) continue;
      for (const name of names) {
        records.push([
          MUTATION_TYPE_UPDATE_PROPERTY,
          remoteId(element),
          name,
          element.getAttribute(name),
        ]);
      }
    }

    if (records.length > 0) this.#connection.mutate(records);
  }

  /**
   * Removes, on the host, every child of `parent` that is no longer where the
   * final DOM has it. It keeps the longest run of held children that are still
   * children in the same relative order, so a reorder re-sends only the nodes
   * that moved and the host keeps the rest mounted (and focused). The children
   * left are then an in-order subsequence of the final children.
   */
  #removeStale(parent: Node, records: RemoteMutationRecord[]): void {
    const sent = this.#sent.get(parent);
    // The host does not hold this parent: it was removed whole, or it is new and
    // its insertion carries its final children.
    if (sent === undefined) return;
    const finalIndex = new Map<Node, number>();
    parent.childNodes.forEach((child, index) => {
      finalIndex.set(child, index);
    });
    const kept = longestInOrder(sent.map((child) => finalIndex.get(child)));
    let index = 0;
    for (const [position, child] of sent.slice().entries()) {
      if (kept.has(position)) {
        index += 1;
        continue;
      }
      records.push([MUTATION_TYPE_REMOVE_CHILD, remoteId(parent), index]);
      sent.splice(index, 1);
      this.#forget(child);
    }
  }

  /**
   * Inserts, on the host, every final child of `parent` it does not hold yet,
   * left to right, so each lands at its final index. Run after `#removeStale`,
   * which leaves the held children in final order.
   */
  #insertMissing(parent: Node, records: RemoteMutationRecord[], fresh: Set<Node>): void {
    const sent = this.#sent.get(parent);
    if (sent === undefined) return;
    const children = Array.from(parent.childNodes);
    for (let index = 0; index < children.length; index++) {
      const child = children[index] as Node;
      if (sent[index] === child) continue;
      connectRemoteNode(child, this.#connection);
      records.push([
        MUTATION_TYPE_INSERT_CHILD,
        remoteId(parent),
        serializeRemoteNode(child),
        index,
      ]);
      sent.splice(index, 0, child);
      this.#remember(child, fresh);
    }
  }

  /** Records a subtree the host now holds, in the state it was just serialized in. */
  #remember(node: Node, fresh: Set<Node>): void {
    const children = Array.from(node.childNodes);
    this.#sent.set(node, children);
    fresh.add(node);
    for (const child of children) this.#remember(child, fresh);
  }

  /** Drops a subtree the host no longer holds, by the children it was sent with. */
  #forget(node: Node): void {
    disconnectRemoteNode(node);
    this.#unindex(node);
  }

  #unindex(node: Node): void {
    for (const child of this.#sent.get(node) ?? []) this.#unindex(child);
    this.#sent.delete(node);
  }
}

/**
 * The positions of the longest strictly increasing subsequence of `values`,
 * skipping `undefined` (a child that left). Patience sorting, O(n log n).
 */
function longestInOrder(values: readonly (number | undefined)[]): Set<number> {
  // tails[k]: the position ending the best run of length k + 1 found so far.
  const tails: number[] = [];
  const previous = new Array<number>(values.length).fill(-1);
  for (const [position, value] of values.entries()) {
    if (value === undefined) continue;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((values[tails[middle] as number] as number) < value) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[position] = tails[low - 1] as number;
    tails[low] = position;
  }
  const run = new Set<number>();
  for (let at = tails.at(-1) ?? -1; at !== -1; at = previous[at] as number) run.add(at);
  return run;
}
