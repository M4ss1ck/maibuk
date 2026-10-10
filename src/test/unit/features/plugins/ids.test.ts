import { describe, expect, it } from "vitest";
import { PluginRenameError, collapseContributionRenames } from "@/features/plugins/ids";

const declared = new Set(["third"]);

describe("collapseContributionRenames", () => {
  it("collapses chains to their final declared id", () => {
    expect(
      collapseContributionRenames({ first: "second", second: "third" }, declared, "Command")
    ).toEqual({ first: "third", second: "third" });
  });

  it("carries the offending ids on the error so callers can locate the field", () => {
    const cases: Array<[Record<string, string>, PluginRenameError["problem"]]> = [
      [{ bad_id: "third" }, "not-local-id"],
      [{ third: "first" }, "source-declared"],
      [{ first: "missing" }, "target-undeclared"],
      [{ first: "second", second: "first" }, "cycle"],
    ];
    for (const [renames, problem] of cases) {
      try {
        collapseContributionRenames(renames, declared, "Command");
        throw new Error(`expected ${problem} to be refused`);
      } catch (error) {
        expect(error).toBeInstanceOf(PluginRenameError);
        expect((error as PluginRenameError).problem, JSON.stringify(renames)).toBe(problem);
      }
    }
  });
});
