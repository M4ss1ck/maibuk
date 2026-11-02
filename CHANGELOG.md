# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.19.3] - 2026-11-01

### Fixed
- Keep the canvas delete confirmation prompt within the fixed-height canvas card, preventing the action buttons from overflowing or wrapping

## [0.19.2] - 2026-11-01

### Added
- Visual Customize toolbar editor with separate Toolbar and Selection layouts
- Keyboard move mode for reordering toolbar buttons, with Enter to pick up and drop, arrows to move, and Escape to cancel
- Pointer drag-and-drop for arranging toolbar buttons
- Tray for hiding toolbar buttons

### Changed
- The Selection Toolbar now keeps its own button order, independent of the main toolbar
- Wrapped toolbar grids move Left/Right in reading order and Up/Down by position

### Fixed
- Dropping a button removes only the dividers made redundant by the move, preserving stored edge dividers and those beside hidden buttons
- Escape leaves the arrangement preview before it closes the Customize toolbar dialog

## [0.19.1] - 2026-11-01

### Added
- Canary and Nemotron Dictation models on desktop via the sherpa-onnx engine
- Installed Dictation models that are no longer in the catalog now appear in the list with a Remove option

### Changed
- Dictation model rows now show the model name, supported languages, a live preview, and its source
- Lower idle memory use by stopping inactive sync and spell-check workers, unloading the Dictation model after use, and reducing idle WebKit and database resources
- Faster launch and smaller app size with screens loaded on first visit and an optimized release build
- Faster Book Editor opening by loading PDF and image export tools only when an export runs

### Fixed
- Restart now brings the main window back when Maibuk was started at login
- Saved Sync sessions are verified at launch so Auto Sync starts promptly instead of waiting for window focus or the keep-alive interval

## [0.19.0] - 2026-10-31

### Added
- Optional Resource Usage in Settings > Window, showing Maibuk's CPU, RAM, and storage use in the tray and Settings

### Changed
- The tray menu is now fully localized

### Fixed
- Native scrollbars and controls follow the dark theme, with consistent scrollbar styling across all scroll containers
- Shift+Tab no longer traps keyboard focus inside a Frame in Firefox
- Resource Usage only measures Maibuk's data and the approved Backup Directory
- Resource Usage no longer shows stale values after a quick off/on toggle

## [0.18.0] - 2026-10-30

### Added
- In-app updates on Linux and Windows, available from What's new and the Update Maibuk command
- Update badge with download progress, plus a percentage beside the download bar
- Windows update flow that downloads and verifies the installer, then offers Restart to update or Later
- Unified shutdown that flushes pending edits and waits for Backup and Sync before restarting or installing an update

### Changed
- Update download bar uses the New chip's amber styling and respects reduced motion
- Windows updates install in passive mode so the installer shows its own progress
- Choosing Later keeps the update on offer and closes What's new
- What's new can be reopened from the update badge during a download

### Fixed
- Update failures use the updater's actual error messages and provide clearer guidance for cancelled authentication and failed installs
- Restart now explains when the last edit cannot be saved and keeps the restart option available
- Retry is hidden for unrecoverable update failures
- Update Maibuk is hidden from the Command Palette when no update is possible
- Download percentage stays visible beside the progress bar instead of scrolling out of view

## [0.17.0] - 2026-10-29

### Added
- Reader Built-in Plugin for PDF, EPUB, MOBI, AZW3, FB2, and CBZ, with a cover-grid Shelf and File Grants for picked files
- Note Filter in the Notes list sidebar
- Continuous scroll for PDFs (toolbar toggle and Command), saved as pdfLayout
- Full-screen reading from the toolbar or F; Escape leaves full screen first
- Mouse-wheel paging at page edges, Ctrl+wheel zoom, and touch taps and swipes for paging
- Icon toolbar with tooltips and previous/next page buttons

### Changed
- Plugin modules are planned in a one-shot Worker, freeing WebAssembly memory
- Flowing text follows the live theme with no dark colours baked in at load
- On-demand plugins can opt out of warming via the warmStart "intent" manifest option
- Frames can request full screen from the host

### Fixed
- Plugin Directory watch ignored read events, fixing an endless reload loop
- PDF pages repaint correctly when shown again from their bitmap
- Relaunching onto the Reading page reopens the open Document
- Palette keeps focus when the last Command starts
- Current search match is highlighted and moves with Next and Previous
- File Grant release refuses unknown grants and reports write failures; 0-byte Documents no longer read a zero-length range
- Note Filter popover polish: tooltips, Tag list keyboard, badge, and label icons
- Note Filter focus after Clear, shortcut outside the editor, and Tab closing Tag lists

## [0.16.0] - 2026-10-24

### Added
- Library Search across the Library, with snippets, result counts, and indexing status
- Commands mode in the command palette, opened with `>` and Library Search without a prefix
- Match case, Whole word, and Regex options inside the Library Search field
- Opening a Library Search result at its first match in Find and Replace, or opening the note's Canvas from its card
- A `library.search` Plugin API method and an MCP `search_library` tool
- Release Notes in every app language, with fallback to the author's language for newer releases

### Changed
- The web Library runs on SQLite WASM over OPFS for more reliable storage and search
- Library Search and Find and Replace ignore accents

### Fixed
- The web Library loads the bundled sql.js WASM instead of a CDN, avoiding link errors
- The Tutorial Library opens correctly when EPUB export code is loaded
- The desktop Library opens with the FTS5 search index enabled
- Reset all in the Shortcut Editor returns focus to the search field
- Dragging a note while sorted no longer removes it from the sidebar
- A Library Search query entered during the index rebuild reruns when indexing completes
- Filtering by Book in plugin Library Search returns exact pages

## [0.15.2] - 2026-10-23

### Changed
- Startup screen uses the selected theme from the first frame, including a persisted boot theme snapshot and localized loading status
- Desktop window opens on the theme background instead of white

### Fixed
- Main window appears only after its page loads, with a fallback, preventing a white flash on WebKitGTK
- Embedded views apply their own theme on the first frame and stale entrance captures expire

## [0.15.1] - 2026-10-22

### Added
- Show a warning marker and reason for Stopped Plugins in the sidebar on desktop and mobile
- Add a Stopped Plugin panel with the reason, Try again, and Review in Settings actions
- Keep refused enabled Plugins’ saved sidebar entries marked for the next launch
- Show the time of day for notes edited today in sidebar rows, with the full edit date on hover and as the focused row description

### Changed
- Label the Link dialog’s internal targets as “In Maibuk” instead of “In this book”

### Fixed
- Prevent restored window focus from showing keyboard focus rings after Alt+Tab, taskbar clicks, or unminimizing when using the mouse
- Delete a Book’s or Chapter’s dependents together with it on every platform, including links, EPUB metadata, styles, metadata, assets, and chapters
- Prevent stale reads from reordering the Notes Gallery, Library, and Canvas galleries
- Show enabled Plugins’ sidebar entries in the first frame instead of waiting for launch sync or session checks

## [0.15.0] - 2026-10-22

### Changed
- Versions are stored as manifests over shared content, so unchanged Chapter and Cover text is saved once and Library size is reduced
- Version Retention is unified across devices and the sync server: the newest 10 Versions from the last day, the newest per UTC day for 14 days, and the newest per week for 8 weeks are kept, while Named, pre-restore and Plugin Versions are always retained
- Version Retention is applied before pulling during sync, and dropped Versions are tombstoned
- The storage upgrade runs on launch after a protected safety Backup, drops orphans and converts inline rows in batches; a failed safety Backup leaves data untouched and notifies the author
- The storage upgrade re-runs after Restore, Database File load, Reset or Tutorial completion
- Backups and Database Files remain self-contained in dump format 2; an older whole-Book row loaded over split data goes back to inline

### Fixed
- Pruned Checkpoints no longer return during sync

## [0.14.1] - 2026-10-21

### Fixed
- Keep sidebar row focus rings fully visible inside the scrolling destinations area
- Let sidebar keyboard navigation reach pinned destinations such as Metrics and Settings

## [0.14.0] - 2026-10-21

### Added
- Adds MCP Server as a built-in plugin with a dedicated page for agent snippets, key management, live connections, and a capped activity log
- Adds MCP tools for reading Books, Chapters, and Notes with filtering, paging, excerpts, windows, and format options
- Adds MCP tools for creating, editing, replacing, moving, and deleting Chapters and Notes, plus Book detail updates
- Adds MCP read-only mode and automatic Checkpoints before a connection’s first write to a Book
- Adds Plugin API support for Book, Chapter, and Note fields and writes, including Chapter reordering, Note Tags and filing, and plugin-created Checkpoints
- Adds the serve permission and Plugin Endpoint for plugins that receive HTTP requests
- Adds Plugin Endpoint address APIs so serve plugins can discover their URL and react when it changes

### Changed
- Keeps a stable Plugin Endpoint port across launches and moves it only when another app holds it
- Protects plugin and MCP writes from overwriting newer author edits
- Refines MCP Server page state for key regeneration, missing keys, connection durations, and activity timestamps

### Fixed
- Fixes MCP Server compatibility in opaque-origin sandbox environments
- Fixes Plugin Endpoint cleanup and response handling for abandoned requests and responses without bodies
- Keeps plugin-created Checkpoints from being pruned

## [0.13.2] - 2026-10-20

### Added
- Add a Spanish Opening Marks setting that inserts ¿ and ¡ around typed questions and exclamations
- Copy a picked Symbol from the Symbols dialog and access Insert and Copy actions from its Item Menu

### Fixed
- Prevent the placeholder from showing behind a dictation partial on an empty Chapter or Quick Note

## [0.13.1] - 2026-10-19

### Added
- Show each Plugin's version beside its name in Settings

### Changed
- Virtualize the Notes list, Notes tree, Gallery, and Chapter list to keep large libraries responsive
- Debounce editor serialization until typing settles for smoother WebKit typing
- Reduce command palette layout work when opening and typing
- Keep Chapter list resizing smoother on WebKit
- Rasterize the canvas watermark once per zoom for smoother panning on WebKit
- Shield the editor during keyboard Chapter reordering to avoid restyling stalls

### Fixed
- Prevent closing the editor context menu from stealing focus or closing a newly reopened menu
- Preserve keyboard navigation at Notes tree and Gallery edges when rows are virtualized
- Make Notes tree group headers focusable and toggleable with Enter, and restore inline rename focus
- Keep command palette touch rows at 44px so they cannot overlap
- Allow Chapter delete focus to reach off-screen neighbors
- Make drag-and-drop reorder targets and FLIP animations tolerate virtualized rows

## [0.13.0] - 2026-10-18

### Added
- Sort control for the Notes sidebar, shared with the Gallery, with Custom Order, A to Z, Z to A, and Last Edited (newest or oldest first)
- Arrow grip indicator so the Custom Order sort option reads as a sort
- Echo highlight colors assigned per Echo, using an adapted Okabe-Ito palette
- Palette dropdown for Echo highlights with Okabe-Ito, Vivid, and Soft palettes
- Persisted "Toggle echo highlights" switch that stays on across editors, restarts, and Plugin stops
- Toolbar icon for Echoes drawn from inline SVG elements
- Plugin manifest icons may use inline SVG elements on a 24x24 grid
- Plugin Select options may display up to 12 decorative swatch colors

### Changed
- Plugin API updated to 0.1.1, with Echoes declaring `^0.1.1` and version 0.2.0

### Fixed
- Pointer cursor now appears on Book, Note, and Canvas gallery cards, and Canvas cards deepen their shadow on hover instead of lifting
- Spelling context menu no longer crashes the app when suggestion items change
- Echoes highlights work before the caret is placed and in the Ephemeral editor
- Echo highlights toggle reliably on the first click after a cold start
- Echoes report rows always show the word, with a full-text tooltip on hover or keyboard focus

## [0.12.0] - 2026-10-17

### Added
- Plugin system: install, enable, and manage plugins from Settings, with filters, add, remove, reinstall, delete data, and per-plugin status
- Permission approval with pinned file hashes, a review step for changed files, and a development mode with watched reloads
- Plugin contributions across commands, pages, sidebar entries, Settings rows, toolbar buttons, and item menus
- Plugin API spanning Library reads and writes, focused-editor access and highlights, storage, navigation, notifications, network, secrets, clipboard, and language
- Host-rendered Remote UI component kit plus sandboxed Frames with live theme tokens and a custom-UI notice
- Echoes built-in plugin for finding repeated words and phrases, with a report page, editor highlights, and next/previous echo navigation
- Plugin execution on Android through a memory-capped QuickJS engine, opt-in per plugin through its manifest platforms
- Toggle Buttons for plugin toolbar controls, with pressed state reflecting plugin readiness
- Plugin template, authoring guide, and authoring Agent Skill for external plugin development

### Changed
- Built-in plugins now start disabled and pre-granted, with Echoes off by default
- Plugin Settings rows show header badges, an enable switch, localized names, and a permissions accordion
- Plugin sidebar entries sit after core destinations while Metrics and Settings stay pinned at the bottom
- Views refresh when rows change through plugin writes, imports, or version restores

### Fixed
- Android keeps the app alive and restarts it when the WebView renderer dies
- Linux login no longer shows a duplicate tray icon
- Settings reveals wait for a plugin row's control to mount before moving focus
- Echoes keeps its report within Remote UI limits and stays responsive on large books
- Plugin writes flush open editors first and refuse cleanly when a save fails

## [0.11.0] - 2026-10-09

### Added
- Link Preview shows where a link goes without following it when hovering or resting the caret on a link for 500 ms
- Link Preview includes note, chapter, heading, book, and web address targets with relevant details
- Right-click or long press on a link in a text node opens Edit Link
- Screen readers hear link targets through a polite live region

### Changed
- Link Preview loads snippets on demand and caches them until a change, library switch, or 30 seconds
- Link Preview hides the type icon for notes, chapters, headings, and books
- Edit Link shows the current target

### Fixed
- Typing [[ creates a standard link mark instead of an atom node, fixing text selection, right-click editing, and previews
- Selecting a link suggestion consumes the auto-closed ]] and typing ] closes the suggestion list
- Link suggestions read notes and books when opened, so items created after the editor opened appear
- Closing a dialog restores focus without scrolling the editor away from the link
- A click that ends a drag selection inside a link no longer follows it
- Link Preview icons align with the first line
- The link suggestion list scrolls to keep the active option visible

## [0.10.4] - 2026-10-08

### Added
- Dictation Bar size options (Hidden, Compact, Full) and a collapse caret that shrinks it to the microphone; Full remains the default
- Keyboard arrow navigation between widgets and panes, including position-based movement, edge exits, F6 pane entry, and a visible pane focus frame
- Keyboard-operable resize handles for every panel, with arrow-key resizing, spoken width, and touch dragging

### Changed
- Lists and card grids are now one Tab stop, with row or card buttons reached by arrow keys and edge exits
- Panel resize handles now update panel width live during pointer drag without re-rendering the whole screen
- Large list and gallery arrow navigation now avoids full row or card checks, keeping movement responsive

### Fixed
- Dictation bar settings button now opens the Dictation section instead of landing on the Editor section
- Pane focus ring now hides when typing, using the pointer, or pressing Escape until keyboard focus moves again
- Escape on a focused resize handle now returns focus to the previous control instead of falling through
- Notes list date groups now sort by most recently edited first
- Arrow navigation keeps outline headings inside their Chapter row, lets Left leave an open Settings section, and lands in the editor text instead of the font size control

## [0.10.3] - 2026-10-03

### Changed
- Improve Command Palette dialog opening performance by avoiding unrelated work
- Improve keyboard reordering performance in Chapter, Notes, and Toolbar Settings by parking text selections during drags

### Fixed
- Keep Command Palette Settings search targets visible and outline scrollbar stable when the Backup list loads
- Prevent Settings outline animation from flashing or snapping during fast scrolling and mid-change retargets
- Make Notes row buttons such as Edit, Duplicate, and Delete respond to Enter and Space instead of opening the note
- Make Notes tree view rows keyboard-accessible with Enter to open, Shift+F10 for the item menu, and focus return after rename
- Fix dictation so "new item" creates a checklist item and "scratch that" removes new line breaks without deleting the sentence above
- Keep the key that closes the last dialog from immediately triggering a Command

## [0.10.2] - 2026-10-02

### Added
- Release Notes dialog opened from the Release number in the sidebar and Settings → About, with newer published releases marked New and a download link when available
- `global.openReleaseNotes` command for the command palette and voice

### Changed
- Update checks now use published GitHub Releases instead of tags, so the New chip appears only after all platform builds are published
- Settings outline now animates smoothly between sections instead of snapping

### Fixed
- Restore tray windows on first activation on Linux, including hidden, minimized, and cold-start activations before the main window exists

## [0.10.1] - 2026-10-02

### Added
- Searchable section outline in Settings and a compact section menu on narrow panels

### Changed
- Unified Settings sections into a single card, title, and divider rhythm
- Improved Settings outline rendering performance while scrolling

### Fixed
- Anchored text and image menus to their trigger element
- Kept the app inert for the full tutorial run when it starts from a closing modal
- Made every footnote insert, edit, and delete its own undo step
- Added accessible expand controls to Settings outline sections
- Editor shortcuts and deletion keys now use the current caret position immediately after a caret move
- Pressing Escape right after extending a selection now preserves the last selection step

## [0.10.0] - 2026-10-01

### Added
- Command Palette reachable via F1 / Mod+Shift+P with ranked search across commands, books, chapters, notes, canvases, settings rows, nested pages, and recent choices
- Offline dictation on web and Linux desktop with English and Spanish models, a floating page control, and model management in Settings → Dictation
- Dictation Command Interpreter with voice commands for formatting and navigation, spoken punctuation, scratch that, numeral and all-caps modifiers, click by name, focus keys, and dictation handoff across navigation
- Dictation Vocabulary and per-language Spoken Punctuation settings for heard/written replacements and punctuation behavior
- Custom voice commands per Dictation language and a Shortcut Editor for assigning custom shortcuts to every Command
- Shared accessible color picker across Settings, editor, Canvas, and Cover Designer with contrast warnings and live preview
- Keyboard access to the selection toolbar via Alt+F10
- Edit and delete actions for footnotes in the Footnotes lists
- Chapter Status submenu in Chapter item menus
- Keyboard reordering for the Notes list
- Phrase recording by saying a phrase once in voice command fields
- Dictation into plain text fields, including native undo and password refusal
- Shortcut help displays current Voice Commands while Dictation is on

### Changed
- Full-width title bar in the Book Editor and Note editor
- Removed hover lift from Book and Note cards
- Raised minimum Android version from 7.0/7.1 to 8.0 (API 26)
- Restricted Library database access from the webview and hardened SQLite authorization for ATTACH, VACUUM INTO, and PRAGMAs
- Dictation settings now use one language tab group and a compact language picker

### Fixed
- Make Library database file loading, import, and backup restore all-or-nothing
- Recover from a failed Library open with an error message and Try again instead of an empty Library, and stop cascade deletes on desktop
- Keep the Reading Position stable while a freshly opened Chapter finishes loading images and node views
- Apply line height as a block setting that tightens list spacing and scales paragraph spacing after Enter
- Fix Note heading links that never scrolled to their target and report missing targets
- Restore Export button colors in dark mode
- Refuse to close a busy export dialog until generation and saving finish
- Keep shell live regions announced while a modal is open
- Recognize Spanish “pulsar tap” as Tab
- Show the dictation bar on the ephemeral page
- Let Escape stop dictation in the Book Editor
- Default new Books and Notes to the author’s app language or their Book’s language
- Improve keyboard focus restoration and Enter/default button behavior across dialogs, menus, toolbars, and forms

## [0.9.0] - 2026-09-25

### Added
- Add guided Tutorial in an in-memory Tutorial Library, offered on first launch and relaunched from Settings or keyboard
- Add bulk backup selection and deletion in Settings with confirmation and failure reporting
- Add touch-accessible item menus for notes, chapters, Notes gallery cards, and Canvas nodes via long-press, right-click, or ⋯ button
- Add Connect to… picker and selected-node ports for keyboard and touch Canvas connections
- Add Exit focus mode button on touch and Android back support

### Changed
- Change Backup directory field to show the effective default, commit on Enter or blur, revert on Escape, and open the picker at the current directory
- Change custom backup directory approval to native confirmation, store approvals outside webview-writable paths, and reject relative or ~ paths
- Change backup Date column to follow app language and use localized 12-hour time
- Change Book status dropdown to open from the status pill instead of the hover-only corner button
- Change note and chapter drags on touch to start only from the visible grip; long-press on the row body opens the item menu
- Change note deletion to ask for confirmation before removing
- Change Add divider below to an always-visible toolbar settings action
- Keep desktop hover actions unchanged and show touch-specific controls only on coarse pointers

### Fixed
- Fix custom backup directory so it works and persists across launches
- Fix item menus anchoring to visible notes and chapters and switching correctly on successive right-clicks
- Fix saved Canvas drawings not rendering in Chromium because of a 0×0 SVG
- Fix editor toolbar overflow to measure actual layout and no longer scroll prematurely
- Fix web route reloads so nested routes no longer open a blank page
- Fix Tutorial cards focusing the Next button so Enter or Space advance through steps

## [0.8.1] - 2026-09-16

### Changed
- No user-facing changes

## [0.8.0] - 2026-09-16

### Added
- Canvas sync as a synced item with its own sync scope and deletion review
- Help dialog that lists the keyboard shortcuts bound on the current screen, grouped by area

### Changed
- Manual sync now defaults to the current editor's scope
- Book Last Edited timestamps now change only for content or title edits, not pin, order, or status changes
- UI labels now align with the domain glossary in both English and Spanish

### Fixed
- On Android, deleting at the start of a task item now works with the soft keyboard
- Pending note and book edits are saved on unmount, failed saves are retried, and Save Status shows "Not saved" instead of losing changes
- Backups now include Canvases, and restoring a backup only replaces Canvases when the backup contains them
- Reset, Restore, and restore-failure warnings now accurately describe what is kept, replaced, or recoverable

## [0.7.1] - 2026-09-14

### Added
- Sync log now shows rejected writes

### Fixed
- Sync no longer re-creates notes or books deleted on another device

## [0.7.0] - 2026-09-12

### Added
- Automatic sync, enabled by default, runs at launch and 30 seconds after the last local edit when signed in and online

### Changed
- Sync now applies one-sided local or remote changes automatically and asks only when both sides changed
- Automatic sync defers conflicts and continues past pending deletion reviews
- Opening a book no longer counts as a local edit for sync

### Fixed
- Keep the sync session alive while the app runs, refreshing it periodically and on reconnect instead of forcing re-login
- Refresh the open book, chapter, or note in place after a sync pull instead of showing stale content or remounting the editor

## [0.6.2] - 2026-09-12

### Fixed
- Prevent the editor's saved badge from resetting to idle too early when saving again before the previous reset timer fires

## [0.6.1] - 2026-09-12

### Fixed
- clear the pending save-status reset on unmount so a stale timer no longer sets state on a torn-down editor

## [0.6.0] - 2026-09-12

### Changed
- Maintenance release.

## [0.5.3] - 2026-09-12

### Changed
- stop per-keystroke work that scales with chapter length (#160)

## [0.5.2] - 2026-09-07

### Fixed
- exit through the activity's finish() instead of process::exit (#155) (#158)
- guard the close-trigger backup with a 6-hour interval (#154) (#157)
- keep the daily backup off the startup path and stop copying the dump (#156)
- stop the startup OOM crash and the Back-button app kill (#152)

## [0.5.1] - 2026-09-07

### Added
- handle maibuk:// URLs from the OS (#147)

### Fixed
- keep mobile sync responsive and serialized (#148)

## [0.5.0] - 2026-08-13

### Added
- Add Android app with signed APK builds and mobile-specific support for full-page safe areas, hardware back handling, background data flushing, cover layer controls, and file/image handling
- Add book archiving as a fourth status with gallery status filtering
- Add persisted gallery filters and search across visits for notes, canvas, and books
- Add exclude-tag note filter
- Add accessible canvas text and background color controls with contrast-checked presets and custom colors
- Add larger canvas text nodes that are selected on creation

### Changed
- Replace the book card archive button with a status dropdown to set draft, in-progress, completed, or archived directly from the gallery, with restored books returning to draft
- Hide desktop-only settings and keyboard shortcut hints on mobile and Android
- Improve mobile and Android responsive layouts and safe-area handling, including full-page editors and bottom bars

### Fixed
- Fix Android system bar overlap, duplicate page scrolling, and duplicate mobile back actions
- Fix notes filter panel overflow and keep the filters button next to the search box on narrow panels
- Improve Android image clipboard and content URI handling, touch resizing, and canvas toolbar touch targets

## [0.4.20] - 2026-07-18

### Added
- Drag-and-drop import for Markdown files to create notes and chapters, with positional insertion indicators and real-time feedback
- Justify text alignment button in the editor toolbar with Ctrl+Shift+J shortcut

### Fixed
- Long chapter titles overflowing horizontally and hiding action buttons
- Duplicate file drop indicators in the editor
- Drag-and-drop reordering not working after clearing the chapter list
- Chapter action buttons shrinking titles when overlaying

## [0.4.19] - 2026-07-17

### Added
- Opt-in autoclose pairs for brackets and quotes in the editor
- Colon-triggered emoji autocomplete in the editor
- Symbols dialog (Ctrl+Shift+O) with search, recents, and tooltips for inserting Unicode and emoji
- Manual dictionary lookup (Ctrl+Shift+D), with a prompt when no text is selected

### Fixed
- Confirm canvas deletion with an in-app dialog instead of an unreliable browser prompt
- Editor toolbar shortcut help now correctly lists available shortcuts when opened

## [0.4.18] - 2026-07-16

### Added
- Session-only scratch editor with in-memory storage, accessible via the navigation and `g e` shortcut, with clear and create-note actions

### Fixed
- Caret jumping in the editor when stale content echoes conflicted with recent typing

## [0.4.17] - 2026-07-15

### Added
- Keyboard navigation for all core app surfaces including dialogs, menus, sidebars, and editor controls
- Text transformation modes: horizontal mirror, upside-down, reverse, and leetspeak, preserving text formatting

### Changed
- Replaced Headless UI component library with React Aria for improved accessibility and consistency

### Fixed
- Typing after an inline code span now exits the code properly without inserting an extra space
- Multi-line selections toggled as code block now merge into a single block instead of separate ones
- Editor caret no longer jumps to the document start when content saves with auto-assigned heading IDs
- Removed an incorrect page border shadow that appeared in some editor layouts
- Sidebar navigation now activates on a single click instead of requiring a double-click
- Chapter outline appears directly below its active chapter and supports navigation with arrow keys
- Removed invalid ARIA attributes and improved focus management for assistive technology

## [0.4.16] - 2026-07-12

### Added
- Toolbar tooltips now show formatting keyboard shortcuts and markdown syntax hints, with hints highlighted in a code style

### Changed
- The editor toolbar is now customizable: groups can be reordered via drag-and-drop or keyboard, and a settings dialog lets you choose which controls to show. The toolbar layout is responsive, automatically collapsing controls into an overflow menu and wrapping expanded groups

## [0.4.15] - 2026-07-06

### Added
- Custom tooltips with keyboard shortcut keycap chips throughout the editor, canvas, notes, and settings
- Desktop window state persistence (size, position, and maximized) across sessions
- Tray icon now indicates sync-in-progress status

### Changed
- Help dialog now displays keyboard shortcuts as keycap chips, consistent with tooltips

### Fixed
- Sequential shortcut chips no longer have an arrow separator (e.g., "G N" renders as two adjacent keycaps)

## [0.4.14] - 2026-06-28

### Added
- Add a keyboard shortcuts help dialog, accessible via a new button in the editor toolbar, that lists all active shortcuts for the current route
- Add infinite canvas workspace (mind maps) with rich text nodes, freehand drawing, node connections, and a collapsible tool panel
- Add editor page padding control to adjust the writable area width, with simple and custom input modes
- Add inline code block language selection; syntax highlighting is now disabled by default until a language is chosen

### Changed
- Update tag chips to use dynamic colors and subtle borders for clearer visual distinction

## [0.4.13] - 2026-06-24

### Added
- Document spellcheck language selector in the editor
- Sort-by dropdown in the notes gallery (by date or title; preference saved)
- Adjustable editor content width with presets, slider, and side borders
- Paste cleanup rule creation from selected text in the HTML source view

### Changed
- Notes now use a separate content-modified timestamp; organizing actions like tagging or pinning no longer update the note's modified date
- Paste cleanup rule values are edited in an auto-growing textarea, and the target preview tooltip was removed to prevent overflow

## [0.4.12] - 2026-06-22

### Added
- Syntax highlighting for code blocks in the editor using lowlight
- Reworked notes layout

### Changed
- Improved editor paste and Markdown typing behavior

### Fixed
- System theme cycle now respects the OS color scheme

> Older releases are listed on the [GitHub Releases](https://github.com/M4ss1ck/maibuk/releases) page.
