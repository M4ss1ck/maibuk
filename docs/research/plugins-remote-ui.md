# Remote UI for sandboxed React Plugins: library and performance

Research date: 2026-10-02. Ticket: #391, map: #389. Primary sources only: source repositories pinned to a commit, official docs, npm registry metadata, and a throwaway prototype measured in Playwright Chromium and WebKit on this machine. Maibuk paths are relative to the repo root at `bed1e51d`.

Standing decisions from #389 that this builds on, not reopens: Plugin logic runs in a Worker; UI is host-rendered by default with Maibuk's React Aria components, tokens, and i18n; a `Frame` (sandboxed iframe) is the escape hatch; performance is a top requirement; desktop, web, and Android all run Plugins.

Pinned refs:

| Source | Ref |
| --- | --- |
| Shopify/remote-dom | commit `dd02515a4324fc279e4d7c0b1fce827bd3a2ffad` (main, 2026-10-02) |
| `@remote-dom/core` | 1.12.0 (npm, published 2026-09-22) |
| `@remote-dom/react` | 1.2.2 (npm, published 2025-09-18) |
| `@quilted/threads` | 4.1.0 |
| `react`, `react-dom` | 19.2.3 (the version installed in Maibuk's `node_modules`; `package.json` asks for `^19.1.0`) |
| `react-reconciler` | 0.33.0 (peer `react ^19.2.0`); latest is 0.34.0 (peer `react ^19.3.0`) |
| Playwright | 1.62.1 (Maibuk's pinned version), bundled Chromium and WebKit |

---

## Recommendation

**Use Shopify Remote DOM: `@remote-dom/core` + `@remote-dom/react`.** In the Plugin Worker, the Plugin's React tree renders with the real `react-dom` into Remote DOM's DOM polyfill; on the host, `RemoteReceiver` + `RemoteRootRenderer` map each remote element to a Maibuk React Aria component. Wrap it behind Maibuk's own Plugin SDK so Plugins never import Remote DOM directly, and put Maibuk's allowlist and prop validation in front of the receiver, not inside it.

Why this one:

1. **It is the only maintained, production-proven library for exactly this job.** Shopify's UI extensions (Checkout, Customer Account, Admin, POS) are built on it ([Shopify, "Using web components"](https://shopify.dev/docs/api/polaris/using-polaris-web-components); [Shopify Engineering, "Remote rendering"](https://shopify.engineering/remote-rendering-ui-extensibility)). The repo (1,340 stars, MIT, created 2020-06-17 as `Shopify/remote-ui`, now renamed) had at least 100 commits since 2025-10-01 (the API page limit) and a commit on 2026-10-02; the 2026 commits come from eight human authors, including Preact maintainers `andrewiggins` and `developit`.
2. **React upgrades come free.** The remote side is plain `react-dom` rendering into a polyfilled DOM, not a custom reconciler. Every reconciler-based competitor is stuck: Stripe's `@stripe/ui-extension-sdk` 9.4.0 (2026-09-25) pins `react 18.3.1` + `react-reconciler 0.29.0` + `@remote-ui/*`; Atlassian `@forge/react` 12.3.0 (2026-09-29) pins `react ^18.2.0` + `react-reconciler ^0.29.0`; Raycast `@raycast/api` 2.6.2 pins `react 19.0.0` exactly. `react-reconciler` binds to one React minor (0.33 needs `^19.2`, 0.34 needs `^19.3`) and its README says "Its API is not as stable as that of React... Use it at your own risk." The prototype below ran React 19.2.3 through Remote DOM unchanged.
3. **The host cost is small and measured.** `@remote-dom/react/host` + `@quilted/threads` add 4.6 KB gzip to Maibuk's bundle (React excluded, since Maibuk ships it already). The repo enforces size budgets in CI (`packages/size-limit/.size-limit.js`: core host 3,250 B, react host 3,000 B, polyfill 14,000 B).
4. **Typing is fast enough when the host owns the field's value.** Measured keystroke to host commit with a remote-rendered text field: p50 0.7 ms, p95 0.9 ms on desktop Chromium with no other UI; p50 5.8 ms, p95 11.5 ms while 1,000 remote list rows also update on every keystroke. Details in section 3.

What it costs, stated up front:

- **React 19 is not declared.** `@remote-dom/react` 1.2.2 has `peerDependencies: react ^17 || ^18` and the repo's own catalog uses React 18.3. [Issue #530](https://github.com/Shopify/remote-dom/issues/530) "React 19 Support" has been open since 2025-02-11 with no maintainer reply. The prototype worked on 19.2.3 for text, events, properties, and lists; Maibuk needs a `pnpm.peerDependencyRules.allowedVersions` entry and its own tests. The React wrapper is 2 KB of source (`packages/react/source/`), small enough to fork if Shopify drops it.
- **Issue triage is weak.** Pull requests are reviewed within days, but user-filed issues from 2025 sit open for months (#530, #560, #563, #585, #588), and #530 has no maintainer reply at all. Plan to read the source, not wait for answers.
- **Shopify's own authors moved off React.** From API 2025-10, Shopify extensions use Preact and Polaris web components with a 64 KB bundle limit ([Gadget, "Shopify API 2025-10"](https://gadget.dev/blog/shopify-api-2025-10-web-components-preact)). React stays supported in Remote DOM, but Preact gets the attention.
- **The remote bundle is heavy.** A Plugin Worker carries `react` + `react-dom` (60.3 KB gzip) plus Remote DOM's polyfill, elements, React wrapper, and threads (21.6 KB gzip): 79.3 KB gzip total for the prototype Plugin. A custom reconciler Worker would be 41.1 KB gzip. Measured worker start to first remote field committed on the host: 33 to 42 ms on desktop Chromium, 39 to 43 ms in WebKit, 57 to 65 ms with 4x CPU throttling. This is paid when a Plugin is first used, never at launch (decision 4 in #389).

**Rejected:** writing Maibuk's own `react-reconciler` renderer (section 2.4). It saves 38 KB gzip per Plugin Worker and costs a host config that changes with every React minor, a function-proxy RPC with memory management, mutation batching, and a host receiver: everything Remote DOM already ships and tests. Revisit only if a prototype shows Worker startup on Android over budget because of `react-dom`'s size.

---

## 1. How the options compare

| | Remote DOM (`@remote-dom/react`) | Own `react-reconciler` renderer | Raycast | Figma | Atlassian Forge UI Kit | Stripe Apps |
| --- | --- | --- | --- | --- | --- | --- |
| Where Plugin code runs | Worker or hidden iframe | Worker | Node worker thread per extension | Main thread sandbox (Realms, later QuickJS) + UI in null-origin iframe | Sandboxed iframe | Sandboxed iframe |
| UI drawn by | Host components | Host components | Native Swift views | The plugin's own iframe | Atlassian Design System | Stripe components |
| Remote renderer | `react-dom` over a DOM polyfill | Custom host config | Custom reconciler, JSON render tree, JSON Patch | n/a | `ForgeReconciler` (`react-reconciler ^0.29`) | `@remote-ui/react` (`react-reconciler 0.29`) |
| React version today | 19.2.3 works (measured); peer says 17/18 | Pinned to one minor | 19.0.0 exact | Any (iframe) | 18 | 18.3.1 exact |
| Accessible by construction | Yes, host components | Yes | Yes | No | Yes | Yes |
| Library available to Maibuk | Yes, MIT | Build it | No | No | No | No |

### 1.1 Shopify Remote DOM

Model ([README](https://github.com/Shopify/remote-dom/blob/dd02515a4324fc279e4d7c0b1fce827bd3a2ffad/README.md)): the remote environment builds a tree of custom elements (`RemoteElement` subclasses, or `createRemoteElement({properties, attributes, events, methods})`). A `RemoteRootElement` (in a Worker) or `RemoteMutationObserver` (in an iframe) turns DOM changes into mutation records and sends them over a `RemoteConnection`, an interface with two methods: `mutate(records)` and `call(id, method, ...args)` (`packages/core/source/types.ts:121-136`). Four record types exist: insert child, remove child, update text, update property, where a property update is a property, an attribute, or an event listener (`packages/core/source/constants.ts:6-13`).

On a React host, `RemoteReceiver` stores the tree as plain objects and `RemoteRootRenderer` renders it with a `components` map from element name to React component. `createRemoteComponentRenderer()` hands each host component the element's properties, attributes, event listeners as `onEventName` props, and children, with slotted children as named props ([packages/react/README.md](https://github.com/Shopify/remote-dom/blob/dd02515a4324fc279e4d7c0b1fce827bd3a2ffad/packages/react/README.md)).

`BatchingRemoteConnection` coalesces mutations to one message per microtask; the docs call it out for the Worker case because "no such batching is performed" there otherwise ([packages/core/README.md, BatchingRemoteConnection](https://github.com/Shopify/remote-dom/blob/dd02515a4324fc279e4d7c0b1fce827bd3a2ffad/packages/core/README.md)).

Functions (event listeners, callbacks) cross through `@quilted/threads`, which proxies them by id and releases them with `WeakRef` + `FinalizationRegistry`, or manually with `retain`/`release` ([quilt/packages/threads README, "Memory management"](https://github.com/lemonmade/quilt/tree/main/packages/threads)). The README is direct about the cost: "Implementing functions using message passing always leaks memory."

`@remote-ui/*`, the previous generation that Stripe still uses, was built on `react-reconciler`; `@remote-ui/react` 5.0.8 (2025-06-13) limits `@types/react` to `<19` and `@types/react-reconciler` to `<0.30`.

### 1.2 Raycast

From [Raycast, "How the Raycast API and extensions work"](https://www.raycast.com/blog/how-raycast-api-extensions-work) (2023-05-31): one Node process hosts all extensions, each in its own worker thread (a separate V8 isolate). A custom React reconciler turns the tree into a JSON "render tree"; Raycast diffs it and sends JSON Patch over JSON-RPC on stdio, and "If there are no patches... native land can just sit there and do nothing." Extensions "only send registered messages ('render', 'setClipboard', etc.)", so the protocol is the allowlist. Raycast does not sandbox: it relies on reviewing open-source extensions. Its List search bar is uncontrolled by default; `onSearchTextChange` notifies, and a `throttle` prop is "Recommended... when using custom filtering logic with asynchronous operations" ([List API](https://developers.raycast.com/api-reference/user-interface/list)). Nothing here is a library Maibuk can install.

### 1.3 Figma

From [Figma, "How we built the Figma plugin system"](https://www.figma.com/blog/how-we-built-the-figma-plugin-system/) (2019-08-22): plugin logic that touches the document runs in a sandbox on the main thread; UI runs in a null-origin iframe that the plugin draws itself, and the two talk by message passing. Figma accepted that "using browser APIs [is] a little more tedious". This is Maibuk's `Frame` escape hatch, not the default: Figma cannot guarantee that plugin UI is themed or accessible.

### 1.4 Atlassian Forge UI Kit and Stripe Apps

Forge is the closest analog to #389's design, down to the name of the escape hatch. UI Kit "does not directly rely on React DOM. Therefore, functionalities dependent on standard browser DOM elements, like custom HTML, portals, and forwarding refs, may not work as expected" ([UI Kit overview](https://developer.atlassian.com/platform/forge/ui-kit/overview/)). Its [`Frame` component](https://developer.atlassian.com/platform/forge/ui-kit/components/frame/) renders a static HTML/JS app inside UI Kit, sizes itself to its content unless given explicit dimensions, and allows "Only a single Frame component... per module to protect performance". Stripe Apps run in a sandboxed null-origin iframe, do not support `ref` props, and allow only Stripe's components ([How UI extensions work](https://docs.stripe.com/stripe-apps/how-ui-extensions-work)).

### 1.5 Other contenders checked

- **AMP `worker-dom`** (3,264 stars): a DOM in a Worker mirrored to the main thread. Last release 0.36.0 on 2025-06-27; nothing but dependency bumps since. It mirrors real HTML, not host components, so it would not give Maibuk its React Aria components.
- **MCP-UI** (5,190 stars) supported Remote DOM resources, then removed them: "MCP-UI only supports the new MCP Apps from now on" ([PR #185](https://github.com/MCP-UI-Org/mcp-ui/pull/185), 2026-03). The MCP Apps spec (`modelcontextprotocol/ext-apps`, 2,890 stars) renders HTML in iframes. A signal that Remote DOM's ecosystem outside Shopify is thin, not a reason against it for Maibuk, whose requirement is host-drawn accessible UI.
- **Lynx** (`lynx-family/lynx-stack`, 735 stars): a whole dual-thread app framework, not a library to put inside an existing React DOM app.
- `GoogleChromeLabs/comlink` (12,800 stars) and `@quilted/threads` are RPC transports, not renderers. Remote DOM already brings `@quilted/threads`.

### 1.6 Maintenance numbers (checked 2026-10-02 with `gh api` and `npm view`)

| Repo / package | Stars | Last commit | Notes |
| --- | --- | --- | --- |
| Shopify/remote-dom | 1,340 | 2026-10-02 | at least 100 commits since 2025-10-01; 37 open issues + PRs; user issues from 2025 unanswered |
| `@remote-dom/core` | | 1.12.0, 2026-09-22 | |
| `@remote-dom/react` | | 1.2.2, 2025-09-18 | peer `react ^17 \|\| ^18` |
| facebook/react `react-reconciler` | | 0.34.0, 2026-10-02 | peer `react ^19.3.0` |
| ampproject/worker-dom | 3,264 | 2025-06-30 | release 0.36.0 |
| MCP-UI-Org/mcp-ui | 5,190 | 2026-09-16 | dropped Remote DOM |

---

## 2. Events, controlled inputs, and latency

### 2.1 How events cross

A remote element declares `events: ['input']`. In the Worker, `createRemoteComponent(..., {eventProps: {onInput: {event: 'input'}}})` turns a React `onInput` prop into an event listener on the custom element. Adding the listener sends an "update property, event listener" record; the host component receives `onInput` as a prop, and calling `onInput(value)` dispatches a `RemoteEvent` in the Worker with `value` as `event.detail` ([packages/core/README.md, "Remote events"](https://github.com/Shopify/remote-dom/blob/dd02515a4324fc279e4d7c0b1fce827bd3a2ffad/packages/core/README.md)). Remote events do not bubble unless declared with `bubbles`. A remote listener can return a value to the host with `event.respondWith()`.

Every remote handler runs after the host event has finished. A Plugin cannot call `preventDefault()` or `stopPropagation()` on a host key or pointer event. So the host component decides default behavior; Plugins express intent through props (`isDisabled`, `onAction`), and keyboard shortcuts stay manifest-declared Commands.

### 2.2 Controlled inputs: the host must own the live value

Shopify's own rule for its remote text fields: `onChange` "fires when the user finishes editing the field, typically on blur", `onInput` "fires on every change the user makes in the field, including each keystroke", and "Don't use `onInput` to control `value`" because it "can cause problems on lower-powered devices due to asynchronous rendering" ([URLField docs](https://shopify.dev/docs/api/admin-extensions/2025-07/ui-components/forms/urlfield)). Raycast's search bar is uncontrolled by default with an opt-in `throttle`.

The prototype confirms why. When the host `<input>` takes its `value` from the remote prop (a React controlled input across the boundary), fast typing loses text: in Chromium the field ended as `y` instead of the 70-character sentence (each keystroke replaced the field because the host reverted to the stale remote value before the echo arrived); in WebKit it ended scrambled (`e quikbon fxjmp vrt lzy...`). At a human pace (one key per 100 ms) it survived, but only because the round trip stayed under 100 ms; a slower Worker on Android would lose characters at real typing speed.

The pattern that held in every run: **the host component keeps the field's live value in its own state, sends `onInput` notifications to the Plugin, and applies a remote `value` only when it differs from what the host last sent** (the same echo check the Edit Session uses for editor saves, `src/features/edit-session/`). The remote `value` prop then means "the Plugin replaced the text" (clear, reset, programmatic fill), not "here is your keystroke back".

### 2.3 Measured latency

Prototype: one remote text field, one remote text node showing the length, and N remote list rows whose labels all change on every keystroke (the worst case for the mutation stream). Host components are plain React; React 19.2.3 on both sides; `BatchingRemoteConnection` on. Playwright types a 70-character sentence through the real keyboard pipeline. Latency is from the host `onChange` to the host `useLayoutEffect` that sees the Plugin's echo of that exact value (so it includes host to Worker message, Worker React render, mutation batch, Worker to host message, host React commit; it does not include paint). "Host-owned" and "controlled" differ only in the input's `value` source.

Human pace (100 ms between keys), 70 samples per row:

| Engine, CPU | Remote rows | Host-owned p50 / p95 / max (ms) | Controlled p50 / p95 / max (ms) |
| --- | --- | --- | --- |
| Chromium, 1x | 0 | 0.7 / 1.0 / 2.1 | 0.7 / 0.9 / 10.9 |
| Chromium, 1x | 200 | 1.9 / 4.1 / 18.0 | 2.4 / 4.7 / 7.7 |
| Chromium, 1x | 1,000 | 5.8 / 11.5 / 18.0 | 5.8 / 9.5 / 13.1 |
| Chromium, 4x throttle | 0 | 2.9 / 4.0 / 7.7 | 3.0 / 4.3 / 7.1 |
| Chromium, 4x throttle | 200 | 7.7 / 12.3 / 15.7 | 7.8 / 10.3 / 14.9 |
| Chromium, 4x throttle | 1,000 | 19.3 / 25.3 / 39.9 | 20.7 / 27.8 / 37.1 |
| WebKit, 1x | 0 | 1 / 2 / 3 | 1 / 2 / 3 |
| WebKit, 1x | 1,000 | 6 / 9 / 19 | 9 / 16 / 22 |

(WebKit's `performance.now()` is clamped to 1 ms.)

Bare RPC round trip host to Worker and back with `@quilted/threads`: p50 0.0 ms, p95 0.1 ms, max 0.3 ms (Chromium, 200 calls). The transport is not the cost; React rendering on both sides and the size of the mutation batch are.

Burst typing (no delay between keys), host-owned: the field's final text was correct in every engine and size, and the Plugin caught up within p95 104 ms (1,000 rows, Chromium 1x) and 641 ms (1,000 rows, 4x throttle). Controlled: the final text was wrong in all 6 Chromium and 3 WebKit burst runs.

Reading the numbers against a 16.7 ms frame: with host-owned input, the character appears on the host's own render, independent of the Plugin, so typing feel does not depend on the Worker at all. The Plugin's reaction (filtering a list, a counter) arrives within a frame or two on desktop for small trees. A Plugin that re-renders 1,000 rows per keystroke on a slow device lags visibly (20 to 40 ms per update, seconds of catch-up under bursts), which is a reason for the list design in section 4.4, not a reason to change libraries.

Worker start to first remote element committed on the host: 33 to 42 ms (Chromium 1x, empty tree), 39 to 43 ms (WebKit), 57 to 65 ms (Chromium 4x), and 71 to 133 ms with 1,000 initial rows.

### 2.4 What owning a `react-reconciler` renderer costs

Measured: `react` + `react-reconciler` 0.33 in a Worker is 40.2 KB gzip, against 60.3 KB for `react` + `react-dom`, and Remote DOM's remote layer adds 21.6 KB. A minimal mutation-mode host config for React 19 (written for the size probe) already needs about 50 members (the 0.33 production build reads 160 distinct host config members in all, many optional for hydration, persistence, and resources), including recent additions (`resolveUpdatePriority`, `maySuspendCommit`, `NotPendingTransition`, `resolveEventType`, `trackSchedulerEvent`, and others); the full list lives in [`ReactFiberConfig.custom.js`](https://github.com/facebook/react/blob/main/packages/react-reconciler/src/forks/ReactFiberConfig.custom.js) and changes between minors. On top of the host config, Maibuk would own the function proxy and its memory release, batching, the host receiver, and ordering bugs Remote DOM already fixed (for example "Insert- and AddMutations applied in wrong order at Receiver-side", #519). Stripe and Forge, both with dedicated teams, are still on React 18 with reconciler 0.29. The 38 KB saving is real but paid only at Plugin activation; it does not justify the upkeep unless an Android measurement says otherwise.

---

## 3. Restricting the tree and validating props

Remote DOM gives two layers; Maibuk should add a third.

1. **The components map is the element allowlist.** `renderRemoteNode` looks the element name up in `components` and throws `No component found for remote element: <name>` when it is missing (`packages/react/source/host/node.tsx:16-22`). Unknown elements therefore cannot render as anything. But the throw happens during React render, so every Plugin surface needs an error boundary that stops the Plugin and shows Maibuk's own error state instead of breaking the page.
2. **`DOMRemoteReceiver` has a host-owned element policy** (per-element `properties` with `type` checks, `attributes`, `events`, `methods`, `blockedProperties`, URL scheme filtering; it "validates an entire inserted subtree before creating any host DOM nodes"; added in [PR #713](https://github.com/Shopify/remote-dom/pull/713), 2026-09). It does not apply to Maibuk: it is for mirroring real DOM elements, not React components, and [PR #726](https://github.com/Shopify/remote-dom/pull/726) (open) deprecates `DOMRemoteReceiver` in favor of `RemoteReceiver`. `RemoteReceiver` performs no prop validation; the docs say "The host still owns its component interface."
3. **Maibuk's layer: validate at the connection.** Wrap `receiver.connection` before handing it to the Worker. `mutate(records)` sees every record before the receiver stores it, so one function can enforce: element name in the UI kit; property, attribute, and event names declared for that element; property values matching that component's schema (strings length-capped, enums checked, no functions except declared events); a cap on records per batch, total nodes, and message rate (the runtime budget from decision 4 in #389). `call(id, method, ...args)` is denied unless the method is declared (for example `focus`). A rejected record stops the Plugin with a reason, rather than dropping it silently, because Remote DOM does not roll back earlier records in a batch. The same schema table generates the Plugin SDK's TypeScript types, so the allowlist has one source.

Plugins never see Maibuk's components: the SDK exports wrappers created with `createRemoteComponent('maibuk-button', ...)`, and the host maps `maibuk-button` to a component that renders Maibuk's `Button`. Labels a Plugin passes are plain strings; i18n of the Plugin's own strings is the "Plugin i18n" open question in #389.

---

## 4. Pitfalls

### 4.1 Focus and keyboard

Focus never leaves the host document: the Worker has no focusable anything, so React Aria's focus management, focus rings, Tab order, and F6 panes (`data-focus-pane`) work on host components as usual. What does not work is a Plugin moving focus by itself. Remote DOM's answer is remote methods: declare `methods: ['focus']` and the Plugin calls `element.focus()`, which runs on the host component asynchronously. Maibuk should expose only declared methods (`focus`, perhaps `scrollIntoView`) and keep `autoFocus` as a prop the host honors on mount. Arrow-key navigation inside lists and menus must come from the host component (React Aria collections), never from Plugin key handlers, because a remote handler cannot `preventDefault` (section 2.1).

### 4.2 Refs

A ref in the Plugin points at the remote custom element, not a host node. It cannot measure layout (`getBoundingClientRect` has nothing to measure in a polyfilled DOM), cannot scroll, and cannot be passed to a host-side positioning library. Forge and Stripe both document refs as unsupported. Maibuk's SDK should not forward refs except to call declared remote methods.

### 4.3 Portals, Modal, Popover

`createPortal` into the Worker's `document.body` creates nodes outside the observed remote root, so they never reach the host. Overlays must be host components that own their own positioning and focus containment: `maibuk-dialog` with `isOpen` and an `onOpenChange` event renders Maibuk's `Modal` (React Aria `useModalOverlay`, focus restored to the trigger by `useRestoreFocus`). Popover anchoring needs the trigger's host node, which only the host has, so menus and popovers should be composite components (`maibuk-menu-trigger` containing its button and its menu items as children), mirroring React Aria Components' `MenuTrigger` structure. Open state for dialogs can be controlled by the Plugin, but Escape and outside-press dismiss on the host first and then notify the Plugin through `onOpenChange`; the host must not wait for the Plugin's echo to close, for the same reason as section 2.2.

### 4.4 Large lists

Every remote row is a remote element; the measurement in section 2.3 shows the cost grows with rows changed per update (1,000 changed rows: 6 ms p50 desktop, 20 ms at 4x throttle). Two rules keep lists cheap. Stable keys, so React in the Worker sends property updates for changed rows only, not re-inserts. And virtualization on the host: a `maibuk-list` whose items are passed as a data property (an array of `{id, label, description}` validated by schema) and rendered by a React Aria `GridList`/`ListBox` with virtualization on the host, the shape Raycast's `List.Item` and Shopify's resource lists use. A Plugin that maps thousands of children still works but is the Plugin's cost, visible in its runtime budget.

### 4.5 Memory and lifecycle

Function props leak unless released (`@quilted/threads` README). Terminating the Worker when the Plugin goes idle (decision 4) releases everything on the Worker side; the host must also drop its `RemoteReceiver` and thread for that Plugin so proxies to dead functions are collected. A host component calling a proxied function after the Worker stopped must get a rejected promise, not a hang; this needs a test in the platform ticket.

### 4.6 Polyfill gaps

The DOM polyfill is minimal by design (`@remote-dom/polyfill`, 14 KB budget). Libraries a Plugin imports that touch `window`, `localStorage`, layout APIs, or `document.cookie` fail inside the Worker. Open issues show the edges: Suspense with the polyfill (#441), node reordering through adapters (#563). Most of the September 2026 commits are polyfill correctness work, so this is improving.

---

## Implications for Maibuk

1. Add `@remote-dom/core`, `@remote-dom/react`, and `@quilted/threads` as dependencies, with a `peerDependencyRules.allowedVersions` entry for `@remote-dom/react>react: 19` and a gate test that renders a remote tree on the installed React in jsdom or a Worker, so a React upgrade that breaks the bridge fails CI.
2. The Plugin SDK (`@maibuk/plugin-ui` or similar) owns the element names, `createRemoteComponent` wrappers, and generated types. Plugins import only the SDK.
3. One host-side table per UI-kit component: element name, props schema, events, methods, host component. It drives the connection validator (section 3), the `components` map, and the SDK types. The v1 UI kit itself is an open question in #389.
4. Text inputs, search fields, and any other value the author types into are host-owned (section 2.2). Write that into the UI kit contract so no component offers a keystroke-controlled `value`.
5. Overlays and lists are host composites (sections 4.3, 4.4).
6. Each Plugin surface sits in an error boundary that stops the Plugin and shows why, matching the runtime budget behavior from decision 4.
7. The prototype numbers are desktop and emulated throttling only. Before the platform ADR is accepted, run the same prototype on Android (WebView Worker, through `pnpm bench:frames --source android` style tooling) and in the Tauri Linux WebKitGTK webview.

---

## Sources

- Shopify/remote-dom at `dd02515`: [README](https://github.com/Shopify/remote-dom/blob/dd02515a4324fc279e4d7c0b1fce827bd3a2ffad/README.md), [packages/core/README.md](https://github.com/Shopify/remote-dom/blob/dd02515a4324fc279e4d7c0b1fce827bd3a2ffad/packages/core/README.md), [packages/react/README.md](https://github.com/Shopify/remote-dom/blob/dd02515a4324fc279e4d7c0b1fce827bd3a2ffad/packages/react/README.md), `packages/react/source/host/node.tsx`, `packages/core/source/types.ts`, `packages/core/source/constants.ts`, `packages/size-limit/.size-limit.js`, `packages/react/package.json`, `pnpm-workspace.yaml`
- Remote DOM issues and PRs: [#530](https://github.com/Shopify/remote-dom/issues/530), [#519](https://github.com/Shopify/remote-dom/issues/519), [#441](https://github.com/Shopify/remote-dom/issues/441), [#563](https://github.com/Shopify/remote-dom/issues/563), [#713](https://github.com/Shopify/remote-dom/pull/713), [#726](https://github.com/Shopify/remote-dom/pull/726)
- [@quilted/threads README](https://github.com/lemonmade/quilt/tree/main/packages/threads) (installed 4.1.0, "Memory management")
- [react-reconciler README](https://github.com/facebook/react/blob/main/packages/react-reconciler/README.md) and [ReactFiberConfig.custom.js](https://github.com/facebook/react/blob/main/packages/react-reconciler/src/forks/ReactFiberConfig.custom.js)
- Shopify: [Remote rendering: Shopify's take on extensible UI](https://shopify.engineering/remote-rendering-ui-extensibility) (2021-12-01), [Using Polaris web components](https://shopify.dev/docs/api/polaris/using-polaris-web-components), [URLField onChange/onInput](https://shopify.dev/docs/api/admin-extensions/2025-07/ui-components/forms/urlfield)
- [Gadget, Shopify API 2025-10: web components, Preact](https://gadget.dev/blog/shopify-api-2025-10-web-components-preact) (secondary; used only for the Preact move and 64 KB limit)
- Raycast: [How the Raycast API and extensions work](https://www.raycast.com/blog/how-raycast-api-extensions-work) (2023-05-31), [List API](https://developers.raycast.com/api-reference/user-interface/list)
- Figma: [How we built the Figma plugin system](https://www.figma.com/blog/how-we-built-the-figma-plugin-system/) (2019-08-22)
- Atlassian Forge: [UI Kit overview](https://developer.atlassian.com/platform/forge/ui-kit/overview/), [Frame](https://developer.atlassian.com/platform/forge/ui-kit/components/frame/)
- Stripe: [How UI extensions work](https://docs.stripe.com/stripe-apps/how-ui-extensions-work)
- [MCP-UI PR #185](https://github.com/MCP-UI-Org/mcp-ui/pull/185)
- npm registry (`npm view`, 2026-10-02): `@remote-dom/react`, `@remote-dom/core`, `@remote-ui/react`, `react-reconciler`, `@stripe/ui-extension-sdk`, `@forge/react`, `@raycast/api`

---

## Verification log

| Claim | How it was checked | Status |
| --- | --- | --- |
| Stars, last commit, open counts, commit authors | `gh api repos/...` and `gh api repos/.../commits` on 2026-10-02 | Verified |
| Package versions, peer dependencies, publish dates | `npm view` on 2026-10-02 | Verified |
| `@remote-dom/react` works with React 19.2.3 | Prototype: text, property updates, event listeners, 1,000-row lists rendered and updated in Chromium and WebKit with no runtime error | Verified for these features only; Suspense, transitions, `useActionState`, and React 19 form actions untested |
| Bundle sizes | esbuild production minify + gzip -9 of the prototype entry points and isolated package probes | Verified (exact numbers depend on what a Plugin imports) |
| Keystroke latency, burst correctness, startup | Prototype in Playwright 1.62.1 Chromium and WebKit, this machine (Linux, load average about 4 during runs) | Verified on desktop. 4x rows use CDP `Emulation.setCPUThrottlingRate` on the page; whether Chromium applies it to the dedicated Worker is not verified |
| Android and WebKitGTK (Tauri Linux) latency | Not measured | Unverified. Settle with the same prototype in an Android WebView and in the Tauri Linux webview |
| Controlled input loses text | Reproduced in 9 of 9 controlled burst runs (6 Chromium, 3 WebKit); 0 of 9 host-owned burst runs | Verified |
| Shopify runs UI extensions on Remote DOM | Shopify docs and engineering blog | Verified from first-party docs; internal scale not public |
| Raycast, Figma, Forge, Stripe architecture | First-party blog posts and docs, read 2026-10-02 | Verified as documented; none of their code was inspected |
| Host config member count (about 50 used, 160 read) | Counted in the size-probe host config; `grep -o '$$$config.<name>'` over `react-reconciler/cjs/react-reconciler.production.js` 0.33.0 | Approximate for "needed"; 160 is exact |

The prototype (`src/host.tsx`, `src/worker.tsx`, `src/elements.ts`, a size probe, and a Playwright runner) was throwaway and is not committed. To reproduce: one remote `ui-text-field` (`properties: {value, label}`, `events: ['input']`), one `ui-text`, N `ui-list-item` rows whose labels include the text length; worker uses `@remote-dom/core/polyfill`, `@remote-dom/react/polyfill`, `RemoteRootElement` + `BatchingRemoteConnection`, `createRoot` from `react-dom/client`; host uses `RemoteReceiver` + `RemoteRootRenderer` + `createRemoteComponentRenderer`, timing from `onChange` to a `useLayoutEffect` on the echoed `value`; `page.keyboard.type` with 100 ms and 0 ms delays.
