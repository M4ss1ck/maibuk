import {
  AlignLeft,
  Baseline,
  Bold,
  BookOpen,
  CaseSensitive,
  Code2,
  FileDown,
  Heading,
  Highlighter,
  Image,
  IndentIncrease,
  Link,
  List,
  MessageSquareText,
  Minus,
  Omega,
  Quote,
  RemoveFormatting,
  Rows3,
  Search,
  SeparatorHorizontal,
  SpellCheck,
  Subscript,
  Table,
  Type,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import type { ParseKeys } from "i18next";
import {
  ALL_GROUP_IDS,
  FLOATING_ELIGIBLE_IDS,
  type ToolbarGroupId,
} from "@/features/settings/toolbar-config";

export interface ToolbarGroupMeta {
  id: ToolbarGroupId;
  labelKey: ParseKeys;
  Icon: LucideIcon;
  floatingEligible: boolean;
  childLabelKeys?: string[];
}

const ICONS: Record<ToolbarGroupId, LucideIcon> = {
  history: Undo2,
  font: Type,
  "basic-marks": Bold,
  headings: Heading,
  find: Search,
  "line-height": Rows3,
  highlight: Highlighter,
  script: Subscript,
  "text-color": Baseline,
  "link-code": Link,
  lists: List,
  blockquote: Quote,
  indent: IndentIncrease,
  align: AlignLeft,
  "clear-formatting": RemoveFormatting,
  "text-case": CaseSensitive,
  table: Table,
  image: Image,
  "scene-break": SeparatorHorizontal,
  footnote: MessageSquareText,
  "horizontal-rule": Minus,
  spellcheck: SpellCheck,
  dictionary: BookOpen,
  symbols: Omega,
  "html-view": Code2,
  export: FileDown,
};

/** Kebab id to camel-case i18n suffix. Keep in sync with `toolbar.groups`. */
const LABEL_SUFFIX: Record<ToolbarGroupId, string> = {
  history: "history",
  font: "font",
  "basic-marks": "basicMarks",
  headings: "headings",
  find: "find",
  "line-height": "lineHeight",
  highlight: "highlight",
  script: "script",
  "text-color": "textColor",
  "link-code": "linkCode",
  lists: "lists",
  blockquote: "blockquote",
  indent: "indent",
  align: "align",
  "clear-formatting": "clearFormatting",
  "text-case": "textCase",
  table: "table",
  image: "image",
  "scene-break": "sceneBreak",
  footnote: "footnote",
  "horizontal-rule": "horizontalRule",
  spellcheck: "spellcheck",
  dictionary: "dictionary",
  symbols: "symbols",
  "html-view": "htmlView",
  export: "export",
};

export const TOOLBAR_GROUP_META = ALL_GROUP_IDS.reduce(
  (metaById, id) => {
    metaById[id] = {
      id,
      labelKey: `toolbar.groups.${LABEL_SUFFIX[id]}` as ParseKeys,
      Icon: ICONS[id],
      floatingEligible: FLOATING_ELIGIBLE_IDS.has(id),
    };
    return metaById;
  },
  {} as Record<ToolbarGroupId, ToolbarGroupMeta>
);

export const TOOLBAR_GROUP_META_LIST: ToolbarGroupMeta[] = ALL_GROUP_IDS.map(
  (id) => TOOLBAR_GROUP_META[id]
);
