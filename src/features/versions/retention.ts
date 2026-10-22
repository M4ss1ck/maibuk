import type { VersionTrigger } from "@/features/versions/types";

// Version Retention decides which Versions a Book keeps (ADR 0033). It is a
// pure function over Version metadata, so every device that holds the same
// union of Versions computes the same kept set, with no memory of what it
// pruned before.
//
// The rule keeps the newest automatic Version in each fixed UTC bin, and the
// bins nest (days inside 7-day weeks, both counted from the Unix epoch). That
// makes it monotone: once a Version falls outside the kept set, adding Versions
// or advancing time never brings it back, so every device converges on the
// same set.

export interface RetentionCandidate {
  id: string;
  triggerType: VersionTrigger | string;
  /** Unix seconds. */
  createdAt: number;
}

export const RETENTION_RECENT_SECONDS = 24 * 60 * 60;
export const RETENTION_RECENT_MAX = 10;
export const RETENTION_DAY_SECONDS = 24 * 60 * 60;
export const RETENTION_DAILY_BINS = 14;
export const RETENTION_WEEK_SECONDS = 7 * 24 * 60 * 60;
export const RETENTION_WEEKLY_BINS = 8;

/** Triggers Version Retention may drop; every other trigger (manual, pre-restore, plugin, unknown) is always kept. */
export const RETAINED_AUTOMATIC_TRIGGERS: readonly string[] = ["auto-idle", "close", "pre-sync"];

function isAutomatic(triggerType: string): boolean {
  return RETAINED_AUTOMATIC_TRIGGERS.includes(triggerType);
}

/**
 * Keep the newest automatic candidate in each bin whose index is within the
 * last `binCount` bins (the current bin counts as one). `automatic` is sorted
 * newest first, so the first candidate seen in a bin is that bin's newest.
 */
function keepNewestPerBin(
  automatic: readonly RetentionCandidate[],
  binSeconds: number,
  binCount: number,
  nowSeconds: number,
  keep: Set<string>
): void {
  const current = Math.floor(nowSeconds / binSeconds);
  const newestInBin = new Map<number, string>();
  for (const candidate of automatic) {
    const bin = Math.floor(candidate.createdAt / binSeconds);
    if (!newestInBin.has(bin)) newestInBin.set(bin, candidate.id);
  }
  for (const [bin, id] of newestInBin) {
    if (bin > current - binCount) keep.add(id);
  }
}

/**
 * Return the ids of the candidates Version Retention keeps at `nowSeconds`.
 *
 * Duplicate ids count once (first occurrence wins). Non-automatic triggers are
 * always kept. Automatic candidates are kept when they are among the newest
 * RETENTION_RECENT_MAX inside the last day, or the newest in one of the last
 * RETENTION_DAILY_BINS days, or the newest in one of the last
 * RETENTION_WEEKLY_BINS weeks. Input order does not change the result.
 */
export function retainVersions(
  candidates: readonly RetentionCandidate[],
  nowSeconds: number
): Set<string> {
  const keep = new Set<string>();
  const seen = new Set<string>();
  const automatic: RetentionCandidate[] = [];

  for (const candidate of candidates) {
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    if (isAutomatic(candidate.triggerType)) {
      automatic.push(candidate);
    } else {
      keep.add(candidate.id);
    }
  }

  // Newest first: createdAt desc, then id desc as a deterministic tie-break.
  // A Version stamped ahead of this clock (another device's skew) ranks after
  // every real one and counts as taken now: it can fill only slots no real
  // Version wants, and never claims a future bin.
  const future = (c: RetentionCandidate): boolean => c.createdAt > nowSeconds;
  automatic.sort((a, b) => {
    if (future(a) !== future(b)) return future(a) ? 1 : -1;
    if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
    if (a.id > b.id) return -1;
    if (a.id < b.id) return 1;
    return 0;
  });
  for (let i = 0; i < automatic.length; i += 1) {
    if (future(automatic[i])) automatic[i] = { ...automatic[i], createdAt: nowSeconds };
  }

  // S1: the newest RETENTION_RECENT_MAX inside the last day. Sorted newest
  // first, so the candidates inside the window form a prefix.
  const recentCutoff = nowSeconds - RETENTION_RECENT_SECONDS;
  let recentCount = 0;
  for (const candidate of automatic) {
    if (recentCount >= RETENTION_RECENT_MAX) break;
    if (candidate.createdAt <= recentCutoff) break;
    keep.add(candidate.id);
    recentCount += 1;
  }

  // S2 and S3: the newest per day bin, then the newest per week bin.
  keepNewestPerBin(automatic, RETENTION_DAY_SECONDS, RETENTION_DAILY_BINS, nowSeconds, keep);
  keepNewestPerBin(automatic, RETENTION_WEEK_SECONDS, RETENTION_WEEKLY_BINS, nowSeconds, keep);

  return keep;
}
