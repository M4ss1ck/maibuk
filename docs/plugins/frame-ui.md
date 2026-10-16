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

The page's `frame` and the component's `src` are relative paths to an .html file inside your Plugin folder, at most 1024 characters. The `title` is the iframe's accessible name; it is required and at most 512 characters.

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

A Frame's only host channel is `window.maibuk.port`, the MessagePort that connects it to your Plugin's Worker. The host hands the Frame's port to the Plugin through `client.onFrame`, once per mounted Frame, so the Plugin relays messages between the Worker and the Frame. The host never parses that traffic. On the Plugin side:

```ts
client.onFrame((frame) => {
  frame.port.postMessage({ kind: "hello" });
});
```

Inside the Frame, use the same port with the SDK client, or post raw messages to it:

```ts
const client = createPluginClient(window.maibuk.port);
```

## Restrictions

- The Frame is an iframe with `sandbox="allow-scripts"` only. Its origin is opaque, and it is never given `allow-same-origin`.
- The Frame's document is fixed host code, never Plugin bytes. The host posts one load message with your verified files, and a shim makes them `blob:` URLs inside the Frame.
- The Frame's content security policy allows only its own verified files as `blob:` and `data:` resources plus inline style. `connect-src`, `frame-src`, and `worker-src` are `'none'`, so a Frame reaches no network, nests no frame, and starts no Worker; `form-action`, `base-uri`, and `object-src` are `'none'` too.
- Every file a Frame loads comes from your verified hashed folder. Keep the HTML, CSS, JS, images, and fonts inside it and reference them with relative paths. The manifest is never loadable.
- A relative import inside a module script is not supported and fails closed, because a `blob:` module cannot resolve relative specifiers in an opaque origin.
