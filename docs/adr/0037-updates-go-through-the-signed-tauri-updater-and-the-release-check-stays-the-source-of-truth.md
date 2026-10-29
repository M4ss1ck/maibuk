---
status: accepted
---

# Updates go through the signed Tauri updater for the formats it owns, and the Release check stays the source of truth

An Update installs a newer Release through `tauri-plugin-updater` (2.10 or later) for the AppImage, deb, rpm, and Windows NSIS builds. The Arch package never updates in place: pacman owns its files, so its build clears the bundle-type marker, and the app sends any install with no known bundle type to the Download Page. The existing Release check, which reads the GitHub Releases API, still decides whether a newer Release exists and still feeds What's new and the New chip. The updater's own `latest.json` is read only when the author clicks Update. When the file is missing, has no entry for this install's format, or fails its signature, the author gets the Download Page, never a half-installed Release.

The author starts every Update, because an AppImage weighs over 100 MB and some authors are on metered links. On Linux the package installs as soon as it has downloaded, and deb and rpm ask for the admin password right then, so the author can restart now or keep writing on the old Release until the next launch. On Windows the installer quits the app, so the download waits for "Restart to update", and "Later" throws the download away. Restart, Restart to update, and closing the window all go through one shutdown routine, which Flushes the Edit Session and waits briefly for a running Backup or Sync before the process exits.

## Considered Options

- Let the updater's `latest.json` drive the New chip too: rejected. Two feeds could disagree, and the Releases API already carries the localized Release Notes (ADR 0034) and skips drafts.
- Download as soon as a newer Release is found: rejected, for the metered links above.
- Let Arch installs update through the deb path: rejected. `dpkg -i` or `rpm -U` against a pacman-owned tree would break the install.
- Download on Linux and install at restart, to delay the password prompt: rejected. The download lives only in memory, so "Later" would lose it on quit.

## Consequences

- The updater's public key is built into every install. Losing the private key (the `TAURI_SIGNING_PRIVATE_KEY` GitHub secret and its password, also kept in Andy's password manager) means no existing install can ever Update again. Those installs would have to reinstall by hand from the Download Page.
- Installs older than the first Release that ships the updater reach it through the Download Page one last time.
- Debug builds read `MAIBUK_UPDATER_ENDPOINT` so a local `latest.json` can be tested. Release builds compile that override out.
