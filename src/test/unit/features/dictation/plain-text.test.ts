import { describe, expect, it } from "vitest";
import {
  dictationFieldKind,
  EMPTY_FIELD_HISTORY,
  isVerbatimField,
  MAX_DICTATED_SENTENCES,
  planFieldEdits,
  planFieldScratch,
  recordFieldInsert,
} from "@/features/dictation/plain-text";
import type { DictationEdit } from "@/features/dictation/router";

function checkInvariant(
  original: string,
  plan: { from: number; to: number; text: string; value: string }
) {
  expect(original.slice(0, plan.from) + plan.text + original.slice(plan.to)).toBe(plan.value);
}

describe("dictationFieldKind", () => {
  it("accepts text-like inputs, textarea, and password", () => {
    for (const type of ["", "text", "search", "email", "url"]) {
      const el = document.createElement("input");
      if (type === "") el.removeAttribute("type");
      else el.setAttribute("type", type);
      document.body.appendChild(el);
      expect(dictationFieldKind(el)).toBe("text");
      el.remove();
    }
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    expect(dictationFieldKind(textarea)).toBe("multiline");
    textarea.remove();
    const secret = document.createElement("input");
    secret.setAttribute("type", "password");
    document.body.appendChild(secret);
    expect(dictationFieldKind(secret)).toBe("secret");
    secret.remove();
  });

  it("rejects number/hidden/checkbox and other types", () => {
    for (const type of ["number", "hidden", "checkbox", "date", "tel"]) {
      const el = document.createElement("input");
      el.setAttribute("type", type);
      document.body.appendChild(el);
      expect(dictationFieldKind(el)).toBeNull();
      el.remove();
    }
  });

  it("rejects disabled, readOnly, and data-dictation=off", () => {
    const disabled = document.createElement("input");
    disabled.setAttribute("type", "text");
    disabled.disabled = true;
    document.body.appendChild(disabled);
    expect(dictationFieldKind(disabled)).toBeNull();
    disabled.remove();
    const ro = document.createElement("textarea");
    ro.readOnly = true;
    document.body.appendChild(ro);
    expect(dictationFieldKind(ro)).toBeNull();
    ro.remove();
    const off = document.createElement("input");
    off.setAttribute("type", "text");
    off.setAttribute("data-dictation", "off");
    document.body.appendChild(off);
    expect(dictationFieldKind(off)).toBeNull();
    off.remove();
    const wrap = document.createElement("div");
    wrap.setAttribute("data-dictation", "off");
    const inner = document.createElement("input");
    inner.setAttribute("type", "text");
    wrap.appendChild(inner);
    document.body.appendChild(wrap);
    expect(dictationFieldKind(inner)).toBeNull();
    wrap.remove();
  });

  it("rejects contenteditable divs", () => {
    const div = document.createElement("div");
    div.contentEditable = "true";
    document.body.appendChild(div);
    expect(dictationFieldKind(div)).toBeNull();
    div.remove();
    expect(dictationFieldKind(null)).toBeNull();
  });

  it("detects verbatim fields on the element and ancestors", () => {
    const el = document.createElement("input");
    el.setAttribute("data-dictation", "verbatim");
    document.body.appendChild(el);
    expect(isVerbatimField(el)).toBe(true);
    el.remove();
    const wrap = document.createElement("div");
    wrap.setAttribute("data-dictation", "verbatim");
    const inner = document.createElement("input");
    wrap.appendChild(inner);
    document.body.appendChild(wrap);
    expect(isVerbatimField(inner)).toBe(true);
    wrap.remove();
    const plain = document.createElement("input");
    document.body.appendChild(plain);
    expect(isVerbatimField(plain)).toBe(false);
    plain.remove();
  });
});

describe("planFieldEdits", () => {
  it("dictates into an empty field", () => {
    const plan = planFieldEdits("", 0, 0, [{ kind: "text", text: "My book" }], false);
    expect(plan.value).toBe("My book");
    expect(plan.from).toBe(0);
    expect(plan.caret).toBe("My book".length);
    expect(plan.changed).toBe(true);
    expect(plan.dictatedStart).toBe(0);
    checkInvariant("", plan);
  });

  it("adds a separating space at the end", () => {
    const plan = planFieldEdits("Hello", 5, 5, [{ kind: "text", text: "world" }], false);
    expect(plan.value).toBe("Hello world");
    checkInvariant("Hello", plan);
  });

  it("trims a trailing space before a closing mark", () => {
    const plan = planFieldEdits("Hello ", 6, 6, [{ kind: "text", text: ", world" }], false);
    // "," is a closing mark: the space is trimmed and no leading space added.
    expect(plan.value).toBe("Hello, world");
    checkInvariant("Hello ", plan);
  });

  it("replaces a selection", () => {
    const plan = planFieldEdits("Hola gente", 5, 10, [{ kind: "text", text: "mundo" }], false);
    expect(plan.value).toBe("Hola mundo");
    checkInvariant("Hola gente", plan);
  });

  it("inserts in the middle keeping the tail", () => {
    const plan = planFieldEdits("Hello world", 5, 5, [{ kind: "text", text: "brave" }], false);
    expect(plan.value).toBe("Hello brave world");
    checkInvariant("Hello world", plan);
  });

  it("ignores layout edits in single-line fields but keeps text", () => {
    const edits: DictationEdit[] = [
      { kind: "text", text: "hi" },
      { kind: "paragraph" },
      { kind: "text", text: "there" },
      { kind: "line_break" },
      { kind: "list_item" },
      { kind: "text", text: "end" },
    ];
    const plan = planFieldEdits("", 0, 0, edits, false);
    expect(plan.layoutIgnored).toBe(true);
    expect(plan.value).toBe("hi there end");
    checkInvariant("", plan);
  });

  it("inserts newlines and list marks in multiline fields", () => {
    const para = planFieldEdits("a", 1, 1, [{ kind: "paragraph" }], true);
    expect(para.value).toBe("a\n");
    expect(para.layoutIgnored).toBe(false);
    const item = planFieldEdits("a", 1, 1, [{ kind: "list_item" }], true);
    expect(item.value).toBe("a\n- ");
    const emptyItem = planFieldEdits("", 0, 0, [{ kind: "list_item" }], true);
    expect(emptyItem.value).toBe("- ");
  });

  it("moves a Spanish opener to the sentence start and capitalizes", () => {
    const plan = planFieldEdits(
      "Hola. como estas",
      16,
      16,
      [
        { kind: "opener", mark: "¿" },
        { kind: "text", text: "?" },
      ],
      true
    );
    expect(plan.value).toBe("Hola. ¿Como estas?");
    checkInvariant("Hola. como estas", plan);
  });

  it("reports no change for no-op edits", () => {
    const plan = planFieldEdits("Hello", 5, 5, [], false);
    expect(plan.changed).toBe(false);
    expect(plan.value).toBe("Hello");
    checkInvariant("Hello", plan);
  });
});

describe("field history and scratch", () => {
  function dictate(
    history: typeof EMPTY_FIELD_HISTORY,
    value: string,
    edits: DictationEdit[],
    multiline = false
  ) {
    const sel = value.length;
    const plan = planFieldEdits(value, sel, sel, edits, multiline);
    return { plan, next: recordFieldInsert(history, value, plan) };
  }

  it("scratches two dictated sentences in order then reports empty", () => {
    let history = EMPTY_FIELD_HISTORY;
    const first = dictate(history, "", [{ kind: "text", text: "Hello world." }]);
    history = first.next;
    let value = first.plan.value;
    expect(value).toBe("Hello world.");
    const second = dictate(history, value, [{ kind: "text", text: "Second one." }]);
    history = second.next;
    value = second.plan.value;
    expect(value).toBe("Hello world. Second one.");
    let scratch = planFieldScratch(history, value);
    expect(scratch.outcome).toBe("removed");
    if (scratch.outcome !== "removed") throw new Error("expected removal");
    expect(scratch.value).toBe("Hello world.");
    history = scratch.history;
    scratch = planFieldScratch(history, scratch.value);
    expect(scratch.outcome).toBe("removed");
    if (scratch.outcome !== "removed") throw new Error("expected removal");
    expect(scratch.value).toBe("");
    history = scratch.history;
    expect(planFieldScratch(history, scratch.value).outcome).toBe("empty");
  });

  it("merges unended lines and scratches line by line", () => {
    let history = EMPTY_FIELD_HISTORY;
    const first = dictate(history, "", [{ kind: "text", text: "one two" }]);
    history = first.next;
    expect(history.entries).toHaveLength(1);
    const second = dictate(history, first.plan.value, [{ kind: "text", text: "three" }]);
    history = second.next;
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0].lines).toHaveLength(2);
    let scratch = planFieldScratch(history, second.plan.value);
    expect(scratch.outcome).toBe("removed");
    if (scratch.outcome !== "removed") throw new Error("expected removal");
    expect(scratch.value).toBe("one two");
    history = scratch.history;
    scratch = planFieldScratch(history, scratch.value);
    expect(scratch.outcome).toBe("removed");
    if (scratch.outcome !== "removed") throw new Error("expected removal");
    expect(scratch.value).toBe("");
  });

  it("refuses past new lines after an author edit between lines", () => {
    let history = EMPTY_FIELD_HISTORY;
    const first = dictate(history, "", [{ kind: "text", text: "one two" }]);
    history = first.next;
    const edited = `${first.plan.value}X`;
    const second = dictate(history, edited, [{ kind: "text", text: "three" }], false);
    // recordFieldInsert saw valueBefore !== expected and dropped old entries.
    history = second.next;
    const scratch = planFieldScratch(history, second.plan.value);
    expect(scratch.outcome).toBe("removed");
    if (scratch.outcome !== "removed") throw new Error("expected removal");
    history = scratch.history;
    expect(planFieldScratch(history, scratch.value).outcome).toBe("refused");
  });

  it("never scratches earlier sentences after a line replaced a selection", () => {
    const first = dictate(EMPTY_FIELD_HISTORY, "", [{ kind: "text", text: "Hello world." }]);
    const value = first.plan.value;
    const plan = planFieldEdits(value, 6, 11, [{ kind: "text", text: "there" }], false);
    expect(plan.value).toBe("Hello there.");
    let history = recordFieldInsert(first.next, value, plan);
    const scratch = planFieldScratch(history, plan.value);
    expect(scratch.outcome).toBe("removed");
    if (scratch.outcome !== "removed") throw new Error("expected removal");
    expect(scratch.value).toBe("Hello .");
    history = scratch.history;
    expect(planFieldScratch(history, scratch.value).outcome).toBe("refused");
  });

  it("refuses when the author edited after the last line", () => {
    let history = EMPTY_FIELD_HISTORY;
    const first = dictate(history, "", [{ kind: "text", text: "Hello world." }]);
    history = first.next;
    const tampered = `${first.plan.value}X`;
    const scratch = planFieldScratch(history, tampered);
    expect(scratch.outcome).toBe("refused");
    expect(tampered).toBe("Hello world.X");
  });

  it("caps history at MAX_DICTATED_SENTENCES", () => {
    let history = EMPTY_FIELD_HISTORY;
    let value = "";
    for (let i = 0; i < MAX_DICTATED_SENTENCES + 3; i += 1) {
      const r = dictate(history, value, [{ kind: "text", text: `S${i}.` }]);
      history = r.next;
      value = r.plan.value;
    }
    expect(history.entries).toHaveLength(MAX_DICTATED_SENTENCES);
    expect(history.expected).toBe(value);
  });

  it("removes the whole sentence including its opener", () => {
    let history = EMPTY_FIELD_HISTORY;
    const first = dictate(history, "", [{ kind: "text", text: "hola como estas" }]);
    history = first.next;
    const second = dictate(
      history,
      first.plan.value,
      [
        { kind: "opener", mark: "¿" },
        { kind: "text", text: "?" },
      ],
      true
    );
    expect(second.plan.value).toBe("¿Hola como estas?");
    history = second.next;
    const scratch = planFieldScratch(history, second.plan.value);
    expect(scratch.outcome).toBe("removed");
    if (scratch.outcome !== "removed") throw new Error("expected removal");
    expect(scratch.value).toBe("");
    expect(scratch.value).not.toContain("¿");
  });
});
