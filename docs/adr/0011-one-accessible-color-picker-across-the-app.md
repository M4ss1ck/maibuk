---
status: accepted (not implemented)
---

# One accessible color picker across the app

Issue #220 exposed a keyboard dead end in Settings' native color input. The same input also appears in the editor, Canvas, and Cover Designer. All color-selection surfaces will use one shared picker built from React Aria's color area, hue slider, preset swatches, and a hex field. The shared interaction keeps each surface's existing presets and contextual actions; Canvas's accessible text/background pairs remain a separate one-action choice beside its individual color pickers. This applies to preset-only controls as well as the eight native color inputs.

A color-area or slider adjustment previews on the affected content while it moves, then commits once when the adjustment ends. Preset selection commits immediately. A valid hex value commits on blur or Enter; incomplete or invalid text stays editable and never reaches a setting or document store. Escape discards uncommitted preview. This boundary matters because Canvas and Cover Designer record each stored change in undo history. Accent-filled controls choose a light or dark foreground that meets text contrast, including for the current default blue. The picker warns about low contrast in other rendered foreground/background pairs that are known, using [WCAG 2.2 AA text](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [non-text](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) thresholds. It allows any color and states when a variable background makes contrast impossible to check.

## Considered options

- Reuse the editor's palette unchanged: rejected because its custom-color path is another native input with the same keyboard dead end.
- Add only a hex field in Settings: rejected because the defect occurs in other color controls and a text field alone removes visual color exploration.
- Use one universal preset palette: rejected because the editor, Canvas, and Cover Designer already offer colors chosen for different jobs.
- Store every drag movement: rejected because one adjustment would fill Canvas and Cover Designer undo history with intermediate colors.
- Warn while keeping white text on the current accent: rejected because the untouched default blue and white text measure only 3.678:1. Darkening the default blue alone would still leave arbitrary light accents unreadable.

## Consequences

- The shared picker needs a preview/commit contract that feature adapters can use without persisting preview values or adding undo entries. Existing Reset, automatic, transparent, clear, and paired-color actions keep their meaning.
- Accent-filled controls need one foreground token derived from the selected accent; hard-coded white foregrounds on those controls must use it. Contrast warnings remain available for other known pairs and never block a color choice.
- Keyboard, screen reader, mouse, and touch behavior must be checked in every affected feature. The expected-failure `settings-primary-color` E2E workflow becomes an accepted keyboard-and-persistence check when the implementation ships.
