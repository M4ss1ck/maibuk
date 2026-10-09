---
status: accepted
---

# Plugin-owned Shortcuts and Voice Commands survive disable and removal

ADR 0012 drops Custom Shortcuts for unknown Command ids every time the settings load. Applied to Plugin Commands, that rule would erase an author's bindings whenever a Plugin is disabled, removed to reinstall, or found incompatible after an update. So for ids under `plugin.<pluginId>.`, the rule changes: Custom Shortcuts and custom Voice Commands are kept on this device, inactive, until that Plugin returns. Removing a Plugin offers an explicit choice to erase them. Reset settings always erases them. A kept preference does not reserve its key. If another Plugin takes the key meanwhile, the existing active binding wins, and the returning binding stays inactive and visible in the Shortcut Editor for the author to resolve. Unknown ids outside the `plugin.` namespace are still dropped, as ADR 0012 says.

Decided in [Commands, Shortcuts, and Voice Commands contributed by Plugins](https://github.com/M4ss1ck/maibuk/issues/397#issuecomment-5974199143). The `plugin.` prefix and the same-Plugin rename maps are in [Plugin manifest schema and API versioning](https://github.com/M4ss1ck/maibuk/issues/400#issuecomment-5975037577).

## Considered Options

- Keep ADR 0012's rule and drop unknown ids: rejected. Disabling a Plugin for a day would silently cost the author every binding they made for it.
- Reserve a kept preference's key while its Plugin is away: rejected. A Plugin the author may never reinstall would block a key forever.

## Consequences

- The shortcut resolver represents a preference separately from whether it is active. Conflict checks run on enable, update, and settings changes, with the existing context-overlap and sequence-prefix rules.
- A core Default counts as an existing binding, including one added by an app update: a Plugin binding it collides with stays inactive and shows in the Shortcut Editor for the author to resolve.
- Renames for Plugin Commands migrate only within the same Plugin. A cross-owner rename cannot be expressed in a manifest.
- Kept preferences are still device-local settings: not synced, not in Backups, carried by a Shortcut File like any other.
