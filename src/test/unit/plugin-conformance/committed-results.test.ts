// @vitest-environment node
/**
 * The committed conformance results must stay readable after the report stopped
 * writing `support` and `followUp` (#517): the file on disk keeps those legacy
 * keys until the next `pnpm conformance:plugins` refreshes it, and every reader
 * must accept it as it is. This reads the real file and never writes it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CARGO_LOCK_PATH,
  GATE_RESULTS_PATH,
  checkConformanceGate,
} from "../../../../scripts/plugin-conformance-gate.mjs";

const committedText = readFileSync(GATE_RESULTS_PATH, "utf8");

describe("committed plugins-conformance.results.json", () => {
  it("passes the Cargo.lock gate exactly as it is on disk", () => {
    const cargoLock = readFileSync(CARGO_LOCK_PATH, "utf8");

    expect(checkConformanceGate(cargoLock, JSON.parse(committedText))).toEqual({
      ok: true,
      problems: [],
    });
  });
});
