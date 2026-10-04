# External Plugin authoring research

Checked 2026-10-04. Scope: a Plugin has its own git repository; Maibuk lives in a separate checkout; no published Maibuk SDK, test-kit, or CLI packages. Evidence for [Plugin authoring workflow: scaffold, development, packages, and docs](https://github.com/M4ss1ck/maibuk/issues/418). The ticket owns the accepted workflow; this note records external evidence and its limits. No authoring tooling is implemented here.

## Official precedents

- **VS Code:** launch/test configuration accepts an external extension root through `extensionDevelopmentPath`, independently of the installed host. Integration tests run inside the actual Extension Development Host and access the public VS Code API. The official convenient runner uses published test packages, so its distribution model does not meet Maibuk's constraint. The separable host/path/API boundary does. Source: [Testing Extensions](https://code.visualstudio.com/api/working-with-extensions/testing-extension).
- **VS Code build boundary:** ordinary esbuild/webpack watch builds output a bundle; the runtime-supplied `vscode` module stays external. Type checking is separate from esbuild compilation. Packaging excludes development sources and dependencies already bundled. This is a relevant model for keeping host API imports out of Plugin bundles, not proof that Maibuk should expose raw React. Source: [Bundling Extensions](https://code.visualstudio.com/api/working-with-extensions/bundling-extension).
- **Obsidian:** the official guide places the developer's repository under a dedicated development vault's Plugins directory; ordinary watch compilation updates its entry file. Reloading is explicit unless an additional hot-reload plugin is installed. This is not an official guarantee of built-in automatic hot reload or external symlink support. Source: [Build a plugin](https://docs.obsidian.md/Plugins/Getting%20started/Build%20a%20plugin).
- **Obsidian's maintained template:** manual installation copies the built JavaScript, styles, and manifest to the vault. Releases attach those same files; the API dependency is distributed separately, so Maibuk cannot copy that dependency workflow unchanged. Source: [obsidian-sample-plugin](https://github.com/obsidianmd/obsidian-sample-plugin).
- **Joplin:** the developer initializes a distinct Plugin repository; development settings register its root path. Builds go into `dist`; the installed development app loads them with a separate profile. Its scaffold is a published generator, which is specifically not a fit here. Its external-directory registration is evidence for separating the Plugin repository from the host checkout, not a requirement to add directory registration to Maibuk. Source: [Getting started with plugin development](https://joplinapp.org/help/api/get_started/plugins/).
- **React constraint:** components and the renderer invoking them must resolve the same React module. Linking local libraries can introduce a second copy. Independent trees may use separate copies, so this concern differs between host-rendered components and a separately rendered Frame. Source: [Rules of Hooks](https://react.dev/warnings/invalid-hook-call-warning).

## What the evidence establishes

The precedents support keeping Plugin source in an independent repository and testing it against the real host through a public API. They do not establish how Maibuk should distribute its SDK without packages: each compared ecosystem distributes relevant API or tooling dependencies. A local Maibuk checkout can supply that tooling, but its external-path, type-resolution, and test-runner behavior needs execution evidence before the developer experience is claimed to work.

Build and installation are separate operations. Joplin's configured development path and Obsidian's copied build files demonstrate different ways of reaching the installed app. Neither requires treating Built-in source as a special runtime format. Maibuk's accepted choice, including compiled Built-in resources and explicit third-party installation, belongs to the linked decision ticket.

React's duplicate-module constraint applies within each renderer's execution environment. Maibuk's remote Worker renderer and host renderer are separate environments; the evidence does not require them to share a React instance across the sandbox. Local SDK and test-kit resolution still must not accidentally introduce incompatible duplicate runtimes within either environment. A custom Frame can own its renderer dependencies.

## Costs and limits

No packages does not mean no supported tooling surface: local entry points, API declarations, version compatibility, and test runner contracts still need maintenance. A second host checkout and dependency installation remain onboarding/CI costs. Neither official Obsidian nor Joplin guide proves symlink behavior across OSes, atomic reload, or Maibuk's test integration. Do not claim any of these as already proven.

## Verification log

1. The research worker searched official documentation domains, identifying the guides and maintained example repository.
2. The research worker fetched every cited URL through agent-reach's Jina web reader and read its title and relevant body. Returned titles: “Testing Extensions”; “Bundling Extensions”; “Build a plugin - Developer Documentation”; “GitHub - obsidianmd/obsidian-sample-plugin: Template for Obsidian community plugins with build configuration and development best practices.”; “Getting started with plugin development | Joplin”; “Rules of Hooks – React”.
3. The research worker cross-checked directory/build claims against the official Obsidian template and Joplin's [Plugin Loading Rules](https://joplinapp.org/help/api/references/plugin_loading_rules/) (fetched title: “Plugin Loading Rules | Joplin”). Re-read VS Code's testing guide specifically for external root and public API behavior. Reviewed recommendations separately to avoid presenting untested design choices as external facts.

The supervising agent independently fetched all eight linked pages, checked their titles and relevant source passages, reviewed this note against the confirmed decision, and ran Prettier and whitespace checks.

No commands here are presented as a working Maibuk quickstart. No host/plugin setup was executed. A clean external-repo smoke test on supported platforms, including type resolution, build/watch, real test harness, failure reload, and packaging, would settle the unverified implementation details.
