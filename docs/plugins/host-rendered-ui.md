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
| `platforms` | one or more of `desktop`, `web`, `android` |
| `lifecycle` | `persistent`, which starts with the app, or `on-demand`, which starts when a surface becomes reachable |
| `defaultLanguage` | `en` or `es` |
| `permissions` | an object with a `required` list and an `optional` list of Plugin Permission names |

The optional top-level fields are `$schema`, `minAppVersion`, `homepage`, `dataVersion`, `customUi`, `contributes`, `commandRenames`, `rowRenames`, and `buttonRenames`. The `entry` must point to a `.js` or `.mjs` ES module (src/features/plugins/manifest-validate.ts). `manifestVersion` 1 accepts only these fields plus your own `x-*` keys, so a misspelled `permisions` cannot ship a Plugin with no Plugin Permissions. The complete schema, which your editor reads through `$schema`, is src/features/plugins/manifest.schema.json.

## Manifest contributions

A Plugin declares what it adds under `contributes` in manifest.json. The validator and the registries read the same fields (src/features/plugins/manifest-schema.ts and src/features/plugins/contributions.ts):

- `commands`: a Command with a Plugin-local `id`, a `label` in the Plugin's default language, a `contexts` list, optional `keywords`, optional `defaults` and `web` Shortcuts, an optional `voice` block, optional `targets`, and the `navigates` or `opensDialog` flags. A `contexts` entry is a core Shortcut Context name (`global`, `bookList`, `bookEditor`, `coverDesigner`, `notes`, `canvas`, `ephemeral`, `editor`, `noteItem`, `chapterItem`, `canvasNode`, `image`, `footnoteItem`, `commandPalette`, `settings`; `CORE_CONTEXTS` in src/lib/shortcut-registry.ts) or this Plugin's own page id. A `targets` entry is one of `book`, `chapter`, `note`, `canvas`, and `canvasNode` (`PLUGIN_TARGETS` in src/features/plugins/manifest-constants.ts).
- `pages`: a page with a Plugin-local `id`, a `title`, the `command` that opens it (a Command that declares `navigates: true`), and an optional `frame` path.
- `sidebarEntries`: a `page` id and an `icon`. An icon is a Lucide icon name (kebab-case) or a relative .svg path inside the Plugin folder.
- `settingsRows`: an `id`, a `label`, an optional `description`, and optional `keywords`.
- `toolbarButtons`: an `id`, the `command` it runs, an `icon`, and an optional `toggle`. A `toggle` button shows whether what it switches is on or off as the Plugin sets it with `toolbar.setPressed`.
- `itemMenuEntries`: a `command` that declares `targets`.

Every contribution may carry its own `platforms` list, and the host filters each surface by the device platform. Maibuk derives a Command's full id as `plugin.<pluginId>.<localId>`, so a Plugin never claims Maibuk's or another Plugin's ids. Registering is metadata only, so the Command Palette, Settings search, the toolbar, and the sidebar find an installed Plugin before its Worker is ready.

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

The Worker entry, templates/plugin/index.tsx, is the only file that imports `@maibuk/plugin-sdk/worker-ui`, and it imports it before anything else from the SDK. `@maibuk/plugin-sdk` touches `HTMLElement` when it is evaluated, and a Worker has no DOM until that Remote DOM polyfill runs, so an entry that imports the SDK first fails to start. The entry creates the client on the host's init message and calls `start()`. A host-side test imports plugin.tsx with the polyfill-free `@maibuk/plugin-sdk/ui-serve` entry instead, so the polyfill stays out of jsdom. See [Testing](testing.md).

## Events

`client.on(event, listener)` subscribes to an event and resolves with the function that unsubscribes. A subscription whose event's Plugin Permission is not granted rejects with `permission-denied`. The events are `library.changed`, `library.availabilityChanged`, `language.changed`, `editor.contentChanged`, and `editor.focusChanged`; their payloads are in [api-reference.md](api-reference.md#events).

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

A Plugin declares the Plugin Permissions it needs under `permissions.required` (the author must approve them to enable the Plugin) and `permissions.optional` (the author may deny them one by one). The known names are `library:read`, `library:write`, `editor:read`, `editor:decorate`, `editor:write`, `secrets`, `clipboard`, `process`, and `network:<host>` for a named web host. Every API method lists the Plugin Permission it needs in [api-reference.md](api-reference.md). A refused call rejects with `permission-denied`, whose `permission` field names the missing Plugin Permission.
