// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DESKTOP_PREREQUISITES,
  type DesktopBuildStamp,
  desktopBuildDecision,
  displayServer,
  findExecutable,
  missingPrerequisiteMessage,
  stampMismatch,
} from "@/test/support/frames/desktop";

const files = (...paths: string[]) => {
  const set = new Set(paths);
  return (path: string) => set.has(path);
};

describe("findExecutable()", () => {
  const base = { home: "/home/a", env: {} as Record<string, string | undefined> };

  it("prefers the env var's exact path when it names a file", () => {
    expect(
      findExecutable("tauri-driver", {
        ...base,
        envVar: "TAURI_DRIVER",
        env: { TAURI_DRIVER: "/opt/td", PATH: "/usr/bin" },
        isFile: files("/opt/td", "/usr/bin/tauri-driver"),
      })
    ).toBe("/opt/td");
  });

  it("skips an env var that names no file and falls through to PATH", () => {
    expect(
      findExecutable("tauri-driver", {
        ...base,
        envVar: "TAURI_DRIVER",
        env: { TAURI_DRIVER: "/missing", PATH: "/usr/bin" },
        isFile: files("/usr/bin/tauri-driver"),
      })
    ).toBe("/usr/bin/tauri-driver");
  });

  it("returns the first PATH directory holding the file, ignoring empty entries", () => {
    expect(
      findExecutable("WebKitWebDriver", {
        ...base,
        envVar: "WEBKIT_WEBDRIVER",
        env: { PATH: "::/first:/second" },
        isFile: files("/first/WebKitWebDriver", "/second/WebKitWebDriver"),
      })
    ).toBe("/first/WebKitWebDriver");
  });

  it("falls back to ~/.cargo/bin when env and PATH miss", () => {
    expect(
      findExecutable("tauri-driver", {
        ...base,
        envVar: "TAURI_DRIVER",
        env: { PATH: "/usr/bin" },
        isFile: files("/home/a/.cargo/bin/tauri-driver"),
      })
    ).toBe("/home/a/.cargo/bin/tauri-driver");
  });

  it("returns null when nothing holds the file, and tolerates an unset PATH", () => {
    expect(
      findExecutable("tauri-driver", {
        ...base,
        envVar: "TAURI_DRIVER",
        env: {},
        isFile: files(),
      })
    ).toBeNull();
  });

  it("skips PATH entries whose candidate is not a file", () => {
    // isFile is the only judge: a PATH entry the predicate rejects is skipped.
    expect(
      findExecutable("tauri-driver", {
        ...base,
        envVar: "TAURI_DRIVER",
        env: { PATH: "/usr/bin:/bin" },
        isFile: files("/bin/tauri-driver"),
      })
    ).toBe("/bin/tauri-driver");
  });
});

describe("DESKTOP_PREREQUISITES", () => {
  it("names tauri-driver and WebKitWebDriver with their env vars and install commands", () => {
    expect(DESKTOP_PREREQUISITES).toEqual([
      {
        name: "tauri-driver",
        envVar: "TAURI_DRIVER",
        install: "cargo install tauri-driver --locked",
      },
      {
        name: "WebKitWebDriver",
        envVar: "WEBKIT_WEBDRIVER",
        install: "sudo apt install webkit2gtk-driver",
      },
    ]);
  });
});

describe("missingPrerequisiteMessage()", () => {
  it("names the search order and the install command", () => {
    expect(missingPrerequisiteMessage(DESKTOP_PREREQUISITES[0])).toBe(
      "tauri-driver not found (looked in $TAURI_DRIVER, PATH, ~/.cargo/bin): install it with `cargo install tauri-driver --locked`"
    );
  });

  it("uses each prerequisite's own env var and install line", () => {
    expect(
      missingPrerequisiteMessage({
        name: "WebKitWebDriver",
        envVar: "WEBKIT_WEBDRIVER",
        install: "sudo apt install webkit2gtk-driver",
      })
    ).toBe(
      "WebKitWebDriver not found (looked in $WEBKIT_WEBDRIVER, PATH, ~/.cargo/bin): install it with `sudo apt install webkit2gtk-driver`"
    );
  });
});

describe("stampMismatch()", () => {
  const expected: DesktopBuildStamp = {
    lane: "frames",
    profile: "release",
    frontendFlags: { VITE_E2E: "1" },
    commit: "abc1234",
    binarySize: 1000,
    binaryMtimeMs: 1700000000000,
  };
  const matching = (): DesktopBuildStamp => ({
    ...expected,
    frontendFlags: { ...expected.frontendFlags },
  });

  it("returns null when every field matches", () => {
    expect(stampMismatch(matching(), expected)).toBeNull();
  });

  it("reports a missing or malformed stamp as no stamp", () => {
    expect(stampMismatch(undefined, expected)).toBe("no stamp");
    expect(stampMismatch(null, expected)).toBe("no stamp");
    expect(stampMismatch("frames", expected)).toBe("no stamp");
    expect(stampMismatch({ ...matching(), binarySize: "1000" }, expected)).toBe("no stamp");
    expect(stampMismatch({ ...matching(), frontendFlags: { VITE_E2E: 1 } }, expected)).toBe(
      "no stamp"
    );
    expect(stampMismatch({ ...matching(), frontendFlags: null }, expected)).toBe("no stamp");
  });

  it("reports a stamp from another lane", () => {
    expect(stampMismatch({ ...matching(), lane: "plugins" }, expected)).toBe(
      "built by another lane"
    );
  });

  it("reports a build from another profile", () => {
    expect(stampMismatch({ ...matching(), profile: "debug" }, expected)).toBe(
      "built with the debug profile, expected release"
    );
  });

  it("reports a commit change with both commits", () => {
    expect(stampMismatch({ ...matching(), commit: "def5678" }, expected)).toBe(
      "built at commit def5678, now abc1234"
    );
  });

  it("reports frontend flags that differ in value, extra key, or missing key", () => {
    expect(stampMismatch({ ...matching(), frontendFlags: { VITE_E2E: "0" } }, expected)).toBe(
      "frontend flags differ"
    );
    expect(
      stampMismatch(
        { ...matching(), frontendFlags: { VITE_E2E: "1", VITE_PLUGIN_BENCH_DRIVER: "1" } },
        expected
      )
    ).toBe("frontend flags differ");
    expect(stampMismatch({ ...matching(), frontendFlags: {} }, expected)).toBe(
      "frontend flags differ"
    );
  });

  it("reports a binary whose size or mtime changed as rebuilt by another lane", () => {
    const rebuilt = "the binary changed since the frame lane built it (another lane rebuilt it)";
    expect(stampMismatch({ ...matching(), binarySize: 999 }, expected)).toBe(rebuilt);
    expect(stampMismatch({ ...matching(), binaryMtimeMs: 1 }, expected)).toBe(rebuilt);
  });

  it("checks lane before commit before flags before binary", () => {
    expect(
      stampMismatch({ ...matching(), lane: "plugins", commit: "x", binarySize: 1 }, expected)
    ).toBe("built by another lane");
    expect(stampMismatch({ ...matching(), commit: "x", binarySize: 1 }, expected)).toBe(
      "built at commit x, now abc1234"
    );
  });
});

describe("displayServer()", () => {
  it("prefers XDG_SESSION_TYPE when the session sets it", () => {
    expect(displayServer({ XDG_SESSION_TYPE: "wayland", DISPLAY: ":0" })).toBe("wayland");
    expect(displayServer({ XDG_SESSION_TYPE: "x11", WAYLAND_DISPLAY: "wayland-0" })).toBe("x11");
  });

  it("reads WAYLAND_DISPLAY, then DISPLAY, when the session type is unset", () => {
    expect(displayServer({ WAYLAND_DISPLAY: "wayland-0", DISPLAY: ":0" })).toBe("wayland");
    expect(displayServer({ DISPLAY: ":0" })).toBe("x11");
  });

  it("returns none when no display variable is set", () => {
    expect(displayServer({})).toBe("none");
    expect(displayServer({ XDG_SESSION_TYPE: "", DISPLAY: "" })).toBe("none");
  });
});

describe("desktopBuildDecision()", () => {
  const expected: DesktopBuildStamp = {
    lane: "frames",
    profile: "release",
    frontendFlags: {},
    commit: "abc123",
    binarySize: 100,
    binaryMtimeMs: 1000,
  };
  const matching = { ...expected };

  it("reuses a binary whose stamp matches", () => {
    expect(desktopBuildDecision(true, true, matching, expected)).toEqual({
      build: false,
      reason: "reusing",
    });
  });

  it("builds with the mismatch reason when the stamp no longer matches", () => {
    expect(desktopBuildDecision(true, true, { ...matching, commit: "def456" }, expected)).toEqual({
      build: true,
      reason: "built at commit def456, now abc123",
    });
  });

  it("builds when the binary changed under another lane's rebuild", () => {
    expect(
      desktopBuildDecision(true, true, { ...matching, binaryMtimeMs: 2000 }, expected)
    ).toEqual({
      build: true,
      reason: "the binary changed since the frame lane built it (another lane rebuilt it)",
    });
  });

  it("builds without a stamp when reuse is requested", () => {
    expect(desktopBuildDecision(true, true, undefined, expected)).toEqual({
      build: true,
      reason: "no stamp",
    });
  });

  it("builds without reuse, whatever the stamp says", () => {
    expect(desktopBuildDecision(false, true, matching, expected)).toEqual({
      build: true,
      reason: "no --reuse-build",
    });
  });

  it("builds when there is no binary, even with reuse and a matching stamp", () => {
    expect(desktopBuildDecision(true, false, matching, expected)).toEqual({
      build: true,
      reason: "no desktop binary",
    });
  });
});
