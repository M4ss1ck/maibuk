import { Schema } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { classifyTransaction } from "@/features/metrics/classifier";
import type { WritingMetricPayload } from "@/features/metrics/types";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0],
    },
    text: { group: "inline" },
  },
  marks: {
    strong: {
      parseDOM: [{ tag: "strong" }],
      toDOM: () => ["strong", 0],
    },
  },
});

function docFromText(text: string) {
  return schema.node("doc", null, [
    schema.node("paragraph", null, text ? [schema.text(text)] : undefined),
  ]);
}

function stateFromText(text: string) {
  return EditorState.create({ schema, doc: docFromText(text) });
}

function classify(transaction: Transaction) {
  return classifyTransaction(transaction, {
    workId: "book-1",
    chapterId: "chapter-1",
    deviceId: "device-1",
    now: new Date("2026-05-23T12:34:56.789Z"),
  });
}

function netWords(events: ReturnType<typeof classifyTransaction>): number {
  return events.reduce((sum, event) => {
    const words = (event.payload as WritingMetricPayload).words;
    if (event.eventType === "writing.deleted") return sum - words;
    if (event.eventType === "writing.typed" || event.eventType === "writing.pasted") {
      return sum + words;
    }
    return sum;
  }, 0);
}

describe("classifyTransaction()", () => {
  it("skips selection-only and programmatic transactions", () => {
    const tr = stateFromText("hello").tr.setMeta("metrics:programmatic", true);
    tr.insertText(" quiet", 6);

    expect(classify(tr)).toEqual([]);
    expect(classify(stateFromText("hello").tr)).toEqual([]);
  });

  it("emits one event per category when one transaction has multiple replace steps and mark-only steps", () => {
    const state = stateFromText("hello world");
    const tr = state.tr
      .insertText("bright draft", 7)
      .delete(1, 6)
      .addMark(1, 6, schema.marks.strong.create())
      .removeMark(1, 6, schema.marks.strong);

    const events = classify(tr);

    expect(events.map((event) => event.eventType)).toEqual(["writing.deleted", "writing.typed"]);
    expect(events.map((event) => (event.payload as WritingMetricPayload).words)).toEqual([1, 2]);
  });

  it("reads removed text from transaction.docs[i] for multi-step transactions", () => {
    const state = stateFromText("");
    const tr = state.tr.insertText("alpha beta", 1).delete(1, 6);

    const events = classify(tr);

    expect(events.map((event) => event.eventType)).toEqual(["writing.deleted", "writing.typed"]);
    expect(events.map((event) => (event.payload as WritingMetricPayload).words)).toEqual([1, 2]);
  });

  it("counts word deltas instead of letters during character-by-character typing", () => {
    let state = stateFromText("");
    const events: ReturnType<typeof classifyTransaction> = [];

    for (const char of "new bright idea") {
      const tr = state.tr.insertText(char, state.doc.textContent.length + 1);
      events.push(...classify(tr));
      state = state.apply(tr);
    }

    expect(netWords(events)).toBe(3);
  });

  it("classifies paste before history metadata and undo of paste as deletion", () => {
    const paste = stateFromText("")
      .tr.insertText("alpha beta", 1)
      .setMeta("metrics:source", "paste");

    expect(classify(paste).map((event) => event.eventType)).toEqual(["writing.pasted"]);

    const undoPaste = stateFromText("alpha beta").tr.delete(1, 11).setMeta("history$", {});

    const undoEvents = classify(undoPaste);
    expect(undoEvents.map((event) => event.eventType)).toEqual(["writing.deleted"]);
    expect((undoEvents[0].payload as WritingMetricPayload).words).toBe(2);
  });
});
