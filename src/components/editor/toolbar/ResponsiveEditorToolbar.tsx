import { useRef, type ReactNode, type RefObject } from "react";
import type { Editor } from "@tiptap/react";
import { Toolbar } from "react-aria-components/Toolbar";
import { useTranslation } from "react-i18next";
import { TooltipGroup } from "@/components/ui";
import { Divider } from "@/components/editor/ToolbarButton";
import {
  EditorToolbarGroups,
  type ToolbarGroupCallbacks,
} from "@/components/editor/toolbar/EditorToolbarGroups";
import { useToolbarOverflow } from "@/components/editor/toolbar/useToolbarOverflow";
import { useSettingsStore } from "@/features/settings/store";
import { suppressOrphanDividers, type ToolbarEntry } from "@/features/settings/toolbar-config";

interface ResponsiveEditorToolbarProps {
  editor: Editor;
  callbacks: ToolbarGroupCallbacks;
  fixedUtilities: ReactNode;
  utilityCluster: ReactNode;
  /** Esc inside the toolbar hands focus back to the Chapter text. */
  onExitToolbar?: () => void;
}

function visibleEntries(entries: ToolbarEntry[]): ToolbarEntry[] {
  return suppressOrphanDividers(
    entries.filter((entry) => entry.kind !== "group" || entry.toolbarVisible)
  );
}

function withoutTrailingDividers(entries: ToolbarEntry[]): ToolbarEntry[] {
  let end = entries.length;
  while (end > 0 && entries[end - 1].kind === "divider") end--;
  return entries.slice(0, end);
}

function renderEntry(
  entry: ToolbarEntry,
  editor: Editor,
  callbacks: ToolbarGroupCallbacks,
  wrapItems = false
): ReactNode {
  if (entry.kind === "divider") return <Divider key={entry.id} />;
  return (
    <EditorToolbarGroups
      key={entry.id}
      editor={editor}
      groupIds={[entry.id]}
      callbacks={callbacks}
      wrapItems={wrapItems}
    />
  );
}

export function ResponsiveEditorToolbar({
  editor,
  callbacks,
  fixedUtilities,
  utilityCluster,
  onExitToolbar,
}: ResponsiveEditorToolbarProps) {
  const { t } = useTranslation();
  const toolbarConfig = useSettingsStore((state) => state.toolbarConfig);
  const toolbarExpanded = useSettingsStore((state) => state.toolbarExpanded);

  const startEntries = visibleEntries(toolbarConfig.start);
  const endEntries = visibleEntries(toolbarConfig.end);

  const rootRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);

  const { visibleCount } = useToolbarOverflow({
    rootRef: rootRef as RefObject<HTMLElement>,
    endRef: endRef as RefObject<HTMLElement>,
    measureRef: measureRef as RefObject<HTMLElement>,
    entryCount: startEntries.length,
    deps: [toolbarConfig, toolbarExpanded],
  });

  const visibleStart = toolbarExpanded
    ? startEntries
    : withoutTrailingDividers(startEntries.slice(0, visibleCount));

  const rowClass = toolbarExpanded
    ? "flex flex-wrap items-center justify-start gap-1 px-2 sm:px-4 py-1 sm:py-2"
    : "flex flex-nowrap items-center overflow-x-auto px-2 sm:px-4 py-1 sm:py-2 gap-0.5 sm:gap-1";

  const collapsedStartClass = "flex flex-nowrap items-center gap-0.5 sm:gap-1";
  // Between a resize and the next measurement the Start lane may briefly hold one entry too
  // many; clipping it there keeps the row from flashing a scrollbar.
  const startBlockClass = toolbarExpanded
    ? "contents"
    : `${collapsedStartClass} min-w-0 overflow-hidden`;

  const endBlockClass = toolbarExpanded
    ? "flex flex-nowrap items-center shrink-0 ml-auto gap-0.5 sm:gap-1"
    : "flex flex-nowrap items-center shrink-0 ml-auto gap-0.5 sm:gap-1";

  return (
    <TooltipGroup>
      <div
        className="border-b border-border bg-background sticky top-0 z-10"
        onKeyDownCapture={(event) => {
          if (event.key !== "Escape") return;
          // An open combobox listbox owns Escape first (and closes itself).
          const openCombo = (event.target as HTMLElement).closest(
            '[role="combobox"][aria-expanded="true"]'
          );
          if (openCombo) return;
          onExitToolbar?.();
        }}
      >
        <Toolbar ref={rootRef} aria-label={t("editor.toolbar")} className={rowClass}>
          <div data-testid="toolbar-start-lane" className={startBlockClass}>
            {visibleStart.map((entry) => renderEntry(entry, editor, callbacks, toolbarExpanded))}
          </div>
          <div ref={endRef} data-testid="toolbar-end-lane" className={endBlockClass}>
            {endEntries.map((entry) => renderEntry(entry, editor, callbacks))}
            {utilityCluster}
            {fixedUtilities}
          </div>
          <div
            ref={measureRef}
            data-testid="toolbar-measure-lane"
            aria-hidden="true"
            className={`${collapsedStartClass} absolute left-0 top-0 w-max invisible pointer-events-none`}
          >
            {startEntries.map((entry) => renderEntry(entry, editor, callbacks))}
          </div>
        </Toolbar>
      </div>
    </TooltipGroup>
  );
}
