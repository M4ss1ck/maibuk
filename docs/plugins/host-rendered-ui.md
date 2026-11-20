# Host-rendered UI

Host-rendered UI is the default Plugin path (ADR 0021): you write React/JSX against the SDK's `ui.*` components, Remote DOM serializes the resulting tree to the host, and Maibuk draws it with its own React Aria components. Maibuk owns focus, keyboard behavior, and typing, so the page behaves like the rest of the app. The other path, where the Plugin draws its own document, is a custom [Frame](frame-ui.md).

## Manifest fields

Every Plugin ships a `manifest.json` at its root. Its required top-level fields, read by the schema in src/features/plugins/manifest-schema.ts, are:

| Field | Value |
| --- | --- |
| `manifestVersion` | `1`, the manifest file format version |
| `id` | a lowercase slug of 3 to 64 characters, without the reserved `maibuk-` or `tutorial-` prefixes |
| `name` | the Plugin's display name |
| `description` | one sentence describing the Plugin |
| `author` | the author's name |
| `version` | the Plugin's own semver version |
| `apiVersion` | a semver range against the Plugin API, like `^0.1` |
| `entry` | a relative path to the Plugin's ES module entry file |
| `platforms` | one or more of `desktop`, `web`, `android`; omitted means desktop and web, and Android runs the Plugin only when `android` is listed (see [Platforms](#platforms)) |
| `lifecycle` | `persistent`, which starts with the app, or `on-demand`, which starts when a surface becomes reachable (see [Warm start](#warm-start)) |
| `defaultLanguage` | `en` or `es` |
| `permissions` | an object with a `required` list and an `optional` list of Plugin Permission names |

The optional top-level fields are `$schema`, `minAppVersion`, `homepage`, `dataVersion`, `customUi`, `warmStart`, `contributes`, `commandRenames`, `rowRenames`, and `buttonRenames`. The `entry` must point to a `.js` or `.mjs` ES module (src/features/plugins/manifest-validate.ts). `manifestVersion` 1 accepts only these fields plus your own `x-*` keys, so a misspelled `permisions` cannot ship a Plugin with no Plugin Permissions. The complete schema, which your editor reads through `$schema`, is src/features/plugins/manifest.schema.json.

## Warm start

An `on-demand` Plugin starts when a surface it contributes becomes reachable. `warmStart` chooses which reaches count:

- `surface`, the default: a sidebar entry, a Command whose Context is on screen (a Command in the global Context is on every screen), a page, a toolbar button, or a Settings row warms the Plugin.
- `intent`: only the Plugin's own page, or the author's intent, warms it. Hovering, focusing, or pressing its sidebar entry, or running one of its Commands, is an intent. A sidebar entry or a Command's Context on screen does nothing, so the Plugin is not started at launch just because it is listed. Its Commands and Item Menu entries stay enabled while it is stopped, and running one starts it first.

`warmStart: "intent"` applies only to an `on-demand` Plugin; a `persistent` one starts with the app either way. An on-demand Plugin with `intent` stops 3 seconds after its last page closes (or after a hover-only warm that never opened a page), whatever its sidebar entry does. It does not stop while the host still has open work on it: a Command run, another host request, or a Plugin call not yet answered. The stop is silent (no toast) and reopening the page warms it again. A surface Plugin still stops after five minutes with no surface and no call. The Reader Built-in uses `intent` (ADR 0019, amendment of 2026-10-29).

## Platforms

`platforms` lists the devices a Plugin runs on. Android is opt-in:

- No `platforms` field: the Plugin runs on desktop and the web, and it does not run on Android.
- A `platforms` list that includes `"android"`: the Plugin also runs on Android. A list without `"android"`, such as `["desktop", "web"]`, keeps it off Android.

The schema accepts `"android"` in every case, so a published manifest that already lists it runs on Android with no change.

On Android a Plugin runs in a memory-capped QuickJS engine inside the same sandbox Worker, not in the WebView's own engine. Three things differ from desktop and web:

- **Globals.** The Plugin sees exactly `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`, `queueMicrotask`, `performance.now`, `URL`, `TextEncoder`, `TextDecoder`, and `console` (every method a Worker has: `log`, `info`, `warn`, `error`, and `debug` reach the host console, `assert` logs a failed assertion as an error, and the counters and timers do nothing), plus the worker scope bridge: `self`, `globalThis`, `postMessage`, `onmessage`, `addEventListener`, and `removeEventListener`. `Intl` and `WebAssembly` are absent. A Plugin that needs either one bundles its own implementation into its entry.
- **Memory.** Each Plugin gets a 64 MB heap. A Plugin that allocates past it stops with the stop reason `out-of-memory`, and the app keeps running.
- **Custom UI.** Custom Frame UI is off on Android. A Frame shows a placeholder instead of mounting, and the rest of the Plugin still works.

Check Android without a device with `pnpm plugin:check <path>`. When the manifest lists `"android"`, its Android step evaluates the built entry in the same engine and fails with a readable message on a missing global, a module that does not evaluate, or a setup error. Without `"android"` the step is skipped.

## Manifest contributions

A Plugin declares what it adds under `contributes` in manifest.json. The validator and the registries read the same fields (src/features/plugins/manifest-schema.ts and src/features/plugins/contributions.ts):

- `commands`: a Command with a Plugin-local `id`, a `label` in the Plugin's default language, a `contexts` list, optional `keywords`, optional `defaults` and `web` Shortcuts, an optional `voice` block, optional `targets`, and the `navigates` or `opensDialog` flags. A `contexts` entry is a core Shortcut Context name (`global`, `bookList`, `bookEditor`, `coverDesigner`, `notes`, `canvas`, `ephemeral`, `editor`, `noteItem`, `chapterItem`, `canvasNode`, `image`, `footnoteItem`, `commandPalette`, `settings`; `CORE_CONTEXTS` in src/lib/shortcut-registry.ts) or this Plugin's own page id. A `targets` entry is one of `book`, `chapter`, `note`, `canvas`, and `canvasNode` (`PLUGIN_TARGETS` in src/features/plugins/manifest-constants.ts). A bare Arrow in `defaults` (`ArrowUp`, `ArrowDown`, `ArrowLeft`, or `ArrowRight`, no modifier) on a Command whose `contexts` are all its own page ids becomes a Fixed Shortcut on that page, like the Cover Designer nudges: it is locked there and wins over the global `focus.*` arrows. On a Command that also names a core Context the Arrow stays an ordinary Default, which loses to `focus.*` and shows inactive. A page that lifts an Arrow marks its host-rendered body `data-owns-arrows`, so spatial arrow-navigation leaves the Arrows to the page's Commands while lists, menus, and other widgets inside still keep their own.
- `pages`: a page with a Plugin-local `id`, a `title`, the `command` that opens it (a Command that declares `navigates: true`), and an optional `frame` path. Maibuk draws the `title` as the page heading; `"hideTitle": true` keeps it for screen readers and route focus only, for a page that draws its own heading or toolbar (a whole-page Frame usually does). `"hideBack": true` leaves out the Back button Maibuk draws when another place opened the page: the page draws its own from `navigation.returnTargetChanged` and calls `navigation.return`, while the stopped panel still shows Maibuk's Back.
- `sidebarEntries`: a `page` id and an `icon`. An icon is a Lucide icon name (kebab-case), a relative .svg path inside the Plugin folder, or inline elements (see [Inline icons](#inline-icons)).
- `settingsRows`: an `id`, a `label`, an optional `description`, and optional `keywords`.
- `toolbarButtons`: an `id`, the `command` it runs, an `icon`, and an optional `toggle`. A `toggle` button shows whether what it switches is on or off as the Plugin sets it with `toolbar.setPressed`.
- `itemMenuEntries`: a `command` that declares `targets`.
- `canvasReferenceSources`: an `id`, a `label` in the Plugin's default language (a locale file overrides it as `canvasReferenceSources.<id>.label`), and an `icon`, validated like a `sidebarEntries` icon. Maibuk derives the source's full id as `plugin.<pluginId>.<id>`. The Canvas Reference picker draws one tab per source after the host's own tabs, ordered by Plugin name, while the Plugin is on. Every source draws the Generic card: the icon, the source name, the title, an optional subtitle, and Open. An optional `preview` of `"landscape"` or `"portrait"` (Plugin API 0.1.15) adds an image at the top of the card: landscape draws a 3:2 image on a 240x320 card, contained on a muted background, and portrait draws a cover on a 192x480 card, cropped to fill. While the reference loads, is Missing or Unavailable, or has no image, the image slot is a muted block with the source icon, so the card keeps its box. A source without `preview` stays text only. A Plugin declares at most 20 sources.

Every contribution except `canvasReferenceSources` may carry its own `platforms` list, and the host filters each surface by the device platform; a Canvas Reference source follows its Plugin, which runs only on the platforms its manifest lists. Maibuk derives a Command's full id as `plugin.<pluginId>.<localId>`, so a Plugin never claims Maibuk's or another Plugin's ids. Registering is metadata only, so the Command Palette, Settings search, the toolbar, and the sidebar find an installed Plugin before its Worker is ready.


The template's manifest declares one Command, one page, and one sidebar entry:

```json
"contributes": {
  "commands": [
    {
      "id": "openHello",
      "label": "Open Hello",
      "contexts": ["global"],
      "navigates": true
    }
  ],
  "pages": [{ "id": "hello", "title": "Hello", "command": "openHello" }],
  "sidebarEntries": [{ "page": "hello", "icon": "hand" }]
}
```

A Plugin that adds Canvas Reference sources puts them in the same `contributes` object:

```json
"contributes": {
  "canvasReferenceSources": [{ "id": "items", "label": "Items", "icon": "box" }]
}
```

### Inline icons

An `icon` may also be `{ "elements": [[tag, attrs], ...] }`, a list of SVG elements drawn on a 24x24 grid (Plugin API 0.1.1). The host draws them with the same attributes as its own icons: `currentColor` stroke, width 2, round caps and joins, no fill, so size, color, hover, pressed, and disabled styles apply unchanged.

- Allowed tags: `path`, `circle`, `rect`, `line`, `polyline`, `polygon`, `ellipse`.
- Allowed attributes: `d`, `cx`, `cy`, `r`, `rx`, `ry`, `x`, `y`, `width`, `height`, `x1`, `y1`, `x2`, `y2`, `points`. Geometry only.
- At most 16 elements.

The validator refuses anything else and names the offender, such as `style`, `fill`, `stroke`, `href`, an `on*` handler, or an unknown tag. A `.svg` path keeps its existing behavior.

## Drawing a page

Import `ui` from `@maibuk/plugin-sdk` and write the page as an ordinary React component. The host renders every element; an element, prop, event, or method outside the table is rejected by the connection validator. Every component and its props is in [ui-reference.md](ui-reference.md). The template's page, from templates/plugin/plugin.tsx:

```ts
import { useState } from "react";
import { ui } from "@maibuk/plugin-sdk";

function HelloPage() {
  const [greetings, setGreetings] = useState(0);
  return (
    <ui.View direction="column" gap="md">
      <ui.Heading level={2}>Hello from your Plugin</ui.Heading>
      <ui.Text>{greetings === 0 ? "Press Greet to begin." : `Greetings: ${greetings}`}</ui.Text>
      <ui.Button onPress={() => setGreetings((count) => count + 1)}>Greet</ui.Button>
    </ui.View>
  );
}
```

## Wiring the page and answering the host

`start()` hands the host renderer the pages by id and, through `onHostRequest`, the handlers for the host's requests: the health check and this Plugin's Command run. From templates/plugin/plugin.tsx:

```ts
export function start(client: PluginClient, serve: HelloServe): void {
  serve(client, {
    pages: { [PAGE_ID]: HelloPage },
    onHostRequest: (method, params) => handleHostRequest(client, method, params),
  });
}

function handleHostRequest(client: PluginClient, method: string, params: unknown): unknown {
  if (method === "health.check") return "pong";
  if (method === PLUGIN_COMMAND_RUN_REQUEST) return runCommand(client, params);
  throw new Error(`No handler for ${method}`);
}

async function runCommand(client: PluginClient, params: unknown): Promise<null> {
  const { id } = (params ?? {}) as { id?: string };
  if (id === OPEN_COMMAND) await client.navigation.openPage({ pageId: PAGE_ID });
  return null;
}
```

A Plugin that declares `canvasReferenceSources` answers three more requests through the same `onHostRequest`; `canvasReferenceRequests` dispatches each one to the source it names and leaves every other method to your handler. `canvasReference.list` carries `{ source, query }` and answers `{ rows }` of `{ id, title, subtitle? }`; `canvasReference.resolve` carries `{ source, ids }` and answers a map from each asked id to `{ status: "present", title, subtitle?, image? }` or `{ status: "missing" }`; `canvasReference.open` carries `{ source, id }` and answers `"opened"` or `"missing"`. From a Plugin that lists two items:

```ts
import { type CanvasReferenceSourceRequests, canvasReferenceRequests } from "@maibuk/plugin-sdk";

const items: CanvasReferenceSourceRequests = {
  list: (query) => rows.filter((row) => row.title.toLowerCase().includes(query.toLowerCase())),
  resolve: (ids) => resolutionFor(ids),
  open: (id) => "opened",
};

export function start(client: PluginClient, serve: HelloServe): void {
  serve(client, {
    pages: { [PAGE_ID]: HelloPage },
    // Every other host request still goes to the handler above.
    onHostRequest: canvasReferenceRequests({ items }, (method, params) =>
      handleHostRequest(client, method, params)
    ),
  });
}
```

The host caps what it keeps from an answer: at most 200 rows, and a title or subtitle cut to 200 characters and shown as plain text. An `image` is drawn only when it is a `data:image/png`, `jpeg`, `webp`, or `svg+xml` URL of at most 1 MB and the source declares `preview`; anything else is dropped and the card draws its placeholder. The image travels only in the answer, never into the Canvas, so a card shows a new image the next time its Canvas opens. A request that takes more than 5 seconds is abandoned: a list that timed out shows an error row in that source's tab only, and a resolve that failed keeps the labels the Canvas already stored. `resolve` warm-starts an on-demand Plugin's sandbox when it is stopped, but not its Frame. `missing` from `open` flips the card to Missing, and a Plugin that is off makes its references show as Unavailable. None of the three requests needs a Plugin Permission.

A Plugin holding the `serve` Plugin Permission answers one more host request: `endpoint.request`, which carries one HTTP request that reached its [Plugin Endpoint](endpoint.md). Handle it with `client.onEndpointRequest`, not `onHostRequest`, because its answer may stream.

The Worker entry, templates/plugin/index.tsx, is the only file that imports `@maibuk/plugin-sdk/worker-ui`, and it imports it before anything else from the SDK. `@maibuk/plugin-sdk` touches `HTMLElement` when it is evaluated, and a Worker has no DOM until that Remote DOM polyfill runs, so an entry that imports the SDK first fails to start. The entry creates the client on the host's init message and calls `start()`. A host-side test imports plugin.tsx with the polyfill-free `@maibuk/plugin-sdk/ui-serve` entry instead, so the polyfill stays out of jsdom. See [Testing](testing.md).

## Events

`client.on(event, listener)` subscribes to an event and resolves with the function that unsubscribes. A subscription whose event's Plugin Permission is not granted rejects with `permission-denied`. The events are `library.changed`, `library.availabilityChanged`, `language.changed`, `navigation.returnTargetChanged`, `editor.contentChanged`, and `editor.focusChanged`; their payloads are in [api-reference.md](api-reference.md#events).

## Calling the API

The whole Plugin API is namespaced, promise-based methods over the one MessagePort the host gives the Plugin, so `client.library.books.list()` sends a call to the host broker and resolves with its result, or rejects with a `PluginApiError`. Every method, its input, its output, and the Plugin Permission it needs is in [api-reference.md](api-reference.md). A Plugin reaches the Library only through its Plugin Permissions.

## Localization

The manifest's literal strings are its `defaultLanguage`. A `locales/<lang>.json` file overrides them per field path, so `commands.openEchoes.label` overrides one Command's label. The Built-in Echoes Plugin supplies locales/en.json; its shape is:

```json
{
  "name": "Echoes",
  "description": "Points out words and phrases repeated closely enough, or often enough, that a reader would notice.",
  "commands.openEchoes.label": "Open Echoes",
  "pages.report.title": "Echoes",
  "settingsRows.detection.label": "Echo detection"
}
```

A locale file that fails validation is ignored with a warning, so one bad locale never refuses an otherwise valid Plugin. The Command registry keeps every language's label, so the Command Palette and Voice Commands resolve the current one; the other surfaces use the current UI language and re-register in place when it changes.

## Plugin Permissions

A Plugin declares the Plugin Permissions it needs under `permissions.required` (the author must approve them to enable the Plugin) and `permissions.optional` (the author may deny them one by one). The known names are `library:read`, `library:write`, `editor:read`, `editor:decorate`, `editor:write`, `secrets`, `clipboard`, `files:pick`, `files:save`, `system-notifications`, `process`, `serve`, and `network:<host>` for a named web host. Every API method lists the Plugin Permission it needs in [api-reference.md](api-reference.md). A refused call rejects with `permission-denied`, whose `permission` field names the missing Plugin Permission. `serve` is the one name that opens a port rather than a host capability: it lets outside programs reach the Plugin at its [Plugin Endpoint](endpoint.md).

### System Notifications

`system-notifications` lets a Plugin reach the device's own notification center, outside Maibuk's window (ADR 0042). `notifications.system({ id, title, body, at? })` shows one titled with your Plugin's name now, or at `at` (milliseconds since the epoch) when that is still ahead; sending the same `id` again replaces it, whether it is pending or showing, and `notifications.cancel({ id })` withdraws it. Ids are your Plugin's own, so no other Plugin can replace or cancel yours. Sends are queued and released at most one per second per Plugin, and none is dropped. At most 20 scheduled ones may be pending per Plugin: the 21st distinct id resolves `{ error: "limit", message }` naming the cap, while a send that reuses a pending id replaces it instead.

Android holds a scheduled notification after Maibuk closes. Desktop and web hold it only while Maibuk runs and forget it on restart, so send the pending ones again when your Plugin starts. `notifications.systemStatus()` reports the device's answer (`granted`, `denied`, or `default`), whether it can fire one while Maibuk is closed (true on Android), and its `exactTiming`: Android is inexact until the author allows alarms and reminders, and `notifications.requestSystemPermission()` opens that setting. Call it from a button the author pressed: it is refused with `user-action-required` otherwise, like `files.pick`. Disabling or removing the Plugin, or revoking `system-notifications`, cancels its pending ones. Clicking one brings Maibuk to the front on the Plugin's first page. When the answer is not `granted`, or the device cannot show one (mobile browsers), the author sees Maibuk's toast naming your Plugin instead. In tests, `host.systemNotifications` is the device: it records what was sent, replaced, scheduled, and cancelled, and `click(tag)` plays the author's click, which records the first page in `host.pageNavigations`.
