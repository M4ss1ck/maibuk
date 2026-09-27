import type { Editor } from "@tiptap/react";
import { Button, Menu, MenuItem, MenuTrigger, Popover, Separator } from "react-aria-components";
import { useTranslation } from "react-i18next";
import { CaseSensitive, CaseUpper, CaseLower, ChevronDown } from "lucide-react";
import { Tooltip } from "@/components/ui";
import { ToolbarButton } from "@/components/editor/ToolbarButton";
import { transformSelectedText, type TextTransform } from "@/components/editor/text-transforms";
import { useShortcuts } from "@/lib/shortcuts";

interface TextCaseMenuProps {
  editor: Editor;
}

export function TextCaseMenu({ editor }: TextCaseMenuProps) {
  const { t } = useTranslation();

  const runTransform = (transform: TextTransform) => {
    transformSelectedText(editor, transform);
  };

  useShortcuts([
    { id: "editor.uppercase", onTrigger: () => runTransform("uppercase") },
    { id: "editor.lowercase", onTrigger: () => runTransform("lowercase") },
    { id: "editor.alternatingCase", onTrigger: () => runTransform("alternatingCase") },
    { id: "editor.sentenceCase", onTrigger: () => runTransform("sentenceCase") },
    { id: "editor.titleCase", onTrigger: () => runTransform("titleCase") },
    { id: "editor.horizontalMirror", onTrigger: () => runTransform("horizontalMirror") },
    { id: "editor.upsideDown", onTrigger: () => runTransform("upsideDown") },
    { id: "editor.reverseText", onTrigger: () => runTransform("reverseText") },
    { id: "editor.leetspeak", onTrigger: () => runTransform("leetspeak") },
  ]);

  return (
    <>
      <ToolbarButton
        onClick={() => runTransform("uppercase")}
        label={t("editor.uppercase")}
        shortcut="editor.uppercase"
      >
        <CaseUpper className="w-4 h-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => runTransform("lowercase")}
        label={t("editor.lowercase")}
        shortcut="editor.lowercase"
      >
        <CaseLower className="w-4 h-4" />
      </ToolbarButton>

      <MenuTrigger>
        <Tooltip content={t("editor.textCase")}>
          <Button
            aria-label={t("editor.textCase")}
            className="flex items-center gap-0.5 rounded p-2 transition-colors hover:bg-muted data-pressed:bg-primary data-pressed:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <CaseSensitive className="w-4 h-4" />
            <ChevronDown className="w-3 h-3" />
          </Button>
        </Tooltip>
        <Popover
          placement="bottom start"
          className="z-50 mt-1 min-w-max rounded-lg border border-border bg-card py-1 shadow-lg focus:outline-none"
        >
          <Menu
            aria-label={t("editor.textCase")}
            onAction={(key) => runTransform(key as TextTransform)}
            className="outline-none"
          >
            <MenuItem
              id="alternatingCase"
              data-command="editor.alternatingCase"
              textValue={t("editor.alternatingCase")}
              className="cursor-pointer whitespace-nowrap px-3 py-1.5 text-sm text-foreground outline-none data-focused:bg-muted"
            >
              {t("editor.alternatingCase")}
            </MenuItem>
            <MenuItem
              id="sentenceCase"
              data-command="editor.sentenceCase"
              textValue={t("editor.sentenceCase")}
              className="cursor-pointer whitespace-nowrap px-3 py-1.5 text-sm text-foreground outline-none data-focused:bg-muted"
            >
              {t("editor.sentenceCase")}
            </MenuItem>
            <MenuItem
              id="titleCase"
              data-command="editor.titleCase"
              textValue={t("editor.titleCase")}
              className="cursor-pointer whitespace-nowrap px-3 py-1.5 text-sm text-foreground outline-none data-focused:bg-muted"
            >
              {t("editor.titleCase")}
            </MenuItem>
            <Separator className="my-1 border-t border-muted" />
            <MenuItem
              id="horizontalMirror"
              data-command="editor.horizontalMirror"
              textValue={t("editor.horizontalMirror")}
              className="cursor-pointer whitespace-nowrap px-3 py-1.5 text-sm text-foreground outline-none data-focused:bg-muted"
            >
              {t("editor.horizontalMirror")}
            </MenuItem>
            <MenuItem
              id="upsideDown"
              data-command="editor.upsideDown"
              textValue={t("editor.upsideDown")}
              className="cursor-pointer whitespace-nowrap px-3 py-1.5 text-sm text-foreground outline-none data-focused:bg-muted"
            >
              {t("editor.upsideDown")}
            </MenuItem>
            <MenuItem
              id="reverseText"
              data-command="editor.reverseText"
              textValue={t("editor.reverseText")}
              className="cursor-pointer whitespace-nowrap px-3 py-1.5 text-sm text-foreground outline-none data-focused:bg-muted"
            >
              {t("editor.reverseText")}
            </MenuItem>
            <MenuItem
              id="leetspeak"
              data-command="editor.leetspeak"
              textValue={t("editor.leetspeak")}
              className="cursor-pointer whitespace-nowrap px-3 py-1.5 text-sm text-foreground outline-none data-focused:bg-muted"
            >
              {t("editor.leetspeak")}
            </MenuItem>
          </Menu>
        </Popover>
      </MenuTrigger>
    </>
  );
}
