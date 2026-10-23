/**
 * The kinds of Library item Library Search indexes. Versions, Checkpoints,
 * Cover data, Plugin data, Ephemeral text, and Chapter synopses are
 * deliberately absent: they are not current work.
 */
export type SearchItemKind = "book" | "chapter" | "note" | "canvas";

/** The part of an item a block of text comes from. */
export type SearchField = "title" | "subtitle" | "description" | "content" | "card";

/** One row of the device-local plain-text index: one block of one field. */
export interface SearchBlock {
  field: SearchField;
  /** The block's ordinal within the item's field, starting at 0. */
  blockIndex: number;
  text: string;
}

/** A block read back from `search_text`, with the item it belongs to. */
export interface IndexedSearchBlock extends SearchBlock {
  itemKind: SearchItemKind;
  itemId: string;
  bookId: string | null;
}
