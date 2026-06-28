import { useEffect, useMemo, useState } from "react";
import { Network, Plus, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { CanvasCard } from "../components/canvas/CanvasCard";
import { Button } from "../components/ui/Button";
import { useCanvasStore } from "../features/canvas/store";

export function CanvasGallery() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const canvases = useCanvasStore((state) => state.canvases);
  const loadCanvases = useCanvasStore((state) => state.loadCanvases);
  const createCanvas = useCanvasStore((state) => state.createCanvas);
  const deleteCanvas = useCanvasStore((state) => state.deleteCanvas);
  const renameCanvas = useCanvasStore((state) => state.renameCanvas);
  const updateCanvas = useCanvasStore((state) => state.updateCanvas);
  const [search, setSearch] = useState("");

  useEffect(() => {
    void loadCanvases();
  }, [loadCanvases]);

  const filteredCanvases = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query
      ? canvases.filter((canvas) => canvas.title.toLocaleLowerCase().includes(query))
      : canvases;
  }, [canvases, search]);

  const handleCreate = async () => {
    const canvas = await createCanvas({ title: "" });
    navigate(`/canvas/${canvas.id}`);
  };

  return (
    <div className="h-full overflow-auto p-4 sm:p-8">
      <div className="mb-6 flex flex-col gap-4 sm:mb-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{t("canvas.title")}</h2>
            {canvases.length > 0 && (
              <p className="mt-1 text-sm text-muted-foreground">
                {t("canvas.canvasCount", { count: canvases.length })}
              </p>
            )}
          </div>
          <Button onClick={() => void handleCreate()}>
            <Plus className="size-5" aria-hidden="true" />
            {t("canvas.newCanvas")}
          </Button>
        </div>

        {canvases.length > 0 && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("canvas.searchPlaceholder")}
              className="h-11 w-full rounded-lg border border-border bg-card py-2 pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>
        )}
      </div>

      {canvases.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Network className="mb-6 size-16 text-primary opacity-70" aria-hidden="true" />
          <h3 className="text-2xl font-semibold">{t("canvas.empty")}</h3>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            {t("canvas.emptyDescription")}
          </p>
          <Button size="lg" className="mt-6" onClick={() => void handleCreate()}>
            <Plus className="size-5" aria-hidden="true" />
            {t("canvas.newCanvas")}
          </Button>
        </div>
      ) : filteredCanvases.length === 0 ? (
        <p className="py-16 text-center text-muted-foreground">{t("canvas.noMatches")}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredCanvases.map((canvas) => (
            <CanvasCard
              key={canvas.id}
              canvas={canvas}
              onOpen={() => navigate(`/canvas/${canvas.id}`)}
              onRename={(title) => void renameCanvas(canvas.id, title)}
              onTogglePinned={() => void updateCanvas(canvas.id, { pinned: !canvas.pinned })}
              onDelete={() => {
                if (window.confirm(t("canvas.deleteCanvasConfirm"))) void deleteCanvas(canvas.id);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
