// src/components/editor/extensions/Wikilink.ts
import { mergeAttributes, Node, type Editor } from "@tiptap/core";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";
import type { WikilinkCandidate } from "@/features/links/wikilink-targets";
import { formatLinkUri } from "@/features/links/link-uri";

export interface WikilinkAttrs {
  href: string | null; // maibuk:// URI when bound; null when unresolved
  label: string;
}

export interface WikilinkSuggestionConfig {
  items: (props: { query: string; editor: Editor }) => WikilinkCandidate[];
  onCreateNote: (title: string) => Promise<{ noteId: string }>;
  render: SuggestionOptions["render"];
}

// The suggestion option carries the base tiptap Suggestion fields plus the
// wikilink-specific ones (onCreateNote, typed items/render). items/render come
// solely from WikilinkSuggestionConfig to avoid intersecting conflicting
// function signatures with SuggestionOptions.
type WikilinkSuggestionOptions = Omit<Partial<SuggestionOptions>, "items" | "render"> &
  Partial<WikilinkSuggestionConfig>;

/**
 * Inline atom node for `[[ ]]` note links. Bound links render as a maibuk anchor;
 * unresolved links render with a `wikilink-broken` class and a `data-label` so the
 * UI can offer to create a note (D6).
 */
export const Wikilink = Node.create({
  name: "wikilink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return {
      suggestion: {
        char: "[[",
        startOfLine: false,
      } as WikilinkSuggestionOptions,
    };
  },

  addAttributes() {
    return {
      href: { default: null },
      label: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "a.wikilink",
        getAttrs: (el) => {
          const element = el as HTMLElement;
          return {
            href: element.getAttribute("href"),
            label: element.getAttribute("data-label") ?? element.textContent ?? "",
          };
        },
      },
    ];
  },

  renderHTML({ node }) {
    const href = node.attrs.href as string | null;
    const label = (node.attrs.label as string) ?? "";
    if (href) {
      return ["a", mergeAttributes({ class: "wikilink", href, "data-type": "wikilink" }), label];
    }
    return [
      "a",
      mergeAttributes({
        class: "wikilink wikilink-broken",
        "data-label": label,
        "data-type": "wikilink",
      }),
      label,
    ];
  },

  renderText({ node }) {
    return `[[${node.attrs.label}]]`;
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: "[[",
        ...this.options.suggestion,
        command: ({ editor, range, props }) => {
          const candidate = props as WikilinkCandidate;
          editor.chain().focus().deleteRange(range).run();
          insertWikilink(editor, candidate, this.options.suggestion as WikilinkSuggestionConfig);
          return true;
        },
      }),
    ];
  },
});

async function insertWikilink(
  editor: Editor,
  candidate: WikilinkCandidate,
  config: WikilinkSuggestionConfig
): Promise<void> {
  let href: string | null = null;
  let label = candidate.label;

  switch (candidate.kind) {
    case "note":
      href = formatLinkUri({ targetType: "note", targetId: candidate.id });
      break;
    case "book":
      href = formatLinkUri({ targetType: "book", targetId: candidate.id });
      break;
    case "chapter":
      href = formatLinkUri({ targetType: "chapter", targetId: candidate.id });
      break;
    case "heading":
      href = formatLinkUri({
        targetType: "heading",
        targetId: candidate.chapterId,
        headingId: candidate.id,
      });
      break;
    case "createNote": {
      const { noteId } = await config.onCreateNote(candidate.label);
      href = formatLinkUri({ targetType: "note", targetId: noteId });
      label = candidate.label;
      break;
    }
  }

  editor.chain().focus().insertContent({ type: "wikilink", attrs: { href, label } }).run();
}
