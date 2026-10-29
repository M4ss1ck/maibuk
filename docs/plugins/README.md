# Plugin authoring

A **Plugin** is a packaged addition to Maibuk that adds its own Commands, pages, Settings rows, or buttons without changing Maibuk itself, and reaches the author's work only through the **Plugin Permissions** it was granted. Maibuk's own and the author's Plugins work the same way. A **Built-in Plugin** ships with Maibuk: Maibuk copies it into the **Plugin Directory** and starts it off with its Plugin Permissions already granted, so turning it on needs no review. The **Plugin Directory** is the folder on this device that Maibuk loads Plugins from, chosen in Settings. A **Plugin Permission** is one kind of access a Plugin declares, such as reading the Library or reaching a named web host, and that the author grants or revokes.

## Reading order

1. [Quickstart](quickstart.md): from a clean Maibuk checkout to a passing check.
2. [Host-rendered UI](host-rendered-ui.md): the default path, where Maibuk draws your interface.
3. [Frame UI](frame-ui.md): the custom-UI path, where the Plugin draws its own document.
4. [Testing](testing.md): the test kit and what it runs for real.
5. [Reading files](files.md): picking a file from outside the Library, reading it in ranges, and when a File Grant ends.
6. [Plugin Endpoint](endpoint.md): the local HTTP address an outside program reaches the Plugin on, desktop only.
7. [Development mode](development-mode.md): reload on a build, and troubleshooting.
8. [Packaging](packaging.md): the built folder, the zip, and versions.
9. [Plugin API reference](api-reference.md): every method, generated from the code.
10. [Plugin UI component reference](ui-reference.md): every host-rendered component, generated from the code.

Which devices run a Plugin is set by its `platforms` list: omit it for desktop and the web, or list `"android"` to run on Android too. See [Platforms](host-rendered-ui.md#platforms).

## Generated references

api-reference.md and ui-reference.md are generated; do not edit them by hand.

```bash
pnpm generate:plugin-api
pnpm generate:plugin-ui
```

`pnpm generate:plugin-api` writes docs/plugins/api-reference.md from src/features/plugins/api-table.ts. `pnpm generate:plugin-ui` writes docs/plugins/ui-reference.md from src/plugin-sdk/ui-table.ts. A unit test fails when either committed page drifts from what the generator emits: src/test/unit/features/plugins/api-table.test.ts holds api-reference.md to its generator, and src/test/unit/plugins/plugin-ui-codegen.test.ts holds ui-reference.md to its generator. A method or component change ships the regenerated page in the same change.

## Complete example

[plugins/maibuk-echoes/](../../plugins/maibuk-echoes/) is the complete example Plugin. It is a Built-in, host-rendered, and declares a page, a sidebar entry, an editor toolbar button, a Settings row, an Item Menu entry, several Commands, its own locales, and its own tests. Read it beside these pages.

[plugins/maibuk-mcp/](../../plugins/maibuk-mcp/) is the other Built-in: MCP Server, a desktop-only Plugin that holds `serve` and answers the [Plugin Endpoint](endpoint.md), so an outside AI tool reaches the Library through the Model Context Protocol.
