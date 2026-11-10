/**
 * The undo history (#745): one per open Map, in memory, capped so a long
 * drawing session cannot grow it without bound.
 */

import { describe, expect, it } from "vitest";
import { createHistory } from "./history";

describe("createHistory", () => {
  it("starts with the initial value and nothing to undo or redo", () => {
    const history = createHistory(["initial"]);
    expect(history.current).toEqual(["initial"]);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  it("undoes and redoes a committed value", () => {
    const history = createHistory(0);
    history.commit(1);
    expect(history.current).toBe(1);
    expect(history.canUndo).toBe(true);

    history.undo();
    expect(history.current).toBe(0);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);

    history.redo();
    expect(history.current).toBe(1);
    expect(history.canRedo).toBe(false);
  });

  it("ignores a commit of the same value, keeping redo available", () => {
    const current = [1];
    const history = createHistory(current);
    history.commit([2]);
    history.undo();
    history.commit(history.current);
    expect(history.current).toBe(current);
    expect(history.canRedo).toBe(true);
  });

  it("clears redo when a new value is committed after an undo", () => {
    const history = createHistory(0);
    history.commit(1);
    history.undo();
    history.commit(2);
    expect(history.current).toBe(2);
    expect(history.canRedo).toBe(false);
    history.undo();
    expect(history.current).toBe(0);
  });

  it("caps the past at 100 steps", () => {
    const history = createHistory(0);
    for (let value = 1; value <= 150; value++) history.commit(value);

    let undone = 0;
    while (history.canUndo) {
      history.undo();
      undone++;
    }
    expect(undone).toBe(100);
    expect(history.current).toBe(50);
  });

  it("does nothing when undoing or redoing at an end", () => {
    const history = createHistory("only");
    history.undo();
    history.redo();
    expect(history.current).toBe("only");
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });
});
