import { describe, expect, it } from "vitest";
import { createEchoTracker } from "@/features/plugins/remote-ui/echo";

describe("the in-flight echo rule", () => {
  it("ignores an echo and drops everything sent before it", () => {
    const tracker = createEchoTracker();
    tracker.sent("a");
    tracker.sent("ab");
    tracker.sent("abc");

    expect(tracker.shouldApply("ab")).toBe(false);
    expect(tracker.shouldApply("abc")).toBe(false);
  });

  it("never rolls back on a delayed or out-of-order echo", () => {
    const tracker = createEchoTracker();
    tracker.sent("a");
    tracker.sent("ab");
    tracker.sent("abc");

    // Newest echo first, then the older one arrives late.
    expect(tracker.shouldApply("abc")).toBe(false);
    expect(tracker.shouldApply("ab")).toBe(false);
    expect(tracker.shouldApply("a")).toBe(false);
  });

  it("applies a value the host never sent (a programmatic reset)", () => {
    const tracker = createEchoTracker();
    tracker.sent("abc");

    expect(tracker.shouldApply("")).toBe(true);
  });

  it("does not apply a host-sent value that arrives after a reset", () => {
    const tracker = createEchoTracker();
    tracker.sent("abc");

    expect(tracker.shouldApply("")).toBe(true);
    expect(tracker.shouldApply("abc")).toBe(false);
  });

  it("treats composition input like any other host keystroke", () => {
    const tracker = createEchoTracker();
    tracker.sent("に");
    tracker.sent("にほ");
    tracker.sent("にほん");

    expect(tracker.shouldApply("にほ")).toBe(false);
    expect(tracker.shouldApply("にほん")).toBe(false);
  });

  it("recognizes a repeated value only as far as it was sent", () => {
    const tracker = createEchoTracker();
    tracker.sent("a");
    tracker.sent("b");
    tracker.sent("a");

    expect(tracker.shouldApply("a")).toBe(false);
    // "b" is still pending after the echo of the newest "a" resolved the tail.
    expect(tracker.shouldApply("b")).toBe(false);
  });

  it("drops its tracking on reset()", () => {
    const tracker = createEchoTracker();
    tracker.sent("abc");
    tracker.reset();
    expect(tracker.shouldApply("abc")).toBe(true);
  });
});
