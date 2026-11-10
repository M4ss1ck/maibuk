import {
  Label,
  Slider as AriaSlider,
  SliderFill,
  SliderOutput,
  SliderThumb,
  SliderTrack,
} from "react-aria-components";

interface SliderProps {
  /** Visible name of the control. */
  label: string;
  value: number;
  minValue?: number;
  maxValue?: number;
  step?: number;
  onChange: (value: number) => void;
  isDisabled?: boolean;
}

export function Slider({
  label,
  value,
  minValue = 0,
  maxValue = 100,
  step = 1,
  onChange,
  isDisabled = false,
}: SliderProps) {
  return (
    <AriaSlider
      value={value}
      minValue={minValue}
      maxValue={maxValue}
      step={step}
      isDisabled={isDisabled}
      onChange={(next) => {
        if (typeof next === "number") onChange(next);
      }}
      className="flex w-full flex-col gap-1.5 data-disabled:opacity-50"
    >
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-sm font-medium text-foreground">{label}</Label>
        <SliderOutput className="text-sm tabular-nums text-muted-foreground" />
      </div>
      <SliderTrack className="relative h-2 w-full touch-none rounded-full bg-muted">
        <SliderFill className="absolute h-full rounded-full bg-primary" />
        <SliderThumb className="top-1/2 size-5 cursor-grab rounded-full border-2 border-primary bg-card shadow outline-none data-dragging:cursor-grabbing data-focus-visible:ring-2 data-focus-visible:ring-primary data-focus-visible:ring-offset-2 data-focus-visible:ring-offset-background pointer-coarse:size-7" />
      </SliderTrack>
    </AriaSlider>
  );
}
