import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecute = vi.fn();
const mockSelect = vi.fn();
vi.mock("../../../../lib/db", () => ({
  getDatabase: () => Promise.resolve({ execute: mockExecute, select: mockSelect }),
}));

import { ensureGenericCollectionMigration } from "../../../../features/sync/migration-reset";

describe("ensureGenericCollectionMigration", () => {
  beforeEach(() => {
    mockExecute.mockReset().mockResolvedValue(undefined);
    mockSelect.mockReset().mockResolvedValue([]);
    localStorage.clear();
  });

  it("resets metrics push-tracking and watermarks once", async () => {
    await ensureGenericCollectionMigration();
    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining("UPDATE metrics_events SET pushed_at = NULL"));
    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining("UPDATE metrics_event_tombstones SET pushed_at = NULL"));
    expect(localStorage.getItem("maibuk.metrics.lastEventPullAt")).toBeNull();
    expect(localStorage.getItem("maibuk.metrics.lastTombstonePullAt")).toBeNull();
    expect(localStorage.getItem("maibuk.sync.genericMigrationDone")).toBe("1");
  });

  it("is a no-op on the second call", async () => {
    await ensureGenericCollectionMigration();
    mockExecute.mockClear();
    await ensureGenericCollectionMigration();
    expect(mockExecute).not.toHaveBeenCalledWith(expect.stringContaining("UPDATE metrics_events SET pushed_at = NULL"));
    expect(mockExecute).not.toHaveBeenCalledWith(expect.stringContaining("UPDATE metrics_event_tombstones SET pushed_at = NULL"));
  });

  it("backfills the durable marker when only the legacy localStorage marker exists", async () => {
    localStorage.setItem("maibuk.sync.genericMigrationDone", "1");

    await ensureGenericCollectionMigration();

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT OR REPLACE INTO settings"),
      ["sync.genericMigrationDone", "1", expect.any(Number)],
    );
    expect(mockExecute).not.toHaveBeenCalledWith(expect.stringContaining("UPDATE metrics_events SET pushed_at = NULL"));
  });

  it("does not reset again when the durable database marker exists", async () => {
    mockSelect.mockResolvedValue([{ value: "1" }]);

    await ensureGenericCollectionMigration();

    expect(mockExecute).not.toHaveBeenCalledWith(expect.stringContaining("UPDATE metrics_events SET pushed_at = NULL"));
    expect(mockExecute).not.toHaveBeenCalledWith(expect.stringContaining("UPDATE metrics_event_tombstones SET pushed_at = NULL"));
    expect(localStorage.getItem("maibuk.sync.genericMigrationDone")).toBe("1");
  });
});
