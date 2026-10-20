import { Editor } from "@tiptap/core";
import Typography from "@tiptap/extension-typography";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";

import { AutoClose } from "@/components/editor/extensions/AutoClose";
import { CustomCode } from "@/components/editor/extensions/CustomCode";
import {
  isSpanish,
  OpeningMarks,
  openingMarkOffset,
} from "@/components/editor/extensions/OpeningMarks";

/** Where the opener lands, drawn into the text as `|`, or null. */
function placed(before: string): string | null {
  const offset = openingMarkOffset(before);
  return offset === null ? null : `${before.slice(0, offset)}|${before.slice(offset)}`;
}

describe("openingMarkOffset()", () => {
  it.each([
    ["Vienes", "|Vienes"],
    ["  Vienes", "  |Vienes"],
    ["Hola. Vienes", "Hola. |Vienes"],
    ["Si vienes, me avisas", "Si vienes, |me avisas"],
    ["Me dijo: vienes", "Me dijo: |vienes"],
    ["Uno; dos", "Uno; |dos"],
    ["Bien… y tú", "Bien… |y tú"],
    ["Qué tal? Y tú", "Qué tal? |Y tú"],
    ["Ya! Y ahora", "Ya! |Y ahora"],
    ["Dijo «vienes", "Dijo «|vienes"],
    ["Dijo “vienes", "Dijo “|vienes"],
    ["—Vienes", "—|Vienes"],
    ["Ella (vienes", "Ella (|vienes"],
    ["Uno\nDos", "Uno\n|Dos"],
    ["Hola. Vienes", "Hola. |Vienes"],
  ])("places the opener in %j", (before, expected) => {
    expect(placed(before)).toBe(expected);
  });

  it.each([
    ["(ya) vienes", "|(ya) vienes"],
    ["Dijo [algo] y te vas", "|Dijo [algo] y te vas"],
    ["Dijo «hola» y te vas", "|Dijo «hola» y te vas"],
    ["Dijo “hola” y te vas", "|Dijo “hola” y te vas"],
    ['Dijo "hola" y te vas', '|Dijo "hola" y te vas'],
    ['Dijo "vienes', 'Dijo "|vienes'],
    ['Leí "uno" y "dos', 'Leí "uno" y "|dos'],
    ["Ella (y él) vienen", "|Ella (y él) vienen"],
    ["Ella (ya (casi) vienes", "Ella (|ya (casi) vienes"],
  ])("skips a quote or bracket that is already closed in %j", (before, expected) => {
    expect(placed(before)).toBe(expected);
  });

  it("treats a vocative comma as the start of the question", () => {
    expect(placed("Juan, vienes")).toBe("Juan, |vienes");
  });

  it("does not split a number at its decimal point or comma", () => {
    expect(placed("Cuesta 3.5 euros")).toBe("|Cuesta 3.5 euros");
    expect(placed("Cuesta 3,5 euros")).toBe("|Cuesta 3,5 euros");
  });

  it("works the same for an exclamation", () => {
    expect(placed("Ya está. Qué bien")).toBe("Ya está. |Qué bien");
  });

  it.each([
    ["", "an empty paragraph"],
    ["   ", "only spaces"],
    ["Hola. ", "nothing after the boundary"],
    ["Hola, ", "nothing after a comma"],
    ["Hola. «", "only punctuation after the boundary"],
  ])("returns null for %j (%s)", (before) => {
    expect(openingMarkOffset(before)).toBeNull();
  });

  it.each([
    "¿Vienes",
    "Si vienes ¿me avisas",
    "¡Qué dices",
    "Hola. ¿Vienes",
  ])("leaves %j alone: it already has an opening mark", (before) => {
    expect(openingMarkOffset(before)).toBeNull();
  });

  describe("runs of closing marks", () => {
    it.each([
      ["¿Qué haces?", "!", "|¿Qué haces?"],
      ["¡Qué bien!", "!", "|¡Qué bien!"],
      ["¡¡Qué bien!!", "!", "|¡¡Qué bien!!"],
      ["¡Qué haces!", "?", "|¡Qué haces!"],
      ["Hola. ¿Qué haces?", "!", "Hola. |¿Qué haces?"],
      ["Si vienes, ¿me avisas?", "?", "Si vienes, |¿me avisas?"],
    ])("extends %j when %s is typed", (before, _closer, expected) => {
      expect(placed(before)).toBe(expected);
    });

    it("extends a ¿ the author typed", () => {
      expect(placed("¿Vienes?")).toBe("|¿Vienes?");
    });

    it.each([
      ["Qué haces?", "a closer with no opener"],
      ["¿Qué haces??", "more closers than openers"],
      ["¿¡Qué haces?", "more openers than closers"],
      ["?", "a run with nothing before it"],
    ])("leaves %j alone (%s)", (before) => {
      expect(openingMarkOffset(before)).toBeNull();
    });
  });
});

describe("isSpanish()", () => {
  it.each(["es", "ES", "es-MX", "es_AR", "es-419"])("accepts %s", (code) => {
    expect(isSpanish(code)).toBe(true);
  });

  it.each(["en", "fr", "eu", "est", "", null, undefined])("rejects %s", (code) => {
    expect(isSpanish(code)).toBe(false);
  });
});

let editor: Editor | null = null;
let language: string | null = "es";

afterEach(() => {
  editor?.destroy();
  editor = null;
  language = "es";
});

function makeEditor(content: string, extra: Editor["options"]["extensions"] = []) {
  editor = new Editor({
    extensions: [
      StarterKit.configure({ code: false }),
      CustomCode,
      OpeningMarks.configure({ getLanguage: () => language }),
      ...extra,
    ],
    content,
  });
  editor.commands.focus("end");
  return editor;
}

/** Types like ProseMirror does: handleTextInput first, else the default insert. */
function type(target: Editor, text: string) {
  for (const char of text) {
    const { from, to } = target.state.selection;
    let handled = false;
    target.view.someProp("handleTextInput", (handler) => {
      handled = handler(target.view, from, to, char, () => target.state.tr) === true;
      return handled;
    });
    if (!handled) target.view.dispatch(target.state.tr.insertText(char, from, to));
  }
}

function pressBackspace(target: Editor) {
  const event = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true });
  let handled = false;
  target.view.someProp("handleKeyDown", (handler) => {
    handled = handler(target.view, event) === true;
    return handled;
  });
  return handled;
}

describe("OpeningMarks", () => {
  it("adds ¿ at the start of the question when ? is typed", () => {
    const target = makeEditor("<p>Hola. Vienes</p>");

    type(target, "?");

    expect(target.getText()).toBe("Hola. ¿Vienes?");
    expect(target.state.selection.from).toBe(target.state.doc.content.size - 1);
  });

  it("adds ¡ after a comma", () => {
    const target = makeEditor("<p>Si ganas, qué bien</p>");

    type(target, "!");

    expect(target.getText()).toBe("Si ganas, ¡qué bien!");
  });

  it("builds a mirrored run as closers are typed", () => {
    const target = makeEditor("<p>Qué haces</p>");

    type(target, "?!");

    expect(target.getText()).toBe("¡¿Qué haces?!");
  });

  it("builds ¡¡¡ for !!!", () => {
    const target = makeEditor("<p>Qué bien</p>");

    type(target, "!!!");

    expect(target.getText()).toBe("¡¡¡Qué bien!!!");
  });

  it("keeps typing after the question untouched", () => {
    const target = makeEditor("<p>Vienes</p>");

    type(target, "? Sí.");

    expect(target.getText()).toBe("¿Vienes? Sí.");
  });

  it("gives the opener the formatting of the text it opens", () => {
    const target = makeEditor("<p>Hola. <strong>Vienes</strong></p>");

    type(target, "?");

    expect(target.getHTML()).toBe("<p>Hola. <strong>¿Vienes?</strong></p>");
  });

  it("starts a question after a hard break", () => {
    const target = makeEditor("<p>Hola<br>Vienes</p>");

    type(target, "?");

    expect(target.getHTML()).toBe("<p>Hola<br>¿Vienes?</p>");
  });

  it("looks only at the paragraph with the caret", () => {
    const target = makeEditor("<p>Hola</p><p>Vienes</p>");

    type(target, "?");

    expect(target.getHTML()).toBe("<p>Hola</p><p>¿Vienes?</p>");
  });

  describe("undo", () => {
    it("Backspace right after removes only the opener", () => {
      const target = makeEditor("<p>Vienes</p>");
      type(target, "?");

      expect(pressBackspace(target)).toBe(true);

      expect(target.getText()).toBe("Vienes?");
      expect(target.state.selection.from).toBe(target.state.doc.content.size - 1);
    });

    it("Backspace after a run removes only the opener added last", () => {
      const target = makeEditor("<p>Qué haces</p>");
      type(target, "?!");

      pressBackspace(target);

      expect(target.getText()).toBe("¿Qué haces?!");
    });

    it("Backspace after further typing deletes normally", () => {
      const target = makeEditor("<p>Vienes</p>");
      type(target, "? ");

      expect(pressBackspace(target)).toBe(false);
      expect(target.getText()).toBe("¿Vienes? ");
    });

    it("Backspace after moving the caret deletes normally", () => {
      const target = makeEditor("<p>Vienes</p>");
      type(target, "?");
      target.commands.setTextSelection(3);

      expect(pressBackspace(target)).toBe(false);
      expect(target.getText()).toBe("¿Vienes?");
    });

    it("undo right after removes only the opener", () => {
      const target = makeEditor("<p></p>");
      type(target, "Vienes?");

      target.commands.undo();

      expect(target.getText()).toBe("Vienes?");
    });

    it("undo after further typing first removes that typing", () => {
      const target = makeEditor("<p></p>");
      type(target, "Vienes?");
      type(target, " Sí");

      target.commands.undo();

      expect(target.getText()).toBe("¿Vienes?");
    });
  });

  describe("does nothing", () => {
    it.each(["en", "fr", null])("in a %s editor", (code) => {
      language = code;
      const target = makeEditor("<p>Hola. Vienes</p>");

      type(target, "?");

      expect(target.getText()).toBe("Hola. Vienes?");
    });

    it("once the language changes away from Spanish", () => {
      const target = makeEditor("<p>Vienes</p>");
      language = "en";

      type(target, "?");

      expect(target.getText()).toBe("Vienes?");
    });

    it("in a code block", () => {
      const target = makeEditor("<pre><code>Vienes</code></pre>");
      target.commands.setTextSelection(7);

      type(target, "?");

      expect(target.getHTML()).toContain("<code>Vienes?</code>");
    });

    it("in inline code", () => {
      const target = makeEditor("<p>Hola <code>vienes ya</code></p>");
      target.commands.setTextSelection(12);

      type(target, "?");

      expect(target.getText()).toBe("Hola vienes? ya");
    });

    it("when a selection is replaced", () => {
      const target = makeEditor("<p>Vienes ya</p>");
      target.commands.setTextSelection({ from: 7, to: 10 });

      type(target, "?");

      expect(target.getText()).toBe("Vienes?");
    });

    it("for pasted text", () => {
      const target = makeEditor("<p>Vienes</p>");

      target.commands.insertContent("?");

      expect(target.getText()).toBe("Vienes?");
    });
  });

  it("leaves Auto-close pairs and Typography working beside it", () => {
    const target = makeEditor("<p></p>", [AutoClose, Typography]);

    type(target, "Dijo (vienes?");

    expect(target.getText()).toBe("Dijo (¿vienes?)");
  });
});
