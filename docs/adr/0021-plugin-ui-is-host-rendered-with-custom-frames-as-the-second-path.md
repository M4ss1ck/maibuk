---
status: accepted
---

# Plugin UI is host-rendered, with custom Frames as the second path

A Plugin's UI is built one of two ways. **Host-rendered UI** is the default. The Plugin writes React/JSX against SDK counterparts of Maibuk's shared components. Shopify Remote DOM carries the resulting tree over the Plugin's port, and Maibuk renders its own React Aria components. The host therefore owns focus, keyboard behavior, typing response, overlays, and large lists, and the kit is complete enough that settings, forms, reports, and interactive lists never need anything else. **Custom UI** is a `Frame`: a sandboxed surface where the Plugin brings its own HTML, CSS, and libraries, styled with Maibuk's semantic theme tokens. It carries the notice "custom UI, accessibility not verified by Maibuk". Plugin platform v1 is desktop-first. Android support is desirable, not a release blocker. `Frame` was off on Android until the 2026-11-21 amendment below.

Decided in [Remote UI rendering for sandboxed React plugins](https://github.com/M4ss1ck/maibuk/issues/391) (measured at about 1 ms keystroke echo p95 on desktop), [Plugin host-rendered UI kit v1](https://github.com/M4ss1ck/maibuk/issues/416#issuecomment-5980085128), and [Verify the Plugin sandbox and remote UI on WebKitGTK and Android (T1-T3)](https://github.com/M4ss1ck/maibuk/issues/407#issuecomment-5975568807).

## Considered Options

- A JSON UI schema language: rejected. Authors would learn a format, and React already gives them composition.
- Custom UI only (every Plugin draws in an iframe): rejected. Maibuk could promise neither keyboard access nor theme fit for any Plugin.
- Host-rendered only: rejected. Terminals, charts, and specialized editors cannot be built from a fixed kit.
- A standalone Maibuk component package for Frames: rejected. Theme tokens are enough, and a second, self-rendering component library would drift from the first.

## Consequences

- Every public kit component has a documented subset of props and a row in the one component-definition table. Unsupported declarations fail at validation instead of being silently ignored. A coverage gate requires a keyboard test per interactive component through the real remote renderer.
- Text inputs are host-owned, and echoes are matched against the list of values still in flight, not the last value sent, so burst typing never rolls a field back.
- Plugin CSS is scoped by parsing the stylesheet with PostCSS and prefixing every selector under the surface's own `data-plugin-ui` attribute, including inside conditional at-rules. A real parser tokenizes `url()`, strings, comments, and escapes the way CSS Syntax Level 3 does, so a declaration value cannot break a rule's block. Anything the parser cannot safely scope fails closed: a parse error drops the whole stylesheet, and `@import`, `@keyframes`, `@font-face`, `@page`, `@scope`, an unknown at-rule, CSS nesting, a `&` nesting selector, or a selector led by a combinator (`>`, `+`, `~`) drops the offending rule. `:root`, `html`, and `body` are kept but inert under the prefix; `:has()` is scoped as a descendant query.
- The isolation guarantee is about which elements a selector can match, not about painting or resources. A scoped rule may still use `position:fixed`, a large `z-index`, or an external `url()` to draw over the app or load a remote resource — visual and resource concerns, not style leakage, and a Plugin already runs code. What it cannot do is style Maibuk chrome or another Plugin's surface.
- Portaled overlays (Modal, confirmation dialog, Popover, Tooltip) render into a top-layer container outside the `data-plugin-ui` surface, so a Plugin's CSS does not reach them. They are kit-themed only; re-applying the surface scope inside each portal is deferred.
- Overlay dismissal is host-immediate: the host closes a Modal, confirmation dialog, or Popover at once, even with a stopped Worker, and tells the Plugin through `onOpenChange`. A stopped Worker never answers, so the overlay stays closed; once the Worker answers, the Plugin's `isOpen` is authoritative again. The SDK carries that answer in an internal `openSeq` count, which it bumps on every delivered `onOpenChange`, so a batched false then true that nets to no change still reopens the overlay.
- `Frame` on Android: superseded by the 2026-11-21 amendment below.

## Amendment: Frame runs on Android (2026-11-21)

`Frame` is on for Android. A Plugin that lists `"android"` in `platforms` and sets `customUi: true` mounts its Frame there exactly as on Linux. The gate no longer waits for a Tauri fix to IPC reachability from sandboxed frames on Android (#407 T2).

Why: the restriction kept every Frame Plugin off Android, Built-ins included, to guard against a Plugin abusing a path no Plugin has been seen to use. The risk is real only for a Plugin written to exploit it, and Built-ins are not. Users decide which Plugins they install and enable, and Maibuk does not limit a basic capability over a misuse that may never happen. The custom-UI notice still marks every Frame.

Consequences:

- `pluginFrameAvailableOn("android")` is true. Windows keeps its own gate: a recorded WebView2 Frame conformance run with every Frame check passing.
- The T2 frame probe runs on Android in `pnpm conformance:plugins`. It still fails there (tauri 2.12.4, wry 0.57.1, 2026-11-21), so the Android lane exits 1 on that one check until a Tauri fix ships. That failure is known and accepted: it reports, it does not gate the Frame. Details stay under the private disclosure from #407. The probe counts a side effect the host observes (an event the frame emits) as well as a reply, so a missing reply is not mistaken for a refusal.
- The Worker probe is unchanged: Plugin code in the Worker reaches no Tauri IPC on any platform.
- Maps and Reader list `"android"` and run there. Both needed Plugin-side work for QuickJS (no `Intl`, no `Worker` for the pdf.js core; Android runs the native Worker since ADR 0019's 2026-11-23 amendment, so #930 removed those fallbacks), and the host gained File Grants on Android (ADR 0036, 2026-11-21 amendment) so Reader can open a document and Maps an image. Frames run in the system WebView, whose oldest supported version is Chrome 138 (the last one Android 8 and 9 receive); Reader ships core-js polyfills for the APIs its pdf.js build calls that 138 lacks (`plugins/maibuk-reader/vendor/README.md`).
