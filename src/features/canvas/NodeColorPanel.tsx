import { Ban, Palette } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, Dialog, DialogTrigger, Popover } from "react-aria-components";
import { Tooltip } from "@/components/ui";
import { useCanvasStore } from "@/features/canvas/store";

const NODE_COLORS = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899"];

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
        className="z-50 w-60 rounded-lg border border-border bg-card/95 p-3 text-foreground shadow-lg backdrop-blur outline-none"
      >
        <Dialog aria-label={t("canvas.nodeColors")} className="flex flex-col gap-3 outline-none">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs text-muted-foreground">{t("canvas.textColor")}</legend>
            <div className="flex items-center gap-1.5">
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
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs text-muted-foreground">
              {t("canvas.backgroundColor")}
            </legend>
            <div className="flex items-center gap-1.5">
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
          </fieldset>
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
