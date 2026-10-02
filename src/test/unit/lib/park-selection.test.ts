import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parkInertSelection } from "@/lib/park-selection";

let editor: HTMLDivElement;
let label: HTMLParagraphElement;
let handle: HTMLButtonElement;

// jsdom moves the selection onto whatever takes focus, which browsers do not
// do for a button, so each test focuses first and selects after.
function select(node: Node, anchorOffset: number, focusOffset = anchorOffset) {
  document.getSelection()!.setBaseAndExtent(node, anchorOffset, node, focusOffset);
}

const selection = () => document.getSelection()!;
const editorText = () => editor.querySelector("p")!.firstChild!;

beforeEach(() => {
  // The editor and the label sit in inert content, as during a keyboard drag.
  document.body.innerHTML =
    '<section inert><div contenteditable="true"><p>Once upon a time</p></div>' +
    "<p>Chapters of the Book</p></section><button>Reorder</button>";
  editor = document.querySelector("div")!;
  label = document.querySelectorAll("p")[1] as HTMLParagraphElement;
  handle = document.querySelector("button")!;
  handle.focus();
});

afterEach(() => {
  selection().removeAllRanges();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("parkInertSelection()", () => {
  it("removes a caret left in an editor and never sets it back", () => {
    select(editorText(), 5);
    const setBaseAndExtent = vi.spyOn(Selection.prototype, "setBaseAndExtent");

    const end = parkInertSelection();
    expect(selection().rangeCount).toBe(0);
    end();

    expect(selection().rangeCount).toBe(0);
    expect(setBaseAndExtent).not.toHaveBeenCalled();
    expect(handle).toHaveFocus();
  });

  it("treats a selection reaching into an editor as the editor's", () => {
    selection().setBaseAndExtent(label.firstChild!, 0, editorText(), 4);

    parkInertSelection()();
    expect(selection().rangeCount).toBe(0);
  });

  it("puts a selection outside any editor back, a backward one backward", () => {
    const text = label.firstChild!;
    select(text, 9, 2);

    const end = parkInertSelection();
    expect(selection().rangeCount).toBe(0);
    end();

    expect(selection().anchorNode).toBe(text);
    expect([selection().anchorOffset, selection().focusOffset]).toEqual([9, 2]);
  });

  it("puts it back over a caret a focus change left on the focused control", () => {
    select(label.firstChild!, 0, 8);
    const end = parkInertSelection();
    select(handle, 0);
    end();
    expect(selection().anchorNode).toBe(label.firstChild);
    expect(selection().focusOffset).toBe(8);
  });

  it("keeps text the author selected while parked", () => {
    select(label.firstChild!, 0, 8);
    const end = parkInertSelection();
    const other = document.createElement("p");
    other.textContent = "Arrival";
    document.body.append(other);
    select(other.firstChild!, 0, 3);
    end();
    expect(selection().anchorNode).toBe(other.firstChild);
  });

  it("keeps a caret the author placed in an editor while parked", () => {
    select(label.firstChild!, 0, 8);
    const end = parkInertSelection();
    select(editorText(), 2);
    end();
    expect(selection().anchorNode).toBe(editorText());
    expect(selection().anchorOffset).toBe(2);
  });

  it("puts nothing back when the text left the document", () => {
    select(label.firstChild!, 0, 8);
    const end = parkInertSelection();
    label.remove();
    end();
    expect(selection().rangeCount).toBe(0);
  });

  it("puts nothing back when the saved offsets no longer fit", () => {
    select(label.firstChild!, 0, 8);
    const end = parkInertSelection();
    label.firstChild!.textContent = "Ch";
    expect(() => end()).not.toThrow();
    expect(selection().rangeCount).toBe(0);
  });

  it("puts it back once", () => {
    select(label.firstChild!, 0, 8);
    const end = parkInertSelection();
    end();
    selection().removeAllRanges();
    end();
    expect(selection().rangeCount).toBe(0);
  });

  it("does nothing without a selection", () => {
    selection().removeAllRanges();
    const end = parkInertSelection();
    end();
    expect(selection().rangeCount).toBe(0);
  });

  it("leaves a selection outside inert content alone", () => {
    document.querySelector("section")!.removeAttribute("inert");
    select(editorText(), 5);
    parkInertSelection()();
    expect(selection().anchorNode).toBe(editorText());
    expect(selection().anchorOffset).toBe(5);
  });

  it("does not count contenteditable=false as an editor", () => {
    editor.setAttribute("contenteditable", "false");
    select(editorText(), 1, 4);
    parkInertSelection()();
    expect(selection().anchorNode).toBe(editorText());
  });
});
