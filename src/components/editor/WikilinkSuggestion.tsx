import { useEffect, useImperativeHandle, useState, forwardRef } from "react";
import { ReactRenderer } from "@tiptap/react";
import type { SuggestionOptions } from "@tiptap/suggestion";
import type { WikilinkCandidate } from "@/features/links/wikilink-targets";

export interface WikilinkListProps {
  items: WikilinkCandidate[];
  command: (item: WikilinkCandidate) => void;
}

export interface WikilinkListHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export const WikilinkList = forwardRef<WikilinkListHandle, WikilinkListProps>(
  ({ items, command }, ref) => {
    const [selected, setSelected] = useState(0);
    useEffect(() => setSelected(0), [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === "ArrowDown") {
          setSelected((s) => (s + 1) % Math.max(items.length, 1));
          return true;
        }
        if (event.key === "ArrowUp") {
          setSelected((s) => (s - 1 + items.length) % Math.max(items.length, 1));
          return true;
        }
        if (event.key === "Enter") {
          if (items[selected]) command(items[selected]);
          return true;
        }
        return false;
      },
    }));

    return (
      <div className="z-50 max-h-64 w-72 overflow-auto rounded-lg border border-border bg-background shadow-lg">
        {items.length === 0 && (
          <div className="px-3 py-2 text-sm text-muted-foreground">No matches</div>
        )}
        {items.map((item, idx) => (
          <button
            key={`${item.kind}-${"id" in item ? item.id : item.label}`}
            type="button"
            onClick={() => command(item)}
            className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted ${
              idx === selected ? "bg-muted" : ""
            }`}
          >
            <span>{item.kind === "createNote" ? `Create note "${item.label}"` : item.label}</span>
            <span className="text-xs text-muted-foreground">{item.kind}</span>
          </button>
        ))}
      </div>
    );
  }
);
WikilinkList.displayName = "WikilinkList";

export function createWikilinkRenderer(): SuggestionOptions["render"] {
  return () => {
    let component: ReactRenderer<WikilinkListHandle, WikilinkListProps> | null = null;
    let container: HTMLDivElement | null = null;

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
        component = new ReactRenderer(WikilinkList, {
          props: { items: props.items, command: props.command },
          editor: props.editor,
        });
        container = document.createElement("div");
        container.appendChild(component.element);
        document.body.appendChild(container);
        position(props.clientRect);
      },
      onUpdate: (props) => {
        component?.updateProps({ items: props.items, command: props.command });
        position(props.clientRect);
      },
      onKeyDown: (props) => {
        if (props.event.key === "Escape") return true;
        return component?.ref?.onKeyDown(props) ?? false;
      },
      onExit: () => {
        container?.remove();
        component?.destroy();
        container = null;
        component = null;
      },
    };
  };
}
