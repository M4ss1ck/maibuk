import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FocusScope, Overlay, useModalOverlay, useMove } from "react-aria";
import { Dialog, Tab, TabList, TabPanel, TabPanels, Tabs } from "react-aria-components";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { Chapter } from "@/features/chapters/types";
import type { Note } from "@/features/notes";
import { FootnotesView } from "@/components/editor/FootnotesView";
import { BookNotesView } from "@/components/book/BookNotesView";
import { Tooltip } from "@/components/ui";
import { useModalScope, useRestoreFocus } from "@/hooks";
import { registerBackDismiss } from "@/lib/platform/backDismiss";

export type BookSidePanelTab = "footnotes" | "notes";

/** One keyboard resize press moves the panel this many pixels. */
const KEYBOARD_RESIZE_STEP = 16;

interface BookSidePanelProps {
  isOpen: boolean;
  activeTab: BookSidePanelTab;
  onTabChange: (tab: BookSidePanelTab) => void;
  onClose: () => void;
  width: number;
  onResizeStart: (e: React.MouseEvent) => void;
  /** Keyboard resize: a positive delta widens the panel, negative narrows it. */
  onResizeKey?: (delta: number) => void;
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
  onResizeKey,
  chapters,
  currentChapterId,
  onSelectChapter,
  notes,
  onCreateNote,
  onOpenNote,
}: BookSidePanelProps) {
  const { t } = useTranslation();
  const mobilePanelRef = useRef<HTMLDivElement | null>(null);
  const activeTabRef = useRef<HTMLDivElement | null>(null);
  const focusActiveTabRef = useRef(false);
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

  // After useModalOverlay: its inert cleanup must run before the restore.
  useRestoreFocus(isOpen, { skipWhenDialogFocused: true });

  // React Aria owns the separator's keyboard handling. It reports ArrowLeft as
  // deltaX -1 and ArrowRight as +1; the panel sits on the right, so a leftward
  // move widens it, matching the pointer drag direction. Ignore the vertical
  // arrows useMove also reports.
  const { moveProps } = useMove({
    onMove: (event) => {
      if (event.deltaX === 0) return;
      onResizeKey?.(-event.deltaX * KEYBOARD_RESIZE_STEP);
    },
  });

  useEffect(() => {
    if (!isMobile || !isOpen) return;
    return registerBackDismiss(() => {
      onClose();
      return true;
    });
  }, [isMobile, isOpen, onClose]);

  // Opening the panel must land focus inside it, not on <body>: the trigger
  // that opened it disables itself while its tab is active. The mobile overlay
  // already autofocuses through FocusScope, so the desktop panel focuses its
  // active tab. React Aria mounts its collection items after the first commit,
  // so the ref callback, not an effect, is what focuses the tab when it lands.
  useEffect(() => {
    if (isOpen && !wasOpenRef.current && !isMobile) {
      focusActiveTabRef.current = true;
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, isMobile]);

  const setActiveTabRef = useCallback((node: HTMLDivElement | null) => {
    activeTabRef.current = node;
    if (node && focusActiveTabRef.current) {
      focusActiveTabRef.current = false;
      node.focus();
    }
  }, []);

  if (!isOpen) return null;

  const tabClassName =
    "rounded-md px-2.5 py-1 text-sm font-medium transition-colors outline-none text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary data-[selected]:bg-muted data-[selected]:text-foreground";

  const content = (
    <Tabs
      selectedKey={activeTab}
      onSelectionChange={(key) => onTabChange(key as BookSidePanelTab)}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="notes-panel-header">
        <TabList aria-label={t("panes.bookSidePanel")} className="flex items-center gap-1">
          <Tab
            id="footnotes"
            ref={activeTab === "footnotes" ? setActiveTabRef : undefined}
            className={tabClassName}
          >
            {t("bookSidePanel.footnotes")}
          </Tab>
          <Tab
            id="notes"
            ref={activeTab === "notes" ? setActiveTabRef : undefined}
            className={tabClassName}
          >
            {t("bookSidePanel.notes")}
          </Tab>
        </TabList>
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

      <TabPanels className="flex min-h-0 flex-1 flex-col">
        <TabPanel id="footnotes" className="notes-panel-content">
          <FootnotesView
            chapters={chapters}
            currentChapterId={currentChapterId}
            onSelectChapter={onSelectChapter}
          />
        </TabPanel>
        <TabPanel id="notes" className="flex min-h-0 flex-1 flex-col">
          <BookNotesView notes={notes} onCreateNote={onCreateNote} onOpenNote={onOpenNote} />
        </TabPanel>
      </TabPanels>
    </Tabs>
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
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        // The Quick Note editor stops Escape propagation while it handles it,
        // so reaching here means the panel itself owns the dismissal.
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <Tooltip content={t("bookSidePanel.resize")}>
        {/* biome-ignore lint/a11y/useSemanticElements: a focusable window-splitter separator; <hr> cannot take focus or a value. */}
        <div
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label={t("bookSidePanel.resize")}
          aria-valuenow={width}
          aria-valuemin={200}
          aria-valuemax={480}
          aria-valuetext={t("bookSidePanel.widthValue", { width })}
          onMouseDown={onResizeStart}
          onKeyDown={moveProps.onKeyDown}
          className="absolute top-0 left-0 w-1.5 h-full cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      </Tooltip>
      {content}
    </aside>
  );
}
