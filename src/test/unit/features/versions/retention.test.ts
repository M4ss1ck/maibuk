import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  RETENTION_RECENT_MAX,
  retainVersions,
  type RetentionCandidate,
} from "@/features/versions/retention";

const DAY = 24 * 60 * 60;

// Fixed "now": noon UTC on epoch day 20373 (2025-10-22). 1_760_000_000 is
// 3200 s past the start of that day; rounding down to the day boundary and
// adding 12 h gives 1_760_040_000. Day index of NOW = 20373; week index = 2910
// (weeks are 7 whole days, 20370..20376).
const NOW = 20373 * DAY + 12 * 60 * 60;

const AUTOMATIC_TRIGGERS = ["auto-idle", "close", "pre-sync"];

const triggerArb = fc.constantFrom(
  "auto-idle",
  "close",
  "pre-sync",
  "manual",
  "pre-restore",
  "plugin"
);

// Mix of dense (last 3 days) and sparse (last 120 days) ages so both the
// recent window and the bins get exercised.
const offsetArb = fc.oneof(
  fc.integer({ min: 0, max: 3 * DAY }),
  fc.integer({ min: 0, max: 120 * DAY })
);

function candidatesArb(now: number, prefix: string): fc.Arbitrary<RetentionCandidate[]> {
  return fc
    .uniqueArray(
      fc.record({
        id: fc.uuid(),
        triggerType: triggerArb,
        offset: offsetArb,
      }),
      { selector: (c) => c.id, maxLength: 60 }
    )
    .map((rows) =>
      rows.map((r) => ({
        id: `${prefix}-${r.id}`,
        triggerType: r.triggerType,
        createdAt: now - r.offset,
      }))
    );
}

function isAutomatic(c: RetentionCandidate): boolean {
  return AUTOMATIC_TRIGGERS.includes(c.triggerType);
}

describe("retainVersions", () => {
  it("always keeps exempt triggers, even 1000 days old", () => {
    const old = NOW - 1000 * DAY;
    const candidates: RetentionCandidate[] = [
      { id: "manual-1", triggerType: "manual", createdAt: old },
      { id: "restore-1", triggerType: "pre-restore", createdAt: old },
      { id: "plugin-1", triggerType: "plugin", createdAt: old },
      { id: "unknown-1", triggerType: "something-new", createdAt: old },
    ];

    expect(retainVersions(candidates, NOW)).toEqual(
      new Set(["manual-1", "restore-1", "plugin-1", "unknown-1"])
    );
  });

  it("keeps the 10 newest of 15 auto-idle Versions in the last hour", () => {
    // i = 0 is the newest (60 s before now); i = 14 is 2860 s before now.
    // All fall inside the same UTC day as NOW, so the day and week bins add
    // nothing beyond the recent window.
    const candidates: RetentionCandidate[] = Array.from({ length: 15 }, (_, i) => ({
      id: `h${i}`,
      triggerType: "auto-idle",
      createdAt: NOW - 60 - i * 200,
    }));

    expect(retainVersions(candidates, NOW)).toEqual(
      new Set(["h0", "h1", "h2", "h3", "h4", "h5", "h6", "h7", "h8", "h9"])
    );
  });

  it("ranks a Version stamped five days ahead after every real one, so it takes no slot a real Version wants", () => {
    // Another device's clock is ahead. Unranked, the future Version would be
    // the newest and push a real recent Version out of the recent window.
    const recent: RetentionCandidate[] = Array.from({ length: 10 }, (_, i) => ({
      id: `h${i}`,
      triggerType: "auto-idle",
      createdAt: NOW - 60 - i * 200,
    }));
    const candidates: RetentionCandidate[] = [
      { id: "future", triggerType: "auto-idle", createdAt: NOW + 5 * DAY },
      ...recent,
    ];

    const kept = retainVersions(candidates, NOW);

    // The ten real Versions fill the recent window, and h0 is the newest of
    // today's bin and this week's bin, so the future one has no slot left.
    expect(kept).toEqual(new Set(recent.map((c) => c.id)));
  });

  it("keeps a Version stamped ahead of the clock as taken now when no real Version wants its slot", () => {
    const candidates: RetentionCandidate[] = [
      { id: "future", triggerType: "auto-idle", createdAt: NOW + 5 * DAY },
      { id: "old", triggerType: "auto-idle", createdAt: NOW - 3 * DAY },
    ];

    expect(retainVersions(candidates, NOW)).toEqual(new Set(["future", "old"]));
  });

  it("never lets a Version stamped ahead of the clock claim a future bin", () => {
    // Clamped to NOW, the future Version shares today's day and week bins with
    // r0 and ranks after it. Unclamped, it would hold a day bin five days out.
    const candidates: RetentionCandidate[] = [
      { id: "future", triggerType: "close", createdAt: NOW + 5 * DAY },
      ...Array.from({ length: RETENTION_RECENT_MAX }, (_, i) => ({
        id: `r${i}`,
        triggerType: "close",
        createdAt: NOW - 60 - i,
      })),
    ];

    expect(retainVersions(candidates, NOW).has("future")).toBe(false);
  });

  it("keeps one close Version per day for 30 days by the daily and weekly bins", () => {
    // Version k was taken at noon UTC k days before NOW (k = 0..29). Its day
    // index is 20373 - k.
    //
    // Daily: bins > 20373 - 14 = 20359 hold k = 0..13 (one Version each).
    // Recent window: createdAt > NOW - 1 day holds only k = 0.
    // Weekly: week index = floor(day / 7). Current week = floor(20373 / 7) =
    //   2910; bins > 2910 - 8 = 2902 are weeks 2903..2910. Newest per week
    //   among k = 0..29:
    //     2910 (days 20370..20373): k = 0       (already kept)
    //     2909 (days 20363..20369): k = 4       (already kept)
    //     2908 (days 20356..20362): k = 11      (already kept)
    //     2907 (days 20349..20355): k = 18      (new)
    //     2906 (days 20344..20348): k = 25      (new)
    //     2905 and older within the 30 days: none inside the 8 bins
    //       (2903..2905 hold days 20321..20343, i.e. k = 30..52, outside)
    // Expected kept: k = 0..13, 18, 25.
    const candidates: RetentionCandidate[] = Array.from({ length: 30 }, (_, k) => ({
      id: `d${k}`,
      triggerType: "close",
      createdAt: (20373 - k) * DAY + 12 * 60 * 60,
    }));

    const expected = new Set<string>();
    for (let k = 0; k <= 13; k++) expected.add(`d${k}`);
    expected.add("d18");
    expected.add("d25");

    expect(retainVersions(candidates, NOW)).toEqual(expected);
  });

  it("drops automatic Versions older than the 8 week bins, keeps the oldest bin edge", () => {
    // Day 20320 is in week 2902 (days 20314..20320): not > 2902, so dropped.
    // Day 20321 is in week 2903 (days 20321..20327): the newest and only
    // Version there, so kept.
    const candidates: RetentionCandidate[] = [
      { id: "edge-dropped", triggerType: "close", createdAt: 20320 * DAY + 43200 },
      { id: "edge-kept", triggerType: "close", createdAt: 20321 * DAY + 43200 },
      { id: "ancient", triggerType: "auto-idle", createdAt: NOW - 1000 * DAY },
    ];

    expect(retainVersions(candidates, NOW)).toEqual(new Set(["edge-kept"]));
  });

  it("is independent of input order", () => {
    fc.assert(
      fc.property(
        candidatesArb(NOW, "p").chain((cands) =>
          fc
            .shuffledSubarray(cands, {
              minLength: cands.length,
              maxLength: cands.length,
            })
            .map((shuffled) => ({ cands, shuffled }))
        ),
        ({ cands, shuffled }) => {
          expect(retainVersions(shuffled, NOW)).toEqual(retainVersions(cands, NOW));
        }
      ),
      { numRuns: 300 }
    );
  });

  it("is monotone under time: a Version kept later was kept earlier", () => {
    fc.assert(
      fc.property(
        fc
          .tuple(
            fc.integer({ min: 1_700_000_000, max: 1_800_000_000 }),
            fc.integer({ min: 0, max: 30 * DAY })
          )
          .chain(([now, delta]) =>
            candidatesArb(now, "t").map((cands) => ({
              cands,
              now,
              later: now + delta,
            }))
          ),
        ({ cands, now, later }) => {
          const keptNow = retainVersions(cands, now);
          const keptLater = retainVersions(cands, later);
          for (const c of cands) {
            if (isAutomatic(c) && keptLater.has(c.id)) {
              expect(keptNow.has(c.id)).toBe(true);
            }
          }
        }
      ),
      { numRuns: 300 }
    );
  });

  // A busy writing day: more automatic Versions inside one day than the recent
  // cap holds, watched as the day ages into the daily and weekly bins. A rule
  // whose bins skipped the recent window would bring back the Versions the cap
  // dropped.
  it("is monotone under time on a busy day, as Versions age out of the recent window", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_700_000_000, max: 1_800_000_000 }),
        fc.array(fc.integer({ min: 0, max: 3 * DAY }), { minLength: 11, maxLength: 40 }),
        fc.integer({ min: 0, max: 20 * DAY }),
        (now, ages, delta) => {
          const cands = ages.map((age, index) => ({
            id: `busy-${index}`,
            triggerType: "auto-idle",
            createdAt: now - age,
          }));
          const keptNow = retainVersions(cands, now);
          const keptLater = retainVersions(cands, now + delta);
          for (const c of cands) {
            if (keptLater.has(c.id)) expect(keptNow.has(c.id)).toBe(true);
          }
        }
      ),
      { numRuns: 500 }
    );
  });

  it("stays monotone under time for every real Version when another is stamped ahead of the clock", () => {
    fc.assert(
      fc.property(
        fc
          .tuple(
            fc.integer({ min: 1_700_000_000, max: 1_800_000_000 }),
            fc.integer({ min: 0, max: 30 * DAY }),
            fc.integer({ min: 1, max: 5 * DAY })
          )
          .chain(([now, delta, ahead]) =>
            candidatesArb(now, "f").map((cands) => ({
              cands: [
                ...cands,
                { id: "f-ahead", triggerType: "auto-idle", createdAt: now + ahead },
              ],
              now,
              later: now + delta,
            }))
          ),
        ({ cands, now, later }) => {
          const keptNow = retainVersions(cands, now);
          const keptLater = retainVersions(cands, later);
          // Monotone for Versions taken by `now`; the one stamped ahead can
          // only drop sooner than on a correct clock (ADR 0033), and once
          // dropped it is deleted, so it has nothing to come back to.
          for (const c of cands) {
            if (isAutomatic(c) && c.createdAt <= now && keptLater.has(c.id)) {
              expect(keptNow.has(c.id)).toBe(true);
            }
          }
        }
      ),
      { numRuns: 300 }
    );
  });

  it("is monotone under additions: a kept Version stays kept without the additions", () => {
    fc.assert(
      fc.property(candidatesArb(NOW, "a"), candidatesArb(NOW, "b"), (a, b) => {
        const keptUnion = retainVersions([...a, ...b], NOW);
        const keptA = retainVersions(a, NOW);
        for (const c of a) {
          if (isAutomatic(c) && keptUnion.has(c.id)) {
            expect(keptA.has(c.id)).toBe(true);
          }
        }
      }),
      { numRuns: 300 }
    );
  });

  it("converges: two devices with the same union, reordered and duplicated, agree", () => {
    fc.assert(
      fc.property(
        candidatesArb(NOW, "c").chain((union) =>
          fc.tuple(
            fc.shuffledSubarray([...union, ...union], {
              minLength: 2 * union.length,
              maxLength: 2 * union.length,
            }),
            fc.shuffledSubarray([...union, ...union], {
              minLength: 2 * union.length,
              maxLength: 2 * union.length,
            }),
            fc.constant(union)
          )
        ),
        ([deviceA, deviceB, union]) => {
          const resultA = retainVersions(deviceA, NOW);
          const resultB = retainVersions(deviceB, NOW);
          expect(resultA).toEqual(resultB);
          expect(resultA).toEqual(retainVersions(union, NOW));
        }
      ),
      { numRuns: 300 }
    );
  });
});
