import { describe, expect, it } from "vitest";

import {
  OOM_GRACE_POLL_MS,
  waitForReasonWithinGrace,
} from "@/features/plugins/conformance/oom-grace";

/** A virtual clock so the grace wait is tested without real time. */
function fakeClock() {
  let time = 0;
  const sleeps: number[] = [];
  return {
    now: () => time,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      time += ms;
    },
    sleeps,
  };
}

describe("waitForReasonWithinGrace()", () => {
  it("returns the reason as soon as one is available, without sleeping", async () => {
    const clock = fakeClock();
    const reason = await waitForReasonWithinGrace({
      readReason: () => "out-of-memory",
      graceMs: 2_000,
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(reason).toBe("out-of-memory");
    expect(clock.sleeps).toEqual([]);
  });

  it("returns a reason the lifecycle records a few polls after the settle", async () => {
    // This is the race the grace exists for: the Worker's death settles the
    // request before the lifecycle's worker-error path records the reason.
    const clock = fakeClock();
    let reads = 0;
    const reason = await waitForReasonWithinGrace({
      readReason: () => (++reads >= 3 ? "crashed" : null),
      graceMs: 2_000,
      now: clock.now,
      sleep: clock.sleep,
      pollMs: 50,
    });
    expect(reason).toBe("crashed");
    expect(clock.sleeps).toEqual([50, 50]);
  });

  it("returns null once the grace elapses with no reason", async () => {
    const clock = fakeClock();
    const reason = await waitForReasonWithinGrace({
      readReason: () => null,
      graceMs: 200,
      now: clock.now,
      sleep: clock.sleep,
      pollMs: 50,
    });
    expect(reason).toBeNull();
    expect(clock.sleeps).toEqual([50, 50, 50, 50]);
  });

  it("returns a reason that arrives on the poll that reaches the deadline", async () => {
    const clock = fakeClock();
    const reason = await waitForReasonWithinGrace({
      readReason: () => (clock.now() >= 100 ? "out-of-memory" : null),
      graceMs: 100,
      now: clock.now,
      sleep: clock.sleep,
      pollMs: 50,
    });
    expect(reason).toBe("out-of-memory");
  });

  it("does not sleep when the grace is zero and no reason is there yet", async () => {
    const clock = fakeClock();
    const reason = await waitForReasonWithinGrace({
      readReason: () => null,
      graceMs: 0,
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(reason).toBeNull();
    expect(clock.sleeps).toEqual([]);
  });

  it("polls at the module's default cadence", async () => {
    const clock = fakeClock();
    await waitForReasonWithinGrace({
      readReason: () => null,
      graceMs: OOM_GRACE_POLL_MS,
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(clock.sleeps).toEqual([OOM_GRACE_POLL_MS]);
  });
});
