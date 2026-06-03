import { describe, expect, it, beforeEach } from "vitest";
import { useCoverStore } from "../../../../features/covers/store";
import { createDefaultScene, createTextLayer } from "../../../../features/covers/scene/defaults";

const freshTitle = () =>
  createTextLayer({ role: "title", text: "T", docWidth: 1800, docHeight: 2700 });

describe("useCoverStore", () => {
  beforeEach(() => useCoverStore.getState().setScene(createDefaultScene("6x9")));

  it("adds a layer and selects it", () => {
    const layer = freshTitle();
    useCoverStore.getState().addLayer(layer);
    const s = useCoverStore.getState();
    expect(s.scene.layers).toHaveLength(1);
    expect(s.selectedId).toBe(layer.id);
    expect(s.dirty).toBe(true);
  });

  it("setScene resets dirty and history", () => {
    useCoverStore.getState().addLayer(freshTitle());
    useCoverStore.getState().setScene(createDefaultScene("6x9"));
    const s = useCoverStore.getState();
    expect(s.dirty).toBe(false);
    expect(s.scene.layers).toHaveLength(0);
    s.undo();
    expect(useCoverStore.getState().scene.layers).toHaveLength(0);
  });

  it("undo/redo restores layer list", () => {
    const layer = freshTitle();
    const st = useCoverStore.getState();
    st.addLayer(layer);
    st.undo();
    expect(useCoverStore.getState().scene.layers).toHaveLength(0);
    st.redo();
    expect(useCoverStore.getState().scene.layers).toHaveLength(1);
  });

  it("nudges selected layer", () => {
    const layer = freshTitle();
    const st = useCoverStore.getState();
    st.addLayer(layer);
    const x0 = useCoverStore.getState().scene.layers[0].x;
    st.nudgeSelected(10, 0);
    expect(useCoverStore.getState().scene.layers[0].x).toBe(x0 + 10);
  });

  it("does not nudge a locked layer", () => {
    const layer = { ...freshTitle(), locked: true };
    const st = useCoverStore.getState();
    st.addLayer(layer);
    const x0 = useCoverStore.getState().scene.layers[0].x;
    st.nudgeSelected(10, 0);
    expect(useCoverStore.getState().scene.layers[0].x).toBe(x0);
  });

  it("duplicates the selected layer with a new id and offset", () => {
    const layer = freshTitle();
    const st = useCoverStore.getState();
    st.addLayer(layer);
    st.duplicateSelected();
    const s = useCoverStore.getState();
    expect(s.scene.layers).toHaveLength(2);
    expect(s.scene.layers[1].id).not.toBe(layer.id);
    expect(s.scene.layers[1].x).toBe(layer.x + 20);
    expect(s.selectedId).toBe(s.scene.layers[1].id);
  });

  it("removes the selected layer and clears selection", () => {
    const layer = freshTitle();
    const st = useCoverStore.getState();
    st.addLayer(layer);
    st.removeLayer(layer.id);
    const s = useCoverStore.getState();
    expect(s.scene.layers).toHaveLength(0);
    expect(s.selectedId).toBeNull();
  });

  it("updates a layer via patch", () => {
    const layer = freshTitle();
    const st = useCoverStore.getState();
    st.addLayer(layer);
    st.updateLayer(layer.id, { opacity: 0.5 });
    expect(useCoverStore.getState().scene.layers[0].opacity).toBe(0.5);
  });

  it("reorders layers", () => {
    const a = freshTitle();
    const b = freshTitle();
    const st = useCoverStore.getState();
    st.addLayer(a);
    st.addLayer(b);
    st.reorder(b.id, 0);
    expect(useCoverStore.getState().scene.layers[0].id).toBe(b.id);
  });

  it("bringForward / sendBackward move a layer one step", () => {
    const a = freshTitle();
    const b = freshTitle();
    const st = useCoverStore.getState();
    st.addLayer(a);
    st.addLayer(b);
    st.sendBackward(b.id);
    expect(useCoverStore.getState().scene.layers[0].id).toBe(b.id);
    st.bringForward(b.id);
    expect(useCoverStore.getState().scene.layers[1].id).toBe(b.id);
  });

  it("sets background and toggles flags", () => {
    const layer = freshTitle();
    const st = useCoverStore.getState();
    st.addLayer(layer);
    st.setBackground({ type: "solid", color: "#000000" });
    expect(useCoverStore.getState().scene.background).toEqual({ type: "solid", color: "#000000" });
    st.toggleHidden(layer.id);
    expect(useCoverStore.getState().scene.layers[0].hidden).toBe(true);
    st.toggleLocked(layer.id);
    expect(useCoverStore.getState().scene.layers[0].locked).toBe(true);
  });

  it("setDoc changes document size, marks dirty and is undoable", () => {
    const st = useCoverStore.getState();
    st.setDoc({ width: 1600, height: 2560, dpi: 300, bleed: 0, safeMargin: 80, presetId: "kindle" });
    expect(useCoverStore.getState().scene.doc.width).toBe(1600);
    expect(useCoverStore.getState().dirty).toBe(true);
    st.undo();
    expect(useCoverStore.getState().scene.doc.width).toBe(1800);
  });

  it("markSaved clears dirty without changing the scene", () => {
    const st = useCoverStore.getState();
    st.addLayer(freshTitle());
    st.markSaved();
    expect(useCoverStore.getState().dirty).toBe(false);
    expect(useCoverStore.getState().scene.layers).toHaveLength(1);
  });
});
