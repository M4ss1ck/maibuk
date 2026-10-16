// The fixture-everything Plugin (issue #446): one Plugin that declares every
// contribution point and every Plugin Permission, so the E2E lane can drive the
// host's surfaces and the broker's permission checks against one fixture. It is
// deterministic: nothing here reads the clock or a random source, so a spec
// asserts the same result every run.
//
// `stamp` is the target Command: an Item Menu supplies the Book or Chapter it
// acts on, the host captures that target, and the Plugin answers with a
// notification naming it. `writeChapter` appends a paragraph to the focused
// Chapter through `library:write`, and `insertGreeting` inserts a line through
// the optional `editor:write` (#452), so the E2E lanes can drive the write
// paths. The page draws the Remote UI kit; the settings row is
// host-rendered from the manifest. Its controls (#453) save a secret, fetch a
// granted host with that secret injected into a declared header and stream the
// body back, ask an ungranted host and draw the refusal, list the secret names,
// and round-trip the clipboard; each draws its result into the page, and the
// granted fetch also reports whether the secret ever reappears in what the
// Worker can observe. Built from this source into
// e2e/.output/plugins/fixture-everything (persistent) and
// .../fixture-everything-on-demand (on-demand) by the E2E global setup; the
// bundles are never committed and never shipped.

// The Worker entry installs the Remote DOM polyfill, so it stays first among
// the SDK imports, exactly as the remote-ui fixture does.
import { servePluginUi } from "@/plugin-sdk/worker-ui";
import { useState } from "react";
import {
  PLUGIN_COMMAND_RUN_REQUEST,
  createPluginClient,
  ui,
  type PluginClient,
} from "@/plugin-sdk";

/** The credential store's one secret: the name it is saved under and the header
 * it is injected into. The value is written in `saveSecret` and nowhere else. */
const SECRET_NAME = "apiKey";
const SECRET_HEADER = "x-api-key";

/** The host the manifest grants the Plugin, and one it never declares. */
const GRANTED_URL = "https://api.fixture.test/echo";
const UNGRANTED_URL = "https://evil.fixture.test/";

/** The text the clipboard round trip writes and reads back. */
const CLIPBOARD_TEXT = "fixture clipboard text";

/** The clipboard line's success text, spelled out so a spec can read it. */
const CLIPBOARD_MARK = `round trip: ${CLIPBOARD_TEXT}`;

/** The Worker's client, set once the host starts this Worker; the page's
 * controls call the API through it because a mounted page is rendered without
 * props (the SDK mounts page components bare). */
let pluginClient: PluginClient | null = null;

/**
 * The secret value, held only after `saveSecret` runs. It lives in this one
 * call so the Worker's observed-string check below can look for it without the
 * literal appearing a second time: nothing else in the fixture knows it.
 */
let savedSecret = "";

/** Saves the Plugin's one secret. The value literal appears only here. */
function saveSecret(client: PluginClient): Promise<null> {
  savedSecret = "fixture-secret-7c1f9a";
  return client.secrets.set({ name: SECRET_NAME, value: savedSecret });
}

/** What one granted fetch observed, so the page can draw each part. */
interface FetchObserved {
  status: string;
  chunks: string[];
  /** The string the Worker can see: the head, every chunk, the names, any error. */
  observed: string;
}

/**
 * Fetches `GRANTED_URL`, naming the stored secret in the declared header, and
 * collects everything the Worker can observe into one string. The head arrives
 * first; the body follows as chunks until `onEnd`.
 */
async function fetchGranted(client: PluginClient): Promise<FetchObserved> {
  const chunks: string[] = [];
  let head: { status: number } | null = null;
  let failure: unknown = null;
  let names: string[] = [];
  const done = new Promise<void>((resolve) => {
    client.network
      .fetch(
        { url: GRANTED_URL, secretHeaders: { [SECRET_HEADER]: SECRET_NAME } },
        {
          onChunk: (chunk) => {
            chunks.push(chunk.text);
          },
          onEnd: () => resolve(),
        }
      )
      .then((result) => {
        head = result;
      })
      .catch((error: unknown) => {
        failure = error;
        resolve();
      });
  });
  await done;
  try {
    names = await client.secrets.listNames();
  } catch (error) {
    failure ??= error;
  }
  const observed = [
    JSON.stringify(head),
    chunks.join(""),
    JSON.stringify(names),
    JSON.stringify(failure === null ? null : { code: errorLabel(failure) }),
  ].join("\n");
  return { status: head === null ? "(no head)" : String(head.status), chunks, observed };
}

/** The page's content, drawn through the host's Remote UI kit: the deterministic
 * surfaces plus controls a spec drives to exercise the credential, network, and
 * clipboard APIs, each drawing its result back into the page. */
function Panel() {
  const [saved, setSaved] = useState(false);
  const [status, setStatus] = useState("(not run)");
  const [bytes, setBytes] = useState("0");
  const [chunkCount, setChunkCount] = useState("0");
  const [body, setBody] = useState("");
  const [refusal, setRefusal] = useState("(not run)");
  const [names, setNames] = useState("(not listed)");
  const [leak, setLeak] = useState("(not checked)");
  const [clipboard, setClipboard] = useState("(not run)");

  async function runSave(): Promise<void> {
    if (pluginClient === null) return;
    await saveSecret(pluginClient);
    setSaved(true);
  }

  async function runFetchGranted(): Promise<void> {
    if (pluginClient === null) return;
    await saveSecret(pluginClient);
    setSaved(true);
    const result = await fetchGranted(pluginClient);
    setStatus(result.status);
    setBody(result.chunks.join(""));
    setChunkCount(String(result.chunks.length));
    setBytes(String(new TextEncoder().encode(result.chunks.join("")).length));
    setLeak(result.observed.includes(savedSecret) ? "present" : "absent");
  }

  async function runFetchUngranted(): Promise<void> {
    if (pluginClient === null) return;
    try {
      await pluginClient.network.fetch({ url: UNGRANTED_URL });
      setRefusal("(allowed)");
    } catch (error) {
      setRefusal(errorLabel(error));
    }
  }

  async function runListNames(): Promise<void> {
    if (pluginClient === null) return;
    const listed = await pluginClient.secrets.listNames();
    setNames(listed.length > 0 ? listed.join(", ") : "(none)");
  }

  async function runClipboard(): Promise<void> {
    if (pluginClient === null) return;
    try {
      await pluginClient.clipboard.writeText({ text: CLIPBOARD_TEXT });
      const text = await pluginClient.clipboard.readText();
      setClipboard(text === CLIPBOARD_TEXT ? CLIPBOARD_MARK : `mismatch: ${text}`);
    } catch (error) {
      setClipboard(errorLabel(error));
    }
  }

  return (
    <ui.View direction="column" gap="md">
      <ui.Heading>Fixture page</ui.Heading>
      <ui.Text>Every contribution point in one Plugin.</ui.Text>
      <ui.Status tone="info">Deterministic content</ui.Status>

      <ui.View direction="row" gap="sm" wrap>
        <ui.Button onPress={runSave}>Save secret</ui.Button>
        <ui.Button onPress={runFetchGranted}>Fetch granted host</ui.Button>
        <ui.Button onPress={runFetchUngranted}>Fetch ungranted host</ui.Button>
        <ui.Button onPress={runListNames}>List secrets</ui.Button>
        <ui.Button onPress={runClipboard}>Clipboard round trip</ui.Button>
      </ui.View>

      <ui.Text>{`Saved: ${saved ? "yes" : "no"}`}</ui.Text>
      <ui.Text>{`Status: ${status}`}</ui.Text>
      <ui.Text>{`Bytes: ${bytes}`}</ui.Text>
      <ui.Text>{`Chunks: ${chunkCount}`}</ui.Text>
      <ui.Text>{`Refusal: ${refusal}`}</ui.Text>
      <ui.Text>{`Names: ${names}`}</ui.Text>
      <ui.Text>{`Leak: ${leak}`}</ui.Text>
      <ui.Text>{`Clipboard: ${clipboard}`}</ui.Text>
      <ui.Code block>{body}</ui.Code>
    </ui.View>
  );
}

/**
 * The `about` Settings row's live body: one deterministic control the spec can
 * assert the host mounted it (its declaration's label alone would render even
 * when the body never mounted).
 */
function AboutRow() {
  return (
    <ui.View direction="column" gap="sm">
      <ui.Switch label="Fixture switch" isSelected={false} onChange={() => {}} />
    </ui.View>
  );
}

/**
 * The item a target Command was invoked on, as the host captured it.
 */
interface CommandTarget {
  kind: string;
  id: string;
}

/**
 * The title the `stamp` notification names. A Book, Chapter, Note, or Canvas
 * target is read back through the Library API; any other kind (or a read that
 * is refused or missing) falls back to its kind, so the message is always
 * deterministic.
 */
async function targetTitle(
  client: PluginClient,
  target: CommandTarget | undefined
): Promise<string> {
  if (target === undefined) return "the library";
  try {
    switch (target.kind) {
      case "book":
        return (await client.library.books.get({ bookId: target.id }))?.title ?? target.kind;
      case "chapter":
        return (await client.library.chapters.get({ chapterId: target.id }))?.title ?? target.kind;
      case "note":
        return (await client.library.notes.get({ noteId: target.id }))?.title ?? target.kind;
      case "canvas":
        return (await client.library.canvases.get({ canvasId: target.id }))?.title ?? target.kind;
      default:
        return target.kind;
    }
  } catch {
    return target.kind;
  }
}

/** The most useful label for a refusal: a broker code first, then an error name. */
function errorLabel(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const record = error as { code?: unknown; name?: unknown };
    if (typeof record.code === "string" && record.code !== "") return record.code;
    if (typeof record.name === "string" && record.name !== "") return record.name;
  }
  if (typeof error === "string" && error !== "") return error;
  return "unknown";
}

/**
 * The `writeChapter` Command (#452): appends one paragraph to the focused
 * Chapter through `library:write`. It yields first so the author's in-flight
 * typing has landed before it reads, the way a Plugin that does any work
 * between the Command and its read would see it; it then reads the focused
 * editor's live content, and the host flushes the open editor before it
 * persists, so nothing the author typed is dropped. A refusal (no open
 * Chapter, or a refused write) surfaces as a notification.
 */
async function writeChapter(client: PluginClient): Promise<void> {
  // Stands in for a Plugin's own async work, so the author's in-flight typing
  // lands before this read (ADR 0002/0026: newer typing wins over an outside write).
  // Playwright WebKit types the spec's 21 characters in about 560 ms after the
  // palette closes (#479), so the wait keeps a wide margin over that.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const focused = await client.editor.getContent();
  if (focused.status !== "ok" || focused.entity.kind !== "chapter") {
    await client.notifications.show({
      variant: "error",
      message: "Fixture write chapter refused: no open Chapter",
    });
    return;
  }
  try {
    await client.library.chapters.updateContent({
      chapterId: focused.entity.id,
      content: { html: `${focused.content.html}<p>Plugin wrote this.</p>` },
    });
  } catch (error) {
    await client.notifications.show({
      variant: "error",
      message: `Fixture write chapter refused: ${errorLabel(error)}`,
    });
  }
}

/**
 * The `insertGreeting` Command (#452): inserts one line at the caret through
 * `editor:write`, which the fixture manifest declares optional. Without the
 * grant the broker refuses it and the fixture reports the refusal.
 */
async function insertGreeting(client: PluginClient): Promise<void> {
  try {
    await client.editor.insert({ content: { text: "Hello from the Plugin" } });
  } catch (error) {
    await client.notifications.show({
      variant: "error",
      message: `Fixture insert greeting refused: ${errorLabel(error)}`,
    });
  }
}

/**
 * Answers the host's `command.run`. `stamp` names its target in a notification;
 * the write Commands act on the Library and the focused editor; every other
 * Command still replies, so the host reports that it ran.
 */
async function runCommand(client: PluginClient, params: unknown): Promise<null> {
  const { id, target } = (params ?? {}) as { id?: string; target?: CommandTarget };
  if (id === "stamp") {
    const title = await targetTitle(client, target);
    await client.notifications.show({ variant: "info", message: `Fixture stamped ${title}` });
    return null;
  }
  if (id === "writeChapter") {
    await writeChapter(client);
    return null;
  }
  if (id === "insertGreeting") {
    await insertGreeting(client);
    return null;
  }
  await client.notifications.show({ variant: "info", message: `Fixture ran ${id}` });
  return null;
}

if (
  typeof self !== "undefined" &&
  typeof WorkerGlobalScope !== "undefined" &&
  self instanceof WorkerGlobalScope
) {
  self.onmessage = (event) => {
    const port = event.ports && event.ports[0];
    if (!port) return;
    const client = createPluginClient(port);
    pluginClient = client;
    servePluginUi(client, {
      pages: { panel: Panel },
      settingsRows: { about: AboutRow },
      onHostRequest: (method, params) => {
        if (method === "health.check") return "pong";
        if (method === PLUGIN_COMMAND_RUN_REQUEST) return runCommand(client, params);
        throw new Error(`No handler for ${method}`);
      },
    });
    self.postMessage({ kind: "maibuk:plugin-ready" });
  };
}
