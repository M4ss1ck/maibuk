import { describe, expect, it } from "vitest";
import { loadScene } from "../../../../features/covers/scene/migrate";
import { createDefaultScene } from "../../../../features/covers/scene/defaults";

const fallback = createDefaultScene("6x9").doc;

const legacy = JSON.stringify({
  version: "7.0.0",
  background: "#16213e",
  objects: [
    {
      type: "IText",
      text: "My Title",
      left: 900,
      top: 1350,
      originX: "center",
      originY: "center",
      width: 600,
      height: 90,
      scaleX: 1,
      scaleY: 1,
      angle: 0,
      fontFamily: "Georgia",
      fontSize: 72,
      fontWeight: "bold",
      fontStyle: "normal",
      fill: "#ffffff",
      textAlign: "center",
      lineHeight: 1.2,
      textType: "title",
    },
    {
      type: "image",
      src: "data:image/png;base64,AAA",
      left: 100,
      top: 100,
      originX: "left",
      originY: "top",
      width: 400,
      height: 300,
      scaleX: 0.5,
      scaleY: 0.5,
      angle: 0,
    },
  ],
});

describe("loadScene", () => {
  it("returns a fresh scene for null", () => {
    const s = loadScene(null, fallback);
    expect(s.schemaVersion).toBe(1);
    expect(s.layers).toEqual([]);
  });

  it("returns a fresh scene for unparseable input", () => {
    const s = loadScene("{not json", fallback);
    expect(s.schemaVersion).toBe(1);
    expect(s.layers).toEqual([]);
  });

  it("migrates legacy fabric json to v1", () => {
    const s = loadScene(legacy, fallback);
    expect(s.schemaVersion).toBe(1);
    expect(s.background).toEqual({ type: "solid", color: "#16213e" });
    expect(s.layers).toHaveLength(2);

    const text = s.layers[0];
    expect(text.type).toBe("text");
    if (text.type === "text") {
      expect(text.text).toBe("My Title");
      expect(text.role).toBe("title");
      expect(text.font.family).toBe("Georgia");
      // center origin -> top-left bbox: width=600 -> x = 900 - 300 = 600
      expect(text.x).toBe(600);
      expect(text.y).toBe(1305);
    }

    const img = s.layers[1];
    expect(img.type).toBe("image");
    if (img.type === "image") {
      expect(img.src).toBe("data:image/png;base64,AAA");
      expect(img.width).toBe(200); // 400 * 0.5
      expect(img.x).toBe(100);
    }
  });

  it("passes through an already-v1 scene", () => {
    const v1 = JSON.stringify(loadScene(legacy, fallback));
    const again = loadScene(v1, fallback);
    expect(again.layers).toHaveLength(2);
  });
});
