import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, History } from "lucide-react";

interface HistoryMenuButtonProps {
  onOpenPanel: () => void;
  onSaveVersion: () => void;
  saveVersionShortcut: string;
  panelShortcut: string;
}

export function HistoryMenuButton({
  onOpenPanel,
  onSaveVersion,
  saveVersionShortcut,
  panelShortcut,
}: HistoryMenuButtonProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const saveItemRef = useRef<HTMLButtonElement>(null);
  const historyItemRef = useRef<HTMLButtonElement>(null);

  const menuItems = [saveItemRef, historyItemRef];

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) {
        return;
      }
      setMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  const focusMenuItem = (index: number) => {
    menuItems[index]?.current?.focus();
  };

  const openMenu = () => {
    setMenuOpen(true);
  };

  const openMenuAndFocusFirst = () => {
    openMenu();
    window.requestAnimationFrame(() => focusMenuItem(0));
  };

  const runSave = () => {
    onSaveVersion();
    setMenuOpen(false);
  };

  const runOpen = () => {
    onOpenPanel();
    setMenuOpen(false);
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = menuItems.findIndex((item) => item.current === event.currentTarget);

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusMenuItem((currentIndex + 1) % menuItems.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusMenuItem((currentIndex - 1 + menuItems.length) % menuItems.length);
        break;
      case "Escape":
        event.preventDefault();
        setMenuOpen(false);
        break;
    }
  };

  const handleButtonKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openMenuAndFocusFirst();
    }
  };

  return (
    <div ref={rootRef} className="relative inline-flex items-center rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={onOpenPanel}
        onKeyDown={handleButtonKeyDown}
        className="inline-flex h-9 w-9 items-center justify-center rounded-l-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={t("versions.openHistory")}
        title={`${t("versions.title")} (${panelShortcut})`}
      >
        <History className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        onKeyDown={handleButtonKeyDown}
        className="inline-flex h-9 w-7 items-center justify-center rounded-r-lg border-l border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={t("common.more")}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {menuOpen && (
        <ul
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-56 rounded-lg border border-border bg-background p-1 shadow-lg"
        >
          <li>
            <button
              ref={saveItemRef}
              type="button"
              role="menuitem"
              onClick={runSave}
              onKeyDown={handleMenuKeyDown}
              className="flex w-full items-center justify-between gap-3 rounded px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted focus:bg-muted focus-visible:outline-none"
            >
              <span>{t("versions.saveVersion")}</span>
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {saveVersionShortcut}
              </kbd>
            </button>
          </li>
          <li>
            <button
              ref={historyItemRef}
              type="button"
              role="menuitem"
              onClick={runOpen}
              onKeyDown={handleMenuKeyDown}
              className="flex w-full items-center justify-between gap-3 rounded px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted focus:bg-muted focus-visible:outline-none"
            >
              <span>{t("versions.showHistory")}</span>
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {panelShortcut}
              </kbd>
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
