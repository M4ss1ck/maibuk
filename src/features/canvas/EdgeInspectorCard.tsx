import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import type { CanvasEdge } from "@/features/canvas/types";

export function EdgeInspectorCard({
  edge,
  labelDraft,
  onLabelChange,
  onLabelCommit,
  onDirectedChange,
  onDelete,
  onClose,
}: {
  edge: CanvasEdge;
  labelDraft: string;
  onLabelChange: (value: string) => void;
  onLabelCommit: () => void;
  onDirectedChange: (directed: boolean) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const closeRef = useRef<HTMLButtonElement>(null);

  // Land focus on the dismissal control so keyboard users can escape the
  // inspector immediately without tabbing through the whole card.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <div
      className="flex w-56 flex-col gap-3 rounded-lg border border-border bg-card/95 p-3 shadow-lg backdrop-blur"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex items-center justify-end">
        <Button
          ref={closeRef}
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={onClose}
          aria-label={t("common.close")}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
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
