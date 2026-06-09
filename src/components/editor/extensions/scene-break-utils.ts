export type SceneBreakDescriptor =
  | {
      kind: "text";
      symbols: string;
      unit?: string;
      count?: number;
      spaced?: boolean;
    }
  | { kind: "image"; src: string; alt?: string; assetId?: string };

export interface SceneBreakAttrs {
  kind: "text" | "image";
  symbols: string;
  unit: string | null;
  count: number | null;
  spaced: boolean;
  src: string | null;
  assetId: string | null;
  alt: string | null;
}

export const DEFAULT_SCENE_BREAK: SceneBreakDescriptor = {
  kind: "text",
  symbols: "* * *",
};

export const BUILTIN_SCENE_BREAKS: Array<
  Extract<SceneBreakDescriptor, { kind: "text" }>
> = [
  { kind: "text", symbols: "* * *" },
  { kind: "text", symbols: "♠ ♥ ♦ ♣" },
];

export function resolveCustomSymbols(
  unit: string,
  count: number,
  spaced: boolean,
): string {
  if (!unit) return "";
  const n = Math.max(1, Math.floor(count) || 1);
  return Array(n).fill(unit).join(spaced ? " " : "");
}

export function descriptorToAttrs(
  descriptor: SceneBreakDescriptor,
): SceneBreakAttrs {
  if (descriptor.kind === "image") {
    return {
      kind: "image",
      symbols: "",
      unit: null,
      count: null,
      spaced: true,
      src: descriptor.src,
      assetId: descriptor.assetId ?? null,
      alt: descriptor.alt ?? null,
    };
  }

  return {
    kind: "text",
    symbols: descriptor.symbols,
    unit: descriptor.unit ?? null,
    count: descriptor.count ?? null,
    spaced: descriptor.spaced ?? true,
    src: null,
    assetId: null,
    alt: null,
  };
}

export function attrsToDescriptor(
  attrs: SceneBreakAttrs,
): SceneBreakDescriptor {
  if (attrs.kind === "image") {
    return {
      kind: "image",
      src: attrs.src ?? "",
      alt: attrs.alt ?? undefined,
      assetId: attrs.assetId ?? undefined,
    };
  }

  return {
    kind: "text",
    symbols: attrs.symbols,
    unit: attrs.unit ?? undefined,
    count: attrs.count ?? undefined,
    spaced: attrs.spaced,
  };
}
