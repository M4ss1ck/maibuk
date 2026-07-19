# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
