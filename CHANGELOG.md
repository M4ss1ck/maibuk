# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
## [0.4.12] - 2026-06-22

### Added
- Syntax highlighting for code blocks in the editor using lowlight
- Reworked notes layout

### Changed
- Improved editor paste and Markdown typing behavior

### Fixed
- System theme cycle now respects the OS color scheme

> Older releases are listed on the [GitHub Releases](https://github.com/M4ss1ck/maibuk/releases) page.
