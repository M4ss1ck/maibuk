import { useEffect, type ReactNode } from "react";
import type { TFunction } from "i18next";
import { Button, Menu, MenuItem, MenuSection, MenuTrigger, Popover } from "react-aria-components";
import { useEditorState, type Editor } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  BookOpen,
  ChevronDown,
  Code,
  Code2,
  FileDown,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Image,
  ImageDown,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  MessageSquareText,
  Minus,
  Omega,
  Quote,
  Redo2,
  RemoveFormatting,
  Search,
  SpellCheck,
  SquareCode,
  Strikethrough,
  Subscript,
  Superscript,
  Underline,
  Undo2,
  WrapText,
} from "lucide-react";
import { ColorPicker } from "@/components/editor/ColorPicker";
import { FontFamilySelect } from "@/components/editor/FontFamilySelect";
import { FontSizeSelect } from "@/components/editor/FontSizeSelect";
import { LineHeightSelect } from "@/components/editor/LineHeightSelect";
import { SceneBreakMenu } from "@/components/editor/SceneBreakMenu";
import { TableMenu } from "@/components/editor/TableMenu";
import { TextCaseMenu } from "@/components/editor/TextCaseMenu";
import { ToolbarButton } from "@/components/editor/ToolbarButton";
import { PluginToolbarButton } from "@/components/plugins/PluginToolbarButton";
import { Tooltip } from "@/components/ui";
import { getEditorToolbarState } from "@/components/editor/toolbar/editor-toolbar-state";
import { normalizeHexColor, readThemeColor } from "@/lib/color";
import { useSettingsStore } from "@/features/settings/store";
import { LANGUAGE_OPTIONS } from "@/features/settings/types";
import {
  DICTIONARY_CATALOG,
  dictionarySizeMb,
  dictionaryStatus,
  useSpellCheckDictionaries,
  type DictionaryStatus,
} from "@/features/spell-check-dictionaries";
import {
  languageDisplayName,
  withLanguageOption,
  type WritingLanguage,
} from "@/lib/writing-language";
import type { ToolbarEntryId } from "@/features/settings/toolbar-config";
import { isPluginToolbarButtonId } from "@/features/settings/toolbar-config";

const HEADING_SIZES: Record<1 | 2 | 3, string> = {
  1: "36",
  2: "27",
  3: "22",
};
const DEFAULT_FONT_SIZE = "18";

export interface ToolbarGroupCallbacks {
  bookId?: string | null;
  spellCheckLanguage: WritingLanguage;
  onSpellCheckLanguageChange: (language: WritingLanguage) => void;
  openFindReplace: () => void;
  isFindReplaceOpen: boolean;
  onToggleFindReplace: () => void;
  openImageDialog: () => void;
  openFootnote: () => void;
  openLinkDialog: () => void;
  openDictionary: () => void;
  openSymbols: () => void;
  openHtmlPanel: () => void;
  onExportMarkdown?: () => void;
  onExportPdf?: () => void;
  onExportImage?: () => void;
}

interface ToolbarGroupBoundaryProps {
  children: ReactNode;
  wrapItems?: boolean;
  "data-group-id"?: string;
}

export function ToolbarGroupBoundary({
  children,
  wrapItems = false,
  ...rest
}: ToolbarGroupBoundaryProps) {
  return (
    <span
      className={wrapItems ? "contents" : "inline-flex shrink-0 items-center gap-0.5 sm:gap-1"}
      {...rest}
    >
      {children}
    </span>
  );
}

interface EditorToolbarGroupsProps {
  editor: Editor;
  groupIds: ToolbarEntryId[];
  callbacks: ToolbarGroupCallbacks;
  iconSize?: "sm" | "md";
  wrapItems?: boolean;
  /** Whether a command pulls focus into the editor before it runs. */
  shouldFocusEditor?: () => boolean;
}

const alwaysFocusEditor = () => true;

/** Tints the selected range with an uncommitted color; index.css reads these. */
function previewSelectionColor(editor: Editor, kind: "text" | "highlight", color: string | null) {
  const dom = editor.view?.dom;
  if (!dom) return;
  if (color) {
    dom.dataset.colorPreview = kind;
    dom.style.setProperty("--editor-color-preview", color);
  } else {
    delete dom.dataset.colorPreview;
    dom.style.removeProperty("--editor-color-preview");
  }
}

export function EditorToolbarGroups({
  editor,
  groupIds,
  callbacks,
  iconSize = "md",
  wrapItems = false,
  shouldFocusEditor = alwaysFocusEditor,
}: EditorToolbarGroupsProps) {
  const { t } = useTranslation();
  const markdownHints = (name: string) =>
    (t as any)(`editor.markdownHints.${name}`, { returnObjects: true }) as string[];
  const spellCheckEnabled = useSettingsStore((state) => state.spellCheckEnabled);
  const setSpellCheckEnabled = useSettingsStore((state) => state.setSpellCheckEnabled);
  const editorState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => {
      const state = getEditorToolbarState(currentEditor);
      // The first edit enables Undo. Only history controls need to render for it,
      // including when groups are mounted in the hidden measurement lane.
      return groupIds.includes("history") ? state : { ...state, canUndo: false, canRedo: false };
    },
  });
  const icon = iconSize === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  // The floating selection toolbar keeps focus on its own controls: a command
  // started from there must not pull the caret back out of the toolbar.
  const chain = () => (shouldFocusEditor() ? editor.chain().focus() : editor.chain());
  const fieldFocusDecision =
    shouldFocusEditor === alwaysFocusEditor ? undefined : shouldFocusEditor;

  const handleHeadingToggle = (level: 1 | 2 | 3) => {
    const isCurrentlyActive =
      (level === 1 && editorState.isH1) ||
      (level === 2 && editorState.isH2) ||
      (level === 3 && editorState.isH3);
    chain()
      .toggleHeading({ level })
      .setFontSize(`${isCurrentlyActive ? DEFAULT_FONT_SIZE : HEADING_SIZES[level]}px`)
      .setFontFamily(editorState.fontFamily)
      .run();
  };

  const renderGroup = (id: ToolbarEntryId): ReactNode => {
    // Plugin buttons render nothing until the wiring slice (#437) binds them
    // to their Commands; the config keeps their order meanwhile.
    if (isPluginToolbarButtonId(id)) {
      return <PluginToolbarButton id={id} iconSize={iconSize} />;
    }
    switch (id) {
      case "history":
        return (
          <>
            <ToolbarButton
              onClick={() => chain().undo().run()}
              disabled={!editorState.canUndo}
              label={t("editor.undo")}
              shortcut="common.undo"
            >
              <Undo2 className={icon} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => chain().redo().run()}
              disabled={!editorState.canRedo}
              label={t("editor.redo")}
              shortcut="common.redo"
            >
              <Redo2 className={icon} />
            </ToolbarButton>
          </>
        );
      case "font":
        return (
          <>
            <FontSizeSelect
              editor={editor}
              value={editorState.fontSize}
              shouldFocusEditor={fieldFocusDecision}
            />
            <FontFamilySelect
              editor={editor}
              value={editorState.fontFamily}
              shouldFocusEditor={fieldFocusDecision}
            />
          </>
        );
      case "basic-marks":
        return (
          <>
            <ToolbarButton
              onClick={() => chain().toggleBold().run()}
              isActive={editorState.isBold}
              label={t("editor.bold")}
              shortcut="editor.bold"
              markdownHint={markdownHints("bold")}
            >
              <Bold className={icon} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => chain().toggleItalic().run()}
              isActive={editorState.isItalic}
              label={t("editor.italic")}
              shortcut="editor.italic"
              markdownHint={markdownHints("italic")}
            >
              <Italic className={icon} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => chain().toggleUnderline().run()}
              isActive={editorState.isUnderline}
              label={t("editor.underline")}
              shortcut="editor.underline"
            >
              <Underline className={icon} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => chain().toggleStrike().run()}
              isActive={editorState.isStrike}
              label={t("editor.strikethrough")}
              shortcut="editor.strikethrough"
              markdownHint={markdownHints("strikethrough")}
            >
              <Strikethrough className={icon} />
            </ToolbarButton>
          </>
        );
      case "headings":
        return (
          <>
            <ToolbarButton
              onClick={() => handleHeadingToggle(1)}
              isActive={editorState.isH1}
              label={t("editor.heading1")}
              shortcut="editor.heading1"
              markdownHint={markdownHints("heading1")}
            >
              <Heading1 className={icon} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => handleHeadingToggle(2)}
              isActive={editorState.isH2}
              label={t("editor.heading2")}
              shortcut="editor.heading2"
              markdownHint={markdownHints("heading2")}
            >
              <Heading2 className={icon} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => handleHeadingToggle(3)}
              isActive={editorState.isH3}
              label={t("editor.heading3")}
              shortcut="editor.heading3"
              markdownHint={markdownHints("heading3")}
            >
              <Heading3 className={icon} />
            </ToolbarButton>
          </>
        );
      case "find":
        return (
          <ToolbarButton
            onClick={() =>
              callbacks.isFindReplaceOpen
                ? callbacks.onToggleFindReplace()
                : callbacks.openFindReplace()
            }
            isActive={callbacks.isFindReplaceOpen}
            label={t("editor.findReplace")}
            shortcut="common.find"
          >
            <Search className={icon} />
          </ToolbarButton>
        );
      case "line-height":
        return (
          <LineHeightSelect
            editor={editor}
            value={editorState.lineHeight}
            shouldFocusEditor={fieldFocusDecision}
          />
        );
      case "highlight":
        // Color commits leave focus in the open picker; closing it returns focus to its trigger.
        return (
          <ColorPicker
            value={editorState.highlightColor}
            onChange={(color) => editor.chain().setHighlight({ color }).run()}
            onPreview={(color) => previewSelectionColor(editor, "highlight", color)}
            onClear={() => editor.chain().unsetHighlight().run()}
            onToggle={() =>
              chain()
                .toggleHighlight({ color: editorState.highlightColor || "#FFFF00" })
                .run()
            }
            isActive={editorState.isHighlight}
            label={t("editor.highlight")}
            shortcut="editor.highlight"
            markdownHint={markdownHints("highlight")}
            icon={<Highlighter className={icon} />}
            contrastAgainst={() =>
              normalizeHexColor(editorState.color) ?? readThemeColor("--color-foreground")
            }
          />
        );
      case "script":
        return (
          <>
            <ToolbarButton
              onClick={() => chain().toggleSubscript().run()}
              isActive={editorState.isSubscript}
              label={t("editor.subscript")}
              shortcut="editor.subscript"
            >
              <Subscript className={icon} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => chain().toggleSuperscript().run()}
              isActive={editorState.isSuperscript}
              label={t("editor.superscript")}
              shortcut="editor.superscript"
            >
              <Superscript className={icon} />
            </ToolbarButton>
          </>
        );
      case "text-color":
        return (
          <ColorPicker
            value={editorState.color}
            onChange={(color) => editor.chain().setColor(color).run()}
            onPreview={(color) => previewSelectionColor(editor, "text", color)}
            onClear={() => editor.chain().unsetColor().run()}
            onToggle={() =>
              editorState.color ? chain().unsetColor().run() : chain().setColor("#000000").run()
            }
            isActive={!!editorState.color}
            label={t("editor.textColor")}
            shortcut="editor.textColor"
            icon={<Baseline className={icon} />}
            contrastAgainst={() => readThemeColor("--color-background")}
          />
        );
      case "link-code":
        return (
          <>
            <ToolbarButton
              onClick={callbacks.openLinkDialog}
              isActive={editorState.isLink}
              label={t("editor.insertLink")}
              shortcut="editor.insertLink"
            >
              <Link className={icon} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => chain().toggleCode().run()}
              isActive={editorState.isCode}
              label={t("editor.code")}
              shortcut="editor.code"
              markdownHint={markdownHints("code")}
            >
              <Code className={icon} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => chain().toggleCodeBlock().run()}
              isActive={editorState.isCodeBlock}
              label={t("editor.codeBlock")}
              shortcut="editor.codeBlock"
              markdownHint={markdownHints("codeBlock")}
            >
              <SquareCode className={icon} />
            </ToolbarButton>
          </>
        );
      case "lists":
        return (
          <>
            <ToolbarButton
              onClick={() => chain().toggleBulletList().run()}
              isActive={editorState.isBulletList}
              label={t("editor.bulletList")}
              shortcut="editor.bulletList"
              markdownHint={markdownHints("bulletList")}
            >
              <List className={icon} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => chain().toggleOrderedList().run()}
              isActive={editorState.isOrderedList}
              label={t("editor.numberedList")}
              shortcut="editor.numberedList"
              markdownHint={markdownHints("numberedList")}
            >
              <ListOrdered className={icon} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() =>
                (editor.commands as { toggleTaskList: () => unknown }).toggleTaskList()
              }
              isActive={editorState.isTaskList}
              disabled={editor.schema.nodes.taskList === undefined}
              label={t("editor.taskList")}
              shortcut="editor.taskList"
              markdownHint={markdownHints("taskList")}
            >
              <ListChecks className={icon} />
            </ToolbarButton>
          </>
        );
      case "blockquote":
        return (
          <ToolbarButton
            onClick={() => chain().toggleBlockquote().run()}
            isActive={editorState.isBlockquote}
            label={t("editor.quote")}
            shortcut="editor.quote"
            markdownHint={markdownHints("quote")}
          >
            <Quote className={icon} />
          </ToolbarButton>
        );
      case "indent":
        return (
          <>
            <ToolbarButton
              onClick={() =>
                editorState.canSinkListItem
                  ? chain().sinkListItem("listItem").run()
                  : chain().increaseIndent().run()
              }
              label={t("editor.increaseIndent")}
              shortcut="editor.increaseIndent"
            >
              <IndentIncrease className={icon} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() =>
                editorState.canLiftListItem
                  ? chain().liftListItem("listItem").run()
                  : chain().decreaseIndent().run()
              }
              label={t("editor.decreaseIndent")}
              shortcut="editor.decreaseIndent"
            >
              <IndentDecrease className={icon} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => chain().increaseFirstLineIndent().run()}
              label={t("editor.increaseFirstLineIndent")}
              shortcut="editor.increaseFirstLineIndent"
            >
              <WrapText className={icon} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => chain().decreaseFirstLineIndent().run()}
              label={t("editor.decreaseFirstLineIndent")}
              shortcut="editor.decreaseFirstLineIndent"
            >
              <WrapText className={`${icon} scale-x-[-1]`} />
            </ToolbarButton>
          </>
        );
      case "align":
        return (
          <>
            <ToolbarButton
              onClick={() => chain().setTextAlign("left").run()}
              isActive={editorState.isAlignLeft}
              label={t("editor.alignLeft")}
              shortcut="editor.alignLeft"
            >
              <AlignLeft className={icon} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => chain().setTextAlign("center").run()}
              isActive={editorState.isAlignCenter}
              label={t("editor.alignCenter")}
              shortcut="editor.alignCenter"
            >
              <AlignCenter className={icon} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => chain().setTextAlign("right").run()}
              isActive={editorState.isAlignRight}
              label={t("editor.alignRight")}
              shortcut="editor.alignRight"
            >
              <AlignRight className={icon} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => chain().setTextAlign("justify").run()}
              isActive={editorState.isAlignJustify}
              label={t("editor.alignJustify")}
              shortcut="editor.alignJustify"
            >
              <AlignJustify className={icon} />
            </ToolbarButton>
          </>
        );
      case "clear-formatting":
        return (
          <ToolbarButton
            onClick={() => chain().unsetAllMarks().clearNodes().run()}
            label={t("editor.removeFormatting")}
            shortcut="editor.removeFormatting"
          >
            <RemoveFormatting className={icon} />
          </ToolbarButton>
        );
      case "text-case":
        return <TextCaseMenu editor={editor} />;
      case "table":
        return <TableMenu editor={editor} wrapItems={wrapItems} />;
      case "image":
        return (
          <ToolbarButton
            onClick={callbacks.openImageDialog}
            label={t("editor.insertImage")}
            shortcut="editor.insertImage"
          >
            <Image className={icon} />
          </ToolbarButton>
        );
      case "scene-break":
        return <SceneBreakMenu editor={editor} bookId={callbacks.bookId} />;
      case "footnote":
        return (
          <ToolbarButton
            onClick={callbacks.openFootnote}
            label={t("editor.footnote")}
            shortcut="editor.footnote"
          >
            <MessageSquareText className={icon} />
          </ToolbarButton>
        );
      case "horizontal-rule":
        return (
          <ToolbarButton
            onClick={() => chain().setHorizontalRule().run()}
            label={t("editor.horizontalRule")}
            shortcut="editor.horizontalRule"
            markdownHint={markdownHints("horizontalRule")}
          >
            <Minus className={icon} />
          </ToolbarButton>
        );
      case "spellcheck":
        return (
          <>
            <ToolbarButton
              onClick={() => setSpellCheckEnabled(!spellCheckEnabled)}
              isActive={spellCheckEnabled}
              label={t("editor.spellCheck")}
              shortcut="editor.spellCheck"
            >
              <SpellCheck className={icon} />
            </ToolbarButton>
            <SpellCheckLanguageMenu
              value={callbacks.spellCheckLanguage}
              onChange={callbacks.onSpellCheckLanguageChange}
              label={t("editor.spellCheckLanguage")}
            />
          </>
        );
      case "dictionary":
        return (
          <ToolbarButton
            onClick={callbacks.openDictionary}
            label={t("editor.dictionary")}
            shortcut="editor.dictionary"
          >
            <BookOpen className={icon} />
          </ToolbarButton>
        );
      case "symbols":
        return (
          <ToolbarButton
            onClick={callbacks.openSymbols}
            label={t("editor.symbols")}
            shortcut="editor.insertSymbol"
          >
            <Omega className={icon} />
          </ToolbarButton>
        );
      case "html-view":
        return (
          <ToolbarButton
            onClick={callbacks.openHtmlPanel}
            label={t("editor.viewHtml")}
            shortcut="editor.viewHtml"
          >
            <Code2 className={icon} />
          </ToolbarButton>
        );
      case "export":
        return (
          <>
            <ToolbarButton
              onClick={() => callbacks.onExportMarkdown?.()}
              disabled={!callbacks.onExportMarkdown}
              label={t("editor.exportMarkdown")}
              shortcut="editor.exportMarkdown"
            >
              <FileDown className={icon} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => callbacks.onExportPdf?.()}
              disabled={!callbacks.onExportPdf}
              label={t("editor.exportPdf")}
              shortcut="editor.exportPdf"
            >
              <FileText className={icon} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => callbacks.onExportImage?.()}
              disabled={!callbacks.onExportImage}
              label={t("editor.exportImage")}
              shortcut="editor.exportImage"
            >
              <ImageDown className={icon} />
            </ToolbarButton>
          </>
        );
    }
  };

  return (
    <>
      {groupIds.map((id) => (
        <ToolbarGroupBoundary key={id} data-group-id={id} wrapItems={wrapItems}>
          {renderGroup(id)}
        </ToolbarGroupBoundary>
      ))}
    </>
  );
}

interface SpellCheckLanguageMenuProps {
  value: WritingLanguage;
  onChange: (language: WritingLanguage) => void;
  label: string;
}

export function dictionaryStatusText(status: DictionaryStatus, t: TFunction): string | null {
  switch (status.kind) {
    case "ready":
      return null;
    case "available":
      return t("editor.spellCheckDictionaryStatusAvailable");
    case "downloading":
      return t("editor.spellCheckDictionaryStatusDownloading");
    case "unavailable":
      return t("editor.spellCheckDictionaryStatusUnavailable");
  }
}

const MENU_ITEM_CLASS =
  "flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-sm outline-none data-focused:bg-muted data-disabled:cursor-default data-disabled:opacity-60";
const STATUS_ITEM_CLASS =
  "flex cursor-default items-center gap-3 px-3 py-1.5 text-sm text-muted-foreground outline-none data-disabled:opacity-60";

function SpellCheckLanguageMenu({ value, onChange, label }: SpellCheckLanguageMenuProps) {
  const { t } = useTranslation();
  const dictionaries = useSpellCheckDictionaries();
  const { loaded, refresh } = dictionaries;

  useEffect(() => {
    if (!loaded) void refresh().catch(() => {});
  }, [loaded, refresh]);

  const status = dictionaryStatus(value, dictionaries);
  const text = dictionaryStatusText(status, t);

  const options = [
    ...LANGUAGE_OPTIONS,
    ...DICTIONARY_CATALOG.map((entry) => ({
      value: entry.language,
      label: languageDisplayName(entry.language),
    })),
  ];
  const menuOptions = withLanguageOption(options, value);

  const languageName =
    status.kind === "available"
      ? languageDisplayName(status.entry.language)
      : languageDisplayName(value);
  const accessibleLabel = text ? `${label}: ${text}` : label;

  return (
    <MenuTrigger>
      <Tooltip content={accessibleLabel}>
        <Button
          aria-label={accessibleLabel}
          className="flex h-8 min-w-7 max-w-12 flex-col items-center justify-center gap-0 rounded px-0.5 text-[10px] font-medium leading-none transition-colors hover:bg-muted data-pressed:bg-primary data-pressed:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span
            className={`${value.length === 2 ? "max-w-full truncate uppercase" : "max-w-full truncate"} ${text ? "text-warning-text" : ""}`}
          >
            {value}
          </span>
          <ChevronDown className="h-2.5 w-2.5" />
        </Button>
      </Tooltip>
      <Popover
        placement="bottom start"
        className="z-50 min-w-32 overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-lg focus:outline-none"
      >
        <Menu
          aria-label={label}
          selectionMode="single"
          selectedKeys={[value]}
          onAction={(key) => {
            if (key === "download-dictionary") {
              if (status.kind === "available") void dictionaries.download(status.entry.language);
              return;
            }
            if (key !== value) onChange(key as WritingLanguage);
          }}
          className="outline-none"
        >
          {menuOptions.map((option) => (
            <MenuItem
              key={option.value}
              id={option.value}
              data-command-exempt="a value of the Spell Check language picker, not an action"
              textValue={option.label}
              className={`${MENU_ITEM_CLASS} ${
                option.value === value ? "text-primary" : "text-foreground"
              }`}
            >
              <span>{option.label}</span>
              <span
                className={
                  option.value.length === 2
                    ? "text-xs text-muted-foreground uppercase"
                    : "text-xs text-muted-foreground"
                }
              >
                {option.value}
              </span>
            </MenuItem>
          ))}
          {status.kind !== "ready" && (
            <MenuSection className="mt-1 border-t border-border pt-1 outline-none">
              {status.kind === "available" &&
                (status.failed ? (
                  <MenuItem
                    id="download-failed"
                    isDisabled
                    data-command-exempt="a failed download has no action of its own"
                    textValue={t("editor.spellCheckDictionaryDownloadFailed")}
                    className={STATUS_ITEM_CLASS}
                  >
                    {t("editor.spellCheckDictionaryDownloadFailed")}
                  </MenuItem>
                ) : (
                  <MenuItem
                    id="no-dictionary"
                    isDisabled
                    data-command-exempt="a statement about the language, not an action"
                    textValue={t("editor.spellCheckDictionaryNoneFor", {
                      language: languageName,
                    })}
                    className={STATUS_ITEM_CLASS}
                  >
                    {t("editor.spellCheckDictionaryNoneFor", { language: languageName })}
                  </MenuItem>
                ))}
              {status.kind === "available" && (
                <MenuItem
                  id="download-dictionary"
                  data-command="editor.downloadSpellCheckDictionary"
                  textValue={t("editor.spellCheckDictionaryDownloadFor", {
                    language: languageName,
                    size: dictionarySizeMb(status.entry),
                  })}
                  className={`${MENU_ITEM_CLASS} text-foreground`}
                >
                  {t("editor.spellCheckDictionaryDownloadFor", {
                    language: languageName,
                    size: dictionarySizeMb(status.entry),
                  })}
                </MenuItem>
              )}
              {status.kind === "downloading" && (
                <MenuItem
                  id="download-downloading"
                  isDisabled
                  data-command-exempt="the download is already running"
                  textValue={t("editor.spellCheckDictionaryDownloadingFor", {
                    language: languageName,
                  })}
                  className={STATUS_ITEM_CLASS}
                >
                  {t("editor.spellCheckDictionaryDownloadingFor", { language: languageName })}
                </MenuItem>
              )}
              {status.kind === "unavailable" && (
                <MenuItem
                  id="no-spell-check-dictionary"
                  isDisabled
                  data-command-exempt="a statement about the language, not an action"
                  textValue={t("editor.spellCheckDictionaryUnavailableFor", {
                    language: languageName,
                  })}
                  className={STATUS_ITEM_CLASS}
                >
                  {t("editor.spellCheckDictionaryUnavailableFor", { language: languageName })}
                </MenuItem>
              )}
            </MenuSection>
          )}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}
