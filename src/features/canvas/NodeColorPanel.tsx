import { Ban, Palette } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, Dialog, DialogTrigger, Popover } from "react-aria-components";
import { Tooltip } from "@/components/ui";
import { useCanvasStore } from "@/features/canvas/store";

const NODE_COLORS = [
  "#7f1d1d",
  "#ef4444",
  "#92400e",
  "#f59e0b",
  "#065f46",
  "#10b981",
  "#1e3a8a",
  "#3b82f6",
  "#4c1d95",
  "#8b5cf6",
  "#831843",
  "#ec4899",
];

const COLOR_PAIRS = [
  { id: "slate", textColor: "#1e293b", backgroundColor: "#e2e8f0" },
  { id: "rose", textColor: "#7f1d1d", backgroundColor: "#fee2e2" },
  { id: "amber", textColor: "#451a03", backgroundColor: "#fef3c7" },
  { id: "emerald", textColor: "#064e3b", backgroundColor: "#d1fae5" },
  { id: "blue", textColor: "#1e3a8a", backgroundColor: "#dbeafe" },
  { id: "violet", textColor: "#4c1d95", backgroundColor: "#ede9fe" },
] as const;

type ColorSwatchProps = {
  color: string;
  label: string;
  selected: boolean;
  onPress: () => void;
};

function ColorSwatch({ color, label, selected, onPress }: ColorSwatchProps) {
  return (
    <Button
      aria-label={`${label}: ${color}`}
      aria-pressed={selected}
      onPress={onPress}
      className="size-6 rounded-full border border-border outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-primary"
      style={{ backgroundColor: color }}
    />
  );
}

export function NodeColorPanel() {
  const { t } = useTranslation();
  const selectedNodeId = useCanvasStore((state) => state.selectedNodeId);
  const selectedNode = useCanvasStore((state) =>
    state.doc.nodes.find((node) => node.id === state.selectedNodeId && node.kind === "text")
  );
  const updateTextNode = useCanvasStore((state) => state.updateTextNode);

  if (!selectedNodeId || selectedNode?.kind !== "text") return null;

  return (
    <DialogTrigger>
      <Tooltip content={t("canvas.nodeColors")}>
        <Button
          aria-label={t("canvas.nodeColors")}
          className="flex size-8 items-center justify-center rounded-lg border border-border bg-card/95 text-foreground shadow-sm backdrop-blur outline-none transition-colors hover:bg-muted data-pressed:border-primary data-pressed:bg-primary/10 data-pressed:text-primary focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Palette className="size-4" aria-hidden="true" />
        </Button>
      </Tooltip>
      <Popover
        placement="bottom end"
        className="z-50 w-64 rounded-lg border border-border bg-card/95 p-3 text-foreground shadow-lg backdrop-blur outline-none"
      >
        <Dialog aria-label={t("canvas.nodeColors")} className="flex flex-col gap-3 outline-none">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs text-muted-foreground">{t("canvas.colorPairs")}</legend>
            <div className="grid grid-cols-6 gap-1.5">
              {COLOR_PAIRS.map((pair) => (
                <Button
                  key={pair.id}
                  aria-label={`${t("canvas.colorPair")}: ${t(`canvas.colorPairNames.${pair.id}`)}`}
                  aria-pressed={
                    selectedNode.textColor === pair.textColor &&
                    selectedNode.backgroundColor === pair.backgroundColor
                  }
                  onPress={() =>
                    updateTextNode(selectedNodeId, {
                      textColor: pair.textColor,
                      backgroundColor: pair.backgroundColor,
                    })
                  }
                  className="flex h-8 items-center justify-center rounded-lg border border-border text-xs font-semibold outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-primary"
                  style={{ color: pair.textColor, backgroundColor: pair.backgroundColor }}
                >
                  Aa
                </Button>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs text-muted-foreground">{t("canvas.textColor")}</legend>
            <div className="grid grid-cols-7 gap-1.5">
              <Button
                aria-label={t("canvas.automaticTextColor")}
                aria-pressed={!selectedNode.textColor}
                onPress={() => updateTextNode(selectedNodeId, { textColor: "" })}
                className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span className="flex size-6 overflow-hidden rounded-full border border-border">
                  <span className="h-full w-1/2 bg-black" />
                  <span className="h-full w-1/2 bg-white" />
                </span>
              </Button>
              {NODE_COLORS.map((color) => (
                <ColorSwatch
                  key={color}
                  color={color}
                  label={t("canvas.textColor")}
                  selected={selectedNode.textColor === color}
                  onPress={() => updateTextNode(selectedNodeId, { textColor: color })}
                />
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="color"
                aria-label={t("canvas.customTextColor")}
                value={selectedNode.textColor ?? "#1c1917"}
                onChange={(event) =>
                  updateTextNode(selectedNodeId, { textColor: event.currentTarget.value })
                }
                className="size-7 cursor-pointer rounded border border-border bg-transparent p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
              {t("canvas.customColor")}
            </label>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs text-muted-foreground">{t("canvas.backgroundColor")}</legend>
            <div className="grid grid-cols-7 gap-1.5">
              <Button
                aria-label={t("canvas.transparentBackground")}
                aria-pressed={!selectedNode.backgroundColor}
                onPress={() => updateTextNode(selectedNodeId, { backgroundColor: "" })}
                className="flex size-6 items-center justify-center rounded-full border border-border bg-transparent text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Ban className="size-4" aria-hidden="true" />
              </Button>
              {NODE_COLORS.map((color) => (
                <ColorSwatch
                  key={color}
                  color={color}
                  label={t("canvas.backgroundColor")}
                  selected={selectedNode.backgroundColor === color}
                  onPress={() => updateTextNode(selectedNodeId, { backgroundColor: color })}
                />
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="color"
                aria-label={t("canvas.customBackgroundColor")}
                value={selectedNode.backgroundColor ?? "#ffffff"}
                onChange={(event) =>
                  updateTextNode(selectedNodeId, { backgroundColor: event.currentTarget.value })
                }
                className="size-7 cursor-pointer rounded border border-border bg-transparent p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
              {t("canvas.customColor")}
            </label>
          </fieldset>
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
