import { ReactRenderer } from "@tiptap/react";
import type { SuggestionOptions } from "@tiptap/suggestion";
import type { SymbolEntry } from "@/features/symbols/types";
import i18n from "@/i18n";

interface SymbolSuggestionListProps {
  items: SymbolEntry[];
  selectedIndex: number;
  command: (item: SymbolEntry) => void;
}

function SymbolSuggestionList({ items, selectedIndex, command }: SymbolSuggestionListProps) {
  return (
    <div
      role="listbox"
      aria-label={i18n.t("symbols.grid")}
      className="z-50 max-h-72 w-80 overflow-y-auto rounded-lg border border-border bg-background p-1 shadow-lg"
    >
      {items.length === 0 ? (
        <div className="px-3 py-2 text-sm text-muted-foreground">{i18n.t("symbols.noResults")}</div>
      ) : (
        items.map((item, index) => (
          <button
            key={`${item.glyph}-${item.label}`}
            type="button"
            role="option"
            aria-selected={index === selectedIndex}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => command(item)}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-muted ${
              index === selectedIndex ? "bg-muted" : ""
            }`}
          >
            <span className="w-7 shrink-0 text-center text-xl" aria-hidden="true">
              {item.glyph}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-foreground">{item.label}</span>
              <span className="block truncate text-xs text-muted-foreground">{item.category}</span>
            </span>
          </button>
        ))
      )}
    </div>
  );
}

export function createSymbolSuggestionRenderer(): SuggestionOptions<
  SymbolEntry,
  SymbolEntry
>["render"] {
  return () => {
    let component: ReactRenderer<unknown, SymbolSuggestionListProps> | null = null;
    let container: HTMLDivElement | null = null;
    let items: SymbolEntry[] = [];
    let selectedIndex = 0;
    let command: ((item: SymbolEntry) => void) | null = null;

    const updateComponent = () => {
      if (!component || !command) return;
      component.updateProps({ items, selectedIndex, command });
    };

    const position = (clientRect: (() => DOMRect | null) | null | undefined) => {
      if (!container || !clientRect) return;
      const rect = clientRect();
      if (!rect) return;
      container.style.position = "absolute";
      container.style.left = `${rect.left + window.scrollX}px`;
      container.style.top = `${rect.bottom + window.scrollY}px`;
    };

    return {
      onStart: (props) => {
        items = props.items;
        selectedIndex = 0;
        command = props.command;
        component = new ReactRenderer(SymbolSuggestionList, {
          props: { items, selectedIndex, command },
          editor: props.editor,
        });
        container = document.createElement("div");
        container.appendChild(component.element);
        document.body.appendChild(container);
        position(props.clientRect);
      },
      onUpdate: (props) => {
        items = props.items;
        selectedIndex = 0;
        command = props.command;
        updateComponent();
        position(props.clientRect);
      },
      onKeyDown: ({ event }) => {
        if (event.key === "ArrowDown") {
          selectedIndex = (selectedIndex + 1) % Math.max(items.length, 1);
          updateComponent();
          return true;
        }
        if (event.key === "ArrowUp") {
          selectedIndex = (selectedIndex - 1 + items.length) % Math.max(items.length, 1);
          updateComponent();
          return true;
        }
        if (event.key === "Enter") {
          const selected = items[selectedIndex];
          if (!selected || !command) return false;
          command(selected);
          return true;
        }
        if (event.key === "Tab") {
          const first = items[0];
          if (!first || !command) return false;
          command(first);
          return true;
        }
        return false;
      },
      onExit: () => {
        container?.remove();
        component?.destroy();
        container = null;
        component = null;
        items = [];
        command = null;
      },
    };
  };
}
