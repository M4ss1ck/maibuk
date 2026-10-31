// @vitest-environment node
/**
 * The Plugin-side (Worker) Remote UI round trip, in process (#438). A real
 * `RemoteReceiver` and a `@quilted/threads` thread stand in for the host, and the
 * other end of the MessageChannel is handed to `servePluginUi` exactly as the
 * host's `ui.mount` request would. No transport is mocked: mutations and event
 * calls cross a real `MessageChannel`.
 *
 * This suite is `node`, never `jsdom`: importing `worker-ui` installs the Remote
 * DOM polyfill, which replaces the DOM globals with its own.
 */
import { PLUGIN_UI_BATCH_MS, frameBatch, servePluginUi } from "@/plugin-sdk/worker-ui";
import { countRemoteNode, createMountBudget, renderingWithin } from "@/plugin-sdk/ui-node-budget";
import { PLUGIN_ERROR_MESSAGE } from "@/plugin-sdk/protocol";
import { PLUGIN_UI_NODE_LIMIT, PLUGIN_UI_NODE_LIMIT_MARKER } from "@/plugin-sdk/ui-node-limit";
import { servePluginUi as serveSharedPluginUi, splitMutationRecords } from "@/plugin-sdk/ui-serve";
import { ui } from "@/plugin-sdk/ui";
import {
  createValidatedConnection,
  type PluginUiViolation,
} from "@/features/plugins/remote-ui/validate";
import {
  MUTATION_TYPE_INSERT_CHILD,
  MUTATION_TYPE_UPDATE_TEXT,
  NODE_TYPE_ELEMENT,
  NODE_TYPE_TEXT,
  type RemoteConnection,
  type RemoteMutationRecord,
} from "@remote-dom/core";
import { BatchingRemoteConnection } from "@remote-dom/core/elements";
import { RemoteReceiver } from "@remote-dom/core/receivers";
import type { RemoteReceiverElement, RemoteReceiverNode } from "@remote-dom/core/receivers";
import { release, retain, ThreadMessagePort } from "@quilted/threads";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const channels: MessageChannel[] = [];

afterEach(() => {
  for (const channel of channels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
  vi.restoreAllMocks();
});

/** The real host end: a receiver, and the thread that feeds it. */
function createHost() {
  const channel = new MessageChannel();
  channels.push(channel);
  const receiver = new RemoteReceiver({ retain, release });
  new ThreadMessagePort(channel.port1, {
    exports: {
      mutate: (records: readonly RemoteMutationRecord[]) => receiver.connection.mutate(records),
      call: (id: string, method: string, ...args: unknown[]) =>
        receiver.connection.call(id, method, ...args),
    },
  });
  channel.port1.start();
  return { receiver, port: channel.port2 };
}

/**
 * The real host end wrapped in the validator, exactly as the host builds it: a
 * `RemoteReceiver` and `createValidatedConnection`, whose `mutate`/`call` are
 * what the Worker reaches over the thread.
 */
function createValidatedHost() {
  const channel = new MessageChannel();
  channels.push(channel);
  const receiver = new RemoteReceiver({ retain, release });
  const violations: PluginUiViolation[] = [];
  const connection = createValidatedConnection({
    receiver,
    onViolation: (violation) => violations.push(violation),
  });
  new ThreadMessagePort(channel.port1, {
    exports: {
      mutate: (records: readonly RemoteMutationRecord[]) => connection.mutate(records),
      call: (id: string, method: string, ...args: unknown[]) =>
        connection.call(id, method, ...args),
    },
  });
  channel.port1.start();
  return { receiver, violations, port: channel.port2 };
}

/** A minimal `PluginClient`: it keeps the one host-request handler. */
function createClient() {
  let handler: ((method: string, params: unknown) => unknown) | null = null;
  return {
    client: {
      onHostRequest(next: (method: string, params: unknown) => unknown) {
        handler = next;
      },
    },
    request(method: string, params: unknown): unknown {
      if (handler === null) throw new Error(`No handler for ${method}`);
      return handler(method, params);
    },
  };
}

function elements(receiver: RemoteReceiver): RemoteReceiverElement[] {
  return receiver.root.children.filter(
    (node): node is RemoteReceiverElement => node.type === NODE_TYPE_ELEMENT
  );
}

function element(receiver: RemoteReceiver, tag: string): RemoteReceiverElement | undefined {
  return elements(receiver).find((node) => node.element === tag);
}

function textOf(receiver: RemoteReceiver, tag: string): string[] {
  return elements(receiver)
    .filter((node) => node.element === tag)
    .map((node) =>
      node.children
        .map((child: RemoteReceiverNode) => (child.type === NODE_TYPE_TEXT ? child.data : ""))
        .join("")
    );
}

function Page() {
  const [value, setValue] = useState("");
  const [count, setCount] = useState(0);
  return (
    <>
      <ui.Heading>Find</ui.Heading>
      <ui.TextField label="Search" value={value} onChange={(event) => setValue(event.detail)} />
      <ui.Text>{value}</ui.Text>
      <ui.Button onPress={() => setCount((current) => current + 1)}>Go</ui.Button>
      <ui.Text>{`count:${count}`}</ui.Text>
    </>
  );
}

describe("servePluginUi", () => {
  it("mounts a page, round-trips events, and unmounts", async () => {
    const host = createHost();
    const client = createClient();
    servePluginUi(client.client, { pages: { main: Page } });

    client.request("ui.mount", { surface: "main#1", page: "main", port: host.port });

    await vi.waitFor(() => {
      expect(elements(host.receiver).map((node) => node.element)).toEqual([
        "maibuk-heading",
        "maibuk-text-field",
        "maibuk-text",
        "maibuk-button",
        "maibuk-text",
      ]);
    });
    expect(element(host.receiver, "maibuk-text-field")?.properties.label).toBe("Search");

    // The host presses the button; the Plugin's counter re-renders and the new
    // text travels back.
    const button = element(host.receiver, "maibuk-button") as RemoteReceiverElement;
    void (button.eventListeners.press as () => unknown)();
    await vi.waitFor(() => {
      expect(textOf(host.receiver, "maibuk-text")).toContain("count:1");
    });

    // The host types; the Plugin's state echoes the new value.
    const field = element(host.receiver, "maibuk-text-field") as RemoteReceiverElement;
    void (field.eventListeners.change as (detail: string) => unknown)("abc");
    await vi.waitFor(() => {
      expect(textOf(host.receiver, "maibuk-text")).toContain("abc");
    });

    client.request("ui.unmount", { surface: "main#1" });
    await vi.waitFor(() => {
      expect(host.receiver.root.children).toHaveLength(0);
    });

    // Unmounting an unknown surface is a no-op.
    expect(client.request("ui.unmount", { surface: "main#1" })).toBeNull();
  });

  it("splits a render larger than the record budget into batches the host accepts", async () => {
    const host = createValidatedHost();
    const client = createClient();
    const rows = 3_000;
    function BigPage() {
      return (
        <>
          {Array.from({ length: rows }, (_, i) => (
            <ui.Text key={i}>{`row ${i}`}</ui.Text>
          ))}
        </>
      );
    }
    servePluginUi(client.client, { pages: { main: BigPage } });
    client.request("ui.mount", { surface: "main#1", page: "main", port: host.port });

    await vi.waitFor(() => {
      expect(host.violations).toEqual([]);
      expect(elements(host.receiver).filter((node) => node.element === "maibuk-text")).toHaveLength(
        rows
      );
    });
  });

  it("splits a render of 2,500 required-prop Selects into batches the host accepts", async () => {
    const host = createValidatedHost();
    const client = createClient();
    const selects = 2_500;
    function SelectPage() {
      return (
        <>
          {Array.from({ length: selects }, (_, i) => (
            <ui.Select key={i} label={`s${i}`} options={[]} />
          ))}
        </>
      );
    }
    servePluginUi(client.client, { pages: { main: SelectPage } });
    client.request("ui.mount", { surface: "main#1", page: "main", port: host.port });

    await vi.waitFor(() => {
      expect(host.violations).toEqual([]);
      expect(
        elements(host.receiver).filter((node) => node.element === "maibuk-select")
      ).toHaveLength(selects);
    });
  });

  it("sends each element's props and listeners inside its insert record", async () => {
    const channel = new MessageChannel();
    channels.push(channel);
    const receiver = new RemoteReceiver({ retain, release });
    const records: RemoteMutationRecord[] = [];
    new ThreadMessagePort(channel.port1, {
      exports: {
        mutate: (batch: readonly RemoteMutationRecord[]) => {
          records.push(...batch);
          return receiver.connection.mutate(batch);
        },
        call: (id: string, method: string, ...args: unknown[]) =>
          receiver.connection.call(id, method, ...args),
      },
    });
    channel.port1.start();
    const client = createClient();
    function ButtonPage() {
      return <ui.Button onPress={() => {}}>Go</ui.Button>;
    }
    servePluginUi(client.client, { pages: { main: ButtonPage } });
    client.request("ui.mount", { surface: "main#1", page: "main", port: channel.port2 });

    await vi.waitFor(() => expect(element(receiver, "maibuk-button")).toBeDefined());
    expect(records.every((record) => record[0] === MUTATION_TYPE_INSERT_CHILD)).toBe(true);
    const inserted = records[0][2] as unknown as { eventListeners?: Record<string, unknown> };
    expect(Object.keys(inserted.eventListeners ?? {})).toEqual(["press"]);
  });

  it("unsets a prop the Plugin stops passing", async () => {
    const host = createValidatedHost();
    const client = createClient();
    let setHint: (hint: string | undefined) => void = () => {};
    function HintPage() {
      const [hint, update] = useState<string | undefined>("Pick one");
      setHint = update;
      return (
        <ui.Select
          label="Book"
          options={[]}
          {...(hint === undefined ? {} : { description: hint })}
        />
      );
    }
    servePluginUi(client.client, { pages: { main: HintPage } });
    client.request("ui.mount", { surface: "main#1", page: "main", port: host.port });

    await vi.waitFor(() =>
      expect(element(host.receiver, "maibuk-select")?.properties.description).toBe("Pick one")
    );
    setHint(undefined);
    await vi.waitFor(() =>
      expect(element(host.receiver, "maibuk-select")?.properties.description).toBeUndefined()
    );
    expect(host.violations).toEqual([]);
  });

  it("calls only the newest handler after the Plugin swaps it, and none after it removes it", async () => {
    const host = createValidatedHost();
    const client = createClient();
    const onA = vi.fn();
    const onB = vi.fn();
    let setMode: (mode: "a" | "b" | "none") => void = () => {};
    function SwapPage() {
      const [mode, update] = useState<"a" | "b" | "none">("a");
      setMode = update;
      return (
        <>
          <ui.Button {...(mode === "none" ? {} : { onPress: mode === "a" ? onA : onB })}>
            Go
          </ui.Button>
          <ui.Text>{`mode:${mode}`}</ui.Text>
        </>
      );
    }
    servePluginUi(client.client, { pages: { main: SwapPage } });
    client.request("ui.mount", { surface: "main#1", page: "main", port: host.port });

    const button = () => element(host.receiver, "maibuk-button") as RemoteReceiverElement;
    const press = () => (button().eventListeners.press as () => unknown)();

    await vi.waitFor(() => expect(button().eventListeners.press).toBeDefined());
    press();
    await vi.waitFor(() => expect(onA).toHaveBeenCalledTimes(1));

    setMode("b");
    await vi.waitFor(() => expect(textOf(host.receiver, "maibuk-text")).toContain("mode:b"));
    press();
    await vi.waitFor(() => expect(onB).toHaveBeenCalledTimes(1));
    expect(onA).toHaveBeenCalledTimes(1);

    setMode("none");
    await vi.waitFor(() => expect(textOf(host.receiver, "maibuk-text")).toContain("mode:none"));
    expect(button().eventListeners.press).toBeUndefined();
    expect(onA).toHaveBeenCalledTimes(1);
    expect(onB).toHaveBeenCalledTimes(1);
    expect(host.violations).toEqual([]);
  });

  it("replaces 1,500 required-prop rows with 1,500 others in one commit without a violation", async () => {
    // The Echoes Book switch: the old rows are removed and the new ones inserted
    // in the same flush, which is well over maxRecordsPerBatch, and a later
    // sibling is removed after the new rows are inserted.
    const host = createValidatedHost();
    const client = createClient();
    const rows = 1_500;
    let showBook: (book: string) => void = () => {};
    function RowsPage() {
      const [book, setBook] = useState("a");
      showBook = setBook;
      // The notice in the View below the list goes away in the same commit.
      // React commits that removal after the list's subtree, so it lands after
      // the new rows' inserts and before their props.
      return (
        <>
          <ui.Collection label="Echoes" selectionMode="none">
            {Array.from({ length: rows }, (_, i) => (
              <ui.CollectionRow
                key={`${book}-${i}`}
                id={`${book}-${i}`}
                label={`${book} row ${i}`}
              />
            ))}
          </ui.Collection>
          <ui.View>{book === "a" ? <ui.Text>Computing</ui.Text> : null}</ui.View>
        </>
      );
    }
    servePluginUi(client.client, { pages: { main: RowsPage } });
    client.request("ui.mount", { surface: "main#1", page: "main", port: host.port });
    const rowIds = () =>
      (element(host.receiver, "maibuk-collection")?.children ?? [])
        .filter((node): node is RemoteReceiverElement => node.type === NODE_TYPE_ELEMENT)
        .map((node) => node.properties.id);

    await vi.waitFor(() => expect(rowIds()).toHaveLength(rows));
    showBook("b");
    await vi.waitFor(() => {
      expect(host.violations).toEqual([]);
      expect(rowIds()[0]).toBe("b-0");
      expect(rowIds()).toHaveLength(rows);
    });
  });

  it("bumps the internal openSeq on each delivered open change and still calls the Plugin's handler", async () => {
    const host = createValidatedHost();
    const client = createClient();
    function OverlayPage() {
      const [opens, setOpens] = useState(0);
      return (
        <>
          <ui.Modal
            title="Details"
            isOpen={false}
            onOpenChange={() => setOpens((count) => count + 1)}
          >
            <ui.Text>Modal body</ui.Text>
          </ui.Modal>
          <ui.Text>{`opens:${opens}`}</ui.Text>
        </>
      );
    }
    servePluginUi(client.client, { pages: { main: OverlayPage } });
    client.request("ui.mount", { surface: "main#1", page: "main", port: host.port });

    await vi.waitFor(() => {
      expect(element(host.receiver, "maibuk-modal")?.properties.openSeq).toBe(0);
    });

    const modal = () => element(host.receiver, "maibuk-modal") as RemoteReceiverElement;
    void (modal().eventListeners.openchange as (open: boolean) => unknown)(false);
    await vi.waitFor(() => {
      expect(modal().properties.openSeq).toBe(1);
      // The Plugin's own handler still ran: the SDK only adds the counter.
      expect(textOf(host.receiver, "maibuk-text")).toContain("opens:1");
    });

    void (modal().eventListeners.openchange as (open: boolean) => unknown)(true);
    await vi.waitFor(() => {
      expect(modal().properties.openSeq).toBe(2);
      expect(textOf(host.receiver, "maibuk-text")).toContain("opens:2");
    });

    expect(host.violations).toEqual([]);
  });

  it("accepts a page whose required prop arrives behind its insert", async () => {
    // The regression: the Worker's `createRemoteComponent` sets props after the
    // element is inserted, so the validator sees the insert without the required
    // `label` and a same-batch UPDATE_PROPERTY that carries it. The host must not
    // report a violation and the label must arrive.
    const host = createValidatedHost();
    const client = createClient();
    servePluginUi(client.client, { pages: { main: Page } });

    client.request("ui.mount", { surface: "main#1", page: "main", port: host.port });

    await vi.waitFor(() => {
      expect(element(host.receiver, "maibuk-text-field")?.properties.label).toBe("Search");
    });
    expect(host.violations).toEqual([]);
  });

  it("does not touch the closed thread when a batch is scheduled after unmount", async () => {
    // Fake timers: the stale batch rides the code's own frameBatch timer, which
    // the virtual clock fires deterministically below.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    try {
      const host = createHost();
      const client = createClient();
      let connection!: RemoteConnection;
      serveSharedPluginUi(client.client, {
        pages: { main: Page },
        attach: (next) => {
          connection = next;
          return { container: document.createElement("div"), detach: () => {} };
        },
      });

      client.request("ui.mount", { surface: "main#1", page: "main", port: host.port });

      // Watch every call the Worker's thread makes on its host imports; a flush
      // after teardown would show up here as one more call.
      const call = vi.spyOn(ThreadMessagePort.prototype, "call");
      // Teardown waits one task (the code's own timer) before closing; the
      // returned promise settles once the mount is closed.
      const unmounted = client.request("ui.unmount", { surface: "main#1" }) as Promise<null>;
      await vi.advanceTimersByTimeAsync(0);
      await unmounted;
      const callsAtClose = call.mock.calls.length;

      // A stale `frameBatch` timer fires after teardown and flushes one more
      // batch; the closed mount ignores it instead of touching the closed thread.
      connection.mutate([[MUTATION_TYPE_UPDATE_TEXT, "node", "late"]]);
      await vi.advanceTimersByTimeAsync(PLUGIN_UI_BATCH_MS);

      expect(call.mock.calls.length).toBe(callsAtClose);
      expect(host.receiver.root.children).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a mount of an unknown page", () => {
    const host = createHost();
    const client = createClient();
    servePluginUi(client.client, { pages: {} });

    expect(() =>
      client.request("ui.mount", { surface: "main#1", page: "missing", port: host.port })
    ).toThrow("Unknown page missing");
  });

  it("refuses to mount the same surface twice", () => {
    const first = createHost();
    const second = createHost();
    const client = createClient();
    servePluginUi(client.client, { pages: { main: Page } });

    client.request("ui.mount", { surface: "main#1", page: "main", port: first.port });
    expect(() =>
      client.request("ui.mount", { surface: "main#1", page: "main", port: second.port })
    ).toThrow("Surface main#1 is already mounted");
  });

  it("forwards every other method to options.onHostRequest", () => {
    const client = createClient();
    const seen: string[] = [];
    servePluginUi(client.client, {
      pages: {},
      onHostRequest: (method) => {
        seen.push(method);
        return "answered";
      },
    });

    expect(client.request("migrateData", { from: 1 })).toBe("answered");
    expect(seen).toEqual(["migrateData"]);
  });

  it("throws the client's no-handler error for a method without a handler", () => {
    const client = createClient();
    servePluginUi(client.client, { pages: {} });

    expect(() => client.request("command.run", {})).toThrow("No handler for command.run");
  });
});

describe("frameBatch", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs the first flush in a microtask", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const batch = frameBatch();
    const flush = vi.fn();

    batch(flush);
    expect(flush).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(0);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("defers a second batch to exactly the 16 ms boundary", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const batch = frameBatch();
    const flush = vi.fn();

    batch(flush);
    await vi.advanceTimersByTimeAsync(0);
    expect(flush).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4);
    batch(flush);
    await vi.advanceTimersByTimeAsync(PLUGIN_UI_BATCH_MS - 5);
    expect(flush).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("keeps 100 batches over one second to at most 63 flushes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const flush = vi.fn();
    // `frameBatch` is only one flush per window when its caller, the batching
    // connection, requests a batch: it schedules the next one and de-dupes the
    // mutations that arrive behind it.
    const connection = new BatchingRemoteConnection(
      { mutate: (records) => flush(records), call: () => undefined },
      { batch: frameBatch() }
    );

    for (let i = 0; i < 100; i++) {
      connection.mutate([[MUTATION_TYPE_UPDATE_TEXT, "node", String(i)]]);
      await vi.advanceTimersByTimeAsync(10);
    }

    expect(flush.mock.calls.length).toBeLessThanOrEqual(63);
  });
});

describe("splitMutationRecords", () => {
  const insert = (id: string) =>
    [
      MUTATION_TYPE_INSERT_CHILD,
      "root",
      { id, type: NODE_TYPE_ELEMENT, element: "maibuk-text", properties: {}, children: [] },
      0,
    ] as unknown as RemoteMutationRecord;

  it("returns the same array instance in one batch under the limit", () => {
    const records = [insert("a"), insert("b")];
    const result = splitMutationRecords(records, 2);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(records);
  });

  it("splits a long run of records into in-order batches", () => {
    const records = ["a", "b", "c", "d", "e"].map((id) => insert(id));
    const result = splitMutationRecords(records, 2);
    expect(result.map((batch) => batch.length)).toEqual([2, 2, 1]);
    expect(result.flat()).toEqual(records);
  });
});

describe("the Worker's element-limit report", () => {
  it("posts the limit marker through the Worker scope once, as a Plugin error", () => {
    const post = vi.fn();
    vi.stubGlobal("self", { postMessage: post });
    try {
      const budget = createMountBudget();
      renderingWithin(budget, () => {
        for (let index = 0; index <= PLUGIN_UI_NODE_LIMIT + 3; index += 1) countRemoteNode();
      });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({
      kind: PLUGIN_ERROR_MESSAGE.kind,
      message: PLUGIN_UI_NODE_LIMIT_MARKER,
    });
  });
});
