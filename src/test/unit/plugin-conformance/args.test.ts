import { describe, expect, it } from "vitest";

import {
  PLUGIN_CONFORMANCE_USAGE,
  PluginConformanceUsageError,
  parsePluginConformanceArgs,
  platformsFor,
} from "@/test/support/plugin-conformance/args";

describe("parsePluginConformanceArgs()", () => {
  it("defaults to every available platform, no record, .bench, ten minutes", () => {
    expect(parsePluginConformanceArgs([])).toEqual({
      platform: "all",
      record: false,
      skipBuild: false,
      out: ".bench",
      timeoutMinutes: 10,
      help: false,
    });
  });

  it("accepts each platform, and `all`", () => {
    expect(parsePluginConformanceArgs(["--platform", "linux"]).platform).toBe("linux");
    expect(parsePluginConformanceArgs(["--platform", "android"]).platform).toBe("android");
    expect(parsePluginConformanceArgs(["--platform", "all"]).platform).toBe("all");
  });

  it("accepts `--flag=value` as well as `--flag value`", () => {
    expect(parsePluginConformanceArgs(["--platform=android"]).platform).toBe("android");
    expect(parsePluginConformanceArgs(["--out=artifacts"]).out).toBe("artifacts");
  });

  it("reads --record, --skip-build, --out and --timeout", () => {
    expect(
      parsePluginConformanceArgs([
        "--record",
        "--skip-build",
        "--out",
        ".bench/custom",
        "--timeout",
        "3",
      ])
    ).toMatchObject({
      record: true,
      skipBuild: true,
      out: ".bench/custom",
      timeoutMinutes: 3,
    });
  });

  it("recognizes --help and -h", () => {
    expect(parsePluginConformanceArgs(["--help"]).help).toBe(true);
    expect(parsePluginConformanceArgs(["-h"]).help).toBe(true);
  });

  it("rejects an unknown platform with the usage", () => {
    expect(() => parsePluginConformanceArgs(["--platform", "web"])).toThrow(
      PluginConformanceUsageError
    );
    expect(() => parsePluginConformanceArgs(["--platform", "web"])).toThrow(/unknown platform "web"/);
  });

  it("rejects a non-integer or below-one --timeout", () => {
    expect(() => parsePluginConformanceArgs(["--timeout", "0"])).toThrow(/integer ≥ 1/);
    expect(() => parsePluginConformanceArgs(["--timeout", "1.5"])).toThrow(/integer ≥ 1/);
  });

  it("rejects a missing value and an unknown option", () => {
    expect(() => parsePluginConformanceArgs(["--out"])).toThrow(/--out needs a value/);
    expect(() => parsePluginConformanceArgs(["--platform", "--record"])).toThrow(/needs a value/);
    expect(() => parsePluginConformanceArgs(["--nope"])).toThrow(/unknown option "--nope"/);
  });

  it("appends the usage to every usage error", () => {
    expect(() => parsePluginConformanceArgs(["--nope"])).toThrow(PLUGIN_CONFORMANCE_USAGE);
  });
});

describe("platformsFor()", () => {
  it("expands `all` to both engines, and names a single one", () => {
    expect(platformsFor("all")).toEqual(["linux", "android"]);
    expect(platformsFor("linux")).toEqual(["linux"]);
    expect(platformsFor("android")).toEqual(["android"]);
  });
});
