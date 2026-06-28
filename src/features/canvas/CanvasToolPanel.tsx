import { ButtonHTMLAttributes, forwardRef } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowUpRight,
  Circle,
  FilePlus2,
  Link2,
  Lock,
  Maximize,
  MousePointer2,
  Pencil,
  Eraser,
  Square,
  Unlock,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCanvasStore } from "./store";

interface ToolbarButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

const ToolbarButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  ({ className = "", active = false, children, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      className={`inline-flex size-7 items-center justify-center rounded-md border text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-40 ${
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-card hover:bg-muted"
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  ),
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

  const tools = [
    { mode: "select" as const, icon: MousePointer2, label: t("canvas.toolSelect") },
    { mode: "pen" as const, icon: Pencil, label: t("canvas.toolPen") },
    { mode: "eraser" as const, icon: Eraser, label: t("canvas.toolEraser") },
  ];
  const comingSoon = [
    { icon: Square, label: t("canvas.toolRectangle") },
    { icon: ArrowUpRight, label: t("canvas.toolArrow") },
    { icon: Circle, label: t("canvas.toolEllipse") },
  ];

  return (
    <div className="flex w-9 flex-col gap-1 rounded-lg border border-border bg-card/95 p-1 shadow-lg backdrop-blur">
      <ToolbarGroup>
        {tools.map(({ mode, icon: Icon, label }) => (
          <ToolbarButton
            key={mode}
            active={toolMode === mode}
            onClick={() => setToolMode(mode)}
            aria-label={label}
            title={label}
          >
            <Icon className="size-4" aria-hidden="true" />
          </ToolbarButton>
        ))}
      </ToolbarGroup>

      <ToolbarDivider />

      <ToolbarGroup>
        {comingSoon.map(({ icon: Icon, label }) => (
          <ToolbarButton
            key={label}
            disabled
            aria-label={label}
            title={`${label} — ${t("canvas.comingSoon")}`}
          >
            <Icon className="size-4" aria-hidden="true" />
          </ToolbarButton>
        ))}
      </ToolbarGroup>

      <ToolbarDivider />

      <ToolbarGroup>
        <ToolbarButton onClick={onAddText} aria-label={t("canvas.addTextNode")} title={t("canvas.addTextNode")}>
          <FilePlus2 className="size-4" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton onClick={onAddNoteRef} aria-label={t("canvas.addNoteRef")} title={t("canvas.addNoteRef")}>
          <Link2 className="size-4" aria-hidden="true" />
        </ToolbarButton>
      </ToolbarGroup>

      <ToolbarDivider />

      <ToolbarGroup>
        <ToolbarButton onClick={onZoomIn} aria-label={t("canvas.zoomIn")} title={t("canvas.zoomIn")}>
          <ZoomIn className="size-4" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton onClick={onZoomOut} aria-label={t("canvas.zoomOut")} title={t("canvas.zoomOut")}>
          <ZoomOut className="size-4" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton onClick={onFitView} aria-label={t("canvas.fitView")} title={t("canvas.fitView")}>
          <Maximize className="size-4" aria-hidden="true" />
        </ToolbarButton>
      </ToolbarGroup>

      <ToolbarDivider />

      <ToolbarGroup>
        <ToolbarButton
          active={interactivityLocked}
          onClick={toggleInteractivityLocked}
          aria-label={interactivityLocked ? t("canvas.unlockInteractivity") : t("canvas.lockInteractivity")}
          title={interactivityLocked ? t("canvas.unlockInteractivity") : t("canvas.lockInteractivity")}
        >
          {interactivityLocked ? (
            <Lock className="size-4" aria-hidden="true" />
          ) : (
            <Unlock className="size-4" aria-hidden="true" />
          )}
        </ToolbarButton>
      </ToolbarGroup>
    </div>
  );
}
