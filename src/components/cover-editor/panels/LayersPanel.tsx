import { useState } from "react";
import { ChevronDown, ChevronUp, Eye, EyeOff, Lock, Unlock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCoverStore } from "../../../features/covers/store";
import type { Layer } from "../../../features/covers/scene/schema";

function layerLabel(layer: Layer): string {
  if (layer.type === "text") return layer.text || layer.name;
  return layer.name;
}

export function LayersPanel() {
  const { t } = useTranslation();
  const scene = useCoverStore((s) => s.scene);
  const selectedId = useCoverStore((s) => s.selectedId);
  const select = useCoverStore((s) => s.select);
  const updateLayer = useCoverStore((s) => s.updateLayer);
  const toggleHidden = useCoverStore((s) => s.toggleHidden);
  const toggleLocked = useCoverStore((s) => s.toggleLocked);
  const bringForward = useCoverStore((s) => s.bringForward);
  const sendBackward = useCoverStore((s) => s.sendBackward);

  const [editingId, setEditingId] = useState<string | null>(null);

  // Top layer first.
  const ordered = [...scene.layers].reverse();

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b border-border">
        {t("cover.layers.title")}
      </div>
      <div className="flex-1 overflow-y-auto">
        {ordered.length === 0 && (
          <p className="px-3 py-4 text-sm text-muted-foreground">{t("cover.layers.empty")}</p>
        )}
        {ordered.map((layer) => {
          const isSelected = layer.id === selectedId;
          return (
            <div
              key={layer.id}
              className={`group flex items-center gap-1 px-2 py-1.5 border-l-2 ${
                isSelected ? "bg-primary/10 border-primary" : "border-transparent hover:bg-muted"
              }`}
            >
              {editingId === layer.id ? (
                <input
                  autoFocus
                  defaultValue={layer.name}
                  className="flex-1 min-w-0 bg-background border border-border rounded px-1 text-sm"
                  onBlur={(e) => {
                    updateLayer(layer.id, { name: e.target.value || layer.name });
                    setEditingId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="flex-1 min-w-0 truncate text-sm text-left cursor-pointer"
                  onClick={() => select(layer.id)}
                  onDoubleClick={() => setEditingId(layer.id)}
                >
                  {layerLabel(layer)}
                </button>
              )}

              <button
                type="button"
                title={t("cover.layers.reorderUp")}
                className="p-1 text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  bringForward(layer.id);
                }}
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                title={t("cover.layers.reorderDown")}
                className="p-1 text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  sendBackward(layer.id);
                }}
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                title={t("cover.layers.toggleVisible")}
                className="p-1 text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleHidden(layer.id);
                }}
              >
                {layer.hidden ? (
                  <EyeOff className="w-3.5 h-3.5" />
                ) : (
                  <Eye className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                type="button"
                title={t("cover.layers.toggleLock")}
                className="p-1 text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleLocked(layer.id);
                }}
              >
                {layer.locked ? (
                  <Lock className="w-3.5 h-3.5" />
                ) : (
                  <Unlock className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
