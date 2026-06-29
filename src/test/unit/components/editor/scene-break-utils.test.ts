import { describe, expect, it } from "vitest";

import {
  BUILTIN_SCENE_BREAKS,
  DEFAULT_SCENE_BREAK,
  attrsToDescriptor,
  descriptorToAttrs,
  resolveCustomSymbols,
} from "../../../../components/editor/extensions/scene-break-utils";

describe("resolveCustomSymbols", () => {
  it("repeats a multi-char unit with spacing", () => {
    expect(resolveCustomSymbols("-*-", 3, true)).toBe("-*- -*- -*-");
  });

  it("repeats tightly when not spaced", () => {
    expect(resolveCustomSymbols("-*-", 3, false)).toBe("-*--*--*-");
  });

  it("returns the bare unit for count 1", () => {
    expect(resolveCustomSymbols("-*-", 1, true)).toBe("-*-");
  });

  it("clamps count to at least 1 and trims empty units", () => {
    expect(resolveCustomSymbols("*", 0, true)).toBe("*");
    expect(resolveCustomSymbols("", 3, true)).toBe("");
  });
});

describe("built-ins", () => {
  it("default is three spaced asterisks", () => {
    expect(DEFAULT_SCENE_BREAK).toEqual({ kind: "text", symbols: "* * *" });
  });

  it("includes asterisks and the suit set", () => {
    const symbols = BUILTIN_SCENE_BREAKS.map((d) => d.symbols);
    expect(symbols).toContain("* * *");
    expect(symbols).toContain("♠ ♥ ♦ ♣");
  });
});

describe("descriptor <-> attrs", () => {
  it("round-trips a text descriptor", () => {
    const descriptor = {
      kind: "text",
      symbols: "❧",
      unit: "❧",
      count: 1,
      spaced: true,
    } as const;

    expect(attrsToDescriptor(descriptorToAttrs(descriptor))).toMatchObject(descriptor);
  });

  it("round-trips an image descriptor", () => {
    const descriptor = {
      kind: "image",
      src: "data:image/png;base64,AA",
      alt: "x",
      assetId: "id1",
    } as const;

    expect(attrsToDescriptor(descriptorToAttrs(descriptor))).toMatchObject(descriptor);
  });
});
