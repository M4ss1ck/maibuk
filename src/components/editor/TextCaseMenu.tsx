import type { Editor } from "@tiptap/react";
import { Button, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import { useTranslation } from "react-i18next";
import { CaseSensitive, CaseUpper, CaseLower, ChevronDown } from "lucide-react";
import { Tooltip } from "@/components/ui";
import { ToolbarButton } from "@/components/editor/ToolbarButton";
import { transformSelectedText, type TextTransform } from "@/components/editor/text-transforms";

interface TextCaseMenuProps {
  editor: Editor;
}

export function TextCaseMenu({ editor }: TextCaseMenuProps) {
  const { t } = useTranslation();

  const runTransform = (transform: TextTransform) => {
    transformSelectedText(editor, transform);
  };

  return (
    <>
      <ToolbarButton onClick={() => runTransform("uppercase")} label={t("editor.uppercase")}>
        <CaseUpper className="w-4 h-4" />
      </ToolbarButton>

      <ToolbarButton onClick={() => runTransform("lowercase")} label={t("editor.lowercase")}>
        <CaseLower className="w-4 h-4" />
      </ToolbarButton>

      <MenuTrigger>
        <Tooltip content={t("editor.textCase")}>
          <Button
            aria-label={t("editor.textCase")}
            className="flex items-center gap-0.5 rounded p-2 transition-colors hover:bg-muted data-pressed:bg-primary data-pressed:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
              textValue={t("editor.alternatingCase")}
              className="cursor-pointer whitespace-nowrap px-3 py-1.5 text-sm text-foreground outline-none data-focused:bg-muted"
            >
              {t("editor.alternatingCase")}
            </MenuItem>
            <MenuItem
              id="sentenceCase"
              textValue={t("editor.sentenceCase")}
              className="cursor-pointer whitespace-nowrap px-3 py-1.5 text-sm text-foreground outline-none data-focused:bg-muted"
            >
              {t("editor.sentenceCase")}
            </MenuItem>
            <MenuItem
              id="titleCase"
              textValue={t("editor.titleCase")}
              className="cursor-pointer whitespace-nowrap px-3 py-1.5 text-sm text-foreground outline-none data-focused:bg-muted"
            >
              {t("editor.titleCase")}
            </MenuItem>
            <MenuItem
              id="horizontalMirror"
              textValue={t("editor.horizontalMirror")}
              className="cursor-pointer whitespace-nowrap border-t border-border px-3 py-1.5 text-sm text-foreground outline-none data-focused:bg-muted"
            >
              {t("editor.horizontalMirror")}
            </MenuItem>
            <MenuItem
              id="upsideDown"
              textValue={t("editor.upsideDown")}
              className="cursor-pointer whitespace-nowrap px-3 py-1.5 text-sm text-foreground outline-none data-focused:bg-muted"
            >
              {t("editor.upsideDown")}
            </MenuItem>
            <MenuItem
              id="reverseText"
              textValue={t("editor.reverseText")}
              className="cursor-pointer whitespace-nowrap px-3 py-1.5 text-sm text-foreground outline-none data-focused:bg-muted"
            >
              {t("editor.reverseText")}
            </MenuItem>
            <MenuItem
              id="leetspeak"
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
