import { inflateSync } from "node:zlib";
import { Document, Page, pdf, Text } from "@react-pdf/renderer";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { generateDocumentPdf } from "@/features/export/document-pdf";
import { PDF_BASE_FONT } from "@/features/export/types";
import {
  bookPdfText,
  builtInFontsCanRender,
  documentPdfText,
  hyphenateWord,
} from "@/features/export/pdf-text-support";
import { buildBook, buildChapter } from "@/test/support/fixtures";

// The decoder pdfkit's WinAnsi table mirrors: byte -> Unicode.
const winAnsi = new TextDecoder("windows-1252");

/**
 * Recover the text a real standard-font render put in the PDF: inflate the
 * content streams, collect the hex strings of the TJ/Tj operators, and decode
 * them as Windows-1252, which is the encoding the standard fonts declare.
 */
function readBackText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString("latin1");
  const hexes: string[] = [];
  const streamStart = /stream\r?\n/g;
  let match = streamStart.exec(raw);
  while (match) {
    const start = match.index + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    let content = raw.slice(start, end);
    if (raw.lastIndexOf("/FlateDecode", match.index) > raw.lastIndexOf("<<", match.index)) {
      try {
        content = inflateSync(Buffer.from(content, "latin1")).toString("latin1");
      } catch {
        match = streamStart.exec(raw);
        continue;
      }
    }
    if (/\bBT\b/.test(content) && /\bET\b/.test(content)) {
      for (const hex of content.matchAll(/<([0-9A-Fa-f]+)>/g)) {
        hexes.push(hex[1] ?? "");
      }
    }
    match = streamStart.exec(raw);
  }
  const decoded: number[] = [];
  for (const hex of hexes) {
    for (let i = 0; i + 1 < hex.length; i += 2) {
      decoded.push(Number.parseInt(hex.slice(i, i + 2), 16));
    }
  }
  return winAnsi.decode(Uint8Array.from(decoded));
}

async function renderAndReadBack(text: string): Promise<string> {
  const element = createElement(
    Document,
    null,
    createElement(
      Page,
      { size: "A4", style: { padding: 20 } },
      createElement(Text, { style: { fontFamily: PDF_BASE_FONT, fontSize: 8 } }, text)
    )
  );
  const blob = await pdf(element).toBlob();
  return readBackText(new Uint8Array(await blob.arrayBuffer()));
}

describe("builtInFontsCanRender()", () => {
  it("treats the empty string and whitespace as renderable", () => {
    expect(builtInFontsCanRender("")).toBe(true);
    expect(builtInFontsCanRender("\n\t")).toBe(true);
  });

  it("rejects one Polish word inside otherwise English text", () => {
    expect(builtInFontsCanRender("The word is żółć in Polish")).toBe(false);
  });
});

describe("builtInFontsCanRender() against a real render", () => {
  const samples: Array<[string, string, boolean]> = [
    ["fr", "Où est la forêt ? Ça coûte déjà très cher, œuvre", true],
    ["de", "Größe, Äpfel, Übermut, Straße", true],
    ["pt", "Não há ação no coração de você", true],
    ["pl", "Zażółć gęślą jaźń", false],
    ["tr", "Işık, şeker, dağ, İstanbul", false],
    ["ru", "Съешь ещё этих мягких булок", false],
    ["uk", "Їжак і ґедзь", false],
    ["el", "Καλημέρα κόσμε", false],
    ["zh", "你好世界", false],
    ["ar", "مرحبا بالعالم", false],
    ["en", "The quick brown fox — “quoted” … €5", true],
    ["es", "¿Dónde está el niño? ¡Mañana!", true],
  ];

  it.each(samples)("%s sample matches what the encoder reads back", async (_name, sample) => {
    const readback = await renderAndReadBack(sample);
    expect(builtInFontsCanRender(sample)).toBe(readback === sample);
  });

  it.each(samples)("%s sample keeps its pinned answer", (_name, sample, expected) => {
    expect(builtInFontsCanRender(sample)).toBe(expected);
  });
});

describe("builtInFontsCanRender() character sweep", () => {
  // Every printable code point Windows-1252 carries, so the function can never
  // drift from the encoder: if it accepts a character, a real render reads it
  // back unchanged.
  const cp1252Specials = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
  const accepted: string[] = [];
  for (let code = 0x21; code <= 0x7e; code++) {
    accepted.push(String.fromCharCode(code));
  }
  for (let code = 0xa1; code <= 0xff; code++) {
    if (code === 0xad) continue; // soft hyphen crashes the real renderer's layout
    accepted.push(String.fromCharCode(code));
  }
  accepted.push(...cp1252Specials);

  it("is the same set the renderer round-trips", async () => {
    const offenders: string[] = [];
    for (const char of accepted) {
      expect(builtInFontsCanRender(char)).toBe(true);
      const readback = await renderAndReadBack(char);
      if (readback !== char) {
        offenders.push(`U+${char.codePointAt(0)?.toString(16).toUpperCase()} (${char})`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("documentPdfText()", () => {
  it("includes the title, the body text, decoded entities, and moved endnotes", () => {
    const html =
      '<p>Un caf&oacute; con <sup data-footnote="" data-footnote-content="Nota al pie" data-footnote-id="fn-1"></sup></p>';
    const text = documentPdfText(html, "Mi documento");

    expect(text).toContain("Mi documento");
    expect(text).toContain("Un cafó con");
    expect(text).toContain("Nota al pie");
  });
});

describe("endnote backlinks", () => {
  const html =
    '<p>Plain text<sup data-footnote="" data-footnote-content="A note" data-footnote-id="fn-1"></sup></p>';

  it("do not make English text with a footnote warn", () => {
    expect(builtInFontsCanRender(documentPdfText(html, "Title"))).toBe(true);
  });

  it("are left out of the real PDF, where the arrow would print as a copyright sign", async () => {
    const blob = await generateDocumentPdf(html, "Title");
    const readback = readBackText(new Uint8Array(await blob.arrayBuffer()));
    expect(readback).toContain("A note");
    expect(readback).not.toContain("©");
  });
});

describe("bookPdfText()", () => {
  it("includes book metadata and only included chapters", () => {
    const book = buildBook({
      title: "Título del libro",
      authorName: "Ana Pérez",
      subtitle: "Un subtítulo",
    });
    const included = buildChapter({
      title: "Capítulo incluido",
      content: "<p>Texto incluido</p>",
      isIncludedInExport: true,
    });
    const excluded = buildChapter({
      title: "Capítulo excluido",
      content: "<p>Zażółć gęślą jaźń</p>",
      isIncludedInExport: false,
    });

    const text = bookPdfText(book, [included, excluded]);

    expect(text).toContain("Título del libro");
    expect(text).toContain("Ana Pérez");
    expect(text).toContain("Un subtítulo");
    expect(text).toContain("Capítulo incluido");
    expect(text).toContain("Texto incluido");
    expect(text).not.toContain("Capítulo excluido");
    expect(text).not.toContain("Zażółć");
  });

  it("skips the title, subtitle, and author when a cover image replaces them", () => {
    const book = buildBook({
      title: "Zażółć",
      authorName: "Gęślą",
      subtitle: "Jaźń",
      coverImagePath: "data:image/png;base64,AA==",
    });

    expect(builtInFontsCanRender(bookPdfText(book, []))).toBe(true);
  });
});

describe("hyphenateWord()", () => {
  it("leaves a short Latin word whole", () => {
    expect(hyphenateWord("Zażółć")).toEqual(["Zażółć"]);
  });

  it("chunks a long Latin word exactly as before", () => {
    expect(hyphenateWord("a".repeat(30))).toEqual(["a".repeat(16), "a".repeat(14)]);
  });

  it("breaks a Han run after every character", () => {
    expect(hyphenateWord("你好")).toEqual(["你", "", "好", ""]);
  });

  it("breaks a kana run after every character", () => {
    expect(hyphenateWord("かな")).toEqual(["か", "", "な", ""]);
    expect(hyphenateWord("カナ")).toEqual(["カ", "", "ナ", ""]);
  });
});
