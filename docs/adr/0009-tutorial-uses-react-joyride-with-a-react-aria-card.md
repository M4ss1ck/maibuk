---
status: accepted (not implemented)
---

# The Tutorial uses React Joyride with a React Aria card

The Tutorial uses React Joyride for the spotlight, scroll-into-view, and placement, and renders each step card as our own React Aria `Dialog`. Joyride's own focus trap, Escape handling, overlay click, and z-index are switched off, so React Aria owns all focus and keyboard behavior as AGENTS.md section 2 requires. Joyride is loaded only when the Tutorial starts. The Tutorial pauses while any Modal is open instead of layering over it, which avoids depending on React Aria's undocumented top-layer attribute.

## Considered Options

- driver.js with a wrapper and an accessibility exemption: rejected, its focus trap is hand-rolled and still runs on steps without a popover, it rewrites and then deletes the target's `aria-expanded`/`aria-controls`, reads arrows and Escape on global `keyup` with no typing-target check, and renders content through `innerHTML`.
- driver.js for the overlay only, with a React Aria card: rejected, it needs three workarounds that exist only to switch driver.js behavior off.
- No library (React Aria `Popover` plus an in-house spotlight): kept as the fallback if the real-engine spike fails; otherwise rejected because spotlight geometry and scroll tracking across three webviews would be ours to maintain.

## Consequences

- Focus restore after the Tutorial is our code: the card remounts per step, so neither Joyride nor React Aria returns focus to the trigger.
- Missing targets must be handled through Joyride's `target_not_found` event, or the run hangs under the overlay.
- `portalElement` must be passed as an element, never a selector string: Joyride deletes a selector-resolved element on unmount.
- Joyride ignores `prefers-reduced-motion`; the card and overlay honor it themselves.
