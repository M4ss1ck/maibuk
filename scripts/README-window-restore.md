# Native window restore regression

`test-window-restore.py` is an opt-in Linux X11 integration test. It launches
the supplied Maibuk binary with an empty temporary Library and settings,
then restores its window exactly once through each native activation path.
It never copies the author's Library, settings, or Sync credentials.

Run it from a desktop session with another window focused. Maibuk must be
closed first: the test refuses to run while its single-instance D-Bus name
is owned. Requirements are `/usr/bin/python3` with system PyGObject
(`Gio` and `GLib`), `libX11`, `wmctrl`, `xprop`, `xwininfo`, and an X11
window manager with a StatusNotifierItem tray host. Cinnamon on X11 is the
verified desktop. Wayland is outside this test's scope.

The binary can come from an unpacked .deb; it does not need to be installed.
Supply that binary's path with `--binary`. `--rounds` defaults to three and
must be positive; `--output` writes the case measurements as JSONL. Use
`/usr/bin/python3 scripts/test-window-restore.py --help` for the full syntax.

`--startup` runs a separate cold-start lane. Each fixture starts the binary
with `--minimized` and invokes its real single-instance D-Bus handler as soon
as the bus name is owned, before waiting for the main window or tray. It must
become visible and focused with the correct Above state after that one request.
This lane first runs a no-activation control for each preference to prove
`--minimized` stays hidden. Race fixtures record their pre-trigger hidden state
and require a live process with exactly one restored window. They use fresh
processes for every round and each preference.

For both Always on Top preferences, each round covers:

| Initial state | Restore action |
| --- | --- |
| Hidden by the real close-to-tray handler | Tray menu Show Maibuk |
| Hidden by the real close-to-tray handler | Launch the same binary again |
| Minimized by the window manager | Tray menu Show Maibuk |
| Minimized by the window manager | Launch the same binary again |

The test measures visibility, focus, Above, and minimized state through X11.
Success requires the same process and window to be visible, focused, no longer
minimized, and Above only when the preference is enabled, within two seconds.
There is no second click or window-manager activation before the assertion.
Recovery for a failed case happens only after the result has been recorded.
The test terminates only processes it created and restores the original focus.

This is a native integration lane, not a fast pre-commit gate. It moves desktop
focus; avoid interacting with the desktop during the run. Its tray trigger
invokes the real menu handler through D-Bus, but does not synthesize a physical
panel click. Startup, D-Bus calls, native commands, and cleanup have deadlines.
An assertion failure or unavailable prerequisite returns a nonzero exit code.

The regression catches the Linux ordering defect in Tao: `show()` queues a GTK
visibility change, while `set_focus()` can skip a still-hidden or minimized
window. The app restores through GTK on its main thread so showing and
unminimizing precede presentation. X11 presentation uses a fresh server timestamp
instead of the window's stale input time. Both tray and launcher paths use the
same restore function; Windows and macOS retain Tauri's native operations.
An activation received before Tauri registers the main window is retained and
replayed at the end of startup setup, including when autostart uses `--minimized`.

On Cinnamon, the old 0.10.1 .deb fails this test. The repaired .deb passed all
24 cases at three rounds, including Always on Top disabled. The ordinary
frontend window tests mock native events and cannot prove this behavior.
The cold-start lane also passed six activation fixtures and two hidden controls; without the startup handoff,
early activations left the window hidden in both preference fixtures.
