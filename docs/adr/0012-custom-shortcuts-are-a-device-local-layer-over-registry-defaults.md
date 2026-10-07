---
status: accepted
---

# Custom Shortcuts are a device-local layer over registry defaults

Authors can change the Shortcut of every Command. The registry in `src/lib/shortcut-registry.ts` stays the only place Default Shortcuts are written, and every binding names a Command by id and never by keys. The author's changes are stored as a separate layer: for each changed Command, the full list of its editable Shortcuts. Effective Shortcuts are the Command's Fixed Shortcuts plus that list, or its Default Shortcuts when the Command has no entry. Resetting a Command deletes its entry. The layer lives in a device-local settings store of its own (`useShortcutSettingsStore`, localStorage key `maibuk-shortcuts`), is versioned, and is normalized on every load: unknown Commands (except Plugin-owned ones, ADR 0024) and invalid keys are dropped, and renamed Command ids are carried over. It is not synced and not part of Backups. A Shortcut File carries it to another device by hand.

Shortcuts depend on the keyboard in front of the author: a Mac laptop, a Windows desktop with a different layout, a foot pedal, or a phone with no keyboard. A binding that is right on one device is wrong or unreachable on another, which is the same reason position state stays on the device (ADR 0004).

## Considered Options

- Store a full copy of every Command's Shortcuts once the author changes one: rejected. New Default Shortcuts and renamed Commands in later versions would never reach an author who had changed a single key, and "reset" would have nothing to compare against. VS Code, Obsidian, and TanStack Hotkeys all keep only the changes (`docs/research/configurable-shortcuts.md` section 1).
- Sync Custom Shortcuts through Entity Sync: rejected. No setting syncs today, a Settings adapter would be a separate decision, and a synced pedal or Mac-only key is noise on other devices.
- Include Custom Shortcuts in Backups: rejected. Backups are Library data in SQL tables; settings are not in them.
- Keep keys at each binding and apply changes on top: rejected. A binding and the registry could disagree, and the help, hints, and conflict check could not know the keys that actually fire.

## Consequences

- The store is separate from `useSettingsStore` so every hint and key match depends on a small module, not on the whole settings module and its i18n setup.
- Renaming a Command id needs an entry in the rename table, or authors lose that Command's Custom Shortcuts.
- A change to the stored shape needs a new version and a migration step, tested with the old shape as input.
- An author who wants the same Shortcuts on two devices saves a Shortcut File on one and loads it on the other.
