/** @jsxImportSource preact */
/**
 * The Reader Frame's six basic controls (#943 unit 2): Button, IconButton,
 * Segmented, Chip, Switch and Slider. They are the Frame's own Preact, so the
 * host's React Aria cannot reach them (ADR 0021); the Frame implements their
 * keyboard behavior here and proves it in `controls.test.tsx`.
 *
 * Every user-visible string is a prop, so the Worker's catalogs own the copy.
 * The kit draws with the tokens in `kit.css`: reading-aware chrome uses
 * `--chrome-*`, the Segmented track and thumb use `--muted`/`--card`, and
 * selected or accented controls use `--primary`.
 */

import type { ComponentChildren, ComponentProps, TargetedKeyboardEvent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { useLayoutMode } from "../use-layout-mode";
import { Icon, type IconName } from "./icons";

/** A tooltip appears only on Wide, after this long under the pointer. */
const TOOLTIP_DELAY_MS = 500;

function classes(...values: Array<string | undefined>): string {
  return values.filter((value) => value !== undefined && value !== "").join(" ");
}

/** The four button intents. */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";

/** The props a Button takes, plus its variant. */
export interface ButtonProps extends Omit<ComponentProps<"button">, "class"> {
  variant?: ButtonVariant;
  class?: string;
}

/** A native button at the chrome's 36 px control height. */
export function Button({
  variant = "secondary",
  type = "button",
  class: extra,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button {...rest} type={type} class={classes("kit-button", `kit-button--${variant}`, extra)}>
      {children}
    </button>
  );
}

/** The props an IconButton takes: an icon, and the one name it always needs. */
export interface IconButtonProps extends Omit<ComponentProps<"button">, "class" | "children"> {
  label: string;
  icon: IconName;
}

/**
 * A square icon control at the layout's target size. The label is always the
 * accessible name; on Wide it also becomes a tooltip after a short hover, which
 * a quick leave cancels.
 */
export function IconButton({ label, icon, type = "button", ...rest }: IconButtonProps) {
  const { mode, target } = useLayoutMode();
  const [tooltip, setTooltip] = useState(false);
  const timer = useRef<number | null>(null);

  const cancel = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const schedule = () => {
    cancel();
    if (mode !== "wide") return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setTooltip(true);
    }, TOOLTIP_DELAY_MS);
  };

  const hide = () => {
    cancel();
    setTooltip(false);
  };

  useEffect(() => cancel, []);

  // Narrow has no tooltip: a mode change hides a shown one and drops a pending
  // timer, so a stale Wide tooltip never survives the resize.
  useEffect(() => {
    if (mode === "wide") return;
    cancel();
    setTooltip(false);
  }, [mode]);

  return (
    <span class="kit-icon-button">
      <button
        {...rest}
        type={type}
        class="kit-icon-button__button"
        aria-label={label}
        style={{ width: `${target}px`, height: `${target}px`, ...styleObject(rest.style) }}
        onPointerEnter={schedule}
        onPointerLeave={hide}
      >
        <Icon name={icon} />
      </button>
      {tooltip ? (
        <span class="kit-tooltip" role="tooltip">
          {label}
        </span>
      ) : null}
    </span>
  );
}

/** Keeps an object style the caller passed; a string style is not merged. */
function styleObject(style: unknown): Record<string, string | number> {
  if (style !== null && typeof style === "object") {
    return style as Record<string, string | number>;
  }
  return {};
}

/** One option in a Segmented control. */
export interface SegmentedOption<T extends string = string> {
  value: T;
  label: string;
}

/** The props a Segmented control takes; selection stays controlled. */
export interface SegmentedProps<T extends string = string> {
  label: string;
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
  class?: string;
}

/**
 * A radio group with one Tab stop. Arrow keys move and select, Home and End
 * select the first and last option, and only the selected option holds the
 * group's tab stop.
 */
export function Segmented<T extends string = string>({
  label,
  value,
  options,
  onChange,
  class: extra,
}: SegmentedProps<T>) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  const select = (index: number) => {
    const option = options[index];
    if (option === undefined) return;
    onChange(option.value);
    buttons.current[index]?.focus();
  };

  const move = (index: number, delta: number) => {
    if (options.length === 0) return;
    select((index + delta + options.length) % options.length);
  };

  const onKeyDown = (event: TargetedKeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        move(index, 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        move(index, -1);
        break;
      case "Home":
        event.preventDefault();
        select(0);
        break;
      case "End":
        event.preventDefault();
        select(options.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <div role="radiogroup" aria-label={label} class={classes("kit-segmented", extra)}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a Frame runs no host React Aria and owns its roving radio group here (ADR 0021).
          <button
            key={option.value}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            class="kit-segmented__option"
            onClick={() => select(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** A Chip that toggles, drawn as one native button. */
export interface ChipToggleProps {
  children: ComponentChildren;
  class?: string;
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
}

/** A Chip that removes, drawn as a label plus its own x button. */
export interface ChipRemovableProps {
  children: ComponentChildren;
  class?: string;
  onRemove: () => void;
  removeLabel: string;
}

/** The props a Chip takes: a toggle, or a removable label. */
export type ChipProps = ChipToggleProps | ChipRemovableProps;

function isRemovable(props: ChipProps): props is ChipRemovableProps {
  return "onRemove" in props;
}

/**
 * A 32 px pill. A toggle is one native button with `aria-pressed`, so Space and
 * Enter already flip it; a removable chip is a plain span with a separate
 * labelled x button, never a button inside a button.
 */
export function Chip(props: ChipProps) {
  if (isRemovable(props)) {
    return (
      <span class={classes("kit-chip", "kit-chip--removable", props.class)}>
        <span class="kit-chip__label">{props.children}</span>
        <button
          type="button"
          class="kit-chip__remove"
          aria-label={props.removeLabel}
          onClick={props.onRemove}
        >
          <Icon name="close" />
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      class={classes("kit-chip", props.class)}
      aria-pressed={props.pressed}
      onClick={() => props.onPressedChange(!props.pressed)}
    >
      {props.children}
    </button>
  );
}

/** The props a Switch takes: its localized label and controlled state. */
export interface SwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  class?: string;
}

/**
 * A whole-row switch: the button is the row, so a click anywhere on the label
 * or track toggles it, and native Space and Enter do too.
 */
export function Switch({ label, checked, onChange, disabled, class: extra }: SwitchProps) {
  const { target } = useLayoutMode();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      class={classes("kit-switch", extra)}
      style={{ minHeight: `${target}px` }}
      onClick={() => onChange(!checked)}
    >
      <span class="kit-switch__label">{label}</span>
      <span class="kit-switch__track" aria-hidden="true">
        <span class="kit-switch__thumb" />
      </span>
    </button>
  );
}

/** The props a Slider takes; labels and value formatting come from the caller. */
export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  decreaseLabel: string;
  increaseLabel: string;
  formatValue: (value: number) => string;
  class?: string;
}

/** A native range with accent, its formatted value, and minus/plus steps. */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  decreaseLabel,
  increaseLabel,
  formatValue,
  class: extra,
}: SliderProps) {
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const stepBy = (delta: number) => {
    const next = clamp(value + delta);
    if (next !== value) onChange(next);
  };

  const onKeyDown = (event: TargetedKeyboardEvent<HTMLInputElement>) => {
    let next: number | null = null;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = clamp(value + step);
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = clamp(value - step);
        break;
      case "Home":
        next = min;
        break;
      case "End":
        next = max;
        break;
      default:
        return;
    }
    event.preventDefault();
    if (next !== value) onChange(next);
  };

  return (
    <div class={classes("kit-slider", extra)}>
      <IconButton label={decreaseLabel} icon="minus" onClick={() => stepBy(-step)} />
      <input
        type="range"
        class="kit-slider__range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onInput={(event) => onChange(clamp(event.currentTarget.valueAsNumber))}
        onKeyDown={onKeyDown}
      />
      <IconButton label={increaseLabel} icon="plus" onClick={() => stepBy(step)} />
      <output class="kit-slider__value">{formatValue(value)}</output>
    </div>
  );
}
