import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_READING_POSITIONS,
  useReadingPositionStore,
} from "../../../../features/reading-position/store";

describe("useReadingPositionStore", () => {
  beforeEach(() => {
    useReadingPositionStore.setState({ positions: {} });
    vi.restoreAllMocks();
  });

  it("saves and retrieves a position with a timestamp", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    useReadingPositionStore
      .getState()
      .savePosition("chapter:a", { caret: 5, top: 3 });

    expect(useReadingPositionStore.getState().getPosition("chapter:a")).toEqual({
      caret: 5,
      top: 3,
      updatedAt: 1000,
    });
  });

  it("returns undefined for an unknown key", () => {
    expect(
      useReadingPositionStore.getState().getPosition("note:missing"),
    ).toBeUndefined();
  });

  it("overwrites an existing key in place", () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(1).mockReturnValueOnce(2);
    const { savePosition } = useReadingPositionStore.getState();
    savePosition("chapter:a", { caret: 1, top: 1 });
    savePosition("chapter:a", { caret: 9, top: 8 });

    expect(useReadingPositionStore.getState().getPosition("chapter:a")).toEqual({
      caret: 9,
      top: 8,
      updatedAt: 2,
    });
    expect(Object.keys(useReadingPositionStore.getState().positions)).toHaveLength(
      1,
    );
  });

  it("evicts the oldest entries once the cap is exceeded", () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => ++now);
    const { savePosition } = useReadingPositionStore.getState();

    for (let i = 0; i < MAX_READING_POSITIONS + 5; i++) {
      savePosition(`chapter:${i}`, { caret: i, top: i });
    }

    const { positions } = useReadingPositionStore.getState();
    expect(Object.keys(positions)).toHaveLength(MAX_READING_POSITIONS);
    expect(positions["chapter:0"]).toBeUndefined();
    expect(positions["chapter:4"]).toBeUndefined();
    expect(positions["chapter:5"]).toBeDefined();
  });
});
