/** @jsxImportSource preact */
/**
 * The Shelf's Collections (#946): the Wide rail that lists them with their
 * counts and takes a dragged Document, the single-choice picker the "View and
 * filters" surfaces open, the Collection menu (Rename, Delete), and the New,
 * Rename, and Delete dialogs. Every part is controlled: it draws what the Shelf
 * gives it and hands each choice back, and the Worker stores the change.
 *
 * Copy comes from the Worker's catalogs through `FrameShelfLabels`; the kit
 * draws every control, so color, focus ring, and motion live in `kit.css`.
 */

import type { TargetedDragEvent, TargetedKeyboardEvent } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import { Button, Dialog, Icon, IconButton, Menu, Popover, Sheet } from "./kit";
import { fill } from "./shelf-query";
import type { FrameCollection, FrameShelfLabels } from "./types";

/** The drag type a Shelf cell carries: the dragged Document's id. */
export const DOCUMENT_DRAG_TYPE = "application/x-maibuk-document";

/** The rail's small icon buttons, 28 px as the artboard draws its New button. */
const SMALL_BUTTON = { width: "28px", height: "28px" } as const;

/**
 * The longest Collection name the Worker keeps, in characters. This and the
 * duplicate check below mirror `collectionName` and `sameCollectionName` in the
 * Worker's `shelf.ts`: the Frame is its own bundle and cannot import them, and
 * the Worker stays the judge (it trims, cuts by code point, and refuses).
 */
const NAME_LIMIT = 100;

/** A name as the Worker stores it, folded for the duplicate check. */
function nameKey(name: string): string {
  return name.trim().toLocaleLowerCase();
}

/** Whether `name` is another Collection's name, ignoring case and the ends' spaces. */
export function duplicateName(
  name: string,
  collections: readonly FrameCollection[],
  exceptId?: string
): boolean {
  const key = nameKey(name);
  return collections.some(
    (collection) => collection.id !== exceptId && nameKey(collection.name) === key
  );
}

/** True when a key press asks for the context menu: Shift+F10 or the ContextMenu key. */
export function isContextMenuKey(event: TargetedKeyboardEvent<HTMLElement>): boolean {
  return event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
}

/** The props the rail takes. */
export interface CollectionRailProps {
  labels: FrameShelfLabels;
  collections: readonly FrameCollection[];
  counts: ReadonlyMap<string, number>;
  /** Every Document on the Shelf, for the All Documents row. */
  total: number;
  /** The filtered Collection's id, or null for All Documents. */
  active: string | null;
  onChoose: (collectionId: string | null) => void;
  onCreate: () => void;
  /** Opens the Collection menu from a row's More button or its context menu key. */
  onMenu: (collection: FrameCollection, anchor: HTMLElement) => void;
  /** A Document was dropped on a Collection. */
  onFile: (collectionId: string, documentId: string) => void;
}

/** Whether a drag carries a Shelf Document. */
function carriesDocument(event: TargetedDragEvent<HTMLElement>): boolean {
  const types = event.dataTransfer?.types;
  return types !== undefined && Array.from(types).includes(DOCUMENT_DRAG_TYPE);
}

/**
 * The Wide Collections rail, as "Shelf · desktop · grid M" draws it: All
 * Documents, the Collections label with its New button, a row per Collection
 * with its count, and the drag hint at the foot.
 */
export function CollectionRail({
  labels,
  collections,
  counts,
  total,
  active,
  onChoose,
  onCreate,
  onMenu,
  onFile,
}: CollectionRailProps) {
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLElement>());

  return (
    <aside class="shelf-rail" aria-label={labels.collections}>
      <button
        type="button"
        class="shelf-rail__item"
        aria-current={active === null ? "true" : undefined}
        onClick={() => onChoose(null)}
      >
        <Icon name="book" />
        <span class="shelf-rail__name">{labels.allDocuments}</span>
        <span class="shelf-rail__count">{total}</span>
      </button>
      <div class="shelf-rail__heading">
        <span class="shelf-rail__label">{labels.collections}</span>
        <IconButton
          label={labels.newCollection}
          icon="plus"
          // Drawn at 28 px beside the label, as the rail artboard sizes it.
          style={SMALL_BUTTON}
          onClick={onCreate}
        />
      </div>
      {collections.length === 0 ? <p class="shelf-rail__empty">{labels.noCollections}</p> : null}
      {collections.map((collection) => {
        const current = collection.id === active;
        const openMenu = () => {
          const anchor = rows.current.get(collection.id);
          if (anchor) onMenu(collection, anchor);
        };
        return (
          <div
            key={collection.id}
            ref={(node) => {
              if (node) rows.current.set(collection.id, node);
              else rows.current.delete(collection.id);
            }}
            class={
              dropTarget === collection.id
                ? "shelf-rail__row shelf-rail__row--drop"
                : "shelf-rail__row"
            }
            data-collection-id={collection.id}
            onDragOver={(event) => {
              if (!carriesDocument(event)) return;
              event.preventDefault();
              if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
              setDropTarget(collection.id);
            }}
            onDragLeave={() =>
              setDropTarget((target) => (target === collection.id ? null : target))
            }
            onDrop={(event) => {
              setDropTarget(null);
              const documentId = event.dataTransfer?.getData(DOCUMENT_DRAG_TYPE) ?? "";
              if (documentId === "") return;
              event.preventDefault();
              onFile(collection.id, documentId);
            }}
          >
            <button
              type="button"
              class="shelf-rail__item"
              aria-current={current ? "true" : undefined}
              onClick={() => onChoose(collection.id)}
              onKeyDown={(event) => {
                if (!isContextMenuKey(event)) return;
                event.preventDefault();
                openMenu();
              }}
            >
              <Icon name="collection" />
              <span class="shelf-rail__name">{collection.name}</span>
              <span class="shelf-rail__count">{counts.get(collection.id) ?? 0}</span>
            </button>
            <span class="shelf-rail__more">
              <IconButton
                label={fill(labels.moreForCollection, { name: collection.name })}
                icon="moreV"
                tabIndex={-1}
                style={SMALL_BUTTON}
                onClick={openMenu}
              />
            </span>
          </div>
        );
      })}
      <div class="shelf__spacer" />
      <p class="shelf-rail__hint">{labels.railHint}</p>
    </aside>
  );
}

/** The props the Collection picker takes. */
export interface CollectionPickerProps {
  labels: FrameShelfLabels;
  collections: readonly FrameCollection[];
  /** The filtered Collection's id, or null for Any Collection. */
  active: string | null;
  wide: boolean;
  anchor: { current: HTMLElement | null };
  onChoose: (collectionId: string | null) => void;
  onClose: () => void;
}

/**
 * The single-choice Collection filter: Any Collection, then each Collection.
 * One Tab stop on the chosen row; the arrow keys move and choose, as Sort by
 * does, and a click or Enter chooses and closes. A Popover on Wide, a Sheet
 * over the options Sheet on Narrow.
 */
export function CollectionPicker({
  labels,
  collections,
  active,
  wide,
  anchor,
  onChoose,
  onClose,
}: CollectionPickerProps) {
  const radios = useRef<Array<HTMLButtonElement | null>>([]);
  const choices: Array<{ id: string | null; name: string }> = [
    { id: null, name: labels.anyCollection },
    ...collections,
  ];
  const chosenIndex = Math.max(
    0,
    choices.findIndex((choice) => choice.id === active)
  );

  // The keyboard path starts on the current choice, not the layer's first control.
  useEffect(() => {
    radios.current[chosenIndex]?.focus();
  }, []);

  const move = (index: number) => {
    const wrapped = (index + choices.length) % choices.length;
    const choice = choices[wrapped];
    if (choice === undefined) return;
    onChoose(choice.id);
    radios.current[wrapped]?.focus();
  };

  const onKeyDown = (event: TargetedKeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        event.preventDefault();
        move(index + 1);
        return;
      case "ArrowUp":
      case "ArrowLeft":
        event.preventDefault();
        move(index - 1);
        return;
      case "Home":
        event.preventDefault();
        move(0);
        return;
      case "End":
        event.preventDefault();
        move(choices.length - 1);
        return;
      default:
        return;
    }
  };

  const body = (
    <div class="shelf-sort shelf-picker" role="radiogroup" aria-label={labels.collection}>
      {choices.map((choice, index) => {
        const chosen = index === chosenIndex;
        return (
          <div key={choice.id ?? ""} class="shelf-sort__row">
            {/* biome-ignore lint/a11y/useSemanticElements: a Frame owns its roving radio group (ADR 0021), as Sort by does. */}
            <button
              ref={(node) => {
                radios.current[index] = node;
              }}
              type="button"
              role="radio"
              aria-checked={chosen}
              tabIndex={chosen ? 0 : -1}
              class="shelf-sort__option"
              onClick={() => {
                onChoose(choice.id);
                onClose();
              }}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              <span class="shelf-sort__check">{chosen ? <Icon name="check" /> : null}</span>
              <span class="shelf-picker__name">{choice.name}</span>
            </button>
          </div>
        );
      })}
      {collections.length === 0 ? <p class="shelf-picker__empty">{labels.noCollections}</p> : null}
    </div>
  );

  return wide ? (
    <Popover open onClose={onClose} triggerRef={anchor} label={labels.collection}>
      {body}
    </Popover>
  ) : (
    <Sheet open onClose={onClose} title={labels.collection} doneLabel={labels.done}>
      {body}
    </Sheet>
  );
}

/** The props the Collection menu takes. */
export interface CollectionMenuProps {
  labels: FrameShelfLabels;
  collection: FrameCollection;
  wide: boolean;
  anchor: { current: HTMLElement | null };
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}

/** Rename and Delete for one Collection: a Popover on Wide, a Sheet on Narrow. */
export function CollectionMenu({
  labels,
  collection,
  wide,
  anchor,
  onRename,
  onDelete,
  onClose,
}: CollectionMenuProps) {
  const menu = (
    <Menu
      open
      inline
      onClose={onClose}
      label={collection.name}
      items={[
        { id: "rename", label: labels.renameAction, icon: "pen" },
        { id: "delete", label: labels.deleteAction, icon: "trash", destructive: true },
      ]}
      onSelect={(id) => (id === "rename" ? onRename() : onDelete())}
    />
  );
  return wide ? (
    <Popover open onClose={onClose} triggerRef={anchor} label={collection.name}>
      {menu}
    </Popover>
  ) : (
    <Sheet open onClose={onClose} title={collection.name}>
      {menu}
    </Sheet>
  );
}

/** The dialog the Shelf shows for one Collection change, or none. */
export type CollectionDialogState =
  | { kind: "create"; documentId?: string }
  | { kind: "rename"; collection: FrameCollection }
  | { kind: "delete"; collection: FrameCollection };

/** The props the Collection dialogs take. */
export interface CollectionDialogProps {
  labels: FrameShelfLabels;
  dialog: CollectionDialogState;
  collections: readonly FrameCollection[];
  wide: boolean;
  /** The name the author confirmed, trimmed, for a create or a rename. */
  onSubmit: (name: string) => void;
  onDelete: (collection: FrameCollection) => void;
  onClose: () => void;
}

/**
 * New Collection, Rename Collection, and the Delete confirmation: a Dialog on
 * Wide, a Sheet on Narrow. The name field refuses a blank name and says so
 * inline when another Collection already has it.
 */
export function CollectionDialog({
  labels,
  dialog,
  collections,
  wide,
  onSubmit,
  onDelete,
  onClose,
}: CollectionDialogProps) {
  const [name, setName] = useState(() => (dialog.kind === "rename" ? dialog.collection.name : ""));
  const formId = `shelf-collection-${useId()}`;

  if (dialog.kind === "delete") {
    const title = fill(labels.deleteCollectionTitle, { name: dialog.collection.name });
    const actions = (
      <>
        <Button variant="secondary" onClick={onClose}>
          {labels.cancel}
        </Button>
        <Button variant="destructive" onClick={() => onDelete(dialog.collection)}>
          <Icon name="trash" />
          {labels.delete}
        </Button>
      </>
    );
    const body = <p class="shelf-remove__body">{labels.deleteCollectionBody}</p>;
    return wide ? (
      <Dialog open onClose={onClose} title={title} role="alertdialog" actions={actions}>
        {body}
      </Dialog>
    ) : (
      <Sheet open onClose={onClose} title={title} role="alertdialog">
        {body}
        <div class="shelf-remove__actions">{actions}</div>
      </Sheet>
    );
  }

  const renaming = dialog.kind === "rename";
  const title = renaming ? labels.renameCollection : labels.newCollection;
  const blank = name.trim() === "";
  const duplicate =
    !blank && duplicateName(name, collections, renaming ? dialog.collection.id : undefined);
  const errorId = `${formId}-error`;
  /** Submits `value`, read from the field itself so a key pressed before a render sees it. */
  const submit = (value: string) => {
    const trimmed = value.trim();
    if (trimmed === "") return;
    if (duplicateName(trimmed, collections, renaming ? dialog.collection.id : undefined)) return;
    onSubmit(trimmed);
  };

  const form = (
    <form
      id={formId}
      class="shelf-collection-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit(name);
      }}
    >
      <label class="shelf-collection-form__label">
        <span>{labels.collectionName}</span>
        <input
          type="text"
          class="shelf-field"
          value={name}
          maxLength={NAME_LIMIT}
          aria-invalid={duplicate}
          aria-describedby={duplicate ? errorId : undefined}
          onInput={(event) => setName(event.currentTarget.value)}
          // The submit button sits in the layer's actions, outside the form.
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            // deprecated-api: Safari's IME-commit Enter has isComposing false; keyCode 229 is its only tell.
            if (event.isComposing || event.keyCode === 229) return;
            event.preventDefault();
            submit(event.currentTarget.value);
          }}
        />
      </label>
      {duplicate ? (
        <p id={errorId} class="shelf-collection-form__error" role="alert">
          {labels.duplicateCollection}
        </p>
      ) : null}
    </form>
  );
  const actions = (
    <>
      <Button variant="secondary" onClick={onClose}>
        {labels.cancel}
      </Button>
      <Button variant="primary" type="submit" form={formId} disabled={blank || duplicate}>
        {renaming ? labels.rename : labels.create}
      </Button>
    </>
  );
  return wide ? (
    <Dialog open onClose={onClose} title={title} actions={actions}>
      {form}
    </Dialog>
  ) : (
    <Sheet open onClose={onClose} title={title}>
      {form}
      <div class="shelf-remove__actions">{actions}</div>
    </Sheet>
  );
}

/** The props the Document menu's New Collection field takes. */
export interface NewCollectionFieldProps {
  labels: FrameShelfLabels;
  /** Draws the Collections label above the field, when no Collection row draws it. */
  withLabel: boolean;
  onAdd: (name: string) => void;
}

/**
 * The Document menu's New Collection field and its Add button, as "Document
 * menu with Collections" draws them: Add makes the Collection (or reuses one of
 * the same name) and files the Document in it. Enter in the field adds too.
 */
export function NewCollectionField({ labels, withLabel, onAdd }: NewCollectionFieldProps) {
  const [name, setName] = useState("");
  const blank = name.trim() === "";
  return (
    <div class="shelf-menu-new">
      {withLabel ? (
        <p class="kit-menu__section" aria-hidden="true">
          {labels.collections}
        </p>
      ) : null}
      <form
        class="shelf-menu-new__row"
        onSubmit={(event) => {
          event.preventDefault();
          if (blank) return;
          onAdd(name.trim());
          setName("");
        }}
      >
        <input
          type="text"
          class="shelf-field"
          value={name}
          maxLength={NAME_LIMIT}
          placeholder={labels.newCollection}
          aria-label={labels.newCollectionName}
          onInput={(event) => setName(event.currentTarget.value)}
        />
        <Button type="submit" disabled={blank}>
          {labels.add}
        </Button>
      </form>
    </div>
  );
}
