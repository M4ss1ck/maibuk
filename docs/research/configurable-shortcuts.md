# User-configurable keyboard shortcuts in Maibuk (React 19 + TipTap 3 + Tauri 2)

Research date: 2026-09-26. Primary sources only: official docs, specs, and source code pinned to a commit or tag. Every code citation gives the repository, ref, file, and line. Maibuk paths are relative to the repo root at `502bdb7`.

Pinned refs used below:

| Source | Ref |
| --- | --- |
| TipTap | tag `v3.15.1` (the version in `package.json` and `node_modules/@tiptap/core`) |
| prosemirror-keymap | tag `1.2.3` (installed) |
| prosemirror-view | tag `1.41.4` (installed) |
| VS Code | commit `9cf0128b9822dcd8a533f08ef7312956a4390301` (main, 2026-09-27) |
| Obsidian API | commit `cc1744324150c632416857c98964f87b1574a5fc` |
| TanStack Hotkeys | commit `e06d82da83733a874e28c4144ad13e129e462491` |
| tinykeys | commit `64c0731efc25e83802cb94a047e1b8afb91fb1df` (v4.0.1) |
| react-hotkeys-hook | commit `7aba1f61f47328773ccf74f61b251312fdd83333` |
| hotkeys-js | commit `8a0e151e6c46e901931be806f6e123c1e61589bb` (v4.0.8) |
| @github/hotkey | commit `c799d9f9530b3680982dab2540316154e6dd4951` |
| Chromium | commit `ea99e592ef621cfb6bc45216dc2d564e988d258f` (last change to `browser_command_controller.cc`) |
| Firefox | commit `04f509798db049429d2f45a02e0a1439d536530a` (last change to `browser-sets.inc.xhtml`) |
| wry (Tauri webview layer) | `0.53.5` (from `src-tauri/Cargo.lock`, Tauri `2.9.5`) |

---

## Summary and recommendations

Keep Maibuk's own `useShortcuts` and add an override layer. No library is a clear win: the one with the right feature set (TanStack Hotkeys) is alpha and eight months old, and every library would still need wrapping for Maibuk's modal gating, Tutorial gating, Bound Shortcut declaration, and capture-phase handling. The missing pieces (merge, conflict detection, recorder) are small, deterministic, and testable.

1. **Make the registry the only place keys are written.** Today some bindings read their keys from the registry through `matchKeys(id)` (`src/lib/shortcut-registry.ts:260`, used in `Home.tsx:141`, `BookEditor.tsx:881`, `GlobalShortcuts.tsx:131`), but others repeat the keys as literals next to the id: `src/pages/Canvas.tsx:432-459` (`{ id: "canvas.toolSelect", keys: "v" }`), `src/components/GlobalShortcuts.tsx:176-177` (`global.showHelp` with `["shift+/", "shift+?", "?"]`), and `src/pages/Home.tsx:150,163` (`j`/`k`). An override can only change what the binding site reads, so every binding with an `id` must resolve its keys from one function (for example `effectiveKeys(id)`) that merges defaults with overrides. This is the precondition for everything else.
2. **Store a diff, not a copy.** Persist only the ids the author changed, as `Partial<Record<ShortcutId, Binding[]>>` where an empty array means "unassigned". Reset one = delete the key; reset all = clear the map. This is the VS Code model (user rules appended after defaults, plus `-command` removal rules; section 1.1) and it keeps default changes in new releases flowing to untouched shortcuts. Persist it in `useSettingsStore` (`src/features/settings/store.ts`), and add a normalizer to its `merge` (around line 633, next to `normalizePasteCleanup`) that drops ids no longer in `SHORTCUTS` and malformed bindings. `toolbarConfig` plus `resetToolbarConfig` is the existing precedent.
3. **Detect conflicts with a pure function over the effective map.** Group by normalized combo and by scope (the id prefix `global.`/`home.`/`editor.`/`canvas.`/`cover.`; `global.` conflicts with every screen). Include `source: "editor-keymap"` entries, because Maibuk's capture-phase listener runs before ProseMirror and its `preventDefault()` makes ProseMirror skip the event (section 3.4), so an app shortcut silently shadows a formatting key. Show conflicts inline, like VS Code's "N existing commands have this keybinding" (section 1.1).
4. **Rebind TipTap keys at runtime through one dynamic keymap plugin, not by recreating the editor.** TipTap builds each extension's keymap once (`ExtensionManager.plugins`), `Editor.setOptions` never rebuilds the extension manager, and `useEditor` only recreates the editor when its deps change (section 3). Add one extension with `priority` above 100 whose `addProseMirrorPlugins` returns a plugin with a `handleKeyDown` that delegates to `keydownHandler(effectiveEditorBindings)` from `@tiptap/pm/keymap`, rebuilt when the override store changes. It handles remapped combos and swallows the default combos the author moved away. Update `editorKeymapShortcutIds` (`src/components/editor/keymap-shortcuts.ts:52`) to report the effective map, or the help will list defaults that no longer apply.
5. **Fix key matching before exposing it to authors.** `eventToCombo` (`src/lib/shortcuts.ts:35`) matches only on `event.key`. That misses Ctrl+S on non-Latin layouts (Cyrillic `ы`), which ProseMirror handles with a `keyCode` fallback (`prosemirror-keymap` `keymap.ts:91-101`) and TanStack Hotkeys with a `code` fallback. It likely misses Cmd+Option+letter on macOS, where the Option layer changes `event.key` (the reason `@github/hotkey` ships `macos-symbol-layer.ts`). And it checks `isComposing` (`shortcuts.ts:86`) but not `keyCode === 229`, which MDN recommends because `isComposing` can be false on the first and last composition keydown (section 4.5).
6. **Keep `Mod` explicit in stored bindings.** The registry writes `Ctrl` and `matchKeys` expands every `ctrl+` into both `ctrl+` and `meta+` (`shortcut-registry.ts:260-272`), so on Windows and Linux the Super key also matches, and on macOS the literal Control key does. Store `Mod` for "Cmd on Mac, Ctrl elsewhere" as ProseMirror does (`keymap.ts:18`), and allow a literal `Ctrl` only when the author records it.
7. **Build the recorder as a labelled text field with Escape to cancel and Tab to leave.** Announce the captured combo and any conflict through a `role="status"` live region (the pattern already in `src/components/RouteAnnouncer.tsx:42` and `ToolbarSettingsDialog.tsx:105`). Suspend `useShortcuts` while recording: its window capture listener runs before any element handler. Details in section 5.
8. **Ship a "single-key shortcuts" switch before, or with, remapping.** WCAG 2.1.4 (Level A) covers Maibuk's `?`, all `g` sequences, `j`/`k`, `1-9`, and the Canvas letters `V P E T N L`, which are window-level and not "active only on focus" (section 5.1). A switch that turns them off meets the criterion on its own; remapping to include a modifier also meets it.
9. **Refuse or warn on keys the platform keeps.** On the web build, Chromium and Firefox reserve Ctrl+N, Ctrl+T, Ctrl+W, Ctrl+Shift+N/T/W and tab switching in a normal tab (section 4.3), so `home.newBook` (`Ctrl+N`, `shortcut-registry.ts:64`) cannot fire in a browser tab. Under Tauri those keys reach the page. Warn on Ctrl+Alt+key on Windows (AltGr). Put the list in one constant keyed by `IS_WEB`/`IS_TAURI`.
10. **Name it and gate it.** Add a `CONTEXT.md` term for an author-changed shortcut (the glossary already bans "hotkey" and "keybinding" for Bound Shortcut, `CONTEXT.md:378-381`), an `e2e/coverage-matrix.ts` row, and unit tests for merge, normalization, conflict detection, and the recorder's key handling. Decide whether overrides are device-local (keyboards are per device, like ADR 0004's position state) or travel with the Library; that is a decision for Andy, not something this research settles.

---

## 1. How VS Code, Obsidian, Linear, and Figma model defaults vs user changes

### 1.1 VS Code: override layer with removal rules

**Model.** User rules live in `keybindings.json` and are appended after the defaults: "The additional `keybindings.json` rules are appended at runtime to the bottom of the default rules, thus allowing them to overwrite the default rules" ([VS Code docs, Keyboard shortcuts](https://code.visualstudio.com/docs/configure/keybindings)). Evaluation order: "Rules are evaluated from **bottom** to **top**. The first rule that matches both the `key` and `when` clause, is accepted" (same page). In source, `_findCommand` walks matches from the end ([keybindingResolver.ts#L380-L381](https://github.com/microsoft/vscode/blob/9cf0128b9822dcd8a533f08ef7312956a4390301/src/vs/platform/keybinding/common/keybindingResolver.ts#L380-L381)).

**Removal.** "To remove a keyboard shortcut by using the `keybindings.json` file, add a `-` to the `command` and the rule will be a removal rule" ([docs](https://code.visualstudio.com/docs/configure/keybindings)). `KeybindingResolver.handleRemovals` collects every rule whose command starts with `-`, then drops only **default** rules that the removal targets; user rules are never removed this way (`if (!commandRemovals || !rule.isDefault)`) ([keybindingResolver.ts#L124-L175](https://github.com/microsoft/vscode/blob/9cf0128b9822dcd8a533f08ef7312956a4390301/src/vs/platform/keybinding/common/keybindingResolver.ts#L124-L175)). `_isTargetedForRemoval` compares chords and uses implication, not equality, on the `when` clause "so that a removal still matches when the default keybinding's when clause becomes more specific across updates" ([#L91-L120](https://github.com/microsoft/vscode/blob/9cf0128b9822dcd8a533f08ef7312956a4390301/src/vs/platform/keybinding/common/keybindingResolver.ts#L91-L120)). Lesson for Maibuk: a diff must survive default changes in later releases. Keying overrides by stable registry id avoids VS Code's `when`-clause drift problem entirely.

**What the UI writes.** When the author changes a default in the Keyboard Shortcuts editor, `doEditKeybinding` adds a user rule and, for a default item, calls `removeDefaultKeybinding`, which appends `{ key, command: "-<command>", when }` ([keybindingEditing.ts#L72-L90, L152-L163, L203-L213](https://github.com/microsoft/vscode/blob/9cf0128b9822dcd8a533f08ef7312956a4390301/src/vs/workbench/services/keybinding/common/keybindingEditing.ts#L72-L213)). **Reset** (`doResetKeybinding`) deletes the user rule and every `-command` rule for that command ([#L108-L119](https://github.com/microsoft/vscode/blob/9cf0128b9822dcd8a533f08ef7312956a4390301/src/vs/workbench/services/keybinding/common/keybindingEditing.ts#L108-L119)). So the file is a diff, never a full copy. I found no "reset all" command in these files; resetting everything means emptying `keybindings.json` (unverified, see log).

**Conflicts.** Docs: "Right-click on an item in the list of keyboard shortcuts, and select **Show Same Keybindings** to view all entries with the same keyboard shortcut" ([docs, "Detecting keyboard shortcut conflicts"](https://code.visualstudio.com/docs/configure/keybindings)). While recording, the editor counts rules with the same key ([keybindingsEditor.ts#L354](https://github.com/microsoft/vscode/blob/9cf0128b9822dcd8a533f08ef7312956a4390301/src/vs/workbench/contrib/preferences/browser/keybindingsEditor.ts#L354)) and the widget prints and announces "{0} existing commands have this keybinding" with `aria.alert` ([keybindingWidgets.ts#L227-L233](https://github.com/microsoft/vscode/blob/9cf0128b9822dcd8a533f08ef7312956a4390301/src/vs/workbench/contrib/preferences/browser/keybindingWidgets.ts#L227-L233)). A "Source" column shows where each rule came from ([keybindingsEditor.ts#L509](https://github.com/microsoft/vscode/blob/9cf0128b9822dcd8a533f08ef7312956a4390301/src/vs/workbench/contrib/preferences/browser/keybindingsEditor.ts#L509)). Conflicts are shown, not blocked.

**Chords.** "Chords (two separate keypress actions) are described by separating the two keypresses with a space. For example, Ctrl+K Ctrl+C" ([docs](https://code.visualstudio.com/docs/configure/keybindings)). The recorder accepts at most two chords: `if (this._chords.length === 2) { // TODO: limit chords # to 2 for now` ([keybindingWidgets.ts#L121](https://github.com/microsoft/vscode/blob/9cf0128b9822dcd8a533f08ef7312956a4390301/src/vs/workbench/contrib/preferences/browser/keybindingWidgets.ts#L121)). There is no timeout while recording; each press appends a chord until Enter.

### 1.2 Obsidian: per-command defaults, user hotkeys take priority

The plugin API declares defaults on the command: `hotkeys?: Hotkey[]`, documented as "Sets the default hotkey. It is recommended for plugins to avoid setting default hotkeys if possible, to avoid conflicting hotkeys with one that's set by the user, even though customized hotkeys have higher priority" ([obsidian.d.ts#L1823-L1827](https://github.com/obsidianmd/obsidian-api/blob/cc1744324150c632416857c98964f87b1574a5fc/obsidian.d.ts#L1823-L1827)). A `Hotkey` is `{ modifiers: Modifier[]; key: string }` ([#L3435](https://github.com/obsidianmd/obsidian-api/blob/cc1744324150c632416857c98964f87b1574a5fc/obsidian.d.ts#L3435)) and `Modifier` is `'Mod' | 'Ctrl' | 'Meta' | 'Shift' | 'Alt'` ([#L4558](https://github.com/obsidianmd/obsidian-api/blob/cc1744324150c632416857c98964f87b1574a5fc/obsidian.d.ts#L4558)): `Mod` and literal `Ctrl`/`Meta` coexist, which is recommendation 6. The API has no sequence type.

User side, per the help page: add with the plus icon, "Press the keyboard combination you want to use", "Select Save"; "assign multiple hotkey combinations to a single command by selecting the plus (+) icon again"; remove with the X icon ([Obsidian Help, Hotkeys](https://obsidian.md/help/hotkeys)). The page does not document reset, conflict display, or where overrides are stored (see verification log).

### 1.3 Linear: fixed shortcuts, heavy use of sequences

Linear documents two-key sequences throughout: "The fastest way to get there is with the keyboard shortcut `G` then `I`, which takes you to the Inbox from any page" ([Linear Docs, Inbox](https://linear.app/docs/inbox)); "Navigate to Triage with `G` then `T`. If you are in another team's views, use `O` then `T`" ([Triage](https://linear.app/docs/triage)); "`O` then `F` to open favorites" ([Favorites](https://linear.app/docs/favorites)). The shortcut list opens with `?` ([changelog 2021-03-25](https://linear.app/changelog/2021-03-25-keyboard-shortcuts-help)). Linear adjusted some shortcuts itself for non-US layouts ([changelog 2019-06-20](https://linear.app/changelog/2019-06-20-international-keyboard-shortcut-improvements)).

**Rebinding:** I found no Linear doc describing a way to rebind shortcuts. A search engine summary claimed "Shortcuts cannot be remapped in Linear at this time", but I could not find that sentence on any linear.app page. Treat "Linear does not let users rebind" as likely but unverified.

### 1.4 Figma: no rebinding, a layout picker instead

Figma's help center describes a keyboard layout choice, not per-shortcut rebinding: "Figma's default keyboard shortcuts are based on the layout of a US QWERTY keyboard. Some of the keys in these shortcuts aren't available in other languages or layouts", and you "update your keyboard layout in your preferences to access shortcuts mapped to that layout"; "When possible, Figma will notify you of a mismatch between your system keyboard and your keyboard layout in Figma"; "We have focused our initial efforts on a selection of popular shortcuts" ([Select keyboard layout](https://help.figma.com/hc/en-us/articles/5665442977431-Select-keyboard-layout)). The shortcuts panel highlights "Shortcuts you've already used" ([Use Figma products with a keyboard](https://help.figma.com/hc/en-us/articles/360040328653-Keyboard-shortcuts-in-Figma)). Neither page mentions remapping. Plainly: Figma does not document user rebinding; it ships per-layout default maps.

### 1.5 Comparison

| | VS Code | Obsidian | Linear | Figma |
| --- | --- | --- | --- | --- |
| User rebinding | Yes | Yes | Not documented (likely no) | No, layout picker only |
| Storage model | Diff: appended rules plus `-command` removals | Not documented | n/a | n/a |
| Per-item reset | Yes | Not documented | n/a | n/a |
| Conflict display | Count while recording, "Show Same Keybindings" | Not documented | n/a | n/a |
| Sequences | Chords, max 2 in recorder | No (API has no sequence type) | Yes, `G` then `I` | n/a |
| Layout handling | Dispatch on `code` (mac/Linux) or `keyCode` (Windows) | Not documented | Adjusted defaults | Per-layout default maps |

---

## 2. Libraries

Stats gathered 2026-09-26 with `gh api repos/OWNER/REPO`, `gh api repos/OWNER/REPO/commits?per_page=1`, `gh api search/issues?q=repo:OWNER/REPO+is:issue+is:open|closed`, and `npm view`. Issue counts exclude pull requests (checked by paginating `/issues` for `github/hotkey` and `TanStack/hotkeys`, whose counts are coincidentally identical).

| Rank for Maibuk | Library | Version | Stars | Last commit | Issues open / closed | Recent issue response | Sequences | Matching | React 19 | Recorder / rebinding |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | Maibuk `useShortcuts` + override layer | n/a | n/a | n/a | n/a | n/a | Yes, 2 keys, 600 ms | `event.key` only | yes | to build |
| 1 | [TanStack Hotkeys](https://github.com/TanStack/hotkeys) (`@tanstack/react-hotkeys`) | 0.12.0, **alpha** | 729 | 2026-09-24 | 11 / 22 | #155, #156 closed same day (2026-09-22); #147, #149 closed in about 4 weeks | Yes, plus sequence recorder | `key`, then `code` fallback; explicit `code` bindings | peer `react >=16.8`, dev on `^19.3.0` | Yes: recorder, sequence recorder, conflict finder |
| 2 | [tinykeys](https://github.com/jamiebuilds/tinykeys) | 4.0.1 | 4,099 | 2026-09-25 | 0 / 40 | Backlog closed in a batch on 2026-05-19 (#191 opened 2024-01, #197 opened 2025-05) | Yes, space-separated, 1000 ms | `key` **or** `code` | framework-free | No |
| 3 | [react-hotkeys-hook](https://github.com/JohannesKlauss/react-hotkeys-hook) | 5.3.3 | 3,503 | 2026-09-21 | 21 / 246 | #1398 (2026-09-14) and #1374 QWERTZ bug (2026-08-10) open, 0 comments | Yes, `>` separator, 1000 ms | `code` by default, `useKey` opt-in | peer `react >=16.8.0` | Basic `useRecordHotkeys`, no conflict logic |
| 4 | [@github/hotkey](https://github.com/github/hotkey) | 3.1.4 | 3,299 | 2026-09-11 | 11 / 22 | #150 (2026-05-05) open, 0 comments | Yes, space-separated | `key`, with macOS Option-layer mapping | DOM attribute model, no hook | No |
| 5 | [hotkeys-js](https://github.com/jaywcjlove/hotkeys-js) | 4.0.8 | 7,128 | 2026-09-09 | 133 / 99 | #539 Dvorak/Colemak regression (2026-04-29) open | No | `keyCode` derived from `key` | not a hook | No |
| excluded | [mousetrap](https://github.com/ccampbell/mousetrap) | 1.6.5 | 11,776 | 2020-01-23 | 188 / 189 | n/a | Yes | legacy | n/a | No |

Evidence for the feature columns:

- **TanStack Hotkeys.** README: "TanStack Hotkeys is alpha" and "sequences (Vim-style), key-state tracking, recorder UI helpers" ([README](https://github.com/TanStack/hotkeys/blob/e06d82da83733a874e28c4144ad13e129e462491/README.md)). The repo was created 2026-01-21 (`gh api`). Matching skips composing events, then tries `key`, then falls back to the logical key from `code` for non-Latin output, with a comment that "ASCII alphabetic output is authoritative for Dvorak/Colemak/AZERTY" ([_match.ts#L25-L65](https://github.com/TanStack/hotkeys/blob/e06d82da83733a874e28c4144ad13e129e462491/packages/hotkeys/src/_match.ts#L25-L65)). It treats `Process`/`Unidentified` keys as composing ([_keyboard-event.ts#L32-L33](https://github.com/TanStack/hotkeys/blob/e06d82da83733a874e28c4144ad13e129e462491/packages/hotkeys/src/_keyboard-event.ts#L32-L33)). The recorder cancels on Escape, clears on bare Backspace/Delete, ignores modifiers and repeats, and calls `preventDefault()` plus `stopPropagation()` on everything else, **including Tab** ([hotkey-recorder.ts#L145-L186](https://github.com/TanStack/hotkeys/blob/e06d82da83733a874e28c4144ad13e129e462491/packages/hotkeys/src/hotkey-recorder.ts#L145-L186)). `findHotkeyConflicts` checks registrations by target and scope ([conflicts.ts#L58](https://github.com/TanStack/hotkeys/blob/e06d82da83733a874e28c4144ad13e129e462491/packages/hotkeys/src/conflicts.ts#L58)).
- **tinykeys.** Grammar: "`<key>` = `<KeyboardEvent.key>` or `<KeyboardEvent.code>` (case-insensitive)" and the matcher accepts either ([tinykeys.ts#L172, L215-L221](https://github.com/jamiebuilds/tinykeys/blob/64c0731efc25e83802cb94a047e1b8afb91fb1df/src/tinykeys.ts#L172-L221)); `DEFAULT_TIMEOUT = 1000` ([#L94](https://github.com/jamiebuilds/tinykeys/blob/64c0731efc25e83802cb94a047e1b8afb91fb1df/src/tinykeys.ts#L94)); `$mod` resolves to `Meta` on Apple devices, `Control` elsewhere ([#L111](https://github.com/jamiebuilds/tinykeys/blob/64c0731efc25e83802cb94a047e1b8afb91fb1df/src/tinykeys.ts#L111)); the default ignore function skips repeats, `isComposing`, and form fields ([#L138-L150](https://github.com/jamiebuilds/tinykeys/blob/64c0731efc25e83802cb94a047e1b8afb91fb1df/src/tinykeys.ts#L138-L150)).
- **react-hotkeys-hook.** Sequences split on `>` ([parseHotkeys.ts#L44-L61](https://github.com/JohannesKlauss/react-hotkeys-hook/blob/7aba1f61f47328773ccf74f61b251312fdd83333/packages/react-hotkeys-hook/src/lib/parseHotkeys.ts#L44-L61)); sequence keys are read as `hotkey.useKey ? e.key : mapCode(e.code)` ([useHotkeys.ts#L142](https://github.com/JohannesKlauss/react-hotkeys-hook/blob/7aba1f61f47328773ccf74f61b251312fdd83333/packages/react-hotkeys-hook/src/lib/useHotkeys.ts#L142)); `useKey` is documented as "listen to the produced key instead of the code" ([types.ts#L37](https://github.com/JohannesKlauss/react-hotkeys-hook/blob/7aba1f61f47328773ccf74f61b251312fdd83333/packages/react-hotkeys-hook/src/lib/types.ts#L37)). `useRecordHotkeys` collects every non-blacklisted key into a set and calls `preventDefault()` on it ([useRecordHotkeys.ts#L4-L38](https://github.com/JohannesKlauss/react-hotkeys-hook/blob/7aba1f61f47328773ccf74f61b251312fdd83333/packages/react-hotkeys-hook/src/lib/useRecordHotkeys.ts#L4-L38)), so Tab and Escape are recorded unless the caller blacklists them.
- **@github/hotkey.** "Multiple keys separated by a blank space represent a key sequence"; "`Mod` is a special modifier that localizes to `Meta` on MacOS/iOS, and `Control` on Windows/Linux" ([README#L106-L110](https://github.com/github/hotkey/blob/c799d9f9530b3680982dab2540316154e6dd4951/README.md)). "MacOS outputs symbols when `Alt` is held, so we map them back to the key symbol" ([hotkey.ts#L50-L53](https://github.com/github/hotkey/blob/c799d9f9530b3680982dab2540316154e6dd4951/src/hotkey.ts#L50-L53)).
- **hotkeys-js.** `getLayoutIndependentKeyCode` turns `event.key` letters and digits back into keyCodes ([utils.ts#L86-L110](https://github.com/jaywcjlove/hotkeys-js/blob/8a0e151e6c46e901931be806f6e123c1e61589bb/src/utils.ts#L86-L110)); the README documents no sequences or recorder.

**Recommendation: keep `useShortcuts`, add the override layer.** Reasons, tied to Maibuk's code:

1. `useShortcuts` carries Maibuk-specific behavior that a library would have to be wrapped to reproduce: it declares Bound Shortcut ids (`shortcuts.ts:59-63`), stops while a modal is open (`shortcuts.ts:73-76`), limits itself to `tutorial.skip` during a Tutorial run (`shortcuts.ts:24-28`), and runs modifier combos in the capture phase because React Aria pressables call `stopPropagation()` (`shortcuts.ts:152-163`). None of the libraries above know about any of these.
2. What Maibuk lacks is small and deterministic: a merge function, a normalizer, a conflict finder, and a recorder. Each is a pure function or a small component with unit tests.
3. The one library that covers recorder plus conflicts plus layout fallback is TanStack Hotkeys, which is alpha (README) and on 0.x releases published days apart. Adopting it now means tracking API churn in a core input path.
4. The libraries still teach Maibuk what to fix in its own matcher (recommendation 5): TanStack's `code` fallback, ProseMirror's `keyCode` fallback, `@github/hotkey`'s macOS Option layer.

Revisit TanStack Hotkeys when it reaches 1.0; its recorder and conflict model are closest to what Maibuk needs.

---

## 3. TipTap 3: how extension shortcuts work, and rebinding at runtime

### 3.1 Where shortcuts come from

- An extension returns a map from `addKeyboardShortcuts()`. `ExtensionManager.plugins` sorts extensions by priority, reads that field with its context, wraps each handler as `() => method({ editor })`, and builds one `keymap(defaultBindings)` plugin per extension ([ExtensionManager.ts#L97-L135](https://github.com/ueberdosis/tiptap/blob/v3.15.1/packages/core/src/ExtensionManager.ts#L97-L135)). Exitable marks also get an `ArrowRight` binding there.
- **Priority.** "The priority of your extension. The higher, the earlier it will be called and will take precedence over other extensions with a lower priority. @default 100" ([Extendable.ts#L49-L54](https://github.com/ueberdosis/tiptap/blob/v3.15.1/packages/core/src/Extendable.ts#L49-L54)); `sortExtensions` puts higher priority first ([sortExtensions.ts](https://github.com/ueberdosis/tiptap/blob/v3.15.1/packages/core/src/helpers/sortExtensions.ts)). The array is reversed before sorting so that later extensions win among equals ([ExtensionManager.ts#L92-L97](https://github.com/ueberdosis/tiptap/blob/v3.15.1/packages/core/src/ExtensionManager.ts#L92-L97)).
- **Overriding at build time.** The docs say: "Import the extension, overwrite the keyboard shortcuts, then add the custom extension to your editor", using `extend()` with `addKeyboardShortcuts()` ([TipTap docs, Keyboard shortcuts](https://tiptap.dev/docs/editor/core-concepts/keyboard-shortcuts)). `configure()` changes options, not shortcuts, unless the extension reads its keys from options.

### 3.2 ProseMirror keymap normalization

- `Mod` becomes `Meta` on Mac and `Ctrl` elsewhere: `else if (/^mod$/i.test(mod)) { if (mac) meta = true; else ctrl = true }` ([prosemirror-keymap keymap.ts#L18](https://github.com/ProseMirror/prosemirror-keymap/blob/1.2.3/src/keymap.ts#L18)). Mac detection is `/Mac|iP(hone|[oa]d)/.test(navigator.platform)` (#L5).
- Names are normalized to a fixed modifier order, `Space` maps to `" "` (#L8-L26). "Use lowercase letters to refer to letter keys (or uppercase letters if you want shift to be held)" and "For characters that are created by holding shift, the `Shift-` prefix is implied" (#L51-L63).
- "You can add multiple keymap plugins to an editor. The order in which they appear determines their precedence (the ones early in the array get to dispatch first)" (#L68-L70). `keymap()` is `new Plugin({props: {handleKeyDown: keydownHandler(bindings)}})` (#L72), and `keydownHandler` is exported separately (#L78).
- **Layout fallback.** When a modifier is held and the produced character is not what the US keyCode table says, it retries with `base[event.keyCode]`, except for Ctrl+Alt on Windows, "Ctrl-Alt may be used for AltGr on Windows" ([#L84-L101](https://github.com/ProseMirror/prosemirror-keymap/blob/1.2.3/src/keymap.ts#L84-L101)). This is why TipTap's Mod-b works on a Russian layout while Maibuk's `useShortcuts` Ctrl+S does not (section 4.2).
- `@tiptap/pm/keymap` is `export * from 'prosemirror-keymap'` (installed `node_modules/@tiptap/pm/keymap/index.ts`), so `keydownHandler` is available without a new dependency.

### 3.3 Can bindings change without recreating the editor?

| Approach | Works at runtime? | Evidence |
| --- | --- | --- |
| `editor.setOptions({ extensions })` | **No.** It merges options, calls `view.setProps(editorProps)` and `view.updateState(state)`; the extension manager, and so the keymap plugins, are untouched | [Editor.ts#L264-L279](https://github.com/ueberdosis/tiptap/blob/v3.15.1/packages/core/src/Editor.ts#L264-L279); the manager is built only in `createExtensionManager` ([#L424-L455](https://github.com/ueberdosis/tiptap/blob/v3.15.1/packages/core/src/Editor.ts#L424-L455)) |
| `useEditor` with new extensions, empty deps | **No.** `compareOptions` sees different extensions and calls `setOptions`, which does not rebuild keymaps | [useEditor.ts#L182-L220, L235-L244](https://github.com/ueberdosis/tiptap/blob/v3.15.1/packages/react/src/useEditor.ts#L182-L244) |
| `useEditor` with changed deps | **Yes, by recreation.** "When the editor ... the deps array changes, We need to destroy the editor instance and re-initialize it" | [useEditor.ts#L245-L251](https://github.com/ueberdosis/tiptap/blob/v3.15.1/packages/react/src/useEditor.ts#L245-L251). Costs: undo history, selection, and the Edit Session wiring in `src/components/editor/Editor.tsx:349-417` are rebuilt |
| `editor.unregisterPlugin` + `registerPlugin` | **Awkward.** Both reconfigure state ([Editor.ts#L368-L420](https://github.com/ueberdosis/tiptap/blob/v3.15.1/packages/core/src/Editor.ts#L368-L420)), but `unregisterPlugin` matches by key prefix and every `keymap()` plugin gets the auto key `plugin$N`, so removing one extension's keymap by name would remove others | same lines, key filter `plugin.key.startsWith(name)` |
| One plugin whose `handleKeyDown` reads a mutable store | **Yes.** `handleKeyDown` is called per event, so it can delegate to `keydownHandler(currentBindings)` rebuilt only when the store changes | `keymap.ts#L72-L78` shows a keymap is just a `handleKeyDown` prop |

The last row is the recommendation. Sketch (not code to paste; the command table and store names are illustrative):

```ts
// priority > 100 so this plugin dispatches before the extensions' own keymaps
Extension.create({
  name: "shortcutOverrides",
  priority: 1000,
  addProseMirrorPlugins() {
    let handler = keydownHandler(buildEditorBindings(this.editor)); // effective map
    const unsubscribe = subscribeToOverrides(() => {
      handler = keydownHandler(buildEditorBindings(this.editor));
    });
    return [new Plugin({
      props: { handleKeyDown: (view, event) => handler(view, event) },
      view: () => ({ destroy: unsubscribe }),
    })];
  },
});
```

`buildEditorBindings` maps each `editor-keymap` registry id to a command (`editor.bold` to `toggleBold`) under its effective combo, and maps each default combo the author moved away to `() => true` so the extension's own keymap never sees it. Returning `true` makes ProseMirror call `preventDefault()` ([prosemirror-view input.ts#L130-L131](https://github.com/ProseMirror/prosemirror-view/blob/1.41.4/src/input.ts#L130-L131)).

### 3.4 How Maibuk's app shortcuts and TipTap interact today

- `useShortcuts` registers a **window capture** listener for combos with Ctrl, Meta, or Alt (`src/lib/shortcuts.ts:152-163`). Capture on `window` runs before the editor's own `keydown` listener.
- ProseMirror ignores bubbling events that are already default-prevented: `if (event.defaultPrevented) return false` in `eventBelongsToView` ([input.ts#L91](https://github.com/ProseMirror/prosemirror-view/blob/1.41.4/src/input.ts#L91)).
- So if an author binds an app command to Mod-B, `useShortcuts` wins and bold stops working, with no error. Conflict detection must therefore compare app bindings against `editor-keymap` bindings (recommendation 3).
- `editorKeymapCombos` (`src/components/editor/keymap-shortcuts.ts:31-49`) reads `addKeyboardShortcuts` from each extension to list what the editor handles. With overrides, the truthful source becomes the effective map plus the extensions not covered by the registry.

---

## 4. Key capture

### 4.1 `key` vs `code`

- `code`: "Unlike the key values described in [UIEvents-key], the code values are based only on the key's physical location on the keyboard and do not vary based on the user's current locale" ([UI Events KeyboardEvent code Values, §1](https://www.w3.org/TR/uievents-code/)).
- MDN: `code` "represents a physical key on the keyboard (as opposed to the character generated by pressing the key)", is "especially common when writing code to handle input for games", and "you can't use the value reported by `KeyboardEvent.code` to determine the character generated by the keystroke" ([MDN, KeyboardEvent.code](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code)).
- `key`: its value "depends upon the key mapping", which is "the result of a combination of several factors, including the operating system and the keyboard layout (e.g., QWERTY, Dvorak, Spanish, InScript, Chinese, etc.), and after taking into account all modifier key (Shift, Alt, et al.) and dead key states" ([UI Events, key mapping / key value definitions](https://www.w3.org/TR/uievents/)).
- WAI-ARIA `aria-keyshortcuts` says "The keys defined in the shortcuts represent the physical keys pressed and not the actual characters generated" and warns "in French keyboard layouts, the number characters are not available until you press the Control key, so a keyboard shortcut defined as "Control+2" would be ambiguous" ([WAI-ARIA 1.2, aria-keyshortcuts](https://www.w3.org/TR/wai-aria-1.2/#aria-keyshortcuts)). (The spec's own example names Control, not Shift; quoted as written.) It also recommends: "authors can prevent conflicts by avoiding keys other than ASCII letters, as number characters and common punctuation often require modifiers".

For an app whose shortcuts are mnemonic (B for bold, S for save), matching on `key` is right: a Dvorak or AZERTY author expects Ctrl+B to follow the letter. `code` is right for positional keys. The practical rule used by ProseMirror and TanStack: match `key` first, fall back to `code`/`keyCode` only when `key` is not a Latin letter.

### 4.2 Non-US layouts and what VS Code does

- VS Code dispatches on `code` by default and offers `keyboard.dispatch: "code" | "keyCode"`, described as "Controls the dispatching logic for key presses to use either `code` (recommended) or `keyCode`", shown only on macOS and Linux ([keyboardConfig.ts#L36-L43](https://github.com/microsoft/vscode/blob/9cf0128b9822dcd8a533f08ef7312956a4390301/src/vs/platform/keyboardLayout/common/keyboardConfig.ts#L36-L43)).
- The VS Code wiki: "On Windows, VS Code dispatches on `e.keyCode`"; "On macOS and Linux, VS Code dispatches on `e.code`"; labels follow the layout ("Ctrl+/ on a US keyboard layout and as Ctrl+# on a GER keyboard layout") via `native-keymap`; "VS Code does not contain default keybindings that are of the form Ctrl+Alt+[Key] on Windows, since these might produce vital characters" ([Keybinding Issues wiki](https://github.com/microsoft/vscode/wiki/Keybinding-Issues)). The docs add layout-independent scan-code bindings such as `cmd+[Slash]` ([docs](https://code.visualstudio.com/docs/configure/keybindings)).
- VS Code's approach needs a native keymap module Maibuk does not have on the web build. The ProseMirror/TanStack fallback is the reachable alternative.

**Maibuk today:** `eventToCombo` builds `ctrl+meta+alt+shift+<event.key lowercased>` (`src/lib/shortcuts.ts:35-43`) with no fallback. Consequences:

1. On a Cyrillic layout, Ctrl+S produces `key: "ы"` and `editor.save` does not fire, while TipTap's Mod-B still works through the `keyCode` fallback (section 3.2).
2. Six defaults use Ctrl+Alt (`editor.saveVersion`, `editor.codeBlock`, `editor.heading1-3`, `editor.toggleHeadingCollapse`, `shortcut-registry.ts`), which the VS Code wiki warns can collide with AltGr characters on Windows. TanStack refuses Ctrl/Alt matches when AltGraph is active ([_match.ts#L30](https://github.com/TanStack/hotkeys/blob/e06d82da83733a874e28c4144ad13e129e462491/packages/hotkeys/src/_match.ts#L30)).
3. `global.showHelp` lists `"shift+/"` as a US-layout alias (`GlobalShortcuts.tsx:177`); on layouts where `?` is elsewhere, the `shift+?` form still matches because `key` is `?`.

### 4.3 Keys the browser keeps on the web

- **Chromium.** `BrowserCommandController::IsReservedCommandOrKey` returns false in app windows ("In Apps mode, no keys are reserved"), delivers everything except exit-fullscreen while fullscreen, and otherwise reserves `IDC_CLOSE_TAB`, `IDC_CLOSE_WINDOW`, `IDC_NEW_INCOGNITO_WINDOW`, `IDC_NEW_ISOLATED_WINDOW`, `IDC_NEW_TAB`, `IDC_NEW_WINDOW`, `IDC_RESTORE_TAB`, `IDC_SELECT_NEXT_TAB`, `IDC_SELECT_PREVIOUS_TAB`, `IDC_CYCLE_TO_NEXT_TAB`, `IDC_CYCLE_TO_PREV_TAB`, `IDC_EXIT` ([browser_command_controller.cc#L474-L540](https://github.com/chromium/chromium/blob/ea99e592ef621cfb6bc45216dc2d564e988d258f/chrome/browser/ui/browser_command_controller.cc#L474-L540)). Those commands are Ctrl+W, Ctrl+Shift+W, Ctrl+Shift+N, Ctrl+T, Ctrl+N, Ctrl+Shift+T, Ctrl+Tab / Ctrl+PgDn and their reverses, and quit (the key-to-command mapping is Chromium's accelerator table, not re-verified here).
- **Firefox.** `browser-sets.inc.xhtml` marks `key_newNavigator` (new window), `key_newNavigatorTab` (new tab), `key_close`, `key_closeWindow`, `key_privatebrowsing`, and `key_quitApplication` with `reserved="true"` ([browser-sets.inc.xhtml#L139-L144, L191-L192, L350-L371](https://github.com/mozilla-firefox/firefox/blob/04f509798db049429d2f45a02e0a1439d536530a/browser/base/content/browser-sets.inc.xhtml#L139-L371)); for keys without the attribute, "the default value depends on the permissions.default.shortcuts preference" ([KeyEventHandler.h#L36-L41](https://github.com/mozilla-firefox/firefox/blob/4559366a819949a8db0b02386410cd770aa4ff38/dom/events/KeyEventHandler.h#L36-L41)).
- **Keyboard Lock API** "allows websites to capture keys that are normally reserved by the underlying host operating system. It is intended to be used by web applications that provide a fullscreen immersive experience (like games or remote access apps)" ([Keyboard Lock ED](https://wicg.github.io/keyboard-lock/)). It is not a fit for a writing app in a normal tab.

Implication: `home.newBook` (`Ctrl+N`) cannot fire in a browser tab on the web build. The recorder should refuse these combos when `IS_WEB`.

### 4.4 Tauri webviews

- Tauri's window has no browser chrome, so Chromium's `BrowserCommandController` reservation (browser UI code) does not apply to the WebView2, WKWebView, or WebKitGTK webviews. This is an inference from where the reservation lives, not a documented Tauri guarantee (see log).
- **WebView2 (Windows)** has its own browser accelerators. With `AreBrowserAcceleratorKeysEnabled` false it disables "Ctrl+F and F3 for Find on Page", "Ctrl+P for Print", "Ctrl+R and F5 for Reload", "Ctrl+Plus and Ctrl+Minus for zooming", "Ctrl+Shift-C and F12 for DevTools"; editing keys "such as ... Ctrl+Z for Undo ... will always be enabled unless they are handled in the AcceleratorKeyPressed event"; "The default value ... is true" ([Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2settings.arebrowseracceleratorkeysenabled)). wry exposes it as `with_browser_accelerator_keys`, default `true` "This is WebView2's default behavior" ([wry lib.rs](https://github.com/tauri-apps/wry/blob/wry-v0.53.5/src/lib.rs), `browser_accelerator_keys`). A code search of `tauri-apps/tauri` found no config key that sets it. Maibuk uses Ctrl+F, Ctrl++, Ctrl+- (`editor.findReplace`, `editor.zoomIn/Out`); whether a page's `preventDefault()` beats WebView2's accelerator is unverified.
- `tauri-plugin-global-shortcut` registers OS-wide shortcuts ("Register global shortcuts"; Windows, Linux, macOS supported; Android and iOS unsupported) ([Tauri docs](https://v2.tauri.app/plugin/global-shortcut/)). It is the wrong tool for in-window shortcuts and Maibuk does not use it (`src-tauri/` has no global shortcut or menu accelerators, only a tray menu in `src-tauri/src/tray.rs:20`).

### 4.5 Mac Cmd vs Ctrl, IME, dead keys

- **Mod.** ProseMirror (`keymap.ts#L18`), tinykeys (`$mod`, #L111), `@github/hotkey` (`Mod`), Obsidian (`'Mod'` in `Modifier`), and TanStack all model a platform modifier. Maibuk's registry writes `Ctrl` and `matchKeys` emits both `ctrl+x` and `meta+x` (`shortcut-registry.ts:260-272`); `formatKeys` shows `⌘` for `Ctrl` on Mac (#L239-L256). Storing `Mod` keeps the display rule and fixes the double match.
- **macOS Option layer.** `@github/hotkey` maps symbols back "because MacOS outputs symbols when `Alt` is held" ([hotkey.ts#L51](https://github.com/github/hotkey/blob/c799d9f9530b3680982dab2540316154e6dd4951/src/hotkey.ts#L51)). Maibuk's Ctrl+Alt defaults become Cmd+Option on Mac through `matchKeys`; whether they fire there is untested (log).
- **IME.** The UI Events legacy algorithm: "If an Input Method Editor is processing key input and the event is keydown, return 229" ([UI Events §7.3.1](https://www.w3.org/TR/uievents/)). MDN recommends `if (event.isComposing || event.keyCode === 229) return;` and notes "compositionstart may fire after keydown when typing the first character that opens up the IME, and compositionend may fire before keydown when typing the last character that closes the IME. In these cases, isComposing is false" ([MDN, keydown event](https://developer.mozilla.org/en-US/docs/Web/API/Element/keydown_event)). ProseMirror returns early from keydown while composing and ignores the Safari Enter that follows `compositionend` within 500 ms ([input.ts#L108, L434-L450](https://github.com/ProseMirror/prosemirror-view/blob/1.41.4/src/input.ts#L434-L450)). Maibuk checks only `event.isComposing` (`shortcuts.ts:86`).
- **Dead keys.** `"Dead"`: "A dead key combining key. It may be any combining key from any keyboard layout. For example, on a PC/AT French keyboard, using a French mapping and without any modifier activated, this is the key value U+0302 COMBINING CIRCUMFLEX ACCENT" ([UI Events KeyboardEvent key Values](https://www.w3.org/TR/uievents-key/)). A recorder must reject `Dead` (and `Process`, `Unidentified`) as the final key; otherwise an author on a Spanish or French layout records a binding that can never match.

---

## 5. Accessible key-capture control

### 5.1 WCAG 2.1 SC 2.1.4 Character Key Shortcuts (Level A), verbatim

From [WCAG 2.1](https://www.w3.org/TR/WCAG21/#character-key-shortcuts):

> If a keyboard shortcut is implemented in content using only letter (including upper- and lower-case letters), punctuation, number, or symbol characters, then at least one of the following is true:
>
> **Turn off**: A mechanism is available to turn the shortcut off;
>
> **Remap**: A mechanism is available to remap the shortcut to include one or more non-printable keyboard keys (e.g., Ctrl, Alt);
>
> **Active only on focus**: The keyboard shortcut for a user interface component is only active when that component has focus.

The Understanding document extends it to sequences and shifted characters: "The success criterion also applies to situations where a shortcut is based on a sequence of character keys – for example, pressing G and then A in quick succession to trigger an action", and "on most full-size US and UK keyboard, the ? (question mark) symbol is accessed using Shift + / ... shortcuts that use these characters still fall under the requirements of this success criterion" ([Understanding SC 2.1.4](https://www.w3.org/WAI/WCAG21/Understanding/character-key-shortcuts)). Its stated goal: "Reduce accidental activation of keyboard shortcuts", because "Character-key shortcuts are easy to accidentally trigger, especially with speech input."

What it implies for Maibuk. These registry shortcuts are character-only and listen on `window` whenever focus is not in a typing target, so "active only on focus" does not apply:

- `global.showHelp` (`?`), every `g` sequence (`global.goto*`, `global.toggleTheme`, `global.toggleShortcutHints`, `global.startTutorial`, `editor.versionHistory`)
- `home.jumpBooks` (`1-9`), `home.moveSelection` (`j/k`)
- `canvas.toolSelect/toolPen/toolEraser/addTextNode/addNoteRef/lock` (`V P E T N L`), `canvas.fitView` (`Shift+1`, a `!` on US layouts)

Not affected: F-keys, Backspace/Delete, Escape, arrows, Enter, and anything with Ctrl/Alt/Meta. A single "Single-key shortcuts" switch is the fastest way to comply; remapping with a required modifier also complies. Gmail and WordPress are listed there as apps that allow turning off or changing such shortcuts.

### 5.2 How VS Code's recorder behaves

- The Define Keybinding widget is an input box whose accessible name is the instruction: `ariaLabel: message` with message "Press desired key combination and then press ENTER." ([keybindingWidgets.ts#L169-L175](https://github.com/microsoft/vscode/blob/9cf0128b9822dcd8a533f08ef7312956a4390301/src/vs/workbench/contrib/preferences/browser/keybindingWidgets.ts#L169-L175)).
- Every keydown is `preventDefault()` + `stopPropagation()`. Enter commits (unless `recordEnter`), Escape fires `onEscape`, everything else is recorded, **including Tab** ([#L92-L105](https://github.com/microsoft/vscode/blob/9cf0128b9822dcd8a533f08ef7312956a4390301/src/vs/workbench/contrib/preferences/browser/keybindingWidgets.ts#L92-L105)).
- Escape clears the recording if there is one, otherwise hides the widget (`clearOrHide`, [#L276-L285](https://github.com/microsoft/vscode/blob/9cf0128b9822dcd8a533f08ef7312956a4390301/src/vs/workbench/contrib/preferences/browser/keybindingWidgets.ts#L276-L285)). Blur cancels ([#L180](https://github.com/microsoft/vscode/blob/9cf0128b9822dcd8a533f08ef7312956a4390301/src/vs/workbench/contrib/preferences/browser/keybindingWidgets.ts#L180)).
- Conflicts are announced with `aria.alert(text)` ([#L232](https://github.com/microsoft/vscode/blob/9cf0128b9822dcd8a533f08ef7312956a4390301/src/vs/workbench/contrib/preferences/browser/keybindingWidgets.ts#L232)).
- Consequence: Enter and Escape cannot be recorded as plain bindings, and Tab is recorded rather than moving focus. The exits are Enter, Escape, and blur, and the label tells the user about Enter.

WCAG SC 2.1.2 No Keyboard Trap: "If keyboard focus can be moved to a component of the page using a keyboard interface, then focus can be moved away from that component using only a keyboard interface, and, if it requires more than unmodified arrow or tab keys or other standard exit methods, the user is advised of the method for moving focus away" ([WCAG 2.1](https://www.w3.org/TR/WCAG21/#no-keyboard-trap)). Capturing Tab is allowed only if the label says how to leave, which VS Code's does.

### 5.3 Screen readers

- NVDA reads web pages in browse mode and passes keys to a control only in focus mode: "You do this by switching to focus mode, where almost all keys are passed to the control. When in Browse mode, by default, NVDA will automatically switch to focus mode if you tab to or click on a particular control that requires it" ([NVDA User Guide, Browse Mode](https://www.nvaccess.org/files/nvda/documentation/userGuide.html)). An editable text field triggers focus mode; a plain `div` or button may not, so letter presses would be eaten by browse-mode quick navigation. This is why VS Code's choice of an input box matters.
- `aria-keyshortcuts` lets the command's trigger expose its current shortcut to assistive technology, and its syntax is "zero or more modifier keys and exactly one non-modifier key", with names from UI Events `key` values ([WAI-ARIA 1.2](https://www.w3.org/TR/wai-aria-1.2/#aria-keyshortcuts)). It has no sequence syntax, so `g p` cannot be expressed; Maibuk would expose only chord shortcuts.

### 5.4 Recorder design for Maibuk (derived from the sources above)

1. A row per registry id: the localized label (`labelKey`), the current binding rendered by `formatKeys`, a "Change" button, a "Reset" button shown only when an override exists, and a conflict note.
2. "Change" swaps in a text field (React Aria `TextField`, so labelling and focus behavior come from the library, per AGENTS.md section 2 item 3) labelled with the instruction, for example "Press the new shortcut for Bold. Escape cancels, Tab leaves." The field is read-only to typing; its value is the recorded combo.
3. Keys: Escape cancels and restores focus to "Change"; Tab and Shift+Tab are never recorded and leave the field, cancelling (standard exit, SC 2.1.2); bare Backspace/Delete could clear to "unassigned" (TanStack's convention). Commit on the first non-modifier keydown, which removes VS Code's need for Enter as a commit key and lets Enter-with-modifier bindings (`editor.followLink` is Ctrl+Enter) be recorded.
4. Sequences: offer a separate "Record sequence" mode that records two presses, because a chord recorder that commits on the first key cannot capture `g` then `p`. TanStack ships a separate sequence recorder for the same reason (`hotkey-sequence-recorder.ts`).
5. Ignore `isComposing`, `keyCode === 229`, `event.repeat`, and final keys `Dead`, `Process`, `Unidentified`, `AltGraph`, and lone modifiers.
6. On web, refuse the reserved combos of section 4.3 with a message; everywhere, refuse Tab/Shift+Tab/Escape as bindings; warn on Ctrl+Alt+key on Windows.
7. Announce the recorded combo and the conflict result through a polite `role="status"` region, reusing the pattern in `RouteAnnouncer.tsx:42` and `ToolbarSettingsDialog.tsx:105`.
8. While recording, `useShortcuts` must not act: its window capture listener sees the event before the field does. `useShortcuts` already stops while `modalIds.length > 0` (`shortcuts.ts:73-76`), so either host the recorder in a `Modal` or add an explicit "recording" flag to the same check.

---

## Implications for Maibuk

| Area | Current code | Change implied |
| --- | --- | --- |
| Single source of keys | `matchKeys(id)` at some sites, literals at `Canvas.tsx:432-459`, `GlobalShortcuts.tsx:177`, `Home.tsx:150,163` | Every binding with an `id` reads `effectiveKeys(id)`; a test fails when a binding with an `id` passes literal `keys` |
| Storage | `useSettingsStore` persisted to localStorage, `merge` normalizes nested settings | Add `shortcutOverrides` diff + normalizer; per-id and global reset |
| Conflicts | None | Pure `findShortcutConflicts(effective)` scoped by id prefix, includes `editor-keymap`, reserved-on-web list |
| Editor | Defaults from extensions; `editorKeymapShortcutIds` reads extensions | One high-priority dynamic keymap extension; help reads the effective map |
| Matching | `event.key` only, `isComposing` only, `ctrl` doubles as `meta` | `code`/`keyCode` fallback for non-Latin letters, `229` guard, explicit `Mod`, AltGr guard |
| WCAG 2.1.4 | Character-only shortcuts always on | "Single-key shortcuts" switch now; remap later |
| Help dialog | `ShortcutsHelpDialog.tsx` lists Bound Shortcuts from the registry | Show effective keys and mark overridden ones |
| Tests / gates | `shortcut-bindings.test.ts`, coverage matrix, keyboard test gate | Unit tests for merge, normalizer, conflicts, matcher; recorder keyboard tests (Escape restores focus, Tab leaves); E2E row with `@wf:` tag; `mac-platform` project for Mod |
| Domain | `Bound Shortcut` in `CONTEXT.md:378-381` | New term for an author-changed shortcut; ADR if the storage or sync decision is hard to reverse |

Open decision for Andy: overrides device-local (keyboard layouts are per device, matching ADR 0004's position state) or part of settings that travel in an Export. The research does not decide it.

---

## Sources

Specs and standards
- WCAG 2.1, SC 2.1.4 and 2.1.2: https://www.w3.org/TR/WCAG21/
- Understanding SC 2.1.4: https://www.w3.org/WAI/WCAG21/Understanding/character-key-shortcuts
- UI Events: https://www.w3.org/TR/uievents/
- UI Events KeyboardEvent code Values: https://www.w3.org/TR/uievents-code/
- UI Events KeyboardEvent key Values: https://www.w3.org/TR/uievents-key/
- WAI-ARIA 1.2, aria-keyshortcuts: https://www.w3.org/TR/wai-aria-1.2/#aria-keyshortcuts
- Keyboard Lock (WICG ED): https://wicg.github.io/keyboard-lock/
- MDN KeyboardEvent.code: https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code
- MDN keydown event: https://developer.mozilla.org/en-US/docs/Web/API/Element/keydown_event
- NVDA User Guide: https://www.nvaccess.org/files/nvda/documentation/userGuide.html

Product docs
- VS Code keyboard shortcuts: https://code.visualstudio.com/docs/configure/keybindings
- VS Code Keybinding Issues wiki: https://github.com/microsoft/vscode/wiki/Keybinding-Issues
- Obsidian Hotkeys: https://obsidian.md/help/hotkeys
- Linear Inbox / Triage / Favorites: https://linear.app/docs/inbox, https://linear.app/docs/triage, https://linear.app/docs/favorites
- Linear changelog: https://linear.app/changelog/2021-03-25-keyboard-shortcuts-help, https://linear.app/changelog/2019-06-20-international-keyboard-shortcut-improvements
- Figma: https://help.figma.com/hc/en-us/articles/5665442977431-Select-keyboard-layout, https://help.figma.com/hc/en-us/articles/360040328653-Keyboard-shortcuts-in-Figma
- TipTap keyboard shortcuts: https://tiptap.dev/docs/editor/core-concepts/keyboard-shortcuts
- WebView2 AreBrowserAcceleratorKeysEnabled: https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2settings.arebrowseracceleratorkeysenabled
- Tauri global shortcut plugin: https://v2.tauri.app/plugin/global-shortcut/

Source code (refs in the table at the top)
- TipTap: `packages/core/src/ExtensionManager.ts`, `Editor.ts`, `Extendable.ts`, `helpers/sortExtensions.ts`, `packages/react/src/useEditor.ts` at `v3.15.1`
- prosemirror-keymap `src/keymap.ts` at `1.2.3`; prosemirror-view `src/input.ts` at `1.41.4`
- VS Code: `src/vs/platform/keybinding/common/keybindingResolver.ts`, `src/vs/workbench/services/keybinding/common/keybindingEditing.ts`, `src/vs/workbench/contrib/preferences/browser/keybindingWidgets.ts`, `keybindingsEditor.ts`, `src/vs/platform/keyboardLayout/common/keyboardConfig.ts`
- Obsidian API `obsidian.d.ts`
- Chromium `chrome/browser/ui/browser_command_controller.cc`; Firefox `browser/base/content/browser-sets.inc.xhtml`, `dom/events/KeyEventHandler.h`
- wry `src/lib.rs` at `wry-v0.53.5`
- TanStack Hotkeys, tinykeys, react-hotkeys-hook, hotkeys-js, @github/hotkey at the commits above

---

## Verification log

Passes run:

1. **Source reads.** Every TipTap, ProseMirror, VS Code, Obsidian, library, Chromium, Firefox, and wry claim was read in the file itself (local `node_modules` for TipTap/ProseMirror, shallow clones or `gh api .../contents?ref=` for the rest). TipTap and ProseMirror line numbers were re-checked against GitHub at the pinned tags (`Editor.ts` L264/L368/L389/L424, `ExtensionManager.ts` L97/L110/L125/L133, `keymap.ts` L18/L72/L94, `input.ts` L91/L108/L130/L435, `useEditor.ts` L235-L251) and matched.
2. **Repo stats.** `gh api` for stars, pushed date, last commit, releases; search API for issue counts, cross-checked by paginating `/issues` for the two repos with identical counts; `npm view` for published versions.
3. **Docs and specs.** WCAG 2.1.4 and 2.1.2 text extracted from w3.org HTML and quoted verbatim; Understanding notes, ARIA, UI Events, MDN, NVDA, VS Code, Obsidian, Linear, Figma, WebView2, and Tauri pages fetched and quoted.

Unverified, with what would settle each:

- **Linear rebinding.** No linear.app page found stating shortcuts cannot be remapped; a search summary claimed it. Settle: find the page in Linear Docs or ask Linear support.
- **Obsidian conflict display, reset, storage file.** The help page does not cover them. Settle: inspect Settings > Hotkeys in a current Obsidian build and its `.obsidian/` folder.
- **VS Code "reset all".** Not found in the files read. Settle: search VS Code commands for a reset-all keybindings command.
- **Chromium command to key mapping.** The reserved list names commands; the Ctrl+N/T/W mapping comes from general knowledge of Chromium accelerators, not a file read here. Settle: read `chrome/browser/ui/views/accelerator_table.cc`.
- **Tauri webviews and reserved keys.** That WebKitGTK, WKWebView, and WebView2 pass Ctrl+N/T/W to the page is an inference from where Chromium keeps its reservation. Settle: a Tauri E2E or manual check on each OS.
- **WebView2 accelerators vs `preventDefault()`.** Whether the page's `preventDefault()` on Ctrl+F or Ctrl+Plus stops WebView2's own action is not stated on the page read. Settle: manual test on Windows, or the `AcceleratorKeyPressed` docs.
- **Maibuk on macOS with Cmd+Option.** Whether `editor.saveVersion` (Cmd+Option+S) fires, given the Option layer. Settle: E2E in the `mac-platform` project or a manual check.
- **Maibuk on non-Latin layouts.** The claim that Ctrl+S misses on a Cyrillic layout follows from `eventToCombo` reading `event.key`; not run. Settle: a unit test dispatching `{ key: "ы", code: "KeyS", ctrlKey: true }`.
- **Playwright and reserved keys.** Whether the E2E suite's Ctrl+N presses reach the page because Playwright bypasses browser accelerators. Settle: check the `home.newBook` spec against a real Chromium tab.
- **Screen reader behavior of the proposed recorder.** Derived from NVDA's documented focus mode rules; not tested with NVDA, JAWS, VoiceOver, or Orca. Settle: manual test once built.
- **Figma.** "No rebinding" rests on two help pages that describe only a layout picker and never mention remapping. Settle: Figma preferences in a current build.
