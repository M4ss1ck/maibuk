---
status: accepted
---

# Arrows leave a widget at its edge by position, layered over React Aria

Maibuk follows the WAI-ARIA keyboard model: Tab moves between widgets, F6 between Panes, and arrows inside a list, grid, or toolbar through React Aria. That model leaves an arrow key dead at a widget's edge, so getting from a Note in the list to its editor took a run of Tabs. An arrow pressed at a widget's edge now moves focus to the nearest widget in that direction on screen, landing on the item that widget would focus on Tab. This is the WinUI `XYFocusKeyboardNavigation` model applied to the desktop and web app; inside each widget, React Aria's behavior is unchanged.

Left and Right leave lists; Up and Down leave toolbars and button rows, so pressing Down to the end of a list never falls into whatever sits below it. A vertical widget inside a list row, like the Chapter outline under the active Chapter, keeps Up and Down between its own items: Up from its first item returns to the row, and Down from its last moves on to the next row. Position decides only inside a Pane: an arrow that crosses into another Pane lands where F6 would, on the control last used there or its first widget. An arrow pressed with nothing focused lands on the main Pane's first item (Down, Right) or last (Up, Left), on every screen. Controls that own their arrows never give them up: the editor text, text fields, sliders, selects, an open menu or popover, a focused resize handle, and the Canvas and Cover Designer surfaces. They are not arrow targets either, so arrows cannot trap the author in them; Tab and F6 reach them. Inside an open dialog, arrows stay within the dialog. The spoken "press right" and its siblings run the same rule, since they press the same keys.

## Considered options

- Plain WAI-ARIA, arrows stop at the edge: rejected because the dead key is the defect the author reported.
- Move to the next widget in Tab order whatever the arrow's direction: rejected because Right would sometimes move focus left or down on screen.
- Norigin Spatial Navigation: rejected because it replaces DOM focus with its own focus tree, which fights React Aria's roving focus. The W3C CSS Spatial Navigation draft has not advanced since 2019 and no browser ships it.

## Consequences

- One shared module is the only hand-written focus code outside React Aria, named as the exception in `CODING_STANDARDS.md` "Keyboard and accessibility". It decides the edge itself, before React Aria sees the key, because React Aria hides it: a GridList row wraps Left and Right between the row and its buttons, and a Toolbar cancels an arrow at its last button whether or not focus moved. It listens once at the window, does nothing for keys other than arrows or inside controls that own their arrows, and measures layout only when an arrow actually leaves a widget, so typing and in-widget navigation cost nothing extra.
- Lists drop `keyboardNavigationBehavior="tab"`, so each list is one Tab stop and its row actions are reached by arrows.
- Every screen's arrow paths are proven by keyboard tests and E2E specs, and the leaving step has a measured time budget.
