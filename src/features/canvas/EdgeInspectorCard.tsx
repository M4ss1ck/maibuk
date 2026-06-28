import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Switch } from "../../components/ui/Switch";
import type { CanvasEdge } from "./types";

export function EdgeInspectorCard({
  edge,
  labelDraft,
  onLabelChange,
  onLabelCommit,
  onDirectedChange,
  onDelete,
}: {
  edge: CanvasEdge;
  labelDraft: string;
  onLabelChange: (value: string) => void;
  onLabelCommit: () => void;
  onDirectedChange: (directed: boolean) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="absolute right-4 bottom-4 z-20 flex w-56 flex-col gap-3 rounded-lg border border-border bg-card/95 p-3 shadow-lg backdrop-blur">
      <Input
        id="canvas-edge-label"
        label={t("canvas.edgeLabel")}
        value={labelDraft}
        onChange={(event) => onLabelChange(event.target.value)}
        onBlur={onLabelCommit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      <div className="flex items-center gap-2 text-sm">
        <Switch
          checked={edge.directed ?? false}
          onChange={onDirectedChange}
          label={t("canvas.directedEdge")}
        />
        {t("canvas.directedEdge")}
      </div>
      <Button variant="destructive" size="sm" onClick={onDelete}>
        {t("canvas.deleteEdge")}
      </Button>
    </div>
  );
}
