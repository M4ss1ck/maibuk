/**
 * The one component-definition table for host-rendered Plugin UI (ADR 0021).
 *
 * This file is the single source of truth for the UI kit: the allowed elements,
 * their documented prop subsets, events, methods, and the host component each
 * declares. It imports nothing, so the plugin-side SDK (`ui.tsx`), the host
 * renderer (`src/features/plugins/remote-ui/`), and the generated SDK types
 * (`ui.generated.ts`, via `pnpm generate:plugin-ui`) all read the same table.
 *
 * A tag is only valid if it is here; a prop or event is only valid if its
 * element declares it. The connection validator rejects anything else, so an
 * unsupported declaration fails instead of being silently ignored.
 */

/** How a prop's value is typed, validated, and rendered into TypeScript. */
export type PluginUiPropKind =
  | "string"
  | "number"
  | "boolean"
  | "enum"
  | "options"
  | "keys"
  | "node";

export interface PluginUiProp {
  kind: PluginUiPropKind;
  /** The prop is required for the element to render correctly. */
  required?: boolean;
  /** A `string` prop is capped at this many UTF-16 units. */
  maxLength?: number;
  /** An `enum` prop's exact allowed values. */
  values?: readonly string[];
  /** A `number` prop's bounds. */
  minimum?: number;
  maximum?: number;
  /** A `number` prop that must be a whole number. */
  integer?: boolean;
  /**
   * A `string` prop that must use this format; `data-url` keeps images offline,
   * `url` keeps links safe, `plugin-path` keeps a Frame's `src` a relative
   * `.html` file inside the Plugin folder (the same rules the manifest's `entry`
   * and page `frame` paths obey).
   */
  format?: "data-url" | "url" | "plugin-path";
  /**
   * Set by the SDK, never by a Plugin; omitted from the generated public types.
   * The validator and the host still accept it, because the SDK sends it.
   */
  internal?: boolean;
  /** One line for the SDK reference and generated types. */
  description?: string;
}

/** The value carried by an event's `detail`; `none` for a bare press. */
export type PluginUiEventDetail = "string" | "number" | "boolean" | "keys" | "none";

/** One event a Plugin may listen for, and the React prop that carries it. */
export interface PluginUiEvent {
  /** The prop the Plugin writes in JSX, e.g. `onInput`. */
  prop: string;
  /** The remote event name on the wire, e.g. `input`. */
  event: string;
  /** The type of the event's `detail`. */
  detail: PluginUiEventDetail;
  description?: string;
}

export type PluginUiCategory =
  | "structure"
  | "forms"
  | "actions"
  | "organization"
  | "overlays"
  | "feedback"
  | "appearance";

export interface PluginUiElement {
  /** The remote custom element's tag name, e.g. `maibuk-button`. */
  tag: string;
  /** The SDK component's name, e.g. `Button`. */
  component: string;
  category: PluginUiCategory;
  /** The host component this tag maps to (the host map is exhaustive over these). */
  host: string;
  /** True when the host component is keyboard-interactive and needs a keyboard test. */
  interactive: boolean;
  summary: string;
  props: Readonly<Record<string, PluginUiProp>>;
  events: readonly PluginUiEvent[];
  /** Remote methods the Plugin may call on the host element; empty in v1 part 1. */
  methods: readonly string[];
}

/**
 * The reopen contract the overlays share. The host dismisses immediately, even
 * with a stopped Worker. Once the Worker has handled the event, the Plugin's
 * `isOpen` is authoritative again: the SDK carries the host's answer in the
 * internal `openSeq` count, so a Plugin that sets `isOpen` from this handler
 * (a batched false→true included) reopens the dialog.
 */
const REOPEN_CONTRACT =
  "Fires when the host dismisses or opens the dialog. The host closes immediately, even with a stopped Worker. Once the Worker has handled this event, the Plugin's `isOpen` is authoritative again: set it from this handler. A Plugin that ignores this event and keeps `isOpen` true reopens the dialog.";

/** The kit tag for the custom-UI `Frame`; only valid with manifest `customUi`. */
export const PLUGIN_UI_FRAME_TAG = "maibuk-frame";

/**
 * The v1 kit: structure, forms, and actions (#416, #438); organization,
 * overlays, feedback, and Plugin CSS (#439); the custom-UI `Frame` (#454).
 */
export const PLUGIN_UI_TABLE: readonly PluginUiElement[] = [
  // Structure
  {
    tag: "maibuk-view",
    component: "View",
    category: "structure",
    host: "View",
    interactive: false,
    summary: "A responsive layout container.",
    props: {
      direction: {
        kind: "enum",
        values: ["row", "column"],
        description: "Main axis; defaults to `column`.",
      },
      gap: { kind: "enum", values: ["none", "sm", "md", "lg"], description: "Space between children." },
      align: { kind: "enum", values: ["start", "center", "end", "stretch"] },
      justify: { kind: "enum", values: ["start", "center", "end", "between"] },
      wrap: { kind: "boolean" },
      padding: { kind: "enum", values: ["none", "sm", "md", "lg"] },
      children: { kind: "node" },
    },
    events: [],
    methods: [],
  },
  {
    tag: "maibuk-heading",
    component: "Heading",
    category: "structure",
    host: "Heading",
    interactive: false,
    summary: "A heading of level 1 to 6.",
    props: {
      level: {
        kind: "number",
        minimum: 1,
        maximum: 6,
        description: "Heading level; defaults to `2`.",
      },
      children: { kind: "node" },
    },
    events: [],
    methods: [],
  },
  {
    tag: "maibuk-text",
    component: "Text",
    category: "structure",
    host: "Text",
    interactive: false,
    summary: "A run of body text.",
    props: {
      tone: { kind: "enum", values: ["default", "muted", "danger", "success", "primary"] },
      size: { kind: "enum", values: ["sm", "md", "lg"] },
      weight: { kind: "enum", values: ["normal", "medium", "semibold"] },
      children: { kind: "node" },
    },
    events: [],
    methods: [],
  },
  {
    tag: "maibuk-separator",
    component: "Separator",
    category: "structure",
    host: "Separator",
    interactive: false,
    summary: "A separator between sections.",
    props: {
      orientation: { kind: "enum", values: ["horizontal", "vertical"] },
    },
    events: [],
    methods: [],
  },
  {
    tag: "maibuk-icon",
    component: "Icon",
    category: "structure",
    host: "Icon",
    interactive: false,
    summary: "A Lucide icon, named.",
    props: {
      name: { kind: "string", required: true, maxLength: 64, description: "A Lucide icon name." },
      label: { kind: "string", maxLength: 256, description: "Accessible name; decorative when omitted." },
      size: { kind: "enum", values: ["sm", "md", "lg"] },
      tone: { kind: "enum", values: ["default", "muted", "danger", "success", "primary"] },
    },
    events: [],
    methods: [],
  },
  {
    tag: "maibuk-image",
    component: "Image",
    category: "structure",
    host: "Image",
    interactive: false,
    summary: "An image from a data URL.",
    props: {
      src: { kind: "string", required: true, maxLength: 2_000_000, format: "data-url", description: "A `data:` URL." },
      alt: { kind: "string", required: true, maxLength: 512 },
      width: { kind: "number", minimum: 1, maximum: 4096 },
      height: { kind: "number", minimum: 1, maximum: 4096 },
    },
    events: [],
    methods: [],
  },
  {
    tag: "maibuk-list",
    component: "List",
    category: "structure",
    host: "List",
    interactive: false,
    summary: "A semantic list; children are `ListItem` elements.",
    props: {
      marker: { kind: "enum", values: ["none", "bullet", "number"] },
      children: { kind: "node" },
    },
    events: [],
    methods: [],
  },
  {
    tag: "maibuk-list-item",
    component: "ListItem",
    category: "structure",
    host: "ListItem",
    interactive: false,
    summary: "One item of a `List`.",
    props: {
      children: { kind: "node" },
    },
    events: [],
    methods: [],
  },

  {
    tag: "maibuk-code",
    component: "Code",
    category: "structure",
    host: "Code",
    interactive: false,
    summary: "Inline code, or a code block.",
    props: {
      block: { kind: "boolean" },
      children: { kind: "node" },
    },
    events: [],
    methods: [],
  },

  // Forms
  {
    tag: "maibuk-text-field",
    component: "TextField",
    category: "forms",
    host: "TextField",
    interactive: true,
    summary: "A single-line text, password, or search field.",
    props: {
      label: { kind: "string", required: true, maxLength: 512 },
      type: { kind: "enum", values: ["text", "password", "search"] },
      value: { kind: "string", maxLength: 100_000 },
      placeholder: { kind: "string", maxLength: 512 },
      description: { kind: "string", maxLength: 1024 },
      errorMessage: { kind: "string", maxLength: 1024 },
      isRequired: { kind: "boolean" },
      isDisabled: { kind: "boolean" },
      isReadOnly: { kind: "boolean" },
      autoFocus: { kind: "boolean" },
    },
    events: [
      { prop: "onInput", event: "input", detail: "string", description: "Fires on every keystroke with the new value." },
      { prop: "onChange", event: "change", detail: "string", description: "Fires when the value is committed." },
    ],
    methods: [],
  },
  {
    tag: "maibuk-text-area",
    component: "TextArea",
    category: "forms",
    host: "TextArea",
    interactive: true,
    summary: "A multiline text field.",
    props: {
      label: { kind: "string", required: true, maxLength: 512 },
      value: { kind: "string", maxLength: 1_000_000 },
      placeholder: { kind: "string", maxLength: 512 },
      rows: { kind: "number", minimum: 1, maximum: 40 },
      description: { kind: "string", maxLength: 1024 },
      errorMessage: { kind: "string", maxLength: 1024 },
      isRequired: { kind: "boolean" },
      isDisabled: { kind: "boolean" },
      isReadOnly: { kind: "boolean" },
      autoFocus: { kind: "boolean" },
    },
    events: [
      { prop: "onInput", event: "input", detail: "string" },
      { prop: "onChange", event: "change", detail: "string" },
    ],
    methods: [],
  },
  {
    tag: "maibuk-number-field",
    component: "NumberField",
    category: "forms",
    host: "NumberField",
    interactive: true,
    summary: "A numeric field with optional bounds and step.",
    props: {
      label: { kind: "string", required: true, maxLength: 512 },
      value: { kind: "number" },
      minValue: { kind: "number" },
      maxValue: { kind: "number" },
      step: { kind: "number" },
      description: { kind: "string", maxLength: 1024 },
      errorMessage: { kind: "string", maxLength: 1024 },
      isRequired: { kind: "boolean" },
      isDisabled: { kind: "boolean" },
    },
    events: [
      {
        prop: "onInput",
        event: "input",
        detail: "number",
        description:
          "Fires with the parsed number; it does not fire while the field is empty or holds a partial value such as `-`.",
      },
      {
        prop: "onChange",
        event: "change",
        detail: "number",
        description:
          "Fires with the parsed number when the value is committed; an empty field does not report 0.",
      },
    ],
    methods: [],
  },
  {
    tag: "maibuk-checkbox",
    component: "Checkbox",
    category: "forms",
    host: "Checkbox",
    interactive: true,
    summary: "A checkbox with a label.",
    props: {
      label: { kind: "string", required: true, maxLength: 512 },
      isSelected: { kind: "boolean" },
      isIndeterminate: { kind: "boolean" },
      description: { kind: "string", maxLength: 1024 },
      isDisabled: { kind: "boolean" },
    },
    events: [{ prop: "onChange", event: "change", detail: "boolean" }],
    methods: [],
  },
  {
    tag: "maibuk-switch",
    component: "Switch",
    category: "forms",
    host: "Switch",
    interactive: true,
    summary: "A switch with a label.",
    props: {
      label: { kind: "string", required: true, maxLength: 512 },
      isSelected: { kind: "boolean" },
      description: { kind: "string", maxLength: 1024 },
      isDisabled: { kind: "boolean" },
    },
    events: [{ prop: "onChange", event: "change", detail: "boolean" }],
    methods: [],
  },
  {
    tag: "maibuk-select",
    component: "Select",
    category: "forms",
    host: "Select",
    interactive: true,
    summary: "A single-choice select.",
    props: {
      label: { kind: "string", required: true, maxLength: 512 },
      options: { kind: "options", required: true },
      selectedKey: { kind: "string", maxLength: 512 },
      placeholder: { kind: "string", maxLength: 512 },
      description: { kind: "string", maxLength: 1024 },
      errorMessage: { kind: "string", maxLength: 1024 },
      isDisabled: { kind: "boolean" },
    },
    events: [{ prop: "onChange", event: "change", detail: "string" }],
    methods: [],
  },
  {
    tag: "maibuk-combobox",
    component: "Combobox",
    category: "forms",
    host: "Combobox",
    interactive: true,
    summary: "An editable combobox with a filtered list.",
    props: {
      label: { kind: "string", required: true, maxLength: 512 },
      options: { kind: "options", required: true },
      selectedKey: { kind: "string", maxLength: 512 },
      placeholder: { kind: "string", maxLength: 512 },
      isDisabled: { kind: "boolean" },
      errorMessage: { kind: "string", maxLength: 1024 },
    },
    events: [{ prop: "onChange", event: "change", detail: "string" }],
    methods: [],
  },
  {
    tag: "maibuk-multi-select-combobox",
    component: "MultiSelectCombobox",
    category: "forms",
    host: "MultiSelectCombobox",
    interactive: true,
    summary: "A combobox that selects several values.",
    props: {
      label: { kind: "string", required: true, maxLength: 512 },
      options: { kind: "options", required: true },
      selectedKeys: { kind: "keys" },
      placeholder: { kind: "string", maxLength: 512 },
      allowsCustomValue: { kind: "boolean" },
      isDisabled: { kind: "boolean" },
      errorMessage: { kind: "string", maxLength: 1024 },
    },
    events: [
      { prop: "onChange", event: "change", detail: "keys", description: "Fires with the selected values." },
    ],
    methods: [],
  },
  {
    tag: "maibuk-radio-group",
    component: "RadioGroup",
    category: "forms",
    host: "RadioGroup",
    interactive: true,
    summary: "A group of radio options.",
    props: {
      label: { kind: "string", required: true, maxLength: 512 },
      options: { kind: "options", required: true },
      selectedKey: { kind: "string", maxLength: 512 },
      orientation: { kind: "enum", values: ["horizontal", "vertical"] },
      description: { kind: "string", maxLength: 1024 },
      errorMessage: { kind: "string", maxLength: 1024 },
      isDisabled: { kind: "boolean" },
    },
    events: [{ prop: "onChange", event: "change", detail: "string" }],
    methods: [],
  },

  // Actions
  {
    tag: "maibuk-button",
    component: "Button",
    category: "actions",
    host: "Button",
    interactive: true,
    summary: "A button.",
    props: {
      variant: { kind: "enum", values: ["primary", "secondary", "ghost", "destructive"] },
      size: { kind: "enum", values: ["sm", "md", "lg"] },
      icon: { kind: "string", maxLength: 64, description: "An optional Lucide icon name." },
      isDisabled: { kind: "boolean" },
      children: { kind: "node" },
    },
    events: [{ prop: "onPress", event: "press", detail: "none" }],
    methods: [],
  },
  {
    tag: "maibuk-icon-button",
    component: "IconButton",
    category: "actions",
    host: "IconButton",
    interactive: true,
    summary: "A button that shows only an icon.",
    props: {
      label: { kind: "string", required: true, maxLength: 512, description: "Accessible name." },
      icon: { kind: "string", required: true, maxLength: 64 },
      variant: { kind: "enum", values: ["primary", "secondary", "ghost", "destructive"] },
      isDisabled: { kind: "boolean" },
    },
    events: [{ prop: "onPress", event: "press", detail: "none" }],
    methods: [],
  },
  {
    tag: "maibuk-link",
    component: "Link",
    category: "actions",
    host: "Link",
    interactive: true,
    summary: "A link that opens a URL.",
    props: {
      href: { kind: "string", required: true, maxLength: 2048, format: "url" },
      isDisabled: { kind: "boolean" },
      children: { kind: "node" },
    },
    events: [{ prop: "onPress", event: "press", detail: "none" }],
    methods: [],
  },

  // Organization
  {
    tag: "maibuk-tabs",
    component: "Tabs",
    category: "organization",
    host: "Tabs",
    interactive: true,
    summary: "A tab list and the selected tab's panel.",
    props: {
      label: {
        kind: "string",
        required: true,
        maxLength: 512,
        description: "Accessible name of the tab list.",
      },
      items: {
        kind: "options",
        required: true,
        description: "Tab keys and titles, in order.",
      },
      selectedKey: {
        kind: "string",
        maxLength: 512,
        description: "The selected tab's key; defaults to the first tab.",
      },
      children: { kind: "node", description: "The panel shown for the selected tab." },
    },
    events: [
      {
        prop: "onChange",
        event: "change",
        detail: "string",
        description: "Fires with the selected tab's key when the selection changes.",
      },
    ],
    methods: [],
  },
  {
    tag: "maibuk-disclosure",
    component: "Disclosure",
    category: "organization",
    host: "Disclosure",
    interactive: true,
    summary: "A collapsible section with a heading and a panel.",
    props: {
      label: { kind: "string", required: true, maxLength: 512, description: "The heading that toggles it." },
      isExpanded: { kind: "boolean", description: "Whether the panel is visible; defaults to collapsed." },
      isDisabled: { kind: "boolean" },
      children: { kind: "node" },
    },
    events: [
      {
        prop: "onExpandedChange",
        event: "expandedchange",
        detail: "boolean",
        description: "Fires with the new expanded state.",
      },
    ],
    methods: [],
  },
  {
    tag: "maibuk-collection",
    component: "Collection",
    category: "organization",
    host: "Collection",
    interactive: true,
    summary: "A keyboard-navigable list of rows, with optional selection.",
    props: {
      label: { kind: "string", required: true, maxLength: 512, description: "Accessible name of the list." },
      selectionMode: {
        kind: "enum",
        values: ["none", "single", "multiple"],
        description: "Whether rows can be selected; defaults to `none`.",
      },
      selectedKeys: { kind: "keys", description: "The selected rows' ids." },
      children: { kind: "node" },
    },
    events: [
      {
        prop: "onSelectionChange",
        event: "selectionchange",
        detail: "keys",
        description: "Fires with the selected rows' ids.",
      },
    ],
    methods: [],
  },
  {
    tag: "maibuk-collection-row",
    component: "CollectionRow",
    category: "organization",
    host: "CollectionRow",
    interactive: true,
    summary: "One row of a `Collection`, with an optional Item Menu and expanded panel.",
    props: {
      id: { kind: "string", required: true, maxLength: 512, description: "Stable row identity." },
      label: { kind: "string", required: true, maxLength: 512, description: "The row's primary text." },
      description: { kind: "string", maxLength: 1024 },
      isExpandable: { kind: "boolean", description: "Shows a toggle that reveals the row's panel." },
      isExpanded: { kind: "boolean" },
      isDisabled: { kind: "boolean" },
      menuItems: {
        kind: "options",
        description: "Entries of the row's Item Menu; none hides the ⋯ button.",
      },
      children: { kind: "node", description: "The panel shown while the row is expanded." },
    },
    events: [
      { prop: "onExpandedChange", event: "expandedchange", detail: "boolean" },
      {
        prop: "onAction",
        event: "action",
        detail: "none",
        description: "Fires when the row is activated and it is not expandable.",
      },
      {
        prop: "onMenuAction",
        event: "menuaction",
        detail: "string",
        description: "Fires with the chosen Item Menu entry's value.",
      },
    ],
    methods: [],
  },
  {
    tag: "maibuk-table",
    component: "Table",
    category: "organization",
    host: "Table",
    interactive: false,
    summary: "A read-only table; children are `TableRow` elements.",
    props: {
      label: { kind: "string", required: true, maxLength: 512, description: "Accessible name of the table." },
      columns: {
        kind: "options",
        required: true,
        description: "Column keys and headers, in order.",
      },
      children: { kind: "node" },
    },
    events: [],
    methods: [],
  },
  {
    tag: "maibuk-table-row",
    component: "TableRow",
    category: "organization",
    host: "TableRow",
    interactive: false,
    summary: "One row of a `Table`; its cells are keyed by column.",
    props: {
      cells: {
        kind: "options",
        required: true,
        description: "Cell text keyed by column value, in column order.",
      },
    },
    events: [],
    methods: [],
  },

  // Overlays
  {
    tag: "maibuk-modal",
    component: "Modal",
    category: "overlays",
    host: "Modal",
    interactive: true,
    summary: "A modal dialog that contains focus and returns it to its trigger.",
    props: {
      title: { kind: "string", required: true, maxLength: 512 },
      isOpen: { kind: "boolean", description: "Whether the dialog is open." },
      openSeq: {
        kind: "number",
        minimum: 0,
        maximum: Number.MAX_SAFE_INTEGER,
        integer: true,
        internal: true,
        description: "How many open changes the host has delivered; the host treats a newer value as the Plugin's answer.",
      },
      children: { kind: "node" },
    },
    events: [
      {
        prop: "onOpenChange",
        event: "openchange",
        detail: "boolean",
        description: REOPEN_CONTRACT,
      },
    ],
    methods: [],
  },
  {
    tag: "maibuk-confirm-dialog",
    component: "ConfirmDialog",
    category: "overlays",
    host: "ConfirmDialog",
    interactive: true,
    summary: "A confirmation dialog with a confirm and a cancel action.",
    props: {
      title: { kind: "string", required: true, maxLength: 512 },
      description: { kind: "string", maxLength: 1024 },
      confirmLabel: { kind: "string", maxLength: 512, description: "Defaults to the localized Confirm." },
      cancelLabel: { kind: "string", maxLength: 512, description: "Defaults to the localized Cancel." },
      isDestructive: { kind: "boolean", description: "Styles the confirm action as destructive." },
      isOpen: { kind: "boolean" },
      openSeq: {
        kind: "number",
        minimum: 0,
        maximum: Number.MAX_SAFE_INTEGER,
        integer: true,
        internal: true,
        description: "How many open changes the host has delivered; the host treats a newer value as the Plugin's answer.",
      },
    },
    events: [
      { prop: "onConfirm", event: "confirm", detail: "none" },
      { prop: "onOpenChange", event: "openchange", detail: "boolean", description: REOPEN_CONTRACT },
    ],
    methods: [],
  },
  {
    tag: "maibuk-popover",
    component: "Popover",
    category: "overlays",
    host: "Popover",
    interactive: true,
    summary: "A trigger button that opens a small panel anchored to it.",
    props: {
      label: { kind: "string", required: true, maxLength: 512, description: "The trigger's accessible name." },
      icon: { kind: "string", maxLength: 64, description: "An optional Lucide icon name for the trigger." },
      isOpen: { kind: "boolean" },
      openSeq: {
        kind: "number",
        minimum: 0,
        maximum: Number.MAX_SAFE_INTEGER,
        integer: true,
        internal: true,
        description: "How many open changes the host has delivered; the host treats a newer value as the Plugin's answer.",
      },
      children: { kind: "node" },
    },
    events: [
      { prop: "onOpenChange", event: "openchange", detail: "boolean", description: REOPEN_CONTRACT },
    ],
    methods: [],
  },
  {
    tag: "maibuk-tooltip",
    component: "Tooltip",
    category: "overlays",
    host: "Tooltip",
    interactive: true,
    summary: "A short hint shown on hover or focus of its child.",
    props: {
      content: { kind: "string", required: true, maxLength: 512 },
      children: { kind: "node" },
    },
    events: [],
    methods: [],
  },

  // Feedback
  {
    tag: "maibuk-progress-bar",
    component: "ProgressBar",
    category: "feedback",
    host: "ProgressBar",
    interactive: false,
    summary: "A determinate or indeterminate progress indicator.",
    props: {
      label: { kind: "string", required: true, maxLength: 512 },
      value: { kind: "number", minimum: 0 },
      maxValue: { kind: "number", minimum: 1 },
      isIndeterminate: { kind: "boolean" },
    },
    events: [],
    methods: [],
  },
  {
    tag: "maibuk-status",
    component: "Status",
    category: "feedback",
    host: "Status",
    interactive: false,
    summary: "An inline status or error message.",
    props: {
      tone: {
        kind: "enum",
        values: ["info", "success", "warning", "danger"],
        description: "Defaults to `info`; `danger` is announced immediately.",
      },
      children: { kind: "node" },
    },
    events: [],
    methods: [],
  },
  {
    tag: "maibuk-empty-state",
    component: "EmptyState",
    category: "feedback",
    host: "EmptyState",
    interactive: false,
    summary: "A centered empty or nothing-here state.",
    props: {
      title: { kind: "string", required: true, maxLength: 512 },
      description: { kind: "string", maxLength: 1024 },
      icon: { kind: "string", maxLength: 64 },
      children: { kind: "node", description: "An optional call to action." },
    },
    events: [],
    methods: [],
  },

  // Appearance
  {
    tag: "maibuk-surface",
    component: "Surface",
    category: "appearance",
    host: "Surface",
    interactive: false,
    summary: "A themed region whose CSS is isolated to it.",
    props: {
      css: {
        kind: "string",
        maxLength: 200_000,
        description: "CSS scoped to this surface; it cannot reach Maibuk or another Plugin.",
      },
      padding: { kind: "enum", values: ["none", "sm", "md", "lg"] },
      children: { kind: "node" },
    },
    events: [],
    methods: [],
  },
  {
    tag: PLUGIN_UI_FRAME_TAG,
    component: "Frame",
    category: "appearance",
    host: "Frame",
    interactive: false,
    summary: "A sandboxed surface that runs the Plugin's own HTML from its folder (custom UI).",
    props: {
      src: {
        kind: "string",
        required: true,
        maxLength: 1024,
        format: "plugin-path",
        description: "A relative path to an .html file in the Plugin folder.",
      },
      title: {
        kind: "string",
        required: true,
        maxLength: 512,
        description: "Accessible name of the Frame's iframe.",
      },
    },
    events: [],
    methods: [],
  },
];

/** The element with this tag, or undefined. */
export function getPluginUiElement(tag: string): PluginUiElement | undefined {
  return PLUGIN_UI_TABLE.find((element) => element.tag === tag);
}

/**
 * The Remote UI budget (decision 4 in #389, enforced by #436's stop reasons):
 * a Plugin that exceeds it is stopped with `remote-ui-limit`. Kept here so the
 * host validator and the documented limits share one source.
 */
export interface PluginUiLimits {
  /** Most nodes the host will hold for one Plugin's tree. */
  maxNodes: number;
  /** Most mutation records accepted in one batch. */
  maxRecordsPerBatch: number;
  /**
   * Most mutation batches accepted in any 1 s window (#401: the SDK sends at
   * most one flush per 16 ms window; the host allows 2x for message jitter).
   */
  maxBatchesPerSecond: number;
  /**
   * Most entries in one option or key list (a Select's `options`, a Tabs'
   * `items`, a selection's keys). Sized for a scope picker over a long Book,
   * one entry per Chapter. A list is one prop, not a node per entry, so this
   * cap, not `maxNodes`, is what bounds it.
   */
  maxOptions: number;
}

export const PLUGIN_UI_LIMITS: PluginUiLimits = {
  maxNodes: 10_000,
  maxRecordsPerBatch: 2_000,
  maxBatchesPerSecond: 120,
  maxOptions: 2_000,
};
