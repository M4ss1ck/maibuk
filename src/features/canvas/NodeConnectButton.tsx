import { Spline } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "react-aria-components";
import { Tooltip } from "@/components/ui";
import { useCanvasStore } from "@/features/canvas/store";

/** Side-panel entry to the Connect to… picker for the selected node. */
export function NodeConnectButton() {
  const { t } = useTranslation();
  const selectedNodeId = useCanvasStore((state) => state.selectedNodeId);
  const openConnectPicker = useCanvasStore((state) => state.openConnectPicker);

  if (!selectedNodeId) return null;

  return (
    <Tooltip content={t("canvas.connectTo")}>
      <Button
        aria-label={t("canvas.connectTo")}
        onPress={() => openConnectPicker(selectedNodeId)}
        className="flex size-8 pointer-coarse:size-10 items-center justify-center rounded-lg border border-border bg-card/95 text-foreground shadow-sm backdrop-blur outline-none transition-colors hover:bg-muted data-pressed:border-primary data-pressed:bg-primary/10 data-pressed:text-primary focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Spline className="size-4" aria-hidden="true" />
      </Button>
    </Tooltip>
  );
}
