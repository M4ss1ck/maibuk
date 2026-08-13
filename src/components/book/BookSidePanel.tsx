import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FocusScope, Overlay, useModalOverlay } from "react-aria";
import { Dialog } from "react-aria-components";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { Chapter } from "@/features/chapters/types";
import type { Note } from "@/features/notes";
import { FootnotesView } from "@/components/editor/FootnotesView";
import { BookNotesView } from "@/components/book/BookNotesView";
import { Tooltip } from "@/components/ui";
import { useModalScope } from "@/hooks";
import { registerBackDismiss } from "@/lib/platform/backDismiss";

export type BookSidePanelTab = "footnotes" | "notes";

interface BookSidePanelProps {
  isOpen: boolean;
  activeTab: BookSidePanelTab;
  onTabChange: (tab: BookSidePanelTab) => void;
  onClose: () => void;
  width: number;
  onResizeStart: (e: React.MouseEvent) => void;
  // footnotes
  chapters: Chapter[];
  currentChapterId: string | null;
  onSelectChapter: (chapter: Chapter) => void;
  // notes
  notes: Note[];
  onCreateNote: (html: string) => void;
  onOpenNote: (noteId: string) => void;
}

export function BookSidePanel({
  isOpen,
  activeTab,
  onTabChange,
  onClose,
  width,
  onResizeStart,
  chapters,
  currentChapterId,
  onSelectChapter,
  notes,
  onCreateNote,
  onOpenNote,
}: BookSidePanelProps) {
  const { t } = useTranslation();
  const mobilePanelRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 768
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 767px)");
    const onChange = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  if (isOpen && !wasOpenRef.current && typeof document !== "undefined") {
    const activeElement = document.activeElement;
    restoreFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null;
  }
  wasOpenRef.current = isOpen;

  useModalScope(isMobile && isOpen);

  const state = useMemo(
    () => ({
      isOpen: isMobile && isOpen,
      open: () => undefined,
      close: onClose,
      toggle: () => {
        if (isOpen) onClose();
      },
      setOpen: (open: boolean) => {
        if (!open) onClose();
      },
    }),
    [isMobile, isOpen, onClose]
  );
  const { modalProps, underlayProps } = useModalOverlay(
    { isDismissable: true },
    state,
    mobilePanelRef
  );

  const restoreFocus = () => {
    const target = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (!target?.isConnected || target === document.body) return;
    if (document.activeElement?.closest?.('[role="dialog"]')) return;
    target.focus();
  };

  useLayoutEffect(() => {
    if (!isOpen) restoreFocus();
  }, [isOpen]);

  useLayoutEffect(() => restoreFocus, []);

  useEffect(() => {
    if (!isMobile || !isOpen) return;
    return registerBackDismiss(() => {
      onClose();
      return true;
    });
  }, [isMobile, isOpen, onClose]);

  if (!isOpen) return null;

  const tab = (value: BookSidePanelTab, label: string) => (
    <button
      type="button"
      aria-pressed={activeTab === value}
      onClick={() => onTabChange(value)}
      className={`rounded-md px-2.5 py-1 text-sm font-medium transition-colors ${
        activeTab === value
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );

  const content = (
    <>
      <div className="notes-panel-header">
        <div className="flex items-center gap-1">
          {tab("footnotes", t("bookSidePanel.footnotes"))}
          {tab("notes", t("bookSidePanel.notes"))}
        </div>
        <Tooltip content={t("common.close")}>
          <button
            type="button"
            onClick={onClose}
            className="notes-panel-close"
            aria-label={t("common.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </Tooltip>
      </div>

      {activeTab === "footnotes" ? (
        <div className="notes-panel-content">
          <FootnotesView
            chapters={chapters}
            currentChapterId={currentChapterId}
            onSelectChapter={onSelectChapter}
          />
        </div>
      ) : (
        <BookNotesView notes={notes} onCreateNote={onCreateNote} onOpenNote={onOpenNote} />
      )}
    </>
  );

  if (isMobile) {
    return (
      <Overlay disableFocusManagement>
        <div
          {...underlayProps}
          data-testid="book-side-panel-backdrop"
          className="fixed inset-0 z-50 flex justify-end bg-black/50"
        >
          <FocusScope contain autoFocus>
            <div {...modalProps} ref={mobilePanelRef} className="contents">
              <Dialog aria-label={t("panes.bookSidePanel")} className="contents outline-none">
                <aside
                  className="h-full w-[min(400px,calc(100vw-1rem))] flex flex-col border-l border-border bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
                  data-focus-pane="book-side-panel"
                  tabIndex={-1}
                  aria-label={t("panes.bookSidePanel")}
                >
                  {content}
                </aside>
              </Dialog>
            </div>
          </FocusScope>
        </div>
      </Overlay>
    );
  }

  return (
    <aside
      className="notes-panel relative"
      style={{ width: `${width}px`, minWidth: `${width}px` }}
      data-focus-pane="book-side-panel"
      tabIndex={-1}
      aria-label={t("panes.bookSidePanel")}
    >
      <Tooltip content={t("bookSidePanel.resize")}>
        <div
          onMouseDown={onResizeStart}
          className="absolute top-0 left-0 w-1.5 h-full cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
        />
      </Tooltip>
      {content}
    </aside>
  );
}
