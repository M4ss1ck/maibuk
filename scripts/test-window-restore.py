#!/usr/bin/python3
"""Opt-in X11 integration regression: one native activation must restore focus.

Requires system PyGObject, libX11, wmctrl, xprop, xwininfo, and a tray host.
Uses an empty temporary Library and refuses to run alongside an existing app.
"""
import argparse
import ctypes
from contextlib import contextmanager
import errno
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time

NAME = "org.com_massick_maibuk.SingleInstance"
DBUS = "org.freedesktop.DBus"
WATCHER = "org.kde.StatusNotifierWatcher"


def command(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL, timeout=5).strip()


def wait(check, seconds=5):
    deadline = time.monotonic() + seconds
    while True:
        result = check()
        if result:
            return result
        if time.monotonic() >= deadline:
            raise AssertionError("condition did not settle before deadline")
        time.sleep(0.05)


def windows(pid):
    try:
        managed = command("wmctrl", "-lp")
    except subprocess.CalledProcessError:
        return []
    return [row.split()[0] for row in managed.splitlines()
            if int(row.split()[2]) == pid]


def active():
    match = re.search(r"window id # (0x[0-9a-fA-F]+)", command("xprop", "-root", "_NET_ACTIVE_WINDOW"))
    return int(match[1], 16) if match else 0


def state(xid):
    props = command("xprop", "-id", xid, "_NET_WM_STATE", "WM_STATE")
    return {"visible": "IsViewable" in command("xwininfo", "-id", xid),
            "focused": active() == int(xid, 16),
            "above": "_NET_WM_STATE_ABOVE" in props,
            "iconic": "Iconic" in props}


def seed(root, enabled):
    env = os.environ.copy()
    for key, name in (("XDG_DATA_HOME", "data"), ("XDG_CONFIG_HOME", "config"), ("XDG_CACHE_HOME", "cache")):
        directory = root / name
        directory.mkdir()
        env[key] = str(directory)
    path = root / "data/com.massick.maibuk/localstorage/tauri_localhost_0.localstorage"
    path.parent.mkdir(parents=True)
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB NOT NULL ON CONFLICT FAIL)")
        stores = {"maibuk-settings": {"state": {"alwaysOnTop": enabled, "closeToTray": True}, "version": 0},
                  "maibuk-tutorial": {"state": {"progress": {"dismissedAt": 1}}, "version": 1}}
        for key, value in stores.items():
            db.execute("INSERT INTO ItemTable VALUES (?,?)", (key, json.dumps(value).encode("utf-16-le")))
    return env


def stop(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


@contextmanager
def temporary_library():
    directory = tempfile.TemporaryDirectory(prefix="maibuk-window-restore-")
    try:
        yield directory.name
    finally:
        # WebKit children can finish a cache write just after their app exits.
        deadline = time.monotonic() + 5
        while True:
            try:
                directory.cleanup()
                break
            except OSError as error:
                if error.errno != errno.ENOTEMPTY or time.monotonic() >= deadline:
                    raise
                time.sleep(0.05)


def positive(raw):
    value = int(raw)
    if value < 1:
        raise argparse.ArgumentTypeError("must be positive")
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", required=True, type=Path)
    parser.add_argument("--rounds", type=positive, default=3)
    parser.add_argument("--startup", action="store_true", help="test early activation of a cold --minimized launch")
    parser.add_argument("--output", type=Path, help="JSONL evidence file")
    args = parser.parse_args()
    binary = str(args.binary.resolve())
    if not os.access(binary, os.X_OK):
        parser.error("binary must be an executable file")
    for tool in ("wmctrl", "xprop", "xwininfo"):
        if not shutil.which(tool):
            parser.error(f"missing {tool}")
    if not os.environ.get("DISPLAY") or os.environ.get("XDG_SESSION_TYPE") == "wayland":
        parser.error("requires an X11 desktop session")

    # Initialise only after argument parsing; --help needs no desktop services.
    from gi.repository import Gio, GLib
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)

    def call(dest, path, interface, method, signature=None, values=()):
        params = GLib.Variant(signature, values) if signature else None
        return bus.call_sync(dest, path, interface, method, params, None,
                             Gio.DBusCallFlags.NONE, 3000, None).unpack()

    def owner():
        return call(DBUS, "/org/freedesktop/DBus", DBUS, "NameHasOwner", "(s)", (NAME,))[0]

    if owner():
        parser.error("Maibuk is already running; close it before this opt-in test")
    original = active()
    if not original:
        parser.error("requires another focused desktop window as a control")

    lib = ctypes.CDLL("libX11.so.6")
    lib.XOpenDisplay.argtypes = [ctypes.c_char_p]
    lib.XOpenDisplay.restype = ctypes.c_void_p
    lib.XDefaultScreen.argtypes = [ctypes.c_void_p]
    lib.XDefaultScreen.restype = ctypes.c_int
    lib.XIconifyWindow.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int]
    lib.XFlush.argtypes = [ctypes.c_void_p]
    lib.XCloseDisplay.argtypes = [ctypes.c_void_p]
    display = lib.XOpenDisplay(None)
    if not display:
        parser.error("cannot open X11 display")
    output = args.output.open("w") if args.output else None
    rows = []

    def emit(row):
        encoded = json.dumps(row)
        print(encoded, flush=True)
        if output:
            output.write(encoded + "\n")
            output.flush()

    def tray(pid):
        items = call(WATCHER, "/StatusNotifierWatcher", "org.freedesktop.DBus.Properties",
                     "Get", "(ss)", (WATCHER, "RegisteredStatusNotifierItems"))[0]
        for item in items:
            dest, separator, suffix = item.partition("/")
            if call(DBUS, "/org/freedesktop/DBus", DBUS, "GetConnectionUnixProcessID", "(s)", (dest,))[0] != pid:
                continue
            path = "/" + suffix if separator else "/StatusNotifierItem"
            menu = call(dest, path, "org.freedesktop.DBus.Properties", "Get", "(ss)",
                        ("org.kde.StatusNotifierItem", "Menu"))[0]
            layout = call(dest, menu, "com.canonical.dbusmenu", "GetLayout", "(iias)", (0, -1, []))[1]
            show = next(node[0] for node in layout[2] if node[1].get("label") == "Show Maibuk")
            return dest, menu, show
        return None

    try:
        with temporary_library() as temp:
            if args.startup:
                # Independent no-activation controls prove --minimized is
                # honored without delaying the race fixtures' early trigger.
                for enabled in (True, False):
                    root = Path(temp) / f"control-{enabled}"
                    root.mkdir()
                    env = seed(root, enabled)
                    with (root / "app.log").open("w") as log:
                        control = subprocess.Popen([binary, "--minimized"], env=env,
                                                   stdout=log, stderr=log)
                    try:
                        wait(lambda: tray(control.pid), 30)
                        time.sleep(3)
                        owned = windows(control.pid)
                        hidden = all(not state(xid)["visible"] for xid in owned)
                        row = {"always_on_top": enabled, "initial": "cold-minimized",
                               "trigger": "none", "visible_windows": len(owned),
                               "passed": hidden and control.poll() is None}
                        rows.append(row)
                        emit(row)
                        assert row["passed"], "--minimized control was visible or exited"
                    finally:
                        stop(control)
                    wait(lambda: not owner())
            fixtures = [(enabled, n) for enabled in (True, False)
                        for n in range(args.rounds if args.startup else 1)]
            for enabled, fixture in fixtures:
                if owner():
                    raise AssertionError("another app instance appeared between fixtures")
                root = Path(temp) / f"{enabled}-{fixture}"
                root.mkdir()
                env = seed(root, enabled)
                with (root / "app.log").open("w") as log:
                    process = subprocess.Popen([binary] + (["--minimized"] if args.startup else []),
                                               env=env, stdout=log, stderr=log)
                try:
                    if args.startup:
                        # Call the real single-instance handler as soon as it
                        # owns its bus name, before waiting for the main window.
                        deadline = time.monotonic() + 30
                        while not owner():
                            assert process.poll() is None and time.monotonic() < deadline
                            time.sleep(0.001)
                        assert call(DBUS, "/org/freedesktop/DBus", DBUS, "GetConnectionUnixProcessID",
                                    "(s)", (NAME,))[0] == process.pid
                        before = windows(process.pid)
                        pre_trigger_hidden = all(not state(xid)["visible"] for xid in before)
                        call(NAME, "/org/com_massick_maibuk/SingleInstance", "org.SingleInstance.DBus",
                             "ExecuteCallback", "(ass)", ([binary], str(root)))
                        start = time.monotonic()
                        observed = {"visible": False, "focused": False, "above": False, "iconic": False}
                        expected = {"visible": True, "focused": True, "above": enabled, "iconic": False}
                        while time.monotonic() - start < 2:
                            owned = windows(process.pid)
                            if owned:
                                observed = state(owned[0])
                                if observed == expected:
                                    break
                            time.sleep(0.05)
                        alive = process.poll() is None
                        owned = windows(process.pid)
                        passed = (pre_trigger_hidden and alive and len(owned) == 1
                                  and observed == expected and state(owned[0]) == expected)
                        row = {"always_on_top": enabled, "round": fixture + 1,
                               "initial": "cold-minimized", "trigger": "single-instance",
                               "pre_trigger_hidden": pre_trigger_hidden,
                               "pre_trigger_windows": len(before), "process_alive": alive,
                               "window_count": len(owned), "observed": observed, "passed": passed,
                               "elapsed_ms": round((time.monotonic() - start) * 1000)}
                        rows.append(row)
                        emit(row)
                        continue
                    xid = wait(lambda: windows(process.pid), 30)[0]
                    wait(lambda: call(DBUS, "/org/freedesktop/DBus", DBUS, "GetConnectionUnixProcessID",
                                      "(s)", (NAME,))[0] == process.pid)
                    dest, menu, show = wait(lambda: tray(process.pid), 15)
                    # Above proves the true preference and frontend init ran.
                    # Allow the false fixture's close-handler import to finish.
                    time.sleep(3)
                    wait(lambda: state(xid)["above"] == enabled)
                    for round_no in range(1, args.rounds + 1):
                        for initial in ("hidden", "minimized"):
                            for trigger in ("tray", "launcher"):
                                command("wmctrl", "-ia", hex(original))
                                wait(lambda: active() == original)
                                if initial == "hidden":
                                    command("wmctrl", "-ic", xid)
                                    wait(lambda: not state(xid)["visible"])
                                    assert process.poll() is None, "close exited instead of hiding to tray"
                                else:
                                    assert lib.XIconifyWindow(display, int(xid, 16), lib.XDefaultScreen(display)) != 0
                                    lib.XFlush(display)
                                    wait(lambda: state(xid)["iconic"])
                                start = time.monotonic()
                                if trigger == "tray":
                                    call(dest, menu, "com.canonical.dbusmenu", "Event", "(isvu)",
                                         (show, "clicked", GLib.Variant("s", ""), 0))
                                else:
                                    launch = subprocess.Popen([binary], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                                    try:
                                        assert launch.wait(timeout=10) == 0
                                    finally:
                                        stop(launch)
                                observed = {}
                                expected = {"visible": True, "focused": True, "above": enabled, "iconic": False}
                                while True:
                                    observed = state(xid)
                                    if observed == expected or time.monotonic() - start >= 2:
                                        break
                                    time.sleep(0.05)
                                passed = observed == expected and process.poll() is None and windows(process.pid) == [xid]
                                row = {"always_on_top": enabled, "round": round_no, "initial": initial,
                                       "trigger": trigger, "observed": observed, "passed": passed,
                                       "elapsed_ms": round((time.monotonic() - start) * 1000)}
                                rows.append(row)
                                emit(row)
                                if not passed:
                                    # Recovery happens AFTER the recorded assertion.
                                    command("wmctrl", "-ia", xid)
                                    wait(lambda: state(xid)["visible"] and not state(xid)["iconic"])
                finally:
                    stop(process)
                wait(lambda: not owner())
    finally:
        lib.XCloseDisplay(display)
        try:
            command("wmctrl", "-ia", hex(original))
        finally:
            if output:
                output.close()
    failed = sum(not row["passed"] for row in rows)
    print(json.dumps({"cases": len(rows), "failed": failed}), flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, OSError, subprocess.SubprocessError) as error:
        print(json.dumps({"error": str(error), "passed": False}), file=sys.stderr)
        raise SystemExit(2)
