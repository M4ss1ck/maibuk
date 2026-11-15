import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Label, RadioButton, RadioField, RadioGroup } from "react-aria-components";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ColorPickerControl } from "@/components/ui/ColorPickerControl";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { PEN_COLORS } from "@/features/canvas/PenSettingsPanel";
import {
  CONNECTION_LINE_STYLES,
  CONNECTION_WIDTHS,
  DEFAULT_CONNECTION_WIDTH,
  type ConnectionLineStyle,
  type ConnectionWidth,
  type CanvasEdge,
  type UpdateEdgePatch,
} from "@/features/canvas/types";
import { readThemeColor } from "@/lib/color";

const THICKNESS_NAMES = {
  1: "thin",
  2: "medium",
  4: "thick",
  6: "extraThick",
} as const satisfies Record<ConnectionWidth, string>;

const OPTION_CLASSES =
  "inline-flex min-h-8 cursor-pointer items-center rounded-lg border-2 border-transparent px-1.5 py-1 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground data-selected:border-primary data-selected:text-foreground data-focus-visible:ring-2 data-focus-visible:ring-primary data-focus-visible:ring-offset-1";

const LINE_STYLE_DASHES: Record<ConnectionLineStyle, string | undefined> = {
  solid: undefined,
  dashed: "8 6",
  dotted: "0 6",
};

export function EdgeInspectorCard({
  edge,
  labelDraft,
  onLabelChange,
  onLabelCommit,
  onDirectedChange,
  onStyleChange,
  onColorPreview,
  onDelete,
  onClose,
}: {
  edge: CanvasEdge;
  labelDraft: string;
  onLabelChange: (value: string) => void;
  onLabelCommit: () => void;
  onDirectedChange: (directed: boolean) => void;
  onStyleChange: (patch: Pick<UpdateEdgePatch, "color" | "width" | "lineStyle">) => void;
  onColorPreview: (color: string | null) => void;
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
          // Commit in place instead of blurring: losing focus resets WebKit's
          // Tab order to the top of the page, so the next Tab never reaches
          // the controls below (the directed switch).
          if (event.key === "Enter") {
            event.preventDefault();
            onLabelCommit();
          }
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
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{t("canvas.connectionColor")}</span>
        <ColorPickerControl
          label={t("canvas.connectionColor")}
          value={edge.color ?? ""}
          fallbackColor="#94a3b8"
          presets={PEN_COLORS}
          onPreview={onColorPreview}
          onCommit={(color) => onStyleChange({ color })}
          onClear={() => onStyleChange({ color: "" })}
          clearLabel={t("canvas.defaultConnectionColor")}
          contrastAgainst={() => readThemeColor("--color-background")}
          contrastKind="non-text"
        />
      </div>
      <RadioGroup
        orientation="horizontal"
        value={String(edge.width ?? DEFAULT_CONNECTION_WIDTH)}
        onChange={(value) => onStyleChange({ width: Number(value) as ConnectionWidth })}
        className="flex flex-wrap items-center gap-1"
      >
        <Label className="w-full text-xs text-muted-foreground">
          {t("canvas.connectionThickness")}
        </Label>
        {CONNECTION_WIDTHS.map((width) => (
          <RadioField key={width} value={String(width)} className="contents">
            <RadioButton className={OPTION_CLASSES}>
              <svg
                width={28}
                height={16}
                viewBox="0 0 28 16"
                aria-hidden="true"
                className="shrink-0"
              >
                <line x1="1" y1="8" x2="27" y2="8" stroke="currentColor" strokeWidth={width} />
              </svg>
              <span className="sr-only">
                {t(`canvas.connectionThicknessOptions.${THICKNESS_NAMES[width]}`)}
              </span>
            </RadioButton>
          </RadioField>
        ))}
      </RadioGroup>
      <RadioGroup
        orientation="horizontal"
        value={edge.lineStyle ?? "solid"}
        onChange={(value) => onStyleChange({ lineStyle: value as ConnectionLineStyle })}
        className="flex flex-wrap items-center gap-1"
      >
        <Label className="w-full text-xs text-muted-foreground">{t("canvas.lineStyle")}</Label>
        {CONNECTION_LINE_STYLES.map((style) => (
          <RadioField key={style} value={style} className="contents">
            <RadioButton className={OPTION_CLASSES}>
              <svg
                width={28}
                height={16}
                viewBox="0 0 28 16"
                aria-hidden="true"
                className="shrink-0"
              >
                <line
                  x1="1"
                  y1="8"
                  x2="27"
                  y2="8"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeDasharray={LINE_STYLE_DASHES[style]}
                  strokeLinecap={style === "dotted" ? "round" : undefined}
                />
              </svg>
              <span className="sr-only">{t(`canvas.lineStyles.${style}`)}</span>
            </RadioButton>
          </RadioField>
        ))}
      </RadioGroup>
      <Button variant="destructive" size="sm" onClick={onDelete}>
        {t("canvas.deleteEdge")}
      </Button>
    </div>
  );
}
