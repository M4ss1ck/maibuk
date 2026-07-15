import Code from "@tiptap/extension-code";

/**
 * Inline code with a **non-inclusive** boundary, matching Notion, Dropbox Paper,
 * and Confluence (and ProseMirror's own recommendation for code marks).
 *
 * StarterKit's default `code` mark is `inclusive: true`, which traps the caret
 * inside the `<code>` element at its trailing edge — typing there stays
 * monospace, and the only escape (`exitable`'s ArrowRight handler) fabricates a
 * literal space to give the caret somewhere to land. Making the mark
 * non-inclusive means the caret at the right edge is treated as *outside* the
 * mark: clicking after the last character or pressing ArrowRight yields plain
 * text with no phantom space. Extending an existing span is still available by
 * clicking inside it or re-toggling code (Mod-E).
 */
export const CustomCode = Code.extend({ inclusive: false });
