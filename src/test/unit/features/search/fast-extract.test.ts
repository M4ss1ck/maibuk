/**
 * The fast index extractor must yield exactly what `htmlToPlainText()` does
 * (#639): the same block boundaries, the same text, the same whitespace and
 * entity handling. `htmlToPlainText()` stays the oracle here, and the fixture
 * set covers every node type the editor schema has plus the bench seed's
 * Chapter and Note HTML.
 */

import { describe, expect, it } from "vitest";
import { generateHTML, getSchema, type JSONContent } from "@tiptap/core";
import { htmlToPlainText } from "@/components/editor/html-to-text";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import { chapterContentBlocks } from "@/features/search/extract";
import { fastHtmlBlocks } from "@/features/search/fast-extract";
import type { SearchBlock } from "@/features/search/types";
import { searchBenchChapterHtml, searchBenchNoteHtml } from "@/test/support/search-bench";

/** Today's extraction, from `htmlToPlainText()` to index blocks. */
function oracleBlocks(html: string): SearchBlock[] {
  const blocks = htmlToPlainText(html).split(/\n{2,}/);
  const result: SearchBlock[] = [];
  blocks.forEach((text, blockIndex) => {
    if (text.trim().length === 0) return;
    result.push({ field: "content", blockIndex, text });
  });
  return result;
}

/** The fast path handles the fixture, and its blocks equal the oracle's. */
function expectParity(html: string, label = html): void {
  expect(fastHtmlBlocks(html), label).not.toBeNull();
  expect(chapterContentBlocks(html), label).toEqual(oracleBlocks(html));
}

function htmlOf(content: JSONContent[]): string {
  return generateHTML({ type: "doc", content }, createRichTextExtensions());
}

const text = (value: string): JSONContent => ({ type: "text", text: value });
const paragraph = (...content: JSONContent[]): JSONContent => ({ type: "paragraph", content });
const cell = (type: "tableCell" | "tableHeader", ...content: JSONContent[]): JSONContent => ({
  type,
  attrs: { colspan: 1, rowspan: 1, colwidth: null },
  content,
});
const item = (...content: JSONContent[]): JSONContent => ({ type: "listItem", content });

const canonicalDocs: JSONContent[][] = [
  // paragraph, text, and every mark the schema carries.
  [
    paragraph(
      { type: "text", text: "bold", marks: [{ type: "bold" }] },
      text(" "),
      { type: "text", text: "italic", marks: [{ type: "italic" }] },
      text(" "),
      { type: "text", text: "under", marks: [{ type: "underline" }] },
      text(" "),
      { type: "text", text: "strike", marks: [{ type: "strike" }] },
      text(" "),
      { type: "text", text: "code", marks: [{ type: "code" }] },
      text(" "),
      {
        type: "text",
        text: "marked",
        marks: [{ type: "highlight", attrs: { color: "#ffff00" } }],
      },
      text(" "),
      { type: "text", text: "sub", marks: [{ type: "subscript" }] },
      text(" "),
      { type: "text", text: "sup", marks: [{ type: "superscript" }] },
      text(" "),
      {
        type: "text",
        text: "link",
        marks: [{ type: "link", attrs: { href: "https://maibuk.test", target: null, rel: null, class: null } }],
      },
      text(" "),
      {
        type: "text",
        text: "styled",
        marks: [{ type: "textStyle", attrs: { color: "#ff0000", fontFamily: null, fontSize: null } }],
      }
    ),
  ],
  // headings 1-3
  [
    { type: "heading", attrs: { level: 1, id: "h1" }, content: [text("One")] },
    { type: "heading", attrs: { level: 2, id: "h2" }, content: [text("Two")] },
    { type: "heading", attrs: { level: 3, id: "h3" }, content: [text("Three")] },
  ],
  // hard breaks, including two in a row
  [
    paragraph(text("before"), { type: "hardBreak" }, text("after")),
    paragraph(text("two"), { type: "hardBreak" }, { type: "hardBreak" }, text("breaks")),
  ],
  // blockquotes, nested
  [
    {
      type: "blockquote",
      content: [paragraph(text("Quote one")), paragraph(text("Quote two"))],
    },
    { type: "blockquote", content: [{ type: "blockquote", content: [paragraph(text("Deep"))] }] },
  ],
  // bullet and ordered lists, nested, with a bare item
  [
    {
      type: "bulletList",
      content: [
        item(paragraph(text("One")), { type: "bulletList", content: [item(paragraph(text("Nested")))] }),
        item(paragraph(text("Two"))),
        item(),
      ],
    },
    {
      type: "orderedList",
      attrs: { start: 3, type: null },
      content: [item(paragraph(text("Three")))],
    },
  ],
  // a table with a header row and a multi-paragraph cell
  [
    {
      type: "table",
      content: [
        { type: "tableRow", content: [cell("tableHeader", paragraph(text("H1"))), cell("tableHeader", paragraph(text("H2")))] },
        { type: "tableRow", content: [cell("tableCell", paragraph(text("C1")), paragraph(text("C1 again"))), cell("tableCell", paragraph(text("C2")))] },
      ],
    },
  ],
  // images with and without caption text
  [
    { type: "image", attrs: { src: "a.png", alt: "Alt", title: null, caption: "", width: null, alignment: "center" }, content: [] },
    { type: "image", attrs: { src: "b.png", alt: null, title: null, caption: "", width: null, alignment: "left" }, content: [text("Caption text")] },
  ],
  // scene break, horizontal rule
  [
    paragraph(text("a")),
    {
      type: "sceneBreak",
      attrs: { kind: "text", symbols: "* * *", unit: null, count: null, spaced: true, src: null, assetId: null, alt: null },
    },
    paragraph(text("b")),
    { type: "horizontalRule" },
    paragraph(text("after rule")),
  ],
  // code blocks keep whitespace, with and without a language
  [
    { type: "codeBlock", attrs: { language: "ts" }, content: [text("const a = 1;\n  const b = 2;")] },
    { type: "codeBlock", attrs: { language: null }, content: [text("  spaced  ")] },
  ],
  // footnote (inline atom) and an empty paragraph
  [
    paragraph(text("Note"), { type: "footnote", attrs: { id: "fn-1", content: "hidden note body" } }, text(" after")),
    paragraph(),
    paragraph(text("after empty")),
  ],
  // whitespace-only edges
  [paragraph(text("  leading and   inner   spaces  "))],
];

/** Hand-written markup around the same nodes, plus whitespace/entity edges. */
const snippets = [
  "<p>First paragraph</p><p>Second paragraph</p>",
  "<p>line one<br>line two</p>",
  "<p>a<br> b</p>",
  "<p>a<br><br>b</p>",
  "<p><br></p>",
  "<p>a<br></p>",
  "<p><em>a</em>\n<em>b</em></p>",
  "<p>a <em> b</em> c</p>",
  "<p><em>a </em> <em>b</em></p>",
  "<p><strong>a</strong> <strong>b</strong></p>",
  "<ul><li>One</li><li>Two</li></ul>",
  "<ul><li>a<p>b</p></li></ul>",
  "<ul><li><p>a</p><p>b</p></li></ul>",
  "<table><tr><td><p>C1</p></td></tr></table>",
  "<div>hello</div><p>there</p>",
  "<span>hello</span>",
  "hello<p>there</p>",
  "<div><p>x</p></div><p>y</p>",
  "<p>a<foo>b</foo>c</p>",
  "<p>A &amp; B &lt;tag&gt; &quot;q&quot; &#39;s&#39; &nbsp;nb</p>",
  "<p>a&nbsp; b</p>",
  "<p>a<!-- c -->b</p>",
  '<p><sup data-footnote="" data-footnote-id="f" data-footnote-content="n">1</sup> hello</p>',
  '<p>x<sup data-footnote="">1</sup> hello</p>',
  "<p>use <code>foo()</code> here</p>",
  "<p>H<sub>2</sub>O and x<sup>2</sup></p>",
  "<pre><code>a\r\nb</code></pre>",
  "<pre><code>  a\n b  </code></pre>",
  "<pre><code>a\n\nb</code></pre>",
  '<div data-scene-break="" data-kind="text"><span class="scene-break-symbols">* * *</span></div><p>b</p>',
  "<p>a</p><hr><p>b</p>",
  "<p>a</p><br><p>b</p>",
  '<figure data-image=""><img src="a.png" alt="Alt"><figcaption>Caption</figcaption></figure><p>After</p>',
  '<figure data-image=""><img src="a.png" alt="Alt"><figcaption></figcaption></figure><p>After</p>',
  '<p>a</p><img src="x.png"><p>b</p>',
  '<div class="tableWrapper"><table><tbody><tr><td><p>c</p></td></tr></tbody></table></div>',
  '<p><span style="font-size: 12px">x</span></p>',
  '<p><span style="color: red">red</span><span style="font-family: serif">serif</span></p>',
  "<p>a\nb</p>",
  "<p>a\tb</p>",
  "<p>\n</p><p>x</p>",
  "<p>\n  </p><p>x</p>",
];

describe("fastHtmlBlocks() parity with htmlToPlainText()", () => {
  it("extracts every node type the editor schema has", () => {
    const schema = getSchema(createRichTextExtensions());
    const seen = new Set<string>();
    const visit = (node: JSONContent): void => {
      seen.add(node.type ?? "");
      for (const child of node.content ?? []) visit(child);
    };
    for (const doc of canonicalDocs) visit({ type: "doc", content: doc });
    for (const name of Object.keys(schema.nodes)) {
      expect(seen, `fixture set has no ${name} node`).toContain(name);
    }

    for (const doc of canonicalDocs) expectParity(htmlOf(doc));
  });

  it("extracts canonical node combinations as one document", () => {
    for (let seed = 0; seed < 20; seed += 1) {
      const content = canonicalDocs
        .slice(1)
        .filter((_, index) => (seed * 7 + index) % 3 !== 0)
        .flat();
      expectParity(htmlOf(content));
    }
  });

  it("handles whitespace, entities, and malformed nesting around the same blocks", () => {
    for (const html of snippets) expectParity(html);
  });

  it("matches the bench seed's Chapter HTML", () => {
    // Both languages, every Book, the first and last Chapters of the seed.
    const indexes = [0, 1, 2, 3, 4, 199, 200, 201, 599, 600, 998, 999];
    for (const index of indexes) {
      const book = Math.floor(index / 200);
      const chapter = index % 200;
      expectParity(searchBenchChapterHtml(book, chapter), `chapter ${index}`);
    }
  });

  it("matches the bench seed's Note HTML", () => {
    // Notes alternate Spanish (index % 5 === 0) and English.
    for (const index of [0, 1, 2, 3, 4, 5, 17, 199, 1999]) {
      expectParity(searchBenchNoteHtml(index), `note ${index}`);
    }
  });

  it("falls back instead of guessing when a block element sits in a paragraph", () => {
    // A block inside a textblock splits it; the oracle's split is the one that
    // counts, so the fast path declines rather than reproduce it.
    expect(fastHtmlBlocks('<p>a<img src="x.png">b</p>')).toBeNull();
    expect(fastHtmlBlocks('<p>a<table><tr><td><p>c</p></td></tr></table>b</p>')).toBeNull();
    // And extraction still matches the oracle through the fallback.
    expect(chapterContentBlocks('<p>a<img src="x.png">b</p>')).toEqual(
      oracleBlocks('<p>a<img src="x.png">b</p>')
    );
  });
});
