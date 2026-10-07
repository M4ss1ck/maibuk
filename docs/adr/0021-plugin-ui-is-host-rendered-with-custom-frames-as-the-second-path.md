---
status: accepted
---

# Plugin UI is host-rendered, with custom Frames as the second path

A Plugin's UI is built one of two ways. **Host-rendered UI** is the default. The Plugin writes React/JSX against SDK counterparts of Maibuk's shared components. Shopify Remote DOM carries the resulting tree over the Plugin's port, and Maibuk renders its own React Aria components. The host therefore owns focus, keyboard behavior, typing response, overlays, and large lists, and the kit is complete enough that settings, forms, reports, and interactive lists never need anything else. **Custom UI** is a `Frame`: a sandboxed surface where the Plugin brings its own HTML, CSS, and libraries, styled with Maibuk's semantic theme tokens. It carries the notice "custom UI, accessibility not verified by Maibuk". Plugin platform v1 is desktop-first. Android support is desirable, not a release blocker, and `Frame` is off on Android.

Decided in [Remote UI rendering for sandboxed React plugins](https://github.com/M4ss1ck/maibuk/issues/391) (measured at about 1 ms keystroke echo p95 on desktop), [Plugin host-rendered UI kit v1](https://github.com/M4ss1ck/maibuk/issues/416#issuecomment-5980085128), and [Verify the Plugin sandbox and remote UI on WebKitGTK and Android (T1-T3)](https://github.com/M4ss1ck/maibuk/issues/407#issuecomment-5975568807).

## Considered Options

- A JSON UI schema language: rejected. Authors would learn a format, and React already gives them composition.
- Custom UI only (every Plugin draws in an iframe): rejected. Maibuk could promise neither keyboard access nor theme fit for any Plugin.
- Host-rendered only: rejected. Terminals, charts, and specialized editors cannot be built from a fixed kit.
- A standalone Maibuk component package for Frames: rejected. Theme tokens are enough, and a second, self-rendering component library would drift from the first.

## Consequences

- Every public kit component has a documented subset of props and a row in the one component-definition table. Unsupported declarations fail at validation instead of being silently ignored. A coverage gate requires a keyboard test per interactive component through the real remote renderer.
- Text inputs are host-owned, and echoes are matched against the list of values still in flight, not the last value sent, so burst typing never rolls a field back.
- `Frame` on Android returns only after Tauri IPC reachability from sandboxed frames is fixed. That is a separate effort.
