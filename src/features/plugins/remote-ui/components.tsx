/**
 * The host half of host-rendered Plugin UI (ADR 0021): every kit tag maps to a
 * Maibuk component. React Aria owns focus, keyboard behavior, and typing; the
 * host, never the Worker, holds the live value of a text field (the in-flight
 * echo rule in `echo.ts`).
 *
 * A kit action forwards to the Plugin's own event listener (`onPress`, ...),
 * never to a Maibuk Command: a Plugin cannot run Maibuk Commands in v1
 * (ADR 0019), and the Command registry is for Maibuk's own actions (#428).
 *
 * The map is exhaustive over `PLUGIN_UI_TABLE`: a tag with no host renderer is
 * a type error, and the coverage gate fails when a table component has no test.
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import {
  FieldError,
  Input as AriaInput,
  Label as AriaLabel,
  Text as AriaText,
  TextArea as AriaTextArea,
  TextField as AriaTextField,
} from "react-aria-components/TextField";
import { NumberField as AriaNumberField } from "react-aria-components/NumberField";
import {
  RadioGroup as AriaRadioGroup,
  RadioButton,
  RadioField,
} from "react-aria-components/RadioGroup";
import { Link as AriaLink } from "react-aria-components/Link";
import { Tabs as AriaTabs, TabList, Tab, TabPanel } from "react-aria-components/Tabs";
import { Disclosure as AriaDisclosure, DisclosurePanel } from "react-aria-components/Disclosure";
import { Button as AriaButton } from "react-aria-components/Button";
import { Heading as AriaHeading } from "react-aria-components/Heading";
import { ProgressBar as AriaProgressBar } from "react-aria-components/ProgressBar";
import { ListBox, ListBoxItem } from "react-aria-components/ListBox";
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useMergeRefs,
  useRole,
} from "@floating-ui/react";
import { DialogTrigger, Dialog, Popover as AriaPopover } from "react-aria-components/Popover";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  createRemoteComponentRenderer,
  type RemoteComponentRendererMap,
} from "@remote-dom/react/host";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Combobox } from "@/components/ui/Combobox";
import { ItemActionsMenu } from "@/components/ui/ItemActionsMenu";
import { Modal } from "@/components/ui/Modal";
import { MultiSelectCombobox } from "@/components/ui/MultiSelectCombobox";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { Tooltip } from "@/components/ui/Tooltip";
import { PluginIcon } from "@/components/plugins/PluginIcon";
import { PluginFrame, type PluginFrameHost } from "@/components/plugins/PluginFrame";
import { scopePluginCss } from "@/features/plugins/remote-ui/css-scope";
import { createEchoTracker, type PluginEchoTracker } from "@/features/plugins/remote-ui/echo";
import { useItemContextMenu, useRestoreFocus } from "@/hooks";
import { openExternal } from "@/lib/platform";
import { PLUGIN_UI_TABLE } from "@/plugin-sdk/ui-table";
import type { PluginUiOption } from "@/plugin-sdk/ui.generated";

/** The shared input look, matching `src/components/ui/Input.tsx`. */
const INPUT_CLASS =
  "w-full px-3 py-2 border rounded-lg bg-background text-foreground transition-colors border-border focus:border-primary focus:ring-primary focus:outline-none focus:ring-2 focus:ring-offset-0 placeholder:text-muted-foreground";

/**
 * The host's live value for a field, with the in-flight echo rule: keystrokes
 * update the host's own state and notify the Plugin; the Plugin's echo is
 * applied only when the host never sent that value.
 */
function useHostValue(remote: string | undefined, onInput?: (value: string) => void) {
  const tracker = useRef<PluginEchoTracker | null>(null);
  tracker.current ??= createEchoTracker();
  const [local, setLocal] = useState(remote ?? "");
  useEffect(() => {
    if (remote === undefined) return;
    if (tracker.current?.shouldApply(remote)) setLocal(remote);
  }, [remote]);
  const send = useCallback(
    (next: string) => {
      tracker.current?.sent(next);
      setLocal(next);
      onInput?.(next);
    },
    [onInput]
  );
  return { local, send };
}

/** The number a NumberField's raw text stands for; empty or partial is undefined. */
function parseNumber(text: string): number | undefined {
  if (text.trim() === "") return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

/** The number clamped into a field's optional min/max bounds. */
function clampNumber(
  value: number,
  minValue: number | undefined,
  maxValue: number | undefined
): number {
  let clamped = value;
  if (minValue !== undefined && clamped < minValue) clamped = minValue;
  if (maxValue !== undefined && clamped > maxValue) clamped = maxValue;
  return clamped;
}

interface TextFieldHostProps {
  label: string;
  type?: "text" | "password" | "search";
  value?: string;
  placeholder?: string;
  description?: string;
  errorMessage?: string;
  isRequired?: boolean;
  isDisabled?: boolean;
  isReadOnly?: boolean;
  autoFocus?: boolean;
  onInput?: (value: string) => void;
  onChange?: (value: string) => void;
}

function TextFieldHost({
  label,
  type = "text",
  value,
  placeholder,
  description,
  errorMessage,
  isRequired,
  isDisabled,
  isReadOnly,
  autoFocus,
  onInput,
  onChange,
}: TextFieldHostProps) {
  const { local, send } = useHostValue(value, onInput);
  return (
    <AriaTextField
      value={local}
      onChange={send}
      isRequired={isRequired}
      isDisabled={isDisabled}
      isReadOnly={isReadOnly}
      autoFocus={autoFocus}
      isInvalid={errorMessage !== undefined}
      className="w-full"
    >
      <AriaLabel className="block text-sm font-medium mb-1.5">{label}</AriaLabel>
      <AriaInput
        type={type}
        placeholder={placeholder}
        className={INPUT_CLASS}
        onKeyDown={(event) => {
          if (event.key === "Enter") onChange?.(local);
        }}
        onBlur={() => onChange?.(local)}
      />
      {description && (
        <AriaText slot="description" className="mt-1 block text-sm text-muted-foreground">
          {description}
        </AriaText>
      )}
      <FieldError className="mt-1 block text-sm text-destructive">{errorMessage}</FieldError>
    </AriaTextField>
  );
}

interface TextAreaHostProps {
  label: string;
  value?: string;
  placeholder?: string;
  rows?: number;
  description?: string;
  errorMessage?: string;
  isRequired?: boolean;
  isDisabled?: boolean;
  isReadOnly?: boolean;
  autoFocus?: boolean;
  onInput?: (value: string) => void;
  onChange?: (value: string) => void;
}

function TextAreaHost({
  label,
  value,
  placeholder,
  rows = 4,
  description,
  errorMessage,
  isRequired,
  isDisabled,
  isReadOnly,
  autoFocus,
  onInput,
  onChange,
}: TextAreaHostProps) {
  const { local, send } = useHostValue(value, onInput);
  return (
    <AriaTextField
      value={local}
      onChange={send}
      isRequired={isRequired}
      isDisabled={isDisabled}
      isReadOnly={isReadOnly}
      autoFocus={autoFocus}
      isInvalid={errorMessage !== undefined}
      className="w-full"
    >
      <AriaLabel className="block text-sm font-medium mb-1.5">{label}</AriaLabel>
      <AriaTextArea
        rows={rows}
        placeholder={placeholder}
        className={INPUT_CLASS}
        onBlur={() => onChange?.(local)}
      />
      {description && (
        <AriaText slot="description" className="mt-1 block text-sm text-muted-foreground">
          {description}
        </AriaText>
      )}
      <FieldError className="mt-1 block text-sm text-destructive">{errorMessage}</FieldError>
    </AriaTextField>
  );
}

interface NumberFieldHostProps {
  label: string;
  value?: number;
  minValue?: number;
  maxValue?: number;
  step?: number;
  description?: string;
  errorMessage?: string;
  isRequired?: boolean;
  isDisabled?: boolean;
  onInput?: (value: number) => void;
  onChange?: (value: number) => void;
}

function NumberFieldHost({
  label,
  value,
  minValue,
  maxValue,
  step,
  description,
  errorMessage,
  isRequired,
  isDisabled,
  onInput,
  onChange,
}: NumberFieldHostProps) {
  // React Aria owns the field's text; the host feeds it only the committed
  // number, so typing never snaps. Feeding the typed value back through the
  // controlled `value` made React Aria clamp mid-keystroke (typing 120 into a
  // 10-200 field landed on 200); instead the input shows exactly what is typed
  // and only blur, Enter, or stepping parse and clamp it (#450).
  const [committed, setCommitted] = useState<number | undefined>(value);
  // The in-flight echo rule, as for the text fields: a value the host did not
  // report is a programmatic reset, while an echo of a reported value is
  // dropped so a burst of keystrokes is never rolled back.
  const tracker = useRef<PluginEchoTracker | null>(null);
  tracker.current ??= createEchoTracker();
  // The number the host last reported, so a repeated commit is not sent twice
  // and an echo of it is not read as a reset.
  const reported = useRef<number | undefined>(value);
  useEffect(() => {
    if (value === undefined) return;
    if (!tracker.current?.shouldApply(String(value))) return;
    reported.current = value;
    setCommitted(value);
  }, [value]);
  const report = useCallback(
    (next: number | undefined) => {
      if (next === undefined) return;
      tracker.current?.sent(String(next));
      if (reported.current === next) return;
      reported.current = next;
      setCommitted(next);
      onChange?.(next);
    },
    [onChange]
  );
  return (
    <AriaNumberField
      // A controlled committed number: stable while typing, updated on commit
      // and on a programmatic reset. React Aria reports the parsed, min/max-
      // clamped number through `onChange` on commit (blur, Enter, stepping).
      value={committed}
      onChange={(next) => {
        if (Number.isFinite(next)) report(clampNumber(next, minValue, maxValue));
      }}
      minValue={minValue}
      maxValue={maxValue}
      step={step}
      isRequired={isRequired}
      isDisabled={isDisabled}
      isInvalid={errorMessage !== undefined}
      className="w-full"
    >
      <AriaLabel className="block text-sm font-medium mb-1.5">{label}</AriaLabel>
      <AriaInput
        className={INPUT_CLASS}
        // Live typing is reported to the Plugin the way a text field reports
        // each keystroke, without ever changing the controlled committed value.
        onInput={(event) => {
          const parsed = parseNumber(event.currentTarget.value);
          if (parsed === undefined) return;
          tracker.current?.sent(String(parsed));
          onInput?.(parsed);
        }}
      />
      {description && (
        <AriaText slot="description" className="mt-1 block text-sm text-muted-foreground">
          {description}
        </AriaText>
      )}
      <FieldError className="mt-1 block text-sm text-destructive">{errorMessage}</FieldError>
    </AriaNumberField>
  );
}

interface CheckboxHostProps {
  label: string;
  isSelected?: boolean;
  isIndeterminate?: boolean;
  description?: string;
  isDisabled?: boolean;
  onChange?: (checked: boolean) => void;
}

function CheckboxHost({
  label,
  isSelected = false,
  isIndeterminate,
  description,
  isDisabled,
  onChange,
}: CheckboxHostProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Checkbox
          id={id}
          checked={isSelected}
          indeterminate={isIndeterminate}
          disabled={isDisabled}
          label={label}
          onChange={(checked) => onChange?.(checked)}
        />
        <label htmlFor={id} className="text-sm text-foreground">
          {label}
        </label>
      </div>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

interface SwitchHostProps {
  label: string;
  isSelected?: boolean;
  description?: string;
  isDisabled?: boolean;
  onChange?: (checked: boolean) => void;
}

function SwitchHost({
  label,
  isSelected = false,
  description,
  isDisabled,
  onChange,
}: SwitchHostProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Switch
          id={id}
          checked={isSelected}
          disabled={isDisabled}
          onChange={(checked) => onChange?.(checked)}
        />
        <label htmlFor={id} className="text-sm text-foreground">
          {label}
        </label>
      </div>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

/** Options keyed by value for the label↔value mapping the shared controls use. */
function optionMaps(options: readonly PluginUiOption[]) {
  const labelToValue = new Map<string, string>();
  for (const option of options) labelToValue.set(option.label, option.value);
  return { labels: options.map((option) => option.label), labelToValue };
}

interface SelectHostProps {
  label: string;
  options: readonly PluginUiOption[];
  selectedKey?: string;
  placeholder?: string;
  description?: string;
  isDisabled?: boolean;
  errorMessage?: string;
  onChange?: (value: string) => void;
}

function SelectHost({
  label,
  options,
  selectedKey = "",
  placeholder,
  description,
  isDisabled,
  errorMessage,
  onChange,
}: SelectHostProps) {
  const id = useId();
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const describedBy = [description ? descriptionId : null, errorMessage ? errorId : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="w-full">
      <label htmlFor={id} className="block text-sm font-medium mb-1.5">
        {label}
      </label>
      <Select
        id={id}
        value={selectedKey}
        options={[...options]}
        ariaLabel={label}
        isDisabled={isDisabled}
        isInvalid={errorMessage !== undefined}
        ariaDescribedBy={describedBy || undefined}
        onChange={(value) => onChange?.(String(value))}
        {...(placeholder === undefined ? {} : { placeholder })}
      />
      {description && (
        <p id={descriptionId} className="mt-1 text-sm text-muted-foreground">
          {description}
        </p>
      )}
      {errorMessage && (
        <p id={errorId} className="mt-1 text-sm text-destructive">
          {errorMessage}
        </p>
      )}
    </div>
  );
}

interface ComboboxHostProps {
  label: string;
  options: readonly PluginUiOption[];
  selectedKey?: string;
  placeholder?: string;
  isDisabled?: boolean;
  errorMessage?: string;
  onChange?: (value: string) => void;
}

function ComboboxHost({
  label,
  options,
  selectedKey = "",
  placeholder,
  errorMessage,
  isDisabled,
  onChange,
}: ComboboxHostProps) {
  const { labels, labelToValue } = optionMaps(options);
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="w-full">
      <label htmlFor={id} className="block text-sm font-medium mb-1.5">
        {label}
      </label>
      <Combobox
        value={selectedKey}
        options={labels}
        ariaLabel={label}
        id={id}
        inputClasses="w-40"
        isDisabled={isDisabled}
        isInvalid={errorMessage !== undefined}
        ariaDescribedBy={errorMessage ? errorId : undefined}
        {...(placeholder === undefined ? {} : { placeholder })}
        onChange={(next) => onChange?.(labelToValue.get(next) ?? next)}
      />
      {errorMessage && (
        <p id={errorId} className="mt-1 text-sm text-destructive">
          {errorMessage}
        </p>
      )}
    </div>
  );
}

interface MultiSelectComboboxHostProps {
  label: string;
  options: readonly PluginUiOption[];
  selectedKeys?: readonly string[];
  placeholder?: string;
  allowsCustomValue?: boolean;
  isDisabled?: boolean;
  errorMessage?: string;
  onChange?: (values: readonly string[]) => void;
}

function MultiSelectComboboxHost({
  label,
  options,
  selectedKeys = [],
  placeholder,
  allowsCustomValue,
  isDisabled,
  errorMessage,
  onChange,
}: MultiSelectComboboxHostProps) {
  const { t } = useTranslation();
  const { labels, labelToValue } = optionMaps(options);
  const value = selectedKeys.map((key) => labelToValue.get(key) ?? key);
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="w-full">
      <label htmlFor={id} className="block text-sm font-medium mb-1.5">
        {label}
      </label>
      <MultiSelectCombobox
        id={id}
        value={[...value]}
        options={labels}
        allowCustom={allowsCustomValue}
        ariaLabel={label}
        isDisabled={isDisabled}
        isInvalid={errorMessage !== undefined}
        ariaDescribedBy={errorMessage ? errorId : undefined}
        removeLabel={(item) => t("plugins.ui.removeValue", { value: item })}
        onChange={(next) => onChange?.(next.map((item) => labelToValue.get(item) ?? item))}
        {...(placeholder === undefined ? {} : { placeholder })}
      />
      {errorMessage && (
        <p id={errorId} className="mt-1 text-sm text-destructive">
          {errorMessage}
        </p>
      )}
    </div>
  );
}

interface RadioGroupHostProps {
  label: string;
  options: readonly PluginUiOption[];
  selectedKey?: string;
  orientation?: "horizontal" | "vertical";
  description?: string;
  errorMessage?: string;
  isDisabled?: boolean;
  onChange?: (value: string) => void;
}

function RadioGroupHost({
  label,
  options,
  selectedKey = "",
  orientation = "vertical",
  description,
  errorMessage,
  isDisabled,
  onChange,
}: RadioGroupHostProps) {
  return (
    <AriaRadioGroup
      value={selectedKey}
      onChange={(value) => onChange?.(value)}
      orientation={orientation}
      isDisabled={isDisabled}
      isInvalid={errorMessage !== undefined}
      className="w-full"
    >
      <AriaLabel className="block text-sm font-medium mb-1.5">{label}</AriaLabel>
      <div
        className={orientation === "horizontal" ? "flex flex-wrap gap-4" : "flex flex-col gap-2"}
      >
        {options.map((option) => (
          <RadioField key={option.value} value={option.value} className="contents">
            <RadioButton className="group flex items-center gap-2 text-sm text-foreground data-focus-visible:ring-2 data-focus-visible:ring-primary">
              <span className="flex size-4 items-center justify-center rounded-full border border-muted-foreground">
                <span className="size-2 rounded-full bg-current opacity-0 group-data-selected:opacity-100" />
              </span>
              {option.label}
            </RadioButton>
          </RadioField>
        ))}
      </div>
      {description && (
        <AriaText slot="description" className="mt-1 text-sm text-muted-foreground">
          {description}
        </AriaText>
      )}
      {errorMessage && (
        <FieldError className="mt-1 text-sm text-destructive">{errorMessage}</FieldError>
      )}
    </AriaRadioGroup>
  );
}

interface ButtonHostProps {
  variant?: "primary" | "secondary" | "ghost" | "destructive";
  size?: "sm" | "md" | "lg";
  icon?: string;
  isDisabled?: boolean;
  children?: ReactNode;
  onPress?: () => void;
}

function ButtonHost({
  variant = "primary",
  size = "md",
  icon,
  isDisabled,
  children,
  onPress,
}: ButtonHostProps) {
  return (
    <Button variant={variant} size={size} disabled={isDisabled} onClick={() => onPress?.()}>
      {icon && <PluginIcon icon={icon} className="h-4 w-4" />}
      {children}
    </Button>
  );
}

interface IconButtonHostProps {
  label: string;
  icon: string;
  variant?: "primary" | "secondary" | "ghost" | "destructive";
  isDisabled?: boolean;
  onPress?: () => void;
}

function IconButtonHost({
  label,
  icon,
  variant = "ghost",
  isDisabled,
  onPress,
}: IconButtonHostProps) {
  return (
    <Button
      variant={variant}
      size="sm"
      aria-label={label}
      disabled={isDisabled}
      onClick={() => onPress?.()}
      className="px-2 pointer-coarse:min-h-10 pointer-coarse:min-w-10"
    >
      <PluginIcon icon={icon} className="h-4 w-4" />
    </Button>
  );
}

interface LinkHostProps {
  href: string;
  isDisabled?: boolean;
  children?: ReactNode;
  onPress?: () => void;
}

function LinkHost({ href, isDisabled, children, onPress }: LinkHostProps) {
  return (
    <AriaLink
      href={href}
      isDisabled={isDisabled}
      // A Plugin link never navigates Maibuk: an https href would replace the
      // webview (on desktop, the whole app). Prevent the client/native
      // navigation and hand the URL to the platform opener instead.
      onClick={(event) => {
        event.preventDefault();
        void openExternal(href);
      }}
      onPress={() => onPress?.()}
      className="text-primary underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-primary"
    >
      {children}
    </AriaLink>
  );
}

const ALIGN: Record<string, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
};
const JUSTIFY: Record<string, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
};
const GAP: Record<string, string> = { none: "gap-0", sm: "gap-2", md: "gap-4", lg: "gap-6" };
const PADDING: Record<string, string> = { none: "p-0", sm: "p-2", md: "p-4", lg: "p-6" };

function ViewHost({
  direction = "column",
  gap = "md",
  align = "stretch",
  justify = "start",
  wrap,
  padding = "none",
  children,
}: {
  direction?: "row" | "column";
  gap?: keyof typeof GAP;
  align?: keyof typeof ALIGN;
  justify?: keyof typeof JUSTIFY;
  wrap?: boolean;
  padding?: keyof typeof PADDING;
  children?: ReactNode;
}) {
  return (
    <div
      className={`flex ${direction === "row" ? "flex-row" : "flex-col"} ${GAP[gap]} ${ALIGN[align]} ${JUSTIFY[justify]} ${PADDING[padding]} ${wrap ? "flex-wrap" : ""}`}
    >
      {children}
    </div>
  );
}

const TEXT_TONE: Record<string, string> = {
  default: "text-foreground",
  muted: "text-muted-foreground",
  danger: "text-destructive",
  success: "text-success",
  primary: "text-primary",
};
const TEXT_SIZE: Record<string, string> = { sm: "text-sm", md: "text-base", lg: "text-lg" };
const TEXT_WEIGHT: Record<string, string> = {
  normal: "font-normal",
  medium: "font-medium",
  semibold: "font-semibold",
};

function TextHost({
  tone = "default",
  size = "md",
  weight = "normal",
  children,
}: {
  tone?: keyof typeof TEXT_TONE;
  size?: keyof typeof TEXT_SIZE;
  weight?: keyof typeof TEXT_WEIGHT;
  children?: ReactNode;
}) {
  return (
    <p className={`${TEXT_TONE[tone]} ${TEXT_SIZE[size]} ${TEXT_WEIGHT[weight]}`}>{children}</p>
  );
}

function HeadingHost({ level = 2, children }: { level?: number; children?: ReactNode }) {
  const safe = Math.min(6, Math.max(1, Math.round(level)));
  return (
    <AriaHeadingTag level={safe} className="font-semibold tracking-tight">
      {children}
    </AriaHeadingTag>
  );
}

function AriaHeadingTag({ level, ...props }: { level: number; [key: string]: unknown }) {
  const Tag = `h${level}` as "h1";
  return <Tag {...(props as Record<string, unknown>)} />;
}

function SeparatorHost({
  orientation = "horizontal",
}: {
  orientation?: "horizontal" | "vertical";
}) {
  return orientation === "vertical" ? (
    <span aria-hidden="true" className="mx-2 inline-block h-4 w-px bg-border" />
  ) : (
    <hr className="my-2 border-border" />
  );
}

const ICON_SIZE: Record<string, string> = { sm: "h-4 w-4", md: "h-5 w-5", lg: "h-6 w-6" };

function IconHost({
  name,
  label,
  size = "md",
  tone = "default",
}: {
  name: string;
  label?: string;
  size?: keyof typeof ICON_SIZE;
  tone?: keyof typeof TEXT_TONE;
}) {
  if (label === undefined) {
    return (
      <span aria-hidden="true" className={`inline-flex ${TEXT_TONE[tone]}`}>
        <PluginIcon icon={name} className={ICON_SIZE[size]} />
      </span>
    );
  }
  return (
    <span role="img" aria-label={label} className={`inline-flex ${TEXT_TONE[tone]}`}>
      <PluginIcon icon={name} className={ICON_SIZE[size]} />
    </span>
  );
}

function ImageHost({
  src,
  alt,
  width,
  height,
}: {
  src: string;
  alt: string;
  width?: number;
  height?: number;
}) {
  return (
    <img src={src} alt={alt} width={width} height={height} className="max-w-full rounded-lg" />
  );
}

function ListHost({
  marker = "bullet",
  children,
}: {
  marker?: "none" | "bullet" | "number";
  children?: ReactNode;
}) {
  if (marker === "number") return <ol className="list-decimal pl-5">{children}</ol>;
  return <ul className={marker === "bullet" ? "list-disc pl-5" : "list-none"}>{children}</ul>;
}

function ListItemHost({ children }: { children?: ReactNode }) {
  return <li>{children}</li>;
}

function CodeHost({ block, children }: { block?: boolean; children?: ReactNode }) {
  if (block) {
    return (
      <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-sm">
        <code className="font-mono text-foreground">{children}</code>
      </pre>
    );
  }
  return (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-sm text-foreground">
      {children}
    </code>
  );
}

/** Organization: tabs, disclosure, collections, tables (#439). */

/**
 * Open state the host mirrors from a Plugin prop, shared by the overlays and
 * the disclosure. A host-driven close (Escape, an outside press, a row
 * activation) applies immediately and tells the Plugin; a Plugin-driven change
 * arrives as the prop on a later render. The mirror is deliberate: it is what
 * lets the host dismiss an overlay even when the Worker is stopped and never
 * echoes the change back.
 *
 * The overlays carry an internal `openSeq` (the disclosure does not). When the
 * Worker answers a host dismissal, the SDK bumps `openSeq` even if the Plugin's
 * batched state nets to no change, so the host sees a newer count and re-syncs
 * `open` to `isOpen`: the Plugin's `isOpen` is authoritative again, and a
 * batched false→true reopens the dialog. A stopped Worker never answers, so the
 * dialog stays closed. The counter speaks for the Plugin only when the Plugin
 * passes `isOpen`: an uncontrolled overlay (a Popover with no `isOpen`) stays
 * host-owned, and without an `openSeq` (the disclosure, a row) only a real
 * `isOpen` change re-syncs, as before.
 */
function useMirroredOpen(
  isOpen: boolean | undefined,
  onOpenChange?: (open: boolean) => void,
  openSeq?: number
): [boolean, (next: boolean) => void] {
  const [open, setOpen] = useState(isOpen ?? false);
  const previousIsOpen = useRef(isOpen);
  const previousOpenSeq = useRef(openSeq);
  useEffect(() => {
    const isOpenChanged = isOpen !== previousIsOpen.current;
    // `openSeq` is the answer channel of a Plugin-controlled overlay: it only
    // speaks for the Plugin when the Plugin passes `isOpen`. An overlay with no
    // `isOpen` (an uncontrolled Popover) stays host-owned, so its `openSeq` is
    // ignored and only a real `isOpen` change (there is none) would re-sync.
    const openSeqChanged =
      openSeq !== undefined && isOpen !== undefined && openSeq !== previousOpenSeq.current;
    if (!isOpenChanged && !openSeqChanged) return;
    previousIsOpen.current = isOpen;
    previousOpenSeq.current = openSeq;
    setOpen(isOpen ?? false);
  }, [isOpen, openSeq]);
  const set = useCallback(
    (next: boolean) => {
      setOpen(next);
      // The notification is best-effort: a stopped Worker's event channel throws
      // or rejects when called, and the host's dismissal must not depend on the
      // Plugin receiving it.
      try {
        void Promise.resolve(onOpenChange?.(next)).catch(() => {});
      } catch {
        // The Worker is gone; there is nobody to tell.
      }
    },
    [onOpenChange]
  );
  return [open, set];
}

/** The disclosure and expandable-row chevron; decorative, the row owns the control. */
function Chevron({ expanded }: { expanded: boolean }) {
  return expanded ? (
    <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
  ) : (
    <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
  );
}

interface TabsHostProps {
  label: string;
  items: readonly PluginUiOption[];
  selectedKey?: string;
  children?: ReactNode;
  onChange?: (key: string) => void;
}

function TabsHost({ label, items, selectedKey, children, onChange }: TabsHostProps) {
  const activeKey = selectedKey ?? items[0]?.value ?? "";
  return (
    <AriaTabs
      selectedKey={activeKey}
      onSelectionChange={(key) => onChange?.(String(key))}
      className="w-full"
    >
      <TabList aria-label={label} className="flex flex-wrap gap-1 border-b border-border pb-px">
        {items.map((item) => (
          <Tab
            key={item.value}
            id={item.value}
            className="-mb-px cursor-pointer rounded-t-lg border-b-2 border-transparent px-3 py-1.5 text-sm text-muted-foreground outline-none transition-colors data-selected:border-primary data-selected:text-foreground data-focus-visible:ring-2 data-focus-visible:ring-primary"
          >
            {item.label}
          </Tab>
        ))}
      </TabList>
      <TabPanel id={activeKey} className="pt-3 outline-none">
        {children}
      </TabPanel>
    </AriaTabs>
  );
}

interface DisclosureHostProps {
  label: string;
  isExpanded?: boolean;
  isDisabled?: boolean;
  children?: ReactNode;
  onExpandedChange?: (expanded: boolean) => void;
}

function DisclosureHost({
  label,
  isExpanded,
  isDisabled,
  children,
  onExpandedChange,
}: DisclosureHostProps) {
  const [expanded, setExpanded] = useMirroredOpen(isExpanded, onExpandedChange);
  return (
    <AriaDisclosure
      isExpanded={expanded}
      onExpandedChange={setExpanded}
      isDisabled={isDisabled}
      className="w-full"
    >
      <AriaHeading className="m-0">
        <AriaButton
          slot="trigger"
          className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-medium text-foreground outline-none transition-colors hover:bg-muted data-focus-visible:ring-2 data-focus-visible:ring-primary"
        >
          <Chevron expanded={expanded} />
          {label}
        </AriaButton>
      </AriaHeading>
      <DisclosurePanel className="px-2 py-1.5 text-sm text-foreground outline-none">
        {children}
      </DisclosurePanel>
    </AriaDisclosure>
  );
}

interface CollectionHostProps {
  label: string;
  selectionMode?: "none" | "single" | "multiple";
  selectedKeys?: readonly string[];
  children?: ReactNode;
  onSelectionChange?: (keys: readonly string[]) => void;
}

/** The shortest a Collection may shrink to: 5 rows at 2.4rem ≈ 12rem. */
const COLLECTION_MIN_HEIGHT_PX = 192;
/** The Collection's height before the first measure, and wherever layout is
 * unmeasurable (jsdom): 20rem, the height the old `max-h-80` gave the list. */
const COLLECTION_FALLBACK_HEIGHT_PX = 320;

/** The nearest ancestor that scrolls vertically, or null when there is none. */
function findScrollableAncestor(start: HTMLElement): HTMLElement | null {
  for (let node = start.parentElement; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

/**
 * The height of everything that renders after the list inside the scroller's
 * content (e.g. the Echoes "Show 200 more" button): from the list's bottom to
 * the bottom of the scroller's last child, so flex gaps, margins, and wrapper
 * padding count too. Both edges move together when the list resizes, so the
 * value does not depend on the list's own height and a re-measure converges
 * instead of oscillating (as the scroller's overflow would).
 */
function trailingSpaceAfter(list: HTMLElement, scroller: HTMLElement): number {
  const last = scroller.lastElementChild;
  if (!last) return 0;
  return Math.max(0, last.getBoundingClientRect().bottom - list.getBoundingClientRect().bottom);
}

/**
 * The tallest a Collection may be so it fills the vertical space its scroll
 * container leaves it, while keeping room for the content that renders after it
 * (e.g. the Echoes "Show 200 more" button). Re-measures on mount, on window
 * resize, and when the scroller or the list's parent resizes (the trailing
 * content can appear or disappear); never on the scroller's scroll, so the list
 * does not resize while the page scrolls. Returns a pixel `max-height`.
 */
function useCollectionMaxHeight(listRef: RefObject<HTMLElement | null>): number {
  const [maxHeight, setMaxHeight] = useState(COLLECTION_FALLBACK_HEIGHT_PX);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const measure = () => {
      const scroller = findScrollableAncestor(list);
      const listRect = list.getBoundingClientRect();
      // With no scrollable ancestor the window is the bottom of the space.
      const scrollerRect = scroller?.getBoundingClientRect() ?? {
        top: 0,
        bottom: window.innerHeight,
      };
      const scrollerHeight = scrollerRect.bottom - scrollerRect.top;
      // jsdom and the first paint before layout report zeros: keep the
      // fallback so the Collection never collapses.
      if (listRect.bottom - listRect.top <= 0 || scrollerHeight <= 0) return;
      const paddingBottom = scroller
        ? Number.parseFloat(getComputedStyle(scroller).paddingBottom) || 0
        : 0;
      const trailing = scroller ? trailingSpaceAfter(list, scroller) : 0;
      // Offset of the list's top inside the scroller's content, so the measure
      // does not depend on where the scroller happens to be scrolled.
      const listTop = listRect.top - scrollerRect.top + (scroller?.scrollTop ?? 0);
      const available = scrollerHeight - listTop - paddingBottom - trailing;
      setMaxHeight(Math.max(COLLECTION_MIN_HEIGHT_PX, available));
    };

    measure();

    const observers: ResizeObserver[] = [];
    if (typeof ResizeObserver !== "undefined") {
      const scroller = findScrollableAncestor(list);
      for (const target of [scroller, list.parentElement]) {
        if (!target) continue;
        const observer = new ResizeObserver(measure);
        observer.observe(target);
        observers.push(observer);
      }
    }
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      for (const observer of observers) observer.disconnect();
    };
  }, [listRef]);

  return maxHeight;
}

function CollectionHost({
  label,
  selectionMode = "none",
  selectedKeys,
  children,
  onSelectionChange,
}: CollectionHostProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const maxHeight = useCollectionMaxHeight(listRef);
  // The host owns the collection: one Tab stop, arrow navigation, stable row
  // identity by id, and a scroll area that fills the space its page leaves it.
  // The Remote UI node cap (10,000) keeps a list the Plugin sends within the
  // host's budget.
  return (
    <ListBox
      ref={listRef}
      aria-label={label}
      selectionMode={selectionMode}
      selectedKeys={selectedKeys}
      onSelectionChange={(keys) => onSelectionChange?.([...keys].map(String))}
      style={{ maxHeight }}
      className="w-full overflow-auto rounded-lg border border-border py-1 outline-none"
    >
      {children}
    </ListBox>
  );
}

interface CollectionRowHostProps {
  id: string;
  label: string;
  description?: string;
  isExpandable?: boolean;
  isExpanded?: boolean;
  isDisabled?: boolean;
  menuItems?: readonly PluginUiOption[];
  children?: ReactNode;
  onExpandedChange?: (expanded: boolean) => void;
  onAction?: () => void;
  onMenuAction?: (value: string) => void;
}

function CollectionRowHost({
  id,
  label,
  description,
  isExpandable,
  isExpanded,
  isDisabled,
  menuItems,
  children,
  onExpandedChange,
  onAction,
  onMenuAction,
}: CollectionRowHostProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useMirroredOpen(isExpanded, onExpandedChange);
  const [menuOpen, setMenuOpen] = useState(false);
  // The label keeps its natural width and the description truncates first
  // (#527). Callback refs into state: React Aria renders a row's children into
  // its collection before they reach the DOM, so a ref object read in an effect
  // would still be null when the DOM attaches.
  const [labelEl, setLabelEl] = useState<HTMLSpanElement | null>(null);
  const [descriptionEl, setDescriptionEl] = useState<HTMLSpanElement | null>(null);
  const [truncated, setTruncated] = useState(false);
  useLayoutEffect(() => {
    const measure = () =>
      setTruncated(isTextOverflowing(labelEl) || isTextOverflowing(descriptionEl));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    if (labelEl) observer.observe(labelEl);
    if (descriptionEl) observer.observe(descriptionEl);
    return () => observer.disconnect();
  }, [labelEl, descriptionEl, label, description, expanded]);
  // The tooltip is the row's own floating layer. The shared Tooltip wraps its
  // child with click, key and pointer handlers that React Aria's listbox
  // navigation does not tolerate. Hover and focus come from the option's props.
  const [tipOpen, setTipOpen] = useState(false);
  const tip = useFloating({
    open: tipOpen && truncated,
    onOpenChange: setTipOpen,
    placement: "top",
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip(), shift({ padding: 4 })],
  });
  const tipDismiss = useDismiss(tip.context);
  const tipRole = useRole(tip.context, { role: "tooltip" });
  const { getFloatingProps } = useInteractions([tipDismiss, tipRole]);
  const tipId = useId();
  // React Aria's option props own `aria-describedby` and drop a prop passed to
  // ListBoxItem, so the link is set on the row element while the tooltip shows.
  useLayoutEffect(() => {
    const row = tip.refs.domReference.current;
    if (!(row instanceof HTMLElement) || !tipOpen || !truncated) return;
    row.setAttribute("aria-describedby", tipId);
    return () => row.removeAttribute("aria-describedby");
  }, [tip.refs.domReference, tipOpen, truncated, tipId]);
  const actions = (menuItems ?? []).map(
    // command-exempt: a Plugin row action runs the Plugin's own event, not a Maibuk Command (ADR 0019).
    (item) => ({
      id: item.value,
      label: item.label,
      onAction: () => onMenuAction?.(item.value),
    })
  );
  // An expandable row gives Enter to its expansion, and a listbox item's ⋯
  // button is not a Tab stop, so the row's Item Menu also opens on the same
  // context-menu gesture Maibuk's own lists use (Shift+F10, the Context Menu
  // key, a right click, a touch long-press) while the row has focus.
  const { itemProps, setOwnerRef } = useItemContextMenu({
    onOpen: () => setMenuOpen(true),
    isDisabled: actions.length === 0,
  });
  const setRowRef = useMergeRefs([setOwnerRef, tip.refs.setReference]);
  return (
    <ListBoxItem
      // Key by the remote `id`: React Aria refuses to mutate an item's id in place, so a new id remounts the row.
      key={id}
      ref={setRowRef}
      {...itemProps}
      id={id}
      textValue={label}
      isDisabled={isDisabled}
      aria-expanded={isExpandable ? expanded : undefined}
      onHoverStart={() => setTipOpen(true)}
      onHoverEnd={() => setTipOpen(false)}
      onFocus={() => setTipOpen(true)}
      onBlur={() => setTipOpen(false)}
      onAction={() => {
        if (isExpandable) {
          setExpanded(!expanded);
          return;
        }
        // A collection is one Tab stop, so its row is the keyboard path to the
        // row's Item Menu; the ⋯ button stays the pointer path.
        if (actions.length > 0) {
          setMenuOpen(true);
          return;
        }
        onAction?.();
      }}
      className="flex cursor-pointer flex-col gap-1 px-2 py-1.5 text-sm text-foreground outline-none data-focused:bg-muted data-selected:bg-primary/10 data-disabled:cursor-default data-disabled:opacity-50"
    >
      <div className="flex items-center gap-2">
        {isExpandable ? <Chevron expanded={expanded} /> : null}
        <span
          ref={setLabelEl}
          className={
            description ? "min-w-0 max-w-[60%] shrink-0 truncate" : "min-w-0 flex-1 truncate"
          }
        >
          {label}
        </span>
        {description && !expanded ? (
          <span
            ref={setDescriptionEl}
            className="min-w-0 flex-1 truncate text-sm text-muted-foreground"
          >
            {description}
          </span>
        ) : null}
        {actions.length > 0 ? (
          <ItemActionsMenu
            label={t("common.moreActionsFor", { title: label })}
            actions={actions}
            isOpen={menuOpen}
            onOpenChange={setMenuOpen}
          />
        ) : null}
      </div>
      {expanded && description ? (
        <div className="pl-7">
          <span className="whitespace-normal break-words text-sm text-muted-foreground">
            {description}
          </span>
        </div>
      ) : null}
      {expanded && children ? <div className="pl-7 text-muted-foreground">{children}</div> : null}
      {tipOpen && truncated ? (
        <FloatingPortal>
          <div
            ref={tip.refs.setFloating}
            className="z-60"
            style={tip.floatingStyles}
            {...getFloatingProps()}
            id={tipId}
          >
            <div className="flex max-w-xs flex-col gap-0.5 whitespace-normal break-words rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground shadow-lg">
              <span>{label}</span>
              {description ? <span className="text-muted-foreground">{description}</span> : null}
            </div>
          </div>
        </FloatingPortal>
      ) : null}
    </ListBoxItem>
  );
}

/** True when the element's text is cut off by its own `truncate` box. */
function isTextOverflowing(element: HTMLElement | null): boolean {
  return !!element && element.scrollWidth > element.clientWidth;
}

interface TableHostProps {
  label: string;
  columns: readonly PluginUiOption[];
  children?: ReactNode;
}

function TableHost({ label, columns, children }: TableHostProps) {
  return (
    <table className="w-full border-collapse text-sm">
      <caption className="sr-only">{label}</caption>
      <thead>
        <tr className="border-b border-border text-left">
          {columns.map((column) => (
            <th key={column.value} scope="col" className="px-2 py-1.5 font-medium text-foreground">
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function TableRowHost({ cells }: { cells: readonly PluginUiOption[] }) {
  return (
    <tr className="border-b border-border last:border-b-0">
      {cells.map((cell) => (
        <td key={cell.value} className="px-2 py-1.5 text-foreground">
          {cell.label}
        </td>
      ))}
    </tr>
  );
}

/** Overlays: modal, confirmation dialog, popover, tooltip (#439). */

interface ModalHostProps {
  title: string;
  isOpen?: boolean;
  openSeq?: number;
  children?: ReactNode;
  onOpenChange?: (open: boolean) => void;
}

function ModalHost({ title, isOpen, openSeq, children, onOpenChange }: ModalHostProps) {
  const [open, setOpen] = useMirroredOpen(isOpen, onOpenChange, openSeq);
  // The host closes immediately on Escape or outside press and notifies the
  // Plugin afterwards; it never waits for the Plugin's echo to close.
  const close = useCallback(() => setOpen(false), [setOpen]);
  return (
    <Modal isOpen={open} onClose={close} title={title}>
      {children}
    </Modal>
  );
}

interface ConfirmDialogHostProps {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  isOpen?: boolean;
  openSeq?: number;
  onConfirm?: () => void;
  onOpenChange?: (open: boolean) => void;
}

function ConfirmDialogHost({
  title,
  description,
  confirmLabel,
  cancelLabel,
  isDestructive,
  isOpen,
  openSeq,
  onConfirm,
  onOpenChange,
}: ConfirmDialogHostProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useMirroredOpen(isOpen, onOpenChange, openSeq);
  const close = useCallback(() => setOpen(false), [setOpen]);
  return (
    <Modal
      isOpen={open}
      onClose={close}
      title={title}
      role="alertdialog"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            {cancelLabel ?? t("common.cancel")}
          </Button>
          <Button
            variant={isDestructive ? "destructive" : "primary"}
            onClick={() => {
              onConfirm?.();
              close();
            }}
          >
            {confirmLabel ?? t("common.confirm")}
          </Button>
        </>
      }
    >
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
    </Modal>
  );
}

interface PopoverHostProps {
  label: string;
  icon?: string;
  isOpen?: boolean;
  openSeq?: number;
  children?: ReactNode;
  onOpenChange?: (open: boolean) => void;
}

function PopoverHost({ label, icon, isOpen, openSeq, children, onOpenChange }: PopoverHostProps) {
  const [open, setOpen] = useMirroredOpen(isOpen, onOpenChange, openSeq);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // A non-modal popover does not return focus by itself when the host dismisses
  // it; the shared hook restores the trigger, immediately and without a Worker
  // echo.
  useRestoreFocus(open, { getTarget: () => triggerRef.current });
  return (
    <DialogTrigger isOpen={open} onOpenChange={setOpen}>
      <AriaButton
        ref={triggerRef}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground outline-none transition-colors hover:bg-muted data-focus-visible:ring-2 data-focus-visible:ring-primary"
      >
        {icon ? <PluginIcon icon={icon} className="h-4 w-4" /> : null}
        {label}
      </AriaButton>
      <AriaPopover className="z-50 max-w-xs rounded-lg border border-border bg-card p-3 shadow-lg">
        <Dialog className="outline-none">{children}</Dialog>
      </AriaPopover>
    </DialogTrigger>
  );
}

function TooltipHost({ content, children }: { content: string; children?: ReactNode }) {
  return (
    <Tooltip content={content}>
      <span className="inline-flex">{children}</span>
    </Tooltip>
  );
}

/** Feedback: progress, inline status, empty states (#439). */

function ProgressBarHost({
  label,
  value,
  maxValue,
  isIndeterminate,
}: {
  label: string;
  value?: number;
  maxValue?: number;
  isIndeterminate?: boolean;
}) {
  return (
    <AriaProgressBar
      aria-label={label}
      value={value}
      maxValue={maxValue}
      isIndeterminate={isIndeterminate}
      className="w-full"
    >
      {({ percentage, valueText, isIndeterminate: indeterminate }) => (
        <>
          <div className="flex items-center justify-between text-sm">
            <span className="text-foreground">{label}</span>
            {!indeterminate ? <span className="text-muted-foreground">{valueText}</span> : null}
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full bg-primary ${
                indeterminate ? "w-2/5 animate-pulse" : "transition-[width]"
              }`}
              style={indeterminate ? undefined : { width: `${percentage ?? 0}%` }}
            />
          </div>
        </>
      )}
    </AriaProgressBar>
  );
}

type StatusTone = "info" | "success" | "warning" | "danger";

const STATUS_TONE: Record<StatusTone, string> = {
  info: "bg-info-bg text-info-text",
  success: "bg-feedback-success-bg text-feedback-success-text",
  warning: "bg-warning-bg text-warning-text",
  danger: "bg-feedback-error-bg text-feedback-error-text",
};

function StatusHost({ tone = "info", children }: { tone?: StatusTone; children?: ReactNode }) {
  return (
    <p
      role={tone === "danger" ? "alert" : "status"}
      className={`rounded-lg px-3 py-2 text-sm ${STATUS_TONE[tone]}`}
    >
      {children}
    </p>
  );
}

function EmptyStateHost({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description?: string;
  icon?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center">
      {icon ? <PluginIcon icon={icon} className="h-8 w-8 text-muted-foreground" /> : null}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {children}
    </div>
  );
}

/** Appearance: a themed region whose CSS is isolated to it (#439). */

let nextSurfaceScope = 0;

/** A fresh, unique scope id; each surface gets its own attribute value. */
function nextSurfaceId(): string {
  nextSurfaceScope += 1;
  return `plugin-ui-${nextSurfaceScope}`;
}

function SurfaceHost({
  css,
  padding = "none",
  children,
}: {
  css?: string;
  padding?: keyof typeof PADDING;
  children?: ReactNode;
}) {
  const scope = useRef<string | null>(null);
  if (scope.current === null) scope.current = nextSurfaceId();
  const scopeId = scope.current;
  const { scoped, drops } = useMemo(() => {
    if (!css) return { scoped: "", drops: [] as string[] };
    const reasons: string[] = [];
    const out = scopePluginCss(css, `[data-plugin-ui="${scopeId}"]`, (reason) => {
      reasons.push(reason);
    });
    return { scoped: out, drops: reasons };
  }, [css, scopeId]);

  useEffect(() => {
    if (drops.length > 0) {
      console.warn("Plugin CSS was partly or wholly dropped from a Surface:", drops);
    }
  }, [drops]);

  return (
    <div data-plugin-ui={scopeId} className={`w-full ${PADDING[padding]}`}>
      {children}
      {scoped ? <style>{scoped}</style> : null}
    </div>
  );
}

/**
 * The custom-UI `Frame` (#454, U3): the kit tag renders the host `PluginFrame`
 * for the mount's own run. Its `src` and `title` come from the Plugin's tree;
 * the runtime comes from the mount, since only the host knows the verified
 * folder and the Worker to hand the Frame port to. Without a runtime (a test
 * tree, or a mount the host did not open) it renders nothing and refuses.
 */
function FrameHost({
  src,
  title,
  host,
}: {
  src: string;
  title: string;
  host?: PluginFrameHost;
}): ReactNode {
  if (host === undefined) return null;
  return <PluginFrame runtime={host} src={src} title={title} variant="embedded" />;
}

/** Every table tag's host renderer, built once. */
export function createPluginUiComponents(host?: PluginFrameHost): RemoteComponentRendererMap {
  const components: RemoteComponentRendererMap = new Map();
  const hosts: Record<string, ComponentType<any>> = {
    View: ViewHost,
    Heading: HeadingHost,
    Text: TextHost,
    Separator: SeparatorHost,
    Icon: IconHost,
    Image: ImageHost,
    List: ListHost,
    ListItem: ListItemHost,
    Code: CodeHost,
    TextField: TextFieldHost,
    TextArea: TextAreaHost,
    NumberField: NumberFieldHost,
    Checkbox: CheckboxHost,
    Switch: SwitchHost,
    Select: SelectHost,
    Combobox: ComboboxHost,
    MultiSelectCombobox: MultiSelectComboboxHost,
    RadioGroup: RadioGroupHost,
    Button: ButtonHost,
    IconButton: IconButtonHost,
    Link: LinkHost,
    Tabs: TabsHost,
    Disclosure: DisclosureHost,
    Collection: CollectionHost,
    CollectionRow: CollectionRowHost,
    Table: TableHost,
    TableRow: TableRowHost,
    Modal: ModalHost,
    ConfirmDialog: ConfirmDialogHost,
    Popover: PopoverHost,
    Tooltip: TooltipHost,
    ProgressBar: ProgressBarHost,
    Status: StatusHost,
    EmptyState: EmptyStateHost,
    Surface: SurfaceHost,
    // The Frame host closes over the mount's runtime: the Plugin tree carries
    // only `src` and `title` (see FrameHost).
    Frame: (props: { src: string; title: string }) => <FrameHost {...props} host={host} />,
  };
  for (const element of PLUGIN_UI_TABLE) {
    const Host = hosts[element.host];
    if (Host === undefined) throw new Error(`The UI kit has no host component for ${element.tag}`);
    components.set(
      element.tag,
      createRemoteComponentRenderer(
        Host as never,
        {
          // The table names each event's React prop; the host must read the same
          // prop, not Remote DOM's mechanical `on<Eventname>` guess.
          eventProps: Object.fromEntries(
            element.events.map((event) => [event.prop, { event: event.event }])
          ),
        } as never
      )
    );
  }
  return components;
}
