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

  it("never rolls back on a delayed echo while a newer value is still pending", () => {
    const tracker = createEchoTracker();
    tracker.sent("a");
    tracker.sent("ab");
    tracker.sent("abc");

    // The Plugin's echo of "ab" arrives while "abc" is still in flight.
    expect(tracker.shouldApply("ab")).toBe(false);
    // A duplicate delayed echo of the same superseded value is still an echo.
    expect(tracker.shouldApply("ab")).toBe(false);
    expect(tracker.shouldApply("abc")).toBe(false);
  });

  it("applies a value the host never sent", () => {
    const tracker = createEchoTracker();
    tracker.sent("abc");

    expect(tracker.shouldApply("other")).toBe(true);
  });

  it("applies a programmatic reset once every echo has drained (FIFO)", () => {
    const tracker = createEchoTracker();
    // Type "a{Backspace}abc": the host sent each of these values in order.
    for (const value of ["a", "", "a", "ab", "abc"]) tracker.sent(value);

    // The Plugin echoes onInput, so the channel carries them back in the same
    // FIFO order; the echo of the newest sent value (abc) arrives last.
    for (const echo of ["a", "", "a", "ab", "abc"]) {
      expect(tracker.shouldApply(echo)).toBe(false);
    }

    // Pending is now empty: nothing the Plugin can still echo is in flight, so
    // the Plugin's Clear is a real change and must reach the field.
    expect(tracker.shouldApply("")).toBe(true);
  });

  it("treats composition input like any other host keystroke", () => {
    const tracker = createEchoTracker();
    tracker.sent("に");
    tracker.sent("にほ");
    tracker.sent("にほん");

    expect(tracker.shouldApply("にほ")).toBe(false);
    expect(tracker.shouldApply("にほん")).toBe(false);
  });

  it("drops its tracking on reset()", () => {
    const tracker = createEchoTracker();
    tracker.sent("abc");
    tracker.reset();
    expect(tracker.shouldApply("abc")).toBe(true);
  });
});
