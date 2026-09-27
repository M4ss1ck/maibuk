import { useEffect, useId, useRef, useState } from "react";
import {
  Button,
  ColorArea,
  ColorPicker as AriaColorPicker,
  ColorSlider,
  ColorSwatchPicker,
  ColorSwatchPickerItem,
  ColorThumb,
  Dialog,
  DialogTrigger,
  Input,
  Label,
  Popover,
  SliderTrack,
  TextField,
  parseColor,
} from "react-aria-components";
import { useTranslation } from "react-i18next";
import { contrastRatio, normalizeHexColor } from "@/lib/color";

export const DEFAULT_COLOR_PRESETS = [
  "#000000",
  "#FFFFFF",
  "#EF4444",
  "#F97316",
  "#EAB308",
  "#22C55E",
  "#14B8A6",
  "#3B82F6",
  "#6366F1",
  "#8B5CF6",
  "#EC4899",
  "#374151",
];

const NO_SWATCH = "#0000";

interface ColorPickerControlProps {
  label: string;
  value: string;
  fallbackColor?: string;
  onCommit: (color: string) => void;
  /** A null preview clears an uncommitted change. */
  onPreview?: (color: string | null) => void;
  presets?: readonly string[];
  contrastAgainst?: string | null;
  contrastKind?: "text" | "large-text" | "non-text";
  showUnknownContrast?: boolean;
  className?: string;
  onClear?: () => void;
  clearLabel?: string;
  closeOnPreset?: boolean;
}

export function ColorPickerControl({
  label,
  value,
  fallbackColor = "#000000",
  onCommit,
  onPreview,
  presets = DEFAULT_COLOR_PRESETS,
  contrastAgainst,
  contrastKind = "text",
  showUnknownContrast = false,
  className = "",
  onClear,
  clearLabel,
  closeOnPreset = false,
}: ColorPickerControlProps) {
  const { t } = useTranslation();
  const errorId = useId();
  const displayValue = normalizeHexColor(value) ?? normalizeHexColor(fallbackColor) ?? "#000000";
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(displayValue);
  const [hexDraft, setHexDraft] = useState(draft);
  const [invalid, setInvalid] = useState(false);
  const skipBlurCommit = useRef(false);
  const previewRef = useRef(onPreview);
  previewRef.current = onPreview;

  useEffect(() => () => previewRef.current?.(null), []);

  useEffect(() => {
    if (!open) {
      setDraft(displayValue);
      setHexDraft(displayValue);
    }
  }, [displayValue, open]);

  const clearPreview = () => onPreview?.(null);
  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (next) skipBlurCommit.current = false;
    if (!next) {
      setInvalid(false);
      clearPreview();
    }
  };
  const preview = (color: ReturnType<typeof parseColor>) => {
    const next = color.toString("hex").toUpperCase();
    setDraft(next);
    setHexDraft(next);
    setInvalid(false);
    onPreview?.(next);
  };
  const commit = (candidate: string) => {
    const next = normalizeHexColor(candidate);
    if (!next) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setDraft(next);
    setHexDraft(next);
    clearPreview();
    if (next !== normalizeHexColor(value)) onCommit(next);
  };
  const commitHex = () => commit(hexDraft);
  // An empty stored value is automatic, so no preset is selected; otherwise the swatch
  // matching the fallback would be selected and pressing it would never commit.
  const swatchValue = !normalizeHexColor(value) && draft === displayValue ? NO_SWATCH : draft;
  const hue = parseColor(draft).toFormat("hsb").getChannelValue("hue");
  const threshold = contrastKind === "text" ? 4.5 : 3;
  const lowContrast =
    contrastAgainst && normalizeHexColor(contrastAgainst)
      ? contrastRatio(draft, contrastAgainst) < threshold
      : false;

  return (
    <DialogTrigger isOpen={open} onOpenChange={changeOpen}>
      <Button
        aria-label={label}
        className={`inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background p-1 outline-none focus-visible:ring-2 focus-visible:ring-primary ${className}`}
      >
        <span
          className="size-full rounded border border-border"
          style={{ backgroundColor: open ? draft : value || draft }}
        />
      </Button>
      <Popover
        placement="bottom start"
        className="z-50 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-background p-3 text-foreground shadow-lg outline-none"
      >
        <Dialog aria-label={label} className="flex flex-col gap-3 outline-none">
          <AriaColorPicker
            value={draft}
            onChange={(color) => setDraft(color.toString("hex").toUpperCase())}
          >
            <ColorArea
              colorSpace="hsb"
              xChannel="saturation"
              yChannel="brightness"
              onChange={preview}
              onChangeEnd={(color) => commit(color.toString("hex"))}
              aria-label={t("colorPicker.area")}
              className="relative h-36 w-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary"
              style={{ backgroundColor: `hsl(${hue} 100% 50%)` }}
            >
              <span className="pointer-events-none absolute inset-0 rounded-md bg-gradient-to-r from-white to-transparent" />
              <span className="pointer-events-none absolute inset-0 rounded-md bg-gradient-to-t from-black to-transparent" />
              <ColorThumb className="size-5 rounded-full border-2 border-white shadow-[0_0_0_1px_black] outline-none focus-visible:ring-2 focus-visible:ring-primary" />
            </ColorArea>
            <ColorSlider
              colorSpace="hsb"
              channel="hue"
              onChange={preview}
              onChangeEnd={(color) => commit(color.toString("hex"))}
              className="flex flex-col gap-1"
            >
              <Label className="text-xs font-medium">{t("colorPicker.hue")}</Label>
              <SliderTrack className="relative h-4 rounded-full bg-[linear-gradient(to_right,red,yellow,lime,cyan,blue,magenta,red)]">
                <ColorThumb className="top-1/2 size-5 rounded-full border-2 border-white shadow-[0_0_0_1px_black] outline-none focus-visible:ring-2 focus-visible:ring-primary" />
              </SliderTrack>
            </ColorSlider>
          </AriaColorPicker>

          {presets.length > 0 && (
            <ColorSwatchPicker
              aria-label={t("colorPicker.presets")}
              value={swatchValue}
              onChange={(color) => {
                commit(color.toString("hex"));
                if (closeOnPreset) changeOpen(false);
              }}
              className="grid grid-cols-6 gap-1 pointer-coarse:grid-cols-5 pointer-coarse:gap-2"
            >
              {presets.map((color) => (
                <ColorSwatchPickerItem
                  key={color}
                  color={color}
                  aria-label={t("colorPicker.preset", { color })}
                  className="size-7 pointer-coarse:size-9 rounded border border-border outline-none data-selected:ring-2 data-selected:ring-primary focus-visible:ring-2 focus-visible:ring-primary"
                  style={{ backgroundColor: color }}
                />
              ))}
            </ColorSwatchPicker>
          )}

          <TextField isInvalid={invalid}>
            <Label className="mb-1 block text-xs font-medium">{t("colorPicker.hexValue")}</Label>
            <Input
              value={hexDraft}
              onChange={(event) => {
                setHexDraft(event.target.value);
                setInvalid(false);
              }}
              onBlur={() => {
                if (skipBlurCommit.current) {
                  skipBlurCommit.current = false;
                  return;
                }
                commitHex();
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  skipBlurCommit.current = true;
                  return;
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitHex();
                }
              }}
              aria-describedby={invalid ? errorId : undefined}
              className="w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary data-invalid:border-destructive"
            />
          </TextField>
          {invalid && (
            <p id={errorId} role="alert" className="text-xs text-destructive">
              {t("colorPicker.invalidHex")}
            </p>
          )}
          {onClear && (
            <Button
              onPress={() => {
                onClear();
                changeOpen(false);
              }}
              className="self-end rounded px-2 py-1 text-xs text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
            >
              {clearLabel ?? t("colorPicker.clear")}
            </Button>
          )}
          {lowContrast && (
            <p role="status" className="text-xs text-warning-text">
              {t("colorPicker.lowContrast")}
            </p>
          )}
          {showUnknownContrast && contrastAgainst == null && (
            <p role="status" className="text-xs text-muted-foreground">
              {t("colorPicker.unknownContrast")}
            </p>
          )}
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
