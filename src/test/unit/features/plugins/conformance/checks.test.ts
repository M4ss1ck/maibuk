import { describe, expect, it } from "vitest";

import {
  RENDERER_DIED_DETAIL,
  T2_FRAME_CHECK_ID,
  T2_WORKER_CHECK_ID,
  T7_CHECK_ID,
  T8_CHECK_ID,
  fixtureCommandCheckIds,
  runConformanceChecks,
} from "@/features/plugins/conformance/checks";
import {
  CONFORMANCE_ESCAPES,
  type ConformanceEscape,
  escapeCheckId,
} from "@/features/plugins/conformance/commands";
import type {
  CommandObservation,
  CommandOutcome,
  ConformanceCheck,
  ConformanceSeam,
} from "@/features/plugins/conformance/types";

/** The first Command whose safe outcome is a typed refusal. */
const REFUSAL_ESCAPE = CONFORMANCE_ESCAPES.find((candidate) => candidate.safe === "refused");
if (!REFUSAL_ESCAPE) throw new Error("no refusal escape in the table");
const REFUSAL_ESCAPE_ID = escapeCheckId(REFUSAL_ESCAPE);

/** The outcome a Command shows when it behaves safely. */
function safeOutcome(escapeCommand: ConformanceEscape): CommandOutcome {
  switch (escapeCommand.safe) {
    case "refused":
      return { kind: "refused", detail: `hostile ${escapeCommand.command} refused: blocked` };
    case "ignored":
      return { kind: "ignored", detail: `hostile ${escapeCommand.command} ignored` };
    case "mounted":
      return { kind: "mounted", detail: `hostile ${escapeCommand.command} mounted` };
    case "remote-ui-limit":
      return {
        kind: "stopped",
        reason: "remote-ui-limit",
        detail: "the host refused the declared interface",
      };
  }
}

function observationFor(command: string): CommandObservation {
  const escapeCommand = CONFORMANCE_ESCAPES.find((candidate) => candidate.command === command);
  return escapeCommand
    ? { outcome: safeOutcome(escapeCommand), leaked: false }
    : { outcome: { kind: "escaped", detail: "unknown command" }, leaked: false };
}

/** The seam the runner sees, with every check passing unless overridden. */
function makeSeam(overrides: Partial<ConformanceSeam> = {}): ConformanceSeam {
  return {
    platform: "desktop",
    engine: { name: "tauri-webkitgtk", version: "v1.0.0", userAgent: "UA" },
    runCommand: async (command) => observationFor(command),
    probeFrameIpc: async () => ({ reached: false, detail: "no __TAURI_INTERNALS__" }),
    probeWorkerIpc: async () => ({ reached: false, detail: "no __TAURI_INTERNALS__" }),
    probeHang: async () => ({ reason: "unresponsive" }),
    probeOom: async () => ({ reason: "out-of-memory" }),
    heartbeat: async () => true,
    ...overrides,
  };
}

function byId(checks: ConformanceCheck[], id: string): ConformanceCheck {
  const check = checks.find((candidate) => candidate.id === id);
  if (!check) throw new Error(`no check ${id}; got ${checks.map((c) => c.id).join(", ")}`);
  return check;
}

/** Overrides one Command's outcome in an otherwise safe seam. */
function withOutcome(command: string, outcome: CommandOutcome, leaked = false): ConformanceSeam {
  return makeSeam({
    runCommand: async (called) =>
      called === command ? { outcome, leaked } : observationFor(called),
  });
}

describe("runConformanceChecks T2", () => {
  it("passes both IPC probes when no Tauri IPC was reached", async () => {
    const checks = await runConformanceChecks(makeSeam());
    expect(byId(checks, T2_FRAME_CHECK_ID).status).toBe("pass");
    expect(byId(checks, T2_WORKER_CHECK_ID).status).toBe("pass");
  });

  it("fails the frame probe when Tauri IPC answered from the sandboxed frame", async () => {
    const checks = await runConformanceChecks(
      makeSeam({ probeFrameIpc: async () => ({ reached: true, detail: "invoke resolved" }) })
    );
    const check = byId(checks, T2_FRAME_CHECK_ID);
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("invoke resolved");
  });

  it("omits the frame probe on Android but keeps the worker probe", async () => {
    const checks = await runConformanceChecks(makeSeam({ platform: "android" }));
    expect(checks.map((check) => check.id)).not.toContain(T2_FRAME_CHECK_ID);
    expect(byId(checks, T2_WORKER_CHECK_ID).status).toBe("pass");
  });

  it("marks the worker probe unmeasured when its setup throws", async () => {
    const checks = await runConformanceChecks(
      makeSeam({
        probeWorkerIpc: async () => {
          throw new Error("the sandbox Worker never started");
        },
      })
    );
    const check = byId(checks, T2_WORKER_CHECK_ID);
    expect(check.status).toBe("unmeasured");
    expect(check.detail).toContain("never started");
  });
});

describe("runConformanceChecks fixture Commands", () => {
  it("passes every Command that shows its safe outcome", async () => {
    const checks = await runConformanceChecks(makeSeam());
    for (const escapeCommand of CONFORMANCE_ESCAPES) {
      expect(byId(checks, escapeCheckId(escapeCommand)).status, escapeCommand.command).toBe("pass");
    }
  });

  it("passes a refusal escape the host stopped with a reason", async () => {
    const checks = await runConformanceChecks(
      withOutcome(REFUSAL_ESCAPE.command, {
        kind: "stopped",
        reason: "crashed",
        detail: "stopped unexpectedly",
      })
    );
    expect(byId(checks, REFUSAL_ESCAPE_ID).status).toBe("pass");
  });

  it("fails a refusal escape the collector saw, even when the Plugin refused", async () => {
    const checks = await runConformanceChecks(
      withOutcome(REFUSAL_ESCAPE.command, safeOutcome(REFUSAL_ESCAPE), true)
    );
    const check = byId(checks, REFUSAL_ESCAPE_ID);
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("collector logged a request");
  });

  it("fails a refusal escape that succeeded", async () => {
    const checks = await runConformanceChecks(
      withOutcome(REFUSAL_ESCAPE.command, {
        kind: "escaped",
        detail: "the fetch left the sandbox",
      })
    );
    expect(byId(checks, REFUSAL_ESCAPE_ID).status).toBe("fail");
  });

  it("marks an escape unmeasured when its setup throws", async () => {
    const checks = await runConformanceChecks(
      makeSeam({
        runCommand: async (command) => {
          if (command === REFUSAL_ESCAPE.command) throw new Error("the Plugin never started");
          return observationFor(command);
        },
      })
    );
    const check = byId(checks, REFUSAL_ESCAPE_ID);
    expect(check.status).toBe("unmeasured");
    expect(check.detail).toContain("never started");
  });

  it("passes escape-spoofedReply only when the forged reply was ignored", async () => {
    const spoof = CONFORMANCE_ESCAPES.find((candidate) => candidate.safe === "ignored");
    if (!spoof) throw new Error("no ignored escape in the table");
    const id = escapeCheckId(spoof);

    const ignored = await runConformanceChecks(makeSeam());
    expect(byId(ignored, id).status).toBe("pass");

    const escaped = await runConformanceChecks(
      withOutcome(spoof.command, { kind: "escaped", detail: "the forged reply was honoured" })
    );
    const check = byId(escaped, id);
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("forged reply");
  });

  it("passes a UI Command only when the lifecycle stopped the Plugin with remote-ui-limit", async () => {
    const ui = CONFORMANCE_ESCAPES.find((candidate) => candidate.safe === "remote-ui-limit");
    if (!ui) throw new Error("no remote-ui-limit escape in the table");
    const id = escapeCheckId(ui);

    const safe = await runConformanceChecks(makeSeam());
    expect(byId(safe, id).status).toBe("pass");

    const wrongStop = await runConformanceChecks(
      withOutcome(ui.command, { kind: "stopped", reason: "crashed", detail: "stopped unexpectedly" })
    );
    expect(byId(wrongStop, id).status).toBe("fail");
  });

  it("passes openPanel only when the page mounted and left the Plugin ready", async () => {
    const panel = CONFORMANCE_ESCAPES.find((candidate) => candidate.safe === "mounted");
    if (!panel) throw new Error("no mounted escape in the table");
    const id = escapeCheckId(panel);

    const safe = await runConformanceChecks(makeSeam());
    expect(byId(safe, id).status).toBe("pass");

    const failed = await runConformanceChecks(
      withOutcome(panel.command, { kind: "escaped", detail: "the panel did not mount" })
    );
    expect(byId(failed, id).status).toBe("fail");
  });
});

describe("runConformanceChecks terminal probes", () => {
  it("passes T7 when the busy loop stopped the Plugin as unresponsive", async () => {
    const checks = await runConformanceChecks(makeSeam());
    expect(byId(checks, T7_CHECK_ID).status).toBe("pass");
  });

  it("fails T7 when the Plugin stopped for another reason", async () => {
    const checks = await runConformanceChecks(
      makeSeam({ probeHang: async () => ({ reason: "crashed" }) })
    );
    const check = byId(checks, T7_CHECK_ID);
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("expected unresponsive");
  });

  it("passes T8 when the Plugin ran out of memory and the host answered", async () => {
    const checks = await runConformanceChecks(makeSeam());
    expect(byId(checks, T8_CHECK_ID).status).toBe("pass");
  });

  it("fails T8 with renderer-died when the host heartbeat is missing", async () => {
    const checks = await runConformanceChecks(
      makeSeam({
        probeOom: async () => ({ reason: "out-of-memory" }),
        heartbeat: async () => false,
      })
    );
    const check = byId(checks, T8_CHECK_ID);
    expect(check.status).toBe("fail");
    expect(check.detail).toBe(RENDERER_DIED_DETAIL);
  });

  it("marks T8 unmeasured when the allocation probe throws", async () => {
    const checks = await runConformanceChecks(
      makeSeam({
        probeOom: async () => {
          throw new Error("the Worker never started");
        },
      })
    );
    expect(byId(checks, T8_CHECK_ID).status).toBe("unmeasured");
  });
});

describe("runConformanceChecks reporting", () => {
  it("hands every check to onCheck in run order, before returning", async () => {
    const streamed: string[] = [];
    const checks = await runConformanceChecks(makeSeam(), (check) => {
      streamed.push(check.id);
    });
    expect(streamed).toEqual(checks.map((check) => check.id));
    expect(streamed[0]).toBe(T2_FRAME_CHECK_ID);
    expect(streamed.at(-1)).toBe(T8_CHECK_ID);
  });
});

describe("the fixture Command coverage", () => {
  it("records unique escape-<name> ids", () => {
    const ids = CONFORMANCE_ESCAPES.map(escapeCheckId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^escape-[a-zA-Z]+$/);
  });

  it("maps every fixture-hostile manifest Command to exactly one check", async () => {
    const { readFile } = await import("node:fs/promises");
    // The committed source manifest, not the git-ignored build output.
    const manifest = JSON.parse(
      await readFile("e2e/fixtures/plugin-sources/fixture-hostile/manifest.json", "utf8")
    ) as { contributes: { commands: { id: string }[] } };
    const declared = manifest.contributes.commands.map((command) => command.id).sort();

    const mapping = fixtureCommandCheckIds();
    expect(Object.keys(mapping).sort()).toEqual(declared);
    for (const command of declared) {
      expect(typeof mapping[command], command).toBe("string");
      expect(mapping[command].length, command).toBeGreaterThan(0);
    }
  });
});
