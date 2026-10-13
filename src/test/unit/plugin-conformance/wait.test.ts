import { describe, expect, it } from "vitest";

import {
  FIRST_CONTACT_TIMEOUT_MS,
  lastLogLines,
  waitOutcome,
} from "@/test/support/plugin-conformance/wait";

// The runner's wait policy (#447, D5): the loop stops on `/done`, on the app
// dying, on the first-contact timeout (no request at all within 90 s — the app
// never talked to the collector), or on the overall deadline. Pure, so every
// branch is tested without a build, a socket, or a clock.

const base = {
  elapsedMs: 0,
  deadlineMs: 600_000,
  firstContactMs: FIRST_CONTACT_TIMEOUT_MS,
  done: false,
  alive: true,
  requests: 0,
};

describe("FIRST_CONTACT_TIMEOUT_MS", () => {
  it("is 90 seconds", () => {
    expect(FIRST_CONTACT_TIMEOUT_MS).toBe(90_000);
  });
});

describe("waitOutcome", () => {
  it("stops with done as soon as /done arrived", () => {
    expect(waitOutcome({ ...base, done: true, requests: 3 })).toEqual({ kind: "done" });
  });

  it("stops when the app process died, before any timeout", () => {
    expect(waitOutcome({ ...base, alive: false })).toEqual({ kind: "process-died" });
  });

  it("keeps waiting before the first contact while nothing arrived", () => {
    expect(waitOutcome({ ...base, elapsedMs: FIRST_CONTACT_TIMEOUT_MS - 1 })).toEqual({
      kind: "continue",
    });
  });

  it("stops with first-contact-timeout when no request arrived in time", () => {
    expect(waitOutcome({ ...base, elapsedMs: FIRST_CONTACT_TIMEOUT_MS })).toEqual({
      kind: "first-contact-timeout",
    });
  });

  it("never first-contact-times-out once any request arrived", () => {
    expect(
      waitOutcome({ ...base, requests: 1, elapsedMs: FIRST_CONTACT_TIMEOUT_MS * 2 })
    ).toEqual({ kind: "continue" });
  });

  it("stops with deadline once the overall budget is spent, after contact", () => {
    expect(waitOutcome({ ...base, requests: 2, elapsedMs: 600_000 })).toEqual({ kind: "deadline" });
  });

  it("prefers first-contact-timeout over deadline when both elapsed and nothing arrived", () => {
    expect(waitOutcome({ ...base, elapsedMs: 700_000 })).toEqual({ kind: "first-contact-timeout" });
  });
});

describe("lastLogLines", () => {
  it("returns the last non-empty lines, trimmed", () => {
    expect(lastLogLines("a\n\nb\nc\n", 2)).toBe("b\nc");
  });

  it("returns everything when fewer lines than asked", () => {
    expect(lastLogLines("only\n", 10)).toBe("only");
  });

  it("returns an empty string for empty or blank input", () => {
    expect(lastLogLines("", 5)).toBe("");
    expect(lastLogLines("\n\n", 5)).toBe("");
  });
});
