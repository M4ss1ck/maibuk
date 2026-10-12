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

import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
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
import { Radio, RadioGroup as AriaRadioGroup } from "react-aria-components/RadioGroup";
import { Link as AriaLink } from "react-aria-components/Link";
import {
  createRemoteComponentRenderer,
  type RemoteComponentRendererMap,
} from "@remote-dom/react/host";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Combobox } from "@/components/ui/Combobox";
import { MultiSelectCombobox } from "@/components/ui/MultiSelectCombobox";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { PluginIcon } from "@/components/plugins/PluginIcon";
import { createEchoTracker, type PluginEchoTracker } from "@/features/plugins/remote-ui/echo";
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

function FieldShell({
  label,
  description,
  errorMessage,
  children,
}: {
  label: string;
  description?: string;
  errorMessage?: string;
  children: ReactNode;
}) {
  return (
    <div className="w-full">
      <span className="block text-sm font-medium mb-1.5">{label}</span>
      {children}
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      {errorMessage && <p className="mt-1 text-sm text-destructive">{errorMessage}</p>}
    </div>
  );
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
      aria-label={label}
      className="w-full"
    >
      <FieldShell label={label} description={description} errorMessage={errorMessage}>
        <AriaInput
          type={type}
          placeholder={placeholder}
          className={INPUT_CLASS}
          onKeyDown={(event) => {
            if (event.key === "Enter") onChange?.(local);
          }}
          onBlur={() => onChange?.(local)}
        />
      </FieldShell>
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
      aria-label={label}
      className="w-full"
    >
      <FieldShell label={label} description={description} errorMessage={errorMessage}>
        <AriaTextArea
          rows={rows}
          placeholder={placeholder}
          className={INPUT_CLASS}
          onBlur={() => onChange?.(local)}
        />
      </FieldShell>
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
  const { local, send } = useHostValue(value === undefined ? undefined : String(value), (next) =>
    onInput?.(Number(next))
  );
  return (
    <AriaNumberField
      value={local === "" ? undefined : Number(local)}
      // RAC's `onChange` fires on commit (blur, Enter, stepping); live typing is
      // read from the input's own `onInput` below, so the Plugin sees each
      // keystroke the way it does from a text field.
      onChange={(next) => onChange?.(next)}
      minValue={minValue}
      maxValue={maxValue}
      step={step}
      isRequired={isRequired}
      isDisabled={isDisabled}
      aria-label={label}
      className="w-full"
    >
      <FieldShell label={label} description={description} errorMessage={errorMessage}>
        <AriaInput
          className={INPUT_CLASS}
          onInput={(event) => send(event.currentTarget.value)}
        />
      </FieldShell>
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
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Checkbox
          checked={isSelected}
          indeterminate={isIndeterminate}
          disabled={isDisabled}
          label={label}
          onChange={(checked) => onChange?.(checked)}
        />
        <span className="text-sm text-foreground">{label}</span>
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
  return (
    <div className="flex flex-col gap-1">
      <Switch
        checked={isSelected}
        disabled={isDisabled}
        label={label}
        onChange={(checked) => onChange?.(checked)}
      />
      <span className="text-sm text-foreground">{label}</span>
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
  return (
    <FieldShell label={label} description={description} errorMessage={errorMessage}>
      <div
        className={isDisabled === true ? "pointer-events-none opacity-50" : ""}
        aria-disabled={isDisabled}
      >
        <Select
          value={selectedKey}
          options={[...options]}
          ariaLabel={label}
          onChange={(value) => onChange?.(String(value))}
          {...(placeholder === undefined ? {} : { placeholder })}
        />
      </div>
    </FieldShell>
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
  return (
    <FieldShell label={label} errorMessage={errorMessage}>
      <div
        className={isDisabled === true ? "pointer-events-none opacity-50" : ""}
        aria-disabled={isDisabled}
      >
        <Combobox
          value={selectedKey}
          options={labels}
          ariaLabel={label}
          inputClasses="w-40"
          {...(placeholder === undefined ? {} : { placeholder })}
          onChange={(next) => onChange?.(labelToValue.get(next) ?? next)}
        />
      </div>
    </FieldShell>
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
  return (
    <FieldShell label={label} errorMessage={errorMessage}>
      <div
        className={isDisabled === true ? "pointer-events-none opacity-50" : ""}
        aria-disabled={isDisabled}
      >
        <MultiSelectCombobox
          value={[...value]}
          options={labels}
          allowCustom={allowsCustomValue}
          ariaLabel={label}
          removeLabel={(item) => t("plugins.ui.removeValue", { value: item })}
          onChange={(next) => onChange?.(next.map((item) => labelToValue.get(item) ?? item))}
          {...(placeholder === undefined ? {} : { placeholder })}
        />
      </div>
    </FieldShell>
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
      className="w-full"
    >
      <AriaLabel className="block text-sm font-medium mb-1.5">{label}</AriaLabel>
      <div className={orientation === "horizontal" ? "flex flex-wrap gap-4" : "flex flex-col gap-2"}>
        {options.map((option) => (
          <Radio
            key={option.value}
            value={option.value}
            className="group flex items-center gap-2 text-sm text-foreground data-focus-visible:ring-2 data-focus-visible:ring-primary"
          >
            <span className="flex size-4 items-center justify-center rounded-full border border-muted-foreground">
              <span className="size-2 rounded-full bg-current opacity-0 group-data-selected:opacity-100" />
            </span>
            {option.label}
          </Radio>
        ))}
      </div>
      {description && (
        <AriaText slot="description" className="mt-1 text-sm text-muted-foreground">
          {description}
        </AriaText>
      )}
      {errorMessage && <FieldError className="mt-1 text-sm text-destructive">{errorMessage}</FieldError>}
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

function ButtonHost({ variant = "primary", size = "md", icon, isDisabled, children, onPress }: ButtonHostProps) {
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

function IconButtonHost({ label, icon, variant = "ghost", isDisabled, onPress }: IconButtonHostProps) {
  return (
    <Button
      variant={variant}
      size="sm"
      aria-label={label}
      disabled={isDisabled}
      onClick={() => onPress?.()}
      className="px-2"
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
  return <p className={`${TEXT_TONE[tone]} ${TEXT_SIZE[size]} ${TEXT_WEIGHT[weight]}`}>{children}</p>;
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

function SeparatorHost({ orientation = "horizontal" }: { orientation?: "horizontal" | "vertical" }) {
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
  return <img src={src} alt={alt} width={width} height={height} className="max-w-full rounded-lg" />;
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
  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-sm text-foreground">{children}</code>;
}

/** Every table tag's host renderer, built once. */
export function createPluginUiComponents(): RemoteComponentRendererMap {
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
  };
  for (const element of PLUGIN_UI_TABLE) {
    const Host = hosts[element.host];
    if (Host === undefined) throw new Error(`The UI kit has no host component for ${element.tag}`);
    components.set(element.tag, createRemoteComponentRenderer(Host as never));
  }
  return components;
}
