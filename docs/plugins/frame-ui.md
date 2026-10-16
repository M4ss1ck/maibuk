# Frame UI

A Frame is a Plugin's own sandboxed document: your HTML, CSS, and JS running in an iframe the host creates (ADR 0021, the second UI path). The first path is [host-rendered UI](host-rendered-ui.md). Choose a Frame only when host-rendered UI cannot do the job, because a Frame sits outside Maibuk's components and Maibuk does not verify its accessibility.

## When to choose it

Use host-rendered UI unless you need something the [component table](ui-reference.md) cannot express, such as a canvas, a chart, or a rich widget you already have as plain web code. A Frame gives you a full document. It does not give you Maibuk's focus and keyboard behavior, and the host never parses what travels through it.

## Declaring it

Set `customUi: true` in the manifest. A whole-page Frame declares `frame: "<relative path>.html"` on a page contribution:

```json
{ "id": "report", "title": "Report", "command": "openReport", "frame": "ui/report.html" }
```

An embedded Frame uses the kit's `Frame` component inside a host-rendered tree, which is the `maibuk-frame` element in [ui-reference.md](ui-reference.md#maibuk-frame):

```ts
<ui.Frame src="ui/report.html" title="Report" />
```

The page's `frame` and the component's `src` both name a relative path to an .html file inside your Plugin folder. The page `frame` field carries no length cap of its own; the manifest as a whole is capped at 64 KB (src/features/plugins/manifest-validate.ts, `MAX_MANIFEST_BYTES`). The kit `Frame` component is stricter: its `src` prop is capped at 1024 characters, and its `title` prop, the iframe's accessible name, is required and capped at 512 characters (src/plugin-sdk/ui-table.ts).

## Theme tokens

The host writes its semantic theme tokens onto the Frame's `<html>` as public `--maibuk-*` properties on load and again whenever the theme, accent, or font changes (src/features/plugins/frame/theme-tokens.ts). Use them instead of hard-coded colors so the Frame follows a light/dark flip. The names are a stable Plugin-facing contract:

```text
--maibuk-color-primary            --maibuk-color-card
--maibuk-color-primary-hover      --maibuk-color-card-foreground
--maibuk-color-primary-foreground --maibuk-color-destructive
--maibuk-color-secondary          --maibuk-color-destructive-hover
--maibuk-color-background         --maibuk-color-success
--maibuk-color-foreground         --maibuk-color-info-bg
--maibuk-color-muted              --maibuk-color-info-text
--maibuk-color-muted-foreground   --maibuk-color-warning-bg
--maibuk-color-border             --maibuk-color-warning-text
--maibuk-color-error-bg           --maibuk-color-success-bg
--maibuk-color-error-text         --maibuk-color-success-text
--maibuk-color-scheme             --maibuk-font-sans
--maibuk-font-serif               --maibuk-font-mono
--maibuk-font-size                --maibuk-spacing-editor-max
```

For example:

```css
body {
  background: var(--maibuk-color-background);
  color: var(--maibuk-color-foreground);
}
```

## The custom-UI notice

When the author reviews or manages a Plugin that uses a Frame, Maibuk shows this notice: `Custom UI: accessibility not verified by Maibuk. Keyboard and screen-reader support may vary.` A Plugin that declares a `frame` without `customUi: true` cannot use custom UI, and the message then reads `This Plugin cannot use custom UI.`

## Messaging with the host

A Frame's only channel is `window.maibuk.port`, the MessagePort that connects it to your Plugin's Worker. The host hands the Frame's port to the Plugin through `client.onFrame`, once per mounted Frame; the Plugin and the Frame then exchange raw messages over that port, and the host never parses them. Raw messages are the supported path: the Frame's port speaks to your Worker, not to the host broker, so the SDK client is not available inside a Frame.

On the Plugin side, keep each port and answer what the Frame sends:

```ts
client.onFrame((frame) => {
  frame.port.onmessage = (event) => {
    const data = event.data as { kind?: unknown } | null;
    if (data && data.kind === "ping") frame.port.postMessage({ kind: "pong" });
  };
  frame.port.start();
});
```

Inside the Frame, use the port the shim exposes with plain MessagePort calls:

```ts
const port = window.maibuk.port;
port.onmessage = (event) => {
  const data = event.data as { kind?: unknown } | null;
  if (data && data.kind === "pong") console.log("pong");
};
port.start();
port.postMessage({ kind: "ping" });
```

## Restrictions

- The Frame is an iframe with `sandbox="allow-scripts"` only. Its origin is opaque, and it is never given `allow-same-origin`.
- The Frame's document is fixed host code, never Plugin bytes. The host posts one load message with your verified files, and a shim makes them `blob:` URLs inside the Frame.
- The Frame's content security policy allows only its own verified files as `blob:` and `data:` resources plus inline style. `connect-src`, `frame-src`, and `worker-src` are `'none'`, so a Frame reaches no network, nests no frame, and starts no Worker; `form-action`, `base-uri`, and `object-src` are `'none'` too.
- Every file a Frame loads comes from your verified hashed folder. Keep the HTML, CSS, JS, images, and fonts inside it and reference them with relative paths. The manifest is never loadable.
- A relative import inside a module script is not supported and fails closed, because a `blob:` module cannot resolve relative specifiers in an opaque origin.
