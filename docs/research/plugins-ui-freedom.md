# Plugin UI freedom: primary-source comparison

Checked 2026-10-04. Research evidence for [Plugin host-rendered UI kit v1](https://github.com/M4ss1ck/maibuk/issues/416), part of [Plugin platform v1](https://github.com/M4ss1ck/maibuk/issues/389). Decisions live in the ticket, not this comparison.

## What existing platforms do

| Platform | Host-provided UI | Custom UI and theming |
| --- | --- | --- |
| Atlassian Forge | UI Kit uses JSX and Forge components. Developer-written function components may compose those components. Arbitrary HTML, DOM access, portals, and DOM ref forwarding are unavailable. | Custom UI loads HTML/CSS/JS in an iframe and permits any frontend framework within security constraints. Frame embeds that option inside UI Kit. UI Kit gets design tokens automatically; Custom UI can opt into theme tokens. |
| VS Code | Native extension APIs offer specific workbench contributions rather than a universal component renderer. | Webviews provide developer-controlled HTML and message passing. CSS variables expose theme colors and editor fonts; theme classes expose light, dark, and high-contrast modes. The extension owns its styling and accessibility. |
| Figma | This research examined Plugin UI, not the separate Widget API. | Plugin UI is an HTML iframe communicating with plugin code through messages. An optional themeColors setting exposes CSS variables for light/dark integration. |
| Shopify Remote DOM | A transport/rendering library, not a complete plugin platform. Hosts can map remote custom elements to real components. Framework adapters and examples cover React, Preact, Vue, Svelte, and vanilla JS. | Supports hidden iframe or Worker remotes, with a minimal DOM polyfill for Workers. A framework can produce the remote tree without gaining an unrestricted real browser DOM or installing new host implementations. |

Sources: [Forge UI Kit](https://developer.atlassian.com/platform/forge/ui-kit/), [Forge custom options and Frame](https://developer.atlassian.com/platform/forge/extend-ui-with-custom-options/), [Forge theming](https://developer.atlassian.com/platform/forge/design-tokens-and-theming/), [VS Code webviews](https://code.visualstudio.com/api/extension-guides/webview), [Figma Plugin UI](https://developers.figma.com/docs/plugins/creating-ui/), [Figma theming](https://developers.figma.com/docs/plugins/css-variables/), [Shopify Remote DOM](https://github.com/Shopify/remote-dom).

## Distinctions relevant to the decision

- **Bundling a library is not extending a host renderer.** A Plugin may bundle its own component functions that ultimately produce supported host elements. That does not let it introduce a new primitive requiring host implementation. Forge explicitly allows the former and restricts the latter. Remote DOM likewise distinguishes remote declarations from their real host implementation.
- **React syntax is not React DOM compatibility.** A remote JSX adapter can make supported declarations familiar. It does not automatically support arbitrary RAC or other browser component libraries. RAC's Button implementation passes an element ref into useButton and attaches it to a real button. Claiming all RAC works in a Worker would require compatibility evidence beyond a JSX adapter. [RAC Button source](https://github.com/adobe/react-spectrum/blob/main/packages/react-aria-components/src/Button.tsx).
- **A custom browser surface can still blend in.** Forge, Figma, and VS Code provide theme information to custom surfaces. A component kit is not the only way to inherit the host's appearance.
- **A Frame need not be limited to custom drawing.** Forge uses it for arbitrary custom HTML/CSS/JS interfaces. Restricting Maibuk's Frame to drawing would be a Maibuk choice, not an inherent transport requirement.

## Longevity implications (inferences, not vendor guarantees)

If the host component contract freezes, Plugin authors can keep composing its primitives and upgrading compatible non-DOM libraries. They cannot obtain new host component behavior merely by declaring an unknown element. A sufficiently broad browser surface instead lets authors bundle their own future component libraries and renderers, including Markdown libraries, while using host theme tokens. A standalone component package could render within the frame without the host renderer, but would add a separate package to publish and maintain; it is not necessary to consume CSS variables.

That independence still ends at the installed browser/WebView capabilities, sandbox permissions, and stable application API. No approach guarantees arbitrary future libraries run on an indefinitely frozen engine. Preserving a small bridge and theme-token contract is a smaller compatibility surface than preserving every prop of the host's evolving internal React components. This is an architectural inference; the ticket records the accepted contract.

The comparison informs the ticket's decision about a first-class custom surface alongside declarative host UI. It does not establish that unrestricted DOM libraries will work inside the declarative Worker route.

## Verification

1. Discovered relevant current documentation using web search restricted by query to the owning organizations; only primary sources cited.
2. Fetched the seven initial primary pages through agent-reach's Jina Reader route and inspected their titles and content. Raw readings: `/tmp/plugin-ui-research/`. Independently re-read Forge UI Kit/custom UI/theming, VS Code webviews, and Figma Plugin UI/theming through the browser tool; the separate Figma theming page confirms live CSS-variable updates.
3. Rechecked the exact restrictions, theme activation, host/remote distinction, and RAC ref behavior against the fetched text. No runnable examples or runtime compatibility claims are shipped here.

Not verified: a Maibuk integration, Android Frame capability, failure containment, or universal library compatibility. Those require a targeted implementation/prototype on Maibuk's actual supported runtimes.
