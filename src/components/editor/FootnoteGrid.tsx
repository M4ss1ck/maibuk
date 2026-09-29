import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button as AriaButton,
  GridList,
  GridListHeader,
  GridListItem,
  GridListSection,
} from "react-aria-components";
import { useTranslation } from "react-i18next";
import { Pencil, Trash2 } from "lucide-react";
import { FootnoteDialog } from "@/components/editor/FootnoteDialog";
import { type ItemAction, ItemActionsMenu, Tooltip } from "@/components/ui";
import { useItemCommands } from "@/hooks/useItemCommands";
import { useItemContextMenu } from "@/hooks/useItemContextMenu";

export interface FootnoteGridItem {
  /** Unique within the grid; a pasted copy that shares an id gets its own key. */
  key: string;
  id: string;
  /** Place among its Chapter's Footnotes, from 0. */
  index: number;
  /** The number the author sees. */
  number: number;
  content: string;
}

export interface FootnoteGridSection<Item extends FootnoteGridItem = FootnoteGridItem> {
  key: string;
  /** Shown as a header when set (the side panel groups by Chapter). */
  title?: string;
  items: Item[];
}

interface FootnoteGridProps<Item extends FootnoteGridItem> {
  label: string;
  sections: FootnoteGridSection<Item>[];
  onGoTo: (item: Item) => void;
  onSave: (item: Item, content: string) => void;
  onDelete: (item: Item) => void;
  /** Where focus goes when a Delete removed the last entry and the grid unmounts. */
  onEmptied?: () => void;
  className?: string;
  headerClassName?: string;
  /** DOM id of an entry, for the in-text reference to scroll to. */
  rowDomId?: (item: Item) => string;
}

function rowOf(element: Element | null): HTMLElement | null {
  return element?.closest<HTMLElement>('[role="row"]') ?? null;
}

function FootnoteRow({
  item,
  isMenuOpen,
  onMenuOpenChange,
  onEdit,
  onDelete,
  onGoTo,
  domId,
}: {
  item: FootnoteGridItem;
  domId?: string;
  isMenuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onEdit: (row: HTMLElement | null) => void;
  onDelete: (row: HTMLElement | null) => void;
  onGoTo: () => void;
}) {
  const { t } = useTranslation();
  const anchorRef = useRef<HTMLDivElement>(null);
  // React Aria focuses the row around this body, so the Commands follow the row.
  const rowRef = useRef<HTMLElement | null>(null);
  const title = t("editor.footnoteNumber", { number: item.number });
  const actions: ItemAction[] = [
    {
      id: "edit",
      label: t("editor.editFootnote"),
      icon: Pencil,
      commandId: "footnoteItem.edit",
      onAction: () => onEdit(rowOf(anchorRef.current)),
    },
    {
      id: "delete",
      label: t("editor.deleteFootnote"),
      icon: Trash2,
      isDestructive: true,
      commandId: "footnoteItem.delete",
      onAction: () => onDelete(rowOf(anchorRef.current)),
    },
  ];
  const { itemProps, setOwnerRef } = useItemContextMenu({
    onOpen: () => onMenuOpenChange(true),
    anchorRef,
  });
  useItemCommands(rowRef, actions);
  const setBodyRef = useCallback(
    (node: HTMLDivElement | null) => {
      setOwnerRef(node);
      rowRef.current = rowOf(node);
    },
    [setOwnerRef]
  );

  return (
    <div
      id={domId}
      ref={setBodyRef}
      {...itemProps}
      className="footnote-item-body pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]"
    >
      <span className="footnote-number">{item.number}.</span>
      <span className="footnote-content">{item.content}</span>
      <span className="footnote-item-actions">
        {/* Mouse devices keep one-click actions on hover; touch gets the Item Menu. */}
        {/* Edit/Delete overlay the end of the entry, so they take no width from the text. */}
        <span className="pointer-events-none absolute right-6 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-md bg-background/90 opacity-0 backdrop-blur-sm transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 pointer-coarse:hidden">
          <Tooltip content={t("editor.editFootnote")}>
            <AriaButton
              onPress={() => onEdit(rowOf(anchorRef.current))}
              aria-label={t("editor.editFootnote")}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            </AriaButton>
          </Tooltip>
          <Tooltip content={t("editor.deleteFootnote")}>
            <AriaButton
              onPress={() => onDelete(rowOf(anchorRef.current))}
              aria-label={t("editor.deleteFootnote")}
              className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </AriaButton>
          </Tooltip>
        </span>
        <Tooltip content={t("editor.goToReference")}>
          <AriaButton
            onPress={onGoTo}
            aria-label={t("editor.goToReference")}
            data-command-exempt="navigation to the in-text reference; Enter on the entry does the same"
            className="footnote-backref rounded px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            ↩
          </AriaButton>
        </Tooltip>
        <ItemActionsMenu
          anchorRef={anchorRef}
          label={t("common.moreActionsFor", { title })}
          actions={actions}
          isOpen={isMenuOpen}
          onOpenChange={onMenuOpenChange}
          className="hidden pointer-coarse:inline-flex"
        />
      </span>
    </div>
  );
}

/**
 * A Footnotes list whose entries carry an Item Menu (Edit, Delete), shared by
 * the list after the Chapter text and the side panel's Footnotes tab. Enter
 * on an entry goes to its reference in the text.
 */
export function FootnoteGrid<Item extends FootnoteGridItem>({
  label,
  sections,
  onGoTo,
  onSave,
  onDelete,
  onEmptied,
  className = "",
  headerClassName = "",
  rowDomId,
}: FootnoteGridProps<Item>) {
  const { t } = useTranslation();
  const gridRef = useRef<HTMLDivElement>(null);
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ item: Item; row: HTMLElement | null }>();
  // The entry a Delete removed, and where it sat, so focus can land on its neighbor.
  const deletedRef = useRef<{ key: string; position: number } | null>(null);
  const onEmptiedRef = useRef(onEmptied);
  onEmptiedRef.current = onEmptied;

  const items = sections.flatMap((section) => section.items);
  const byKey = new Map(items.map((item) => [item.key, item]));

  const requestDelete = (item: Item, row: HTMLElement | null) => {
    const rows = Array.from(gridRef.current?.querySelectorAll('[role="row"]') ?? []);
    deletedRef.current = { key: item.key, position: Math.max(0, row ? rows.indexOf(row) : 0) };
    onDelete(item);
  };

  const itemKeys = items.map((item) => item.key).join("\n");
  useEffect(() => {
    const deleted = deletedRef.current;
    if (!deleted || itemKeys.split("\n").includes(deleted.key)) return;
    deletedRef.current = null;
    const grid = gridRef.current;
    const active = document.activeElement;
    if (grid && active && active !== document.body && grid.contains(active)) return;
    const rows = grid?.querySelectorAll<HTMLElement>('[role="row"]') ?? [];
    const next = rows[Math.min(deleted.position, rows.length - 1)];
    if (next) next.focus();
    else onEmptiedRef.current?.();
  }, [itemKeys]);

  useEffect(
    () => () => {
      if (deletedRef.current) onEmptiedRef.current?.();
    },
    []
  );

  const renderItem = (item: Item) => (
    <GridListItem
      key={item.key}
      id={item.key}
      textValue={`${item.number}. ${item.content}`}
      className="footnote-item group outline-none data-focus-visible:ring-2 data-focus-visible:ring-primary"
    >
      <FootnoteRow
        item={item}
        isMenuOpen={menuKey === item.key}
        onMenuOpenChange={(open) => setMenuKey(open ? item.key : null)}
        onEdit={(row) => setEditing({ item, row })}
        onDelete={(row) => requestDelete(item, row)}
        onGoTo={() => onGoTo(item)}
        domId={rowDomId?.(item)}
      />
    </GridListItem>
  );

  return (
    <>
      <GridList
        ref={gridRef}
        aria-label={label}
        keyboardNavigationBehavior="tab"
        onAction={(key) => {
          const item = byKey.get(String(key));
          if (item) onGoTo(item);
        }}
        className={`footnote-list ${className}`}
      >
        {sections.map((section) =>
          section.title === undefined ? (
            section.items.map(renderItem)
          ) : (
            <GridListSection
              key={section.key}
              id={section.key}
              aria-label={t("editor.footnotesOf", { title: section.title })}
            >
              <GridListHeader className={headerClassName}>{section.title}</GridListHeader>
              {section.items.map(renderItem)}
            </GridListSection>
          )
        )}
      </GridList>
      <FootnoteDialog
        mode="edit"
        isOpen={editing !== undefined}
        onClose={() => setEditing(undefined)}
        number={editing?.item.number ?? 0}
        initialContent={editing?.item.content ?? ""}
        onSave={(content) => {
          if (editing) onSave(editing.item, content);
        }}
        restoreFocusTarget={() => {
          if (!editing) return null;
          if (editing.row?.isConnected) return editing.row;
          // The row remounted (a Chapter switch re-read the list); find it by key.
          const rows = gridRef.current?.querySelectorAll<HTMLElement>('[role="row"]') ?? [];
          return Array.from(rows).find((row) => row.dataset.key === editing.item.key) ?? null;
        }}
      />
    </>
  );
}
