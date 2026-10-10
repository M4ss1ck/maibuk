import { describe, expect, it } from "vitest";
import {
  compareSemver,
  isValidRange,
  parseSemver,
  rangeRelation,
  satisfiesRange,
} from "@/features/plugins/semver";

describe("parseSemver", () => {
  it("parses plain versions and prerelease/build parts", () => {
    expect(parseSemver("0.3.2")).toEqual({ major: 0, minor: 3, patch: 2, prerelease: [] });
    expect(parseSemver("v1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
    expect(parseSemver("1.2.3-beta.1+build.7")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: ["beta", "1"],
    });
  });

  it("refuses what is not a semver version", () => {
    for (const value of ["", "1", "1.2", "1.2.3.4", "a.b.c", "1.2.x", "^1.2.3", " 1.2.3"]) {
      expect(parseSemver(value), value).toBeNull();
    }
  });
});

describe("compareSemver", () => {
  const at = (value: string) => {
    const parsed = parseSemver(value);
    if (parsed === null) throw new Error(`bad test version ${value}`);
    return parsed;
  };

  it("orders major, minor, then patch", () => {
    expect(compareSemver(at("0.3.0"), at("0.2.9"))).toBeGreaterThan(0);
    expect(compareSemver(at("0.2.1"), at("0.2.2"))).toBeLessThan(0);
    expect(compareSemver(at("1.0.0"), at("1.0.0"))).toBe(0);
  });

  it("orders prerelease below its release, by semver precedence", () => {
    expect(compareSemver(at("1.0.0-beta"), at("1.0.0"))).toBeLessThan(0);
    expect(compareSemver(at("1.0.0-alpha"), at("1.0.0-beta"))).toBeLessThan(0);
    expect(compareSemver(at("1.0.0-beta.2"), at("1.0.0-beta.11"))).toBeLessThan(0);
    expect(compareSemver(at("1.0.0-beta"), at("1.0.0-beta.1"))).toBeLessThan(0);
    expect(compareSemver(at("1.0.0-2"), at("1.0.0-11"))).toBeLessThan(0);
    expect(compareSemver(at("1.0.0-alpha.1"), at("1.0.0-alpha.beta"))).toBeLessThan(0);
  });
});

describe("isValidRange / satisfiesRange", () => {
  const rangeCases: Array<{ range: string; match: string[]; miss: string[] }> = [
    { range: "*", match: ["0.0.1", "9.9.9"], miss: [] },
    { range: "0.3.0", match: ["0.3.0"], miss: ["0.3.1", "0.4.0"] },
    { range: "=0.3.0", match: ["0.3.0"], miss: ["0.3.1"] },
    { range: "^0.3", match: ["0.3.0", "0.3.9"], miss: ["0.4.0", "0.2.9"] },
    { range: "^0.3.1", match: ["0.3.1", "0.3.9"], miss: ["0.4.0", "0.3.0"] },
    { range: "^0.0.3", match: ["0.0.3"], miss: ["0.0.4", "0.0.2"] },
    { range: "^1.2.3", match: ["1.2.3", "1.9.0"], miss: ["2.0.0", "1.2.2"] },
    { range: "~0.3.1", match: ["0.3.1", "0.3.9"], miss: ["0.4.0"] },
    { range: "~0.3", match: ["0.3.0", "0.3.9"], miss: ["0.4.0"] },
    { range: "~1", match: ["1.0.0", "1.9.9"], miss: ["2.0.0"] },
    { range: ">=0.3.0", match: ["0.3.0", "1.0.0"], miss: ["0.2.9"] },
    { range: ">0.3.0", match: ["0.3.1"], miss: ["0.3.0"] },
    { range: "<=0.3.0", match: ["0.3.0", "0.2.0"], miss: ["0.3.1"] },
    { range: "<0.3.0", match: ["0.2.9"], miss: ["0.3.0"] },
    { range: ">=0.3.0 <0.5.0", match: ["0.3.0", "0.4.9"], miss: ["0.5.0"] },
    { range: "^0.1 || ^0.3", match: ["0.1.5", "0.3.0"], miss: ["0.2.0"] },
    { range: "1.2", match: ["1.2.0", "1.2.9"], miss: ["1.3.0", "1.1.9"] },
    { range: "1.x", match: ["1.0.0", "1.9.9"], miss: ["2.0.0"] },
    { range: "1.2.x", match: ["1.2.5"], miss: ["1.3.0"] },
  ];

  for (const { range, match, miss } of rangeCases) {
    it(`matches ${range}`, () => {
      expect(isValidRange(range)).toBe(true);
      for (const version of match) {
        const parsed = parseSemver(version);
        expect(parsed, version).not.toBeNull();
        if (parsed === null) continue;
        expect(satisfiesRange(range, parsed), `${range} vs ${version}`).toBe(true);
      }
      for (const version of miss) {
        const parsed = parseSemver(version);
        expect(parsed, version).not.toBeNull();
        if (parsed === null) continue;
        expect(satisfiesRange(range, parsed), `${range} vs ${version}`).toBe(false);
      }
    });
  }

  it("refuses malformed ranges", () => {
    for (const range of [
      "",
      " ",
      "^",
      "^x",
      ">=",
      "1.2.3 -",
      "1.2.3 - 2.0.0",
      "1.2.3.4",
      "||",
      "^1.2 ||",
    ]) {
      expect(isValidRange(range), range).toBe(false);
    }
  });

  it("never lets a prerelease version satisfy a plain range", () => {
    const beta = parseSemver("0.3.0-beta.1");
    if (beta === null) throw new Error("bad test version");
    expect(satisfiesRange("^0.3", beta)).toBe(false);
    expect(satisfiesRange("*", beta)).toBe(false);
  });
});

describe("rangeRelation", () => {
  const at = (value: string) => {
    const parsed = parseSemver(value);
    if (parsed === null) throw new Error(`bad test version ${value}`);
    return parsed;
  };

  it("reports in-range", () => {
    expect(rangeRelation("^0.3", at("0.3.2"))).toBe("in-range");
    expect(rangeRelation("*", at("9.9.9"))).toBe("in-range");
  });

  it("reports wants-newer when every supported version is above the host", () => {
    expect(rangeRelation("^0.4", at("0.3.2"))).toBe("wants-newer");
    expect(rangeRelation(">=0.5.0", at("0.4.0"))).toBe("wants-newer");
    expect(rangeRelation(">0.3.0", at("0.3.0"))).toBe("wants-newer");
    expect(rangeRelation("^0.4 || ^0.5", at("0.3.0"))).toBe("wants-newer");
  });

  it("reports wants-older when the host has moved past every supported version", () => {
    expect(rangeRelation("^0.1", at("0.3.0"))).toBe("wants-older");
    expect(rangeRelation("<0.3.0", at("0.3.0"))).toBe("wants-older");
    expect(rangeRelation("~0.1.0", at("0.3.0"))).toBe("wants-older");
    expect(rangeRelation("^0.1 || ^0.2", at("0.3.0"))).toBe("wants-older");
  });
});
