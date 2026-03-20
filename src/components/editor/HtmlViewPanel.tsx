import { useState, useRef, useCallback, useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { Button } from "../ui/Button";
import { useTranslation } from "react-i18next";
import { SpinnerIcon, XIcon } from "../icons";
import { useCodeMirror, type CodeMirrorHandle } from "./useCodeMirror";
import { useDebouncedCallback } from "../../hooks/useAutoSave";
import { useSettingsStore } from "../../features/settings/store";
import { useThemeStore } from "../../features/theme/store";
import type { HtmlEditorTheme } from "../../features/settings/types";
import { WrapText, Sparkles } from "lucide-react";

interface HtmlViewPanelProps {
  editor: Editor;
  isOpen: boolean;
  onClose: () => void;
  onReady?: (
    handle: { highlightRange: (from: number, to: number) => void } | null,
  ) => void;
}

const DEFAULT_HEIGHT = 200;
const MIN_HEIGHT = 100;
const MAX_HEIGHT_RATIO = 0.6;

export function HtmlViewPanel({ editor, isOpen, onClose, onReady }: HtmlViewPanelProps) {
  const { t } = useTranslation();
  const [panelHeight, setPanelHeight] = useState(DEFAULT_HEIGHT);
  const [error, setError] = useState("");
  const [warningCount, setWarningCount] = useState(0);
  const activeSourceRef = useRef<"wysiwyg" | "html">("wysiwyg");
  const isResizingRef = useRef(false);

  const appTheme = useThemeStore((s) => s.theme);
  const resolvedDark =
    appTheme === "dark" ||
    (appTheme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  const lightTheme = useSettingsStore((s) => s.htmlEditorLightTheme);
  const darkTheme = useSettingsStore((s) => s.htmlEditorDarkTheme);
  const setLight = useSettingsStore((s) => s.setHtmlEditorLightTheme);
  const setDark = useSettingsStore((s) => s.setHtmlEditorDarkTheme);

  const currentThemeSetting = resolvedDark ? darkTheme : lightTheme;
  const setThemeSetting = resolvedDark ? setDark : setLight;

  // Use a ref for the handle to avoid circular dependency with callbacks
  const cmHandleRef = useRef<CodeMirrorHandle | null>(null);

  const syncWysiwygToHtml = useCallback(() => {
    if (activeSourceRef.current === "wysiwyg" && cmHandleRef.current) {
      const html = editor.getHTML();
      cmHandleRef.current.setContent(html);
    }
  }, [editor]);

  const syncHtmlToWysiwyg = useCallback((content: string) => {
    if (activeSourceRef.current === "html") {
      try {
        editor.commands.setContent(content);
        setError("");
      } catch {
        setError(t("editor.invalidHtml"));
      }
    }
  }, [editor, t]);

  const debouncedSyncToHtml = useDebouncedCallback(syncWysiwygToHtml, 300);
  const debouncedSyncToWysiwyg = useDebouncedCallback(syncHtmlToWysiwyg, 500);

  const { containerRef, isLoading, handle: cmHandle } = useCodeMirror({
    initialContent: isOpen ? editor.getHTML() : "",
    onChange: (content) => {
      debouncedSyncToWysiwyg(content);
      if (cmHandleRef.current) {
        setWarningCount(cmHandleRef.current.getWarningCount());
      }
    },
    onFocus: () => { activeSourceRef.current = "html"; },
    onBlur: () => { /* keep activeSource as-is until wysiwyg focuses */ },
  });

  // Keep ref in sync with handle state
  useEffect(() => {
    cmHandleRef.current = cmHandle;
  }, [cmHandle]);

  // Expose highlightRange to parent
  useEffect(() => {
    onReady?.(cmHandle ? { highlightRange: cmHandle.highlightRange } : null);
  }, [cmHandle, onReady]);

  useEffect(() => {
    if (!isOpen) onReady?.(null);
  }, [isOpen, onReady]);

  // Listen to TipTap updates → sync to CodeMirror
  useEffect(() => {
    if (!isOpen || !cmHandle) return;

    const handleUpdate = () => {
      if (activeSourceRef.current === "wysiwyg") {
        debouncedSyncToHtml();
      }
    };

    editor.on("update", handleUpdate);
    return () => { editor.off("update", handleUpdate); };
  }, [isOpen, cmHandle, editor, debouncedSyncToHtml]);

  // Track WYSIWYG focus
  useEffect(() => {
    if (!isOpen) return;
    const dom = editor.view.dom;
    const onFocus = () => { activeSourceRef.current = "wysiwyg"; };
    dom.addEventListener("focus", onFocus);
    return () => { dom.removeEventListener("focus", onFocus); };
  }, [isOpen, editor]);

  // Initialize content when panel opens
  useEffect(() => {
    if (isOpen && cmHandle) {
      cmHandle.setContent(editor.getHTML());
      activeSourceRef.current = "wysiwyg";
    }
  }, [isOpen, cmHandle]);

  // Apply editor theme
  useEffect(() => {
    if (!cmHandle) return;

    (async () => {
      let themeExtension: any = [];

      if (currentThemeSetting === "one-dark") {
        const { atomone } = await import("@uiw/codemirror-theme-atomone");
        themeExtension = atomone;
      } else if (currentThemeSetting === "dracula") {
        const { dracula } = await import("@uiw/codemirror-theme-dracula");
        themeExtension = dracula;
      } else if (currentThemeSetting === "one-light") {
        const { githubLight } = await import("@uiw/codemirror-theme-github");
        themeExtension = githubLight;
      }
      // "default" → empty extension (CM6 default, inherits from app CSS)

      cmHandle.setTheme(themeExtension);
    })();
  }, [currentThemeSetting, resolvedDark, cmHandle]);

  // Resize handling
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    const startY = e.clientY;
    const startHeight = panelHeight;
    const maxHeight = window.innerHeight * MAX_HEIGHT_RATIO;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const delta = startY - e.clientY;
      const newHeight = Math.max(MIN_HEIGHT, Math.min(maxHeight, startHeight + delta));
      setPanelHeight(newHeight);
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [panelHeight]);

  if (!isOpen) return null;

  return (
    <div className="border-t border-border bg-muted/30">
      {/* Resize handle */}
      <div
        className="h-1 cursor-ns-resize bg-transparent hover:bg-primary/20 transition-colors"
        onMouseDown={handleResizeStart}
      />

      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-border bg-background">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{t("editor.htmlSource")}</span>
          {warningCount > 0 && (
            <span className="text-xs text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded">
              {t("editor.warnings", { count: warningCount })}
            </span>
          )}
          {error && (
            <span className="text-xs text-destructive bg-destructive/10 px-2 py-0.5 rounded">
              {error}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => cmHandle?.prettify()}
            disabled={!cmHandle}
            title={t("editor.prettify")}
          >
            <Sparkles className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => cmHandle?.toggleWrap()}
            disabled={!cmHandle}
            title={t("editor.wordWrap")}
          >
            <WrapText className="w-4 h-4" />
          </Button>
          <select
            value={currentThemeSetting}
            onChange={(e) => setThemeSetting(e.target.value as HtmlEditorTheme)}
            className="text-xs bg-transparent border border-border rounded px-1.5 py-0.5"
            title={t("editor.editorTheme")}
          >
            <option value="default">{t("editor.themeDefault")}</option>
            {resolvedDark ? (
              <>
                <option value="one-dark">{t("editor.themeOneDark")}</option>
                <option value="dracula">{t("editor.themeDracula")}</option>
              </>
            ) : (
              <option value="one-light">{t("editor.themeOneLight")}</option>
            )}
          </select>
          <Button size="sm" variant="ghost" onClick={onClose}>
            <XIcon className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Editor area */}
      <div style={{ height: panelHeight }} className="overflow-hidden">
        {isLoading && (
          <div className="flex items-center justify-center h-full">
            <SpinnerIcon className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}
        <div
          ref={containerRef}
          className={`h-full overflow-auto ${isLoading ? "hidden" : ""}`}
        />
      </div>
    </div>
  );
}
