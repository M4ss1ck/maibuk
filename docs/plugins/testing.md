# Testing

A Plugin tests itself with the kit `@maibuk/plugin-test-kit`, the supported entry point for Plugin tests (src/features/plugins/test-kit.ts). `createTestHost()` runs the real broker and method table over an in-process MessageChannel with in-memory platform adapters, so a test hands the returned port to the Plugin's own setup and asserts against the host's records. `renderPage()` goes further: it draws one of the Plugin's pages through the real host renderer, over a real Remote UI mount, so a test drives the page with the keyboard and asserts what the host drew. `endpoint()` hands the Plugin one request on its Plugin Endpoint, through the same dispatcher the app routes outside requests with, and answers with what the Plugin returned.

## What it runs for real

- The broker: the same broker the app uses, with this Plugin's declared and granted Plugin Permissions.
- The method table: the same handlers the app wires, over an in-memory Library, storage, secrets, clipboard, and navigation.
- Library writes: `library.chapters.updateContent`, `library.chapters.create`, `library.chapters.update`, `library.chapters.delete`, `library.chapters.reorder`, `library.books.update`, `library.books.checkpoint`, `library.notes.create`, `library.notes.update`, and `library.notes.delete` change the in-memory Library through the host's own content conversion, so a test asserts the stored HTML, title, Chapter Type, Chapter Status, Tags, or order a write produced; a deleted Chapter or Note is gone from its `list` and `get`; `host.checkpoints` lists the Checkpoints taken, and a Book unchanged since its last one gets none.
- The Plugin Endpoint: `endpoint()` reads the `serve` grant the way the app does, so a request without it is answered 404, a Plugin with no handler answers 404, and a throwing handler answers 500.
- The Plugin Endpoint address: `setEndpointAddress()` fakes the bound port, so `endpoint.address` and `endpoint.addressChanged` behave as they do in the app.
- The host renderer: `renderPage(pageId)` and `renderSettingsRow(rowId)` mount the page or Settings row the way the app does, and the records the host keeps (notifications, navigations, page navigations, toolbar pressed state) are what the test asserts against.

The kit does not simulate the sandbox; the browser lanes prove that. It proves the host logic around a Plugin in the same jsdom the app's other suites use.

## Requesting the Plugin Endpoint

A Plugin holding the `serve` Permission answers the requests an outside Agent sends to `http://127.0.0.1:<port>/plugin/<pluginId>/…`. `endpoint()` hands the Plugin one such request without a socket: call `host.endpoint({ method, path, headers, body })`, where `path` is relative to the Plugin Endpoint (`/mcp`, `mcp?x=1`) and the kit prefixes `/plugin/<pluginId>`, so the Plugin sees the full path. `method` defaults to `GET`, headers may be a record or `[name, value]` pairs (pairs keep duplicates), and a string body arrives as UTF-8 bytes, with `text()` on the Plugin side for the common case.

The answer it resolves with carries the `status`, `headers` as pairs, the whole `body` as bytes, the `chunks` a streamed answer sent in order, and `text()` for the common UTF-8 case. An `AsyncIterable` body streams: `endpoint()` resolves after the stream's end, with `chunks` joined into `body` and `streamed` true.

For a streamed answer that never ends, such as a `subscriptions/listen` SSE stream, `host.endpointStream(request)` reads it chunk by chunk without waiting for its end: `head` resolves with the head, `waitForText(match)` resolves once the body contains `match`, and `close()` stops reading.

The grant is read live, exactly as in the app. `host.setGranted([])` makes the same call come back 404 without the Plugin's handler running, and granting it again lets the next request through. A Plugin that never called `onEndpointRequest` answers 404, and one whose handler throws answers 500. It also delivers `permissions.changed` to a subscribed Plugin when the set changed.

## Reading the Plugin Endpoint address

`host.setEndpointAddress(port)` fakes the listener bound on that port, as if Maibuk had picked it; `host.setEndpointAddress(null)` turns it off. A Plugin holding `serve` reads it with `client.endpoint.address()` and hears a move through `client.on("endpoint.addressChanged", listener)`, which delivers the current address on subscription. Setting the same address again fires nothing, so a test can prove a Plugin notices only real moves. Both are refused with `permission-denied` without the `serve` grant, like the read and the subscription in the app.

## Library writes and the open editor

Every Chapter, Note, and Book write the Plugin API exposes changes the in-memory Library the reads serve, with the app's own rules: `chapters.create` appends then moves to its 0-based `position` (later Chapters shift), `chapters.reorder` refuses ids that are not exactly the Book's Chapters, `chapters.update` refuses an unknown id or a call naming no field, and a title change moves the Book's Last Edited. `books.update` clears a null Genre or Target Word Count. `notes.create` files a Note in a Book, or Unfiled when `bookId` is omitted or null; `notes.update` renames it, replaces its content (recounting the words), trims and deduplicates its Tags like the Note tags field, and moves it between Books or to Unfiled with a null `bookId`; an unknown Note or Book is refused, and `notes.delete` removes it from the reads.

`host.setPendingEdit(chapterId, html)` records unsaved author typing in an open editor; the next Chapter or Note write or Checkpoint flushes it first, like the app does. An `updateContent` call with `expectedUpdatedAt` is refused with `conflict` when that flush landed typing in the Chapter or the Chapter changed since the read, so a test proves a Plugin never overwrites the author's typing. `library.notes.update` takes the same guard: a stale `expectedUpdatedAt` is refused with `conflict` and the Note is left as stored, so a test proves a Plugin's Note write never replaces newer text.

~~~ts
host.setPendingEdit("ch-1", "<p>Typed</p>");

await expect(
  client.library.chapters.updateContent({
    chapterId: "ch-1",
    content: { html: "<p>Written</p>" },
    expectedUpdatedAt: expected,
  })
).rejects.toMatchObject({ code: "conflict" });
~~~

## A walk through the template test

templates/plugin/index.test.tsx is the suite a Plugin author edits. It imports the two public entries (`@maibuk/plugin-sdk`, its public subpaths, and `@maibuk/plugin-test-kit`), never a Maibuk-internal `@/...` module, which the import-boundary step refuses. It builds one host and wires the Plugin to it:

```ts
import { createPluginClient, PLUGIN_COMMAND_RUN_REQUEST } from "@maibuk/plugin-sdk";
import { servePluginUi } from "@maibuk/plugin-sdk/ui-serve";
import { createTestHost } from "@maibuk/plugin-test-kit";
import { OPEN_COMMAND, PAGE_ID, start } from "./plugin";
import manifest from "./manifest.json";

function testHost() {
  const host = createTestHost({ manifest: manifest as unknown as TestManifest });
  start(createPluginClient(host.port), servePluginUi);
  return host;
}
```

The first test runs the Command and asserts the page navigation the host recorded:

```ts
const host = testHost();
await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: OPEN_COMMAND });
expect(host.pageNavigations).toEqual([{ pluginId: manifest.id, pageId: PAGE_ID }]);
```

The second test renders the page, finds the heading and the button by role, tabs to the button, presses Enter, and asserts the greeting changed. It ends each test in `host.stop()` so no mount is left behind:

```ts
const page = await host.renderPage(PAGE_ID);
const user = userEvent.setup();
expect(await screen.findByRole("heading", { name: "Hello from your Plugin" })).toBeInTheDocument();
const greet = screen.getByRole("button", { name: "Greet" });
await tabTo(user, greet);
await user.keyboard("{Enter}");
await waitFor(() => expect(screen.getByText("Greetings: 1")).toBeInTheDocument());
page.unmount();
```

Actions are proven by `user-event` key presses that assert behavior, never by checking attributes. Only an enabled Plugin is scanned at launch, so a test that wants a Plugin's surfaces reachable goes through the same host the app uses rather than a stand-in.

## Running tests

In the Plugin repository, `pnpm test` runs the Plugin's own tests through the kit; the template's package.json wires it to the tooling. From the Maibuk checkout, `pnpm plugin:test <path>` runs the same step over a Plugin path. `pnpm check` also runs the test step, after build, validate, typecheck, and lint. The kit runs under jsdom with Maibuk's own setup file, and that file fails a test whose timeout is not the suite's.

## The import rule for tests

Your Plugin may import `@maibuk/plugin-sdk` (and its public subpaths), a package you install in your own node_modules, or a relative file inside your own folder. `react` and `react-dom` always resolve to Maibuk's own copy, in build, test, and typecheck, so one React runs per renderer. Tests may also import `@maibuk/plugin-test-kit`; shipped source may not. The import-boundary step refuses a private `@/...` import, an absolute path, another `@maibuk/` package, a relative path that leaves the folder, and a Node builtin in shipped source. A Node builtin is allowed only in a test file.
