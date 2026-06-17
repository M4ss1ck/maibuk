import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecute = vi.fn();
vi.mock("../../../../lib/db", () => ({
  getDatabase: () => Promise.resolve({ execute: mockExecute, select: vi.fn() }),
}));

import { ensureGenericCollectionMigration } from "../../../../features/sync/migration-reset";

describe("ensureGenericCollectionMigration", () => {
  beforeEach(() => {
    mockExecute.mockReset().mockResolvedValue(undefined);
    localStorage.clear();
  });

  it("resets metrics push-tracking and watermarks once", async () => {
    await ensureGenericCollectionMigration();
    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining("UPDATE metrics_events SET pushed_at = NULL"));
    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining("UPDATE metrics_event_tombstones SET pushed_at = NULL"));
    expect(localStorage.getItem("maibuk.metrics.lastEventPullAt")).toBeNull();
    expect(localStorage.getItem("maibuk.sync.genericMigrationDone")).toBe("1");
  });

  it("is a no-op on the second call", async () => {
    await ensureGenericCollectionMigration();
    mockExecute.mockClear();
    await ensureGenericCollectionMigration();
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
