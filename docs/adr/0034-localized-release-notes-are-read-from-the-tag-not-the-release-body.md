---
status: accepted
---

# Localized Release Notes are read from the tag, not the Release body

Release Notes are written in English and translated one to one into every app language, one changelog file per language (`CHANGELOG.md`, `CHANGELOG.<locale>.md`). The GitHub Release body stays English only. For a Release newer than the installed build, the app reads its language's notes from that language's changelog file at the newest Release's tag, and shows the English body when that file or Release is missing or the request fails.

The body cannot carry translations because every shipped app parses it: through 0.15.2, one line outside the Keep a Changelog grammar sends the whole body to the plain-item fallback, so a translated block shows as raw `<details>` and `<summary>` lines in What's new on every install that has not updated yet, and the noise grows with each language.

## Considered Options

- One collapsed `<details lang="…">` block per language in the body: rejected for the reason above, though it was the first choice and would have shown the translations on the GitHub Release page.
- One Release asset per language: rejected. Asset downloads redirect off api.github.com, and whether that hop allows cross-origin reads from the app was never verified.

## Consequences

- The GitHub Release page shows no translation; translated notes are in the changelog files in the repo.
- Every Release must ship every language: there is no English-only release override, since a missing translation fails the parity guard on main.
