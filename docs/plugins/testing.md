# Testing

A Plugin tests itself with the kit `@maibuk/plugin-test-kit`, the supported entry point for Plugin tests (src/features/plugins/test-kit.ts). `createTestHost()` runs the real broker and method table over an in-process MessageChannel with in-memory platform adapters, so a test hands the returned port to the Plugin's own setup and asserts against the host's records. `renderPage()` goes further: it draws one of the Plugin's pages through the real host renderer, over a real Remote UI mount, so a test drives the page with the keyboard and asserts what the host drew.

## What it runs for real

- The broker: the same broker the app uses, with this Plugin's declared and granted Plugin Permissions.
- The method table: the same handlers the app wires, over an in-memory Library, storage, secrets, clipboard, and navigation.
- The host renderer: `renderPage(pageId)` and `renderSettingsRow(rowId)` mount the page or Settings row the way the app does, and the records the host keeps (notifications, navigations, page navigations, toolbar pressed state) are what the test asserts against.

The kit does not simulate the sandbox; the browser lanes prove that. It proves the host logic around a Plugin in the same jsdom the app's other suites use.

## A walk through the template test

templates/plugin/index.test.tsx is the suite a Plugin author edits. It imports the two public entries (`@maibuk/plugin-sdk`, its public subpaths, and `@maibuk/plugin-test-kit`), never a Maibuk-internal `@/...` module, which the import-boundary step refuses. It builds one host and wires the Plugin to it:

```ts
import { createPluginClient, PLUGIN_COMMAND_RUN_REQUEST } from "@maibuk/plugin-sdk";
import { servePluginUi } from "@maibuk/plugin-sdk/ui-serve";
import { createTestHost } from "@maibuk/plugin-test-kit";
import { OPEN_COMMAND, PAGE_ID, start } from "./index";
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
