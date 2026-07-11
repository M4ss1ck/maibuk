import { useRef, type ReactNode, type RefObject } from "react";
import type { Editor } from "@tiptap/react";
import { TooltipGroup } from "@/components/ui";
import { Divider } from "@/components/editor/ToolbarButton";
import {
  EditorToolbarGroups,
  type ToolbarGroupCallbacks,
} from "@/components/editor/toolbar/EditorToolbarGroups";
import { useToolbarOverflow } from "@/components/editor/toolbar/useToolbarOverflow";
import { useSettingsStore } from "@/features/settings/store";
import {
  suppressOrphanDividers,
  type ToolbarEntry,
} from "@/features/settings/toolbar-config";

interface ResponsiveEditorToolbarProps {
  editor: Editor;
  callbacks: ToolbarGroupCallbacks;
  fixedUtilities: ReactNode;
  utilityCluster: ReactNode;
}

function visibleEntries(entries: ToolbarEntry[]): ToolbarEntry[] {
  return suppressOrphanDividers(
    entries.filter((entry) => entry.kind !== "group" || entry.toolbarVisible),
  );
}

function renderEntry(
  entry: ToolbarEntry,
  editor: Editor,
  callbacks: ToolbarGroupCallbacks,
): ReactNode {
  if (entry.kind === "divider") return <Divider key={entry.id} />;
  return (
    <EditorToolbarGroups
      key={entry.id}
      editor={editor}
      groupIds={[entry.id]}
      callbacks={callbacks}
    />
  );
}

export function ResponsiveEditorToolbar({
  editor,
  callbacks,
  fixedUtilities,
  utilityCluster,
}: ResponsiveEditorToolbarProps) {
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
    : startEntries.slice(0, visibleCount);

  const rowClass = toolbarExpanded
    ? "flex flex-wrap items-center justify-between gap-1 px-2 sm:px-4 py-1 sm:py-2"
    : "flex flex-nowrap items-center overflow-x-auto px-2 sm:px-4 py-1 sm:py-2 gap-0.5 sm:gap-1";

  const startBlockClass = toolbarExpanded
    ? "flex flex-wrap items-center gap-0.5 sm:gap-1"
    : "flex flex-nowrap items-center gap-0.5 sm:gap-1";

  const endBlockClass = toolbarExpanded
    ? "flex flex-wrap items-center gap-0.5 sm:gap-1"
    : "flex flex-nowrap items-center shrink-0 ml-auto gap-0.5 sm:gap-1";

  return (
    <TooltipGroup>
      <div className="border-b border-border bg-background sticky top-0 z-10">
        <div ref={rootRef} className={rowClass}>
          <div data-testid="toolbar-start-lane" className={startBlockClass}>
            {visibleStart.map((entry) => renderEntry(entry, editor, callbacks))}
          </div>
          <div
            ref={endRef}
            data-testid="toolbar-end-lane"
            className={endBlockClass}
          >
            {endEntries.map((entry) => renderEntry(entry, editor, callbacks))}
            {utilityCluster}
            {fixedUtilities}
          </div>
          <div
            ref={measureRef}
            data-testid="toolbar-measure-lane"
            className="absolute invisible pointer-events-none"
          >
            {startEntries.map((entry) => renderEntry(entry, editor, callbacks))}
          </div>
        </div>
      </div>
    </TooltipGroup>
  );
}
