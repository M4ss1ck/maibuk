import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { Ellipsis, ImageIcon, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { upsertSeparatorAsset } from "@/features/import/project-assets-repo";
import { useSettingsStore } from "@/features/settings/store";
import { getDialog, getFileSystem, getWebDialog, IS_WEB } from "@/lib/platform";
import { Input, Switch, Tooltip } from "@/components/ui";
import { adjustPosition } from "@/components/editor/editor-context-menu-utils";
import {
  BUILTIN_SCENE_BREAKS,
  resolveCustomSymbols,
  type SceneBreakDescriptor,
} from "@/components/editor/extensions/scene-break-utils";

interface SceneBreakMenuProps {
  editor: Editor;
  bookId?: string | null;
}

function toDataUrl(data: Uint8Array, filename: string): string {
  const extension = filename.split(".").pop()?.toLowerCase() || "png";
  const mimeType = extension === "svg" ? "image/svg+xml" : `image/${extension}`;
  const base64 = btoa(String.fromCharCode(...data));
  return `data:${mimeType};base64,${base64}`;
}

export function SceneBreakMenu({ editor, bookId }: SceneBreakMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [unit, setUnit] = useState("*");
  const [count, setCount] = useState(3);
  const [spaced, setSpaced] = useState(true);
  const btnRef = useRef<HTMLDivElement>(null);
  const optionsBtnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const lastSceneBreak = useSettingsStore((state) => state.lastSceneBreak);
  const presets = useSettingsStore((state) => state.sceneBreakPresets);
  const setLastSceneBreak = useSettingsStore((state) => state.setLastSceneBreak);
  const addSceneBreakPreset = useSettingsStore((state) => state.addSceneBreakPreset);
  const removeSceneBreakPreset = useSettingsStore((state) => state.removeSceneBreakPreset);

  const insert = (descriptor: SceneBreakDescriptor) => {
    editor.chain().focus().setSceneBreak(descriptor).run();
    setLastSceneBreak(descriptor);
    setOpen(false);
  };

  const customDescriptor = (): SceneBreakDescriptor => ({
    kind: "text",
    symbols: resolveCustomSymbols(unit, count, spaced),
    unit,
    count,
    spaced,
  });

  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const isMenuTarget =
        target instanceof HTMLElement && target.closest(".scene-break-menu-portal");

      if (btnRef.current?.contains(target) || isMenuTarget) return;
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        optionsBtnRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !menuRef.current) return;
    setPos((position) => adjustPosition(position, menuRef.current!.getBoundingClientRect()));
  }, [open]);

  const toggle = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen((value) => !value);
  };

  const handleUpload = async () => {
    const filters = [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] }];

    try {
      let dataUrl: string | null = null;
      let filename = "separator.png";

      if (IS_WEB) {
        const webDialog = await getWebDialog();
        const result = await webDialog.openWithData({
          multiple: false,
          filters,
        });

        if (result) {
          filename = result.name;
          dataUrl = toDataUrl(result.data, filename);
        }
      } else {
        const dialog = await getDialog();
        const selected = await dialog.open({ multiple: false, filters });

        if (selected) {
          const fs = await getFileSystem();
          const contents = await fs.readFile(selected);
          filename = selected.split("/").pop() || "separator.png";
          dataUrl = toDataUrl(contents, filename);
        }
      }

      if (!dataUrl) return;

      const base64 = dataUrl.split(",")[1] ?? "";
      const mediaType = dataUrl.slice(5, dataUrl.indexOf(";"));
      const asset = bookId
        ? await upsertSeparatorAsset(bookId, {
            dataBase64: base64,
            mediaType,
            filename,
          })
        : null;

      insert({ kind: "image", src: dataUrl, assetId: asset?.id });
    } catch (error) {
      console.error("Failed to insert image separator:", error);
    }
  };

  const customPreview = resolveCustomSymbols(unit, count, spaced) || "...";

  return (
    <div ref={btnRef} className="flex items-center">
      <Tooltip content={t("editor.sceneBreak")}>
        <button
          type="button"
          onClick={() => insert(lastSceneBreak)}
          aria-label={t("editor.sceneBreak")}
          className="p-2 rounded-l transition-colors hover:bg-muted"
        >
          <Ellipsis className="w-4 h-4" />
        </button>
      </Tooltip>
      <Tooltip content={t("editor.sceneBreakOptions")}>
        <button
          ref={optionsBtnRef}
          type="button"
          onClick={toggle}
          aria-label={t("editor.sceneBreakOptions")}
          className={`px-1 py-2 rounded-r transition-colors ${
            open ? "bg-primary text-white" : "hover:bg-muted"
          }`}
        >
          <span className="text-xs">▾</span>
        </button>
      </Tooltip>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="scene-break-menu-portal fixed bg-card border border-border rounded-lg shadow-lg p-3 z-50 w-64 max-h-[calc(100vh-1rem)] overflow-y-auto"
            style={{ top: pos.top, left: pos.left, maxHeight: "calc(100dvh - 1rem)" }}
          >
            <p className="text-xs text-muted-foreground mb-1">{t("editor.sceneBreakBuiltIns")}</p>
            <div className="flex flex-col gap-1 mb-3">
              {BUILTIN_SCENE_BREAKS.map((descriptor) => (
                <button
                  key={descriptor.symbols}
                  type="button"
                  onClick={() => insert(descriptor)}
                  className="text-center py-1 rounded hover:bg-muted tracking-[0.3em]"
                >
                  {descriptor.symbols}
                </button>
              ))}
            </div>

            {presets.length > 0 && (
              <>
                <p className="text-xs text-muted-foreground mb-1">
                  {t("editor.sceneBreakPresets")}
                </p>
                <div className="flex flex-col gap-1 mb-3">
                  {presets.map((descriptor, index) => (
                    <div key={JSON.stringify(descriptor)} className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => insert(descriptor)}
                        className="flex-1 text-center py-1 rounded hover:bg-muted truncate"
                      >
                        {descriptor.kind === "image"
                          ? t("editor.sceneBreakImagePreset")
                          : descriptor.symbols}
                      </button>
                      <Tooltip content={t("editor.sceneBreakDeletePreset")}>
                        <button
                          type="button"
                          onClick={() => removeSceneBreakPreset(index)}
                          aria-label={t("editor.sceneBreakDeletePreset")}
                          className="p-1 rounded hover:bg-destructive/10 text-destructive"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </Tooltip>
                    </div>
                  ))}
                </div>
              </>
            )}

            <p className="text-xs text-muted-foreground mb-1">{t("editor.sceneBreakCustom")}</p>
            <div className="flex items-center gap-2 mb-2">
              <div className="flex-1 min-w-0">
                <Input
                  type="text"
                  value={unit}
                  onChange={(event) => setUnit(event.target.value)}
                  placeholder={t("editor.sceneBreakCharacters")}
                  className="py-1 text-sm"
                />
              </div>
              <div className="w-20">
                <Input
                  type="number"
                  min={1}
                  value={count}
                  onChange={(event) => setCount(Number(event.target.value))}
                  className="py-1 text-sm"
                />
              </div>
            </div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">{t("editor.sceneBreakSpaced")}</span>
              <Switch checked={spaced} onChange={setSpaced} />
            </div>
            <p className="text-center py-1 mb-2 tracking-[0.3em] text-muted-foreground">
              {customPreview}
            </p>
            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={() => insert(customDescriptor())}
                className="flex-1 py-1 rounded bg-primary text-white text-sm"
              >
                {t("common.insert")}
              </button>
              <button
                type="button"
                onClick={() => addSceneBreakPreset(customDescriptor())}
                className="flex-1 py-1 rounded border border-border text-sm hover:bg-muted"
              >
                {t("editor.sceneBreakSavePreset")}
              </button>
            </div>

            <button
              type="button"
              onClick={handleUpload}
              className="w-full flex items-center justify-center gap-2 py-1 rounded border border-border text-sm hover:bg-muted disabled:opacity-50"
            >
              <ImageIcon className="w-4 h-4" />
              {t("editor.sceneBreakUploadImage")}
            </button>
          </div>,
          document.body
        )}
    </div>
  );
}
