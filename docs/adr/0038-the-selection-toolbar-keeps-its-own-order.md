---
status: accepted
---

# The Selection Toolbar keeps its own order

The Selection Toolbar used to have no order of its own: it showed the Toolbar Buttons flagged for it, in the order they sit in the Editor Toolbar. The Customize toolbar dialog now gives the Selection Toolbar its own visual drag-and-drop editor, so the Selection Toolbar keeps its own list of Toolbar Buttons in its own order, beside the Editor Toolbar's Start and End. Membership stays independent: a Toolbar Button can sit in both toolbars, or in the Selection Toolbar alone while hidden from the Editor Toolbar. The Selection Toolbar takes no Toolbar Dividers and has no Start or End.

## Considered options

- Keep deriving the order from the Editor Toolbar and let the Selection editor only add and remove: rejected. A drag inside the Selection editor would have to reorder the Editor Toolbar, a change the author cannot see from where they made it.

## Consequences

- The first load of an older toolbar configuration builds the Selection Toolbar's list from the old flags, in the old derived order, so nothing moves on upgrade.
- The list layout's "Show in selection menu" switch removes a Toolbar Button from the Selection Toolbar, or inserts it after the Selection Toolbar's last button that comes before it in the Editor Toolbar (or first, when none does), so List places it as it always did while the rest of the author's order survives. Moving a button in List never reorders the Selection Toolbar; that happens only in its visual editor.
