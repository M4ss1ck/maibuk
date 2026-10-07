---
status: accepted
---

# The Plugin API is a versioned method table, and the manifest is strict

Every Plugin API method is a row in a host-owned table kept as data. Each row holds the method id, a description, JSON Schemas for input and output, the required Plugin Permission, and whether the method reads or writes. The SDK's TypeScript types, the documentation, and any future MCP tool list are generated from that table. The broker checks calls against the same rows. The API has its own semver, separate from Maibuk's release number, with no compatibility promise before 1.0. A Plugin whose `apiVersion` range or `minAppVersion` is not met stays listed and off, with a plain explanation, and its data is kept. `manifest.json` is validated against a JSON Schema kept in this repository. Unknown fields are refused (except `x-*`). Contributions mirror `CommandDef` and `SettingsRowDef`. Every contributed id is derived by the host as `plugin.<pluginId>.<localId>`, so no Plugin can claim Maibuk's ids or another Plugin's.

Decided in [Plugin API surface v1](https://github.com/M4ss1ck/maibuk/issues/396#issuecomment-5969592441) and [Plugin manifest schema and API versioning](https://github.com/M4ss1ck/maibuk/issues/400#issuecomment-5975037577). [Plugin authoring workflow: scaffold, development, packages, and docs](https://github.com/M4ss1ck/maibuk/issues/418#issuecomment-5984562425) replaced the npm package that 400 assumed: the SDK and schema come from a Maibuk checkout, not a published package.

## Considered Options

- Hand-written SDK types next to the broker: rejected. Types, docs, Permission checks, and MCP tools would be four lists that drift apart.
- Version the API with Maibuk's release number: rejected. Most releases do not touch the API, and Plugin authors need to know exactly when it breaks.
- A lenient manifest that ignores unknown fields: rejected. A misspelled `permisions` would silently ship a Plugin with no grants.
- Reverse-DNS Plugin ids: rejected. Without a registry, nothing enforces who owns a domain. Slugs are shorter, and `maibuk-` is reserved for Built-in Plugins.

## Consequences

- Reads return plain text and sanitized HTML. TipTap JSON and Canvas content never cross the API, so the editor schema and `CanvasDoc` can change freely.
- Events only invalidate: they carry ids, never content. A Plugin that cares pulls content with a permitted read.
- Adding a method is adding a table row; the SDK types, docs, and broker check follow from it.
- Built-in Plugins ship in lockstep with Maibuk, so they always match the current API.
