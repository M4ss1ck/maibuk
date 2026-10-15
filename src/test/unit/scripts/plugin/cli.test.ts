// @vitest-environment node
// The `plugin:check` command line (issue #455): argument parsing, the plan's
// step order, and `runCheck`'s stop-at-the-first-failure and exit code. The
// steps are stubbed here, so no real toolchain runs; the tools themselves are
// exercised by the slow lane (U3).
import { describe, expect, it } from "vitest";
import {
  CHECK_ORDER,
  type CheckStep,
  parseCommand,
  runCheck,
  type StepResult,
} from "../../../../../scripts/plugin/cli";

/** A step that records its name and returns a fixed result. */
function stubStep(
  name: string,
  ran: string[],
  result: StepResult = { ok: true, details: [] }
): CheckStep {
  return {
    name,
    async run() {
      ran.push(name);
      return result;
    },
  };
}

describe("parseCommand()", () => {
  it("reads a known command and the Plugin path as written", () => {
    expect(parseCommand(["check", "../my plugin"])).toEqual({
      command: "check",
      path: "../my plugin",
    });
    expect(parseCommand(["build", "/abs/plugin"])).toEqual({
      command: "build",
      path: "/abs/plugin",
    });
  });

  it("accepts every command", () => {
    for (const command of CHECK_ORDER) {
      expect(parseCommand([command, "p"])).toEqual({ command, path: "p" });
    }
    expect(parseCommand(["check", "p"])).toEqual({ command: "check", path: "p" });
  });

  it("refuses an unknown command, a missing command, and a missing path", () => {
    expect(parseCommand(["bogus", "p"])).toMatchObject({ error: expect.stringContaining("bogus") });
    expect(parseCommand([])).toHaveProperty("error");
    expect(parseCommand(["check"])).toHaveProperty("error");
  });
});

describe("CHECK_ORDER", () => {
  it("is the plan's order", () => {
    expect([...CHECK_ORDER]).toEqual([
      "build",
      "validate",
      "typecheck",
      "lint",
      "test",
      "boundary",
      "package",
      "layout",
    ]);
  });
});

describe("runCheck()", () => {
  it("runs the steps in order and passes with code 0", async () => {
    const ran: string[] = [];
    const lines: string[] = [];
    const steps = CHECK_ORDER.map((name) => stubStep(name, ran));

    const outcome = await runCheck(steps, (line) => lines.push(line));

    expect(ran).toEqual([...CHECK_ORDER]);
    expect(outcome.code).toBe(0);
    expect(outcome.ok).toBe(true);
    expect(outcome.steps.map((step) => step.name)).toEqual([...CHECK_ORDER]);
    expect(lines[0]).toMatch(/^PASS build \(\d+ms\)$/);
    expect(lines[lines.length - 1]).toContain("passed");
  });

  it("stops at the first failure, reports its details, and exits non-zero", async () => {
    const ran: string[] = [];
    const lines: string[] = [];
    const steps: CheckStep[] = [
      stubStep("build", ran),
      stubStep("validate", ran),
      stubStep("typecheck", ran, { ok: false, details: ["two problems", "and one more"] }),
      stubStep("lint", ran),
      stubStep("test", ran),
    ];

    const outcome = await runCheck(steps, (line) => lines.push(line));

    expect(ran).toEqual(["build", "validate", "typecheck"]);
    expect(outcome.code).toBe(1);
    expect(outcome.ok).toBe(false);
    expect(outcome.steps.map((step) => step.name)).toEqual(["build", "validate", "typecheck"]);
    expect(lines).toContain("FAIL typecheck");
    expect(lines).toContain("  two problems");
    expect(lines).toContain("  and one more");
    expect(lines[lines.length - 1]).toContain("failed at typecheck");
  });

  it("treats a step that throws as a failure at that step", async () => {
    const ran: string[] = [];
    const steps: CheckStep[] = [
      stubStep("build", ran),
      {
        name: "validate",
        async run() {
          ran.push("validate");
          throw new Error("boom");
        },
      },
      stubStep("typecheck", ran),
    ];

    const outcome = await runCheck(steps, () => {});

    expect(ran).toEqual(["build", "validate"]);
    expect(outcome.code).toBe(1);
    expect(outcome.steps[1]).toMatchObject({ name: "validate", ok: false, details: ["boom"] });
  });
});
