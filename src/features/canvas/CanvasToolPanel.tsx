import { ButtonHTMLAttributes, forwardRef } from "react";
import { useTranslation } from "react-i18next";
import {
  FilePlus2,
  Link2,
  Lock,
  Maximize,
  MousePointer2,
  Pencil,
  Eraser,
  Unlock,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCanvasStore } from "@/features/canvas/store";
import { Tooltip, TooltipGroup } from "@/components/ui";
import type { ShortcutId } from "@/lib/shortcut-registry";

interface ToolbarButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

const ToolbarButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  ({ className = "", active = false, children, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      className={`inline-flex size-9 md:size-7 items-center justify-center rounded-md border text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-40 ${
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-card hover:bg-muted"
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  )
);
ToolbarButton.displayName = "ToolbarButton";

function ToolbarGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-1">{children}</div>;
}

function ToolbarDivider() {
  return <div className="h-px w-full bg-border" />;
}

export function CanvasToolPanel({
  onAddText,
  onAddNoteRef,
  onZoomIn,
  onZoomOut,
  onFitView,
}: {
  onAddText: () => void;
  onAddNoteRef: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
}) {
  const { t } = useTranslation();
  const toolMode = useCanvasStore((state) => state.toolMode);
  const setToolMode = useCanvasStore((state) => state.setToolMode);
  const interactivityLocked = useCanvasStore((state) => state.interactivityLocked);
  const toggleInteractivityLocked = useCanvasStore((state) => state.toggleInteractivityLocked);

  const tools: Array<{
    mode: "select" | "pen" | "eraser";
    icon: typeof MousePointer2;
    label: string;
    shortcutId: ShortcutId;
  }> = [
    {
      mode: "select",
      icon: MousePointer2,
      label: t("canvas.toolSelect"),
      shortcutId: "canvas.toolSelect",
    },
    { mode: "pen", icon: Pencil, label: t("canvas.toolPen"), shortcutId: "canvas.toolPen" },
    {
      mode: "eraser",
      icon: Eraser,
      label: t("canvas.toolEraser"),
      shortcutId: "canvas.toolEraser",
    },
  ];

  return (
    <TooltipGroup>
      <div className="flex w-11 md:w-9 flex-col gap-1 rounded-lg border border-border bg-card/95 p-1 shadow-lg backdrop-blur">
        <ToolbarGroup>
          {tools.map(({ mode, icon: Icon, label, shortcutId }) => (
            <Tooltip key={mode} content={label} shortcut={shortcutId}>
              <ToolbarButton
                active={toolMode === mode}
                onClick={() => setToolMode(mode)}
                aria-label={label}
              >
                <Icon className="size-4" aria-hidden="true" />
              </ToolbarButton>
            </Tooltip>
          ))}
        </ToolbarGroup>

        <ToolbarDivider />

        <ToolbarGroup>
          <Tooltip content={t("canvas.addTextNode")} shortcut="canvas.addTextNode">
            <ToolbarButton onClick={onAddText} aria-label={t("canvas.addTextNode")}>
              <FilePlus2 className="size-4" aria-hidden="true" />
            </ToolbarButton>
          </Tooltip>
          <Tooltip content={t("canvas.addNoteRef")} shortcut="canvas.addNoteRef">
            <ToolbarButton onClick={onAddNoteRef} aria-label={t("canvas.addNoteRef")}>
              <Link2 className="size-4" aria-hidden="true" />
            </ToolbarButton>
          </Tooltip>
        </ToolbarGroup>

        <ToolbarDivider />

        <ToolbarGroup>
          <Tooltip content={t("canvas.zoomIn")} shortcut="canvas.zoomIn">
            <ToolbarButton onClick={onZoomIn} aria-label={t("canvas.zoomIn")}>
              <ZoomIn className="size-4" aria-hidden="true" />
            </ToolbarButton>
          </Tooltip>
          <Tooltip content={t("canvas.zoomOut")} shortcut="canvas.zoomOut">
            <ToolbarButton onClick={onZoomOut} aria-label={t("canvas.zoomOut")}>
              <ZoomOut className="size-4" aria-hidden="true" />
            </ToolbarButton>
          </Tooltip>
          <Tooltip content={t("canvas.fitView")} shortcut="canvas.fitView">
            <ToolbarButton onClick={onFitView} aria-label={t("canvas.fitView")}>
              <Maximize className="size-4" aria-hidden="true" />
            </ToolbarButton>
          </Tooltip>
        </ToolbarGroup>

        <ToolbarDivider />

        <ToolbarGroup>
          <Tooltip
            content={
              interactivityLocked ? t("canvas.unlockInteractivity") : t("canvas.lockInteractivity")
            }
            shortcut="canvas.lock"
          >
            <ToolbarButton
              active={interactivityLocked}
              onClick={toggleInteractivityLocked}
              aria-label={
                interactivityLocked
                  ? t("canvas.unlockInteractivity")
                  : t("canvas.lockInteractivity")
              }
            >
              {interactivityLocked ? (
                <Lock className="size-4" aria-hidden="true" />
              ) : (
                <Unlock className="size-4" aria-hidden="true" />
              )}
            </ToolbarButton>
          </Tooltip>
        </ToolbarGroup>
      </div>
    </TooltipGroup>
  );
}
