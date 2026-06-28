import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";

export const nodeEditorExtensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    link: false,
    underline: false,
  }),
  Underline,
  Highlight.configure({ multicolor: true }),
  Link.configure({
    openOnClick: false,
    autolink: false,
    protocols: ["maibuk"],
    HTMLAttributes: { class: "editor-link" },
  }),
];
