import { describe, expect, it } from "vitest";
import { decideSyncAction, type SyncDecisionInput } from "@/features/sync/sync-decision";

function input(overrides: Partial<SyncDecisionInput>): SyncDecisionInput {
  return {
    localChecksum: "local",
    remoteChecksum: "remote",
    base: null,
    direction: "bidirectional",
    localUpdatedAt: 100,
    remoteUpdatedAt: 100,
    ...overrides,
  };
}

describe("decideSyncAction()", () => {
  it("reports in-sync when both sides are identical, whatever the direction or base", () => {
    for (const direction of ["bidirectional", "push", "pull"] as const) {
      expect(
        decideSyncAction(
          input({
            localChecksum: "same",
            remoteChecksum: "same",
            direction,
            base: { localChecksum: "x", remoteChecksum: "y" },
          })
        )
      ).toBe("in-sync");
    }
  });

  it("honours an explicit one-way direction", () => {
    const base = { localChecksum: "local", remoteChecksum: "old-remote" };
    expect(decideSyncAction(input({ direction: "push", base }))).toBe("push");
    expect(decideSyncAction(input({ direction: "pull", base }))).toBe("pull");
  });

  describe("with a base", () => {
    it("pulls when only the remote changed, even if the local timestamp is newer", () => {
      expect(
        decideSyncAction(
          input({
            base: { localChecksum: "local", remoteChecksum: "old-remote" },
            localUpdatedAt: 9999,
            remoteUpdatedAt: 1,
          })
        )
      ).toBe("pull");
    });

    it("pushes when only the local copy changed, even if the remote timestamp is newer", () => {
      expect(
        decideSyncAction(
          input({
            base: { localChecksum: "old-local", remoteChecksum: "remote" },
            localUpdatedAt: 1,
            remoteUpdatedAt: 9999,
          })
        )
      ).toBe("push");
    });

    it("reports a conflict when both sides changed", () => {
      expect(
        decideSyncAction(
          input({ base: { localChecksum: "old-local", remoteChecksum: "old-remote" } })
        )
      ).toBe("conflict");
    });

    // After a pull, the local re-serialization need not byte-match the pushed
    // blob. With nothing changed since, that must not pull again forever.
    it("reports unchanged when neither side moved but their bytes differ", () => {
      expect(
        decideSyncAction(input({ base: { localChecksum: "local", remoteChecksum: "remote" } }))
      ).toBe("unchanged");
    });
  });

  describe("without a base (legacy rules)", () => {
    it("pushes a strictly newer local copy", () => {
      expect(decideSyncAction(input({ localUpdatedAt: 200, remoteUpdatedAt: 100 }))).toBe("push");
    });

    it("asks when the remote is newer or equally new", () => {
      expect(decideSyncAction(input({ localUpdatedAt: 100, remoteUpdatedAt: 200 }))).toBe(
        "conflict"
      );
      expect(decideSyncAction(input({ localUpdatedAt: 100, remoteUpdatedAt: 100 }))).toBe(
        "conflict"
      );
    });
  });
});
