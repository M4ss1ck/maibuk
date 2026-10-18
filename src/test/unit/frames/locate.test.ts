import { beforeEach, describe, expect, it, vi } from "vitest";
import { type LocateStep, locateAll, serializableName } from "@/test/support/frames/locate";

const mount = (html: string) => {
  document.body.innerHTML = html;
};
const byId = (id: string): Element => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`no #${id} in fixture`);
  return el;
};

beforeEach(() => {
  mount("");
});

describe("locateAll", () => {
  it("chains a grid to its row by name, substring and case-insensitive by default", () => {
    mount(`
      <div role="grid" aria-label="Books">
        <div role="row" id="r1">Harbour Lights</div>
        <div role="row" id="r2">Night Log</div>
      </div>
      <div role="grid" aria-label="Chapters">
        <div role="row" id="other">Harbour Lights</div>
      </div>`);
    const grid: LocateStep = { kind: "role", role: "grid", name: "Books" };
    expect(locateAll([grid, { kind: "role", role: "row", name: "harbour" }])).toEqual([byId("r1")]);
    expect(locateAll([grid, { kind: "role", role: "row", name: "LIGHTS" }])).toEqual([byId("r1")]);
  });

  it("matches exact names only when exact is set", () => {
    mount(`<div role="grid"><div role="row" id="r1">Harbour Lights</div></div>`);
    const row = (name: string, exact: boolean): LocateStep => ({
      kind: "role",
      role: "row",
      name,
      exact,
    });
    expect(locateAll([row("Harbour Lights", true)])).toEqual([byId("r1")]);
    expect(locateAll([row("Harbour", true)])).toEqual([]);
    expect(locateAll([row("Harbour", false)])).toEqual([byId("r1")]);
  });

  it("matches a regex name with ^Log 1\\b but not Log 10", () => {
    mount(`
      <div role="grid" aria-label="Chapters">
        <div role="row" id="l1">Log 1: Opening</div>
        <div role="row" id="l10">Log 10: Ending</div>
      </div>`);
    expect(/^Log 1\b/.test("Log 10: Ending")).toBe(false);
    const steps: LocateStep[] = [
      { kind: "role", role: "grid", name: "Chapters" },
      { kind: "role", role: "row", name: serializableName(/^Log 1\b/) },
    ];
    expect(locateAll(steps)).toEqual([byId("l1")]);
    expect(locateAll(steps)).not.toContain(byId("l10"));
  });

  it("filters on aria-selected with selected true and false", () => {
    mount(`
      <div role="grid">
        <div role="row" id="r1" aria-selected="false">One</div>
        <div role="row" id="r2" aria-selected="true">Two</div>
      </div>`);
    expect(locateAll([{ kind: "role", role: "row", selected: true }])).toEqual([byId("r2")]);
    expect(locateAll([{ kind: "role", role: "row", selected: false }])).toEqual([byId("r1")]);
  });

  it("keeps only the first match with first()", () => {
    mount(`
      <div role="grid">
        <div role="row" id="r1">One</div>
        <div role="row" id="r2">Two</div>
      </div>`);
    expect(locateAll([{ kind: "role", role: "row" }, { kind: "first" }])).toEqual([byId("r1")]);
  });

  it("filters headings by level, from the tag or from aria-level", () => {
    mount(`
      <h1>Settings</h1>
      <h2>General</h2>
      <h2 role="heading" aria-level="3">Deep</h2>
      <div role="heading" aria-level="2">Appearance</div>`);
    const level2 = locateAll([{ kind: "role", role: "heading", level: 2 }]);
    expect(level2.map((el) => el.textContent)).toEqual(["General", "Appearance"]);
    expect(
      locateAll([{ kind: "role", role: "heading", name: "Settings", level: 1, exact: true }])
    ).toEqual([document.querySelector("h1")]);
  });

  it("names an element from aria-labelledby, concatenating the referenced text", () => {
    mount(`
      <span id="a">Save</span><span id="b">draft</span>
      <button id="btn" aria-labelledby="a b">x</button>
      <button id="plain">Other</button>`);
    expect(locateAll([{ kind: "role", role: "button", name: "Save draft", exact: true }])).toEqual([
      byId("btn"),
    ]);
  });

  it("excludes aria-hidden, hidden and display:none subtrees from role matches", () => {
    mount(`
      <div aria-hidden="true"><button id="h1">Hidden</button></div>
      <div hidden><button id="h2">Hidden two</button></div>
      <button id="h3" style="display:none">Css hidden</button>
      <button id="shown">Shown</button>`);
    expect(locateAll([{ kind: "role", role: "button" }])).toEqual([byId("shown")]);
    // CSS locators do not filter by accessibility, as in Playwright.
    expect(locateAll([{ kind: "css", selector: "#h1" }])).toEqual([byId("h1")]);
  });

  it("matches text exactly, returning the innermost element", () => {
    mount(`
      <div id="n1"><span id="s1">Node 1</span></div>
      <div id="n10"><span id="s10">Node 10</span></div>`);
    expect(locateAll([{ kind: "text", text: "Node 1", exact: true }])).toEqual([byId("s1")]);
    expect(locateAll([{ kind: "text", text: "Node 1" }])).toEqual([byId("s1"), byId("s10")]);
  });

  it("names a contenteditable textbox from its aria-label", () => {
    mount(`
      <div class="editor">
        <div class="ProseMirror" contenteditable="true" aria-label="Text of Long Chapter" id="ed">
          <p>Rain</p>
        </div>
      </div>
      <div contenteditable="true" role="region" aria-label="Text of Other">x</div>`);
    expect(
      locateAll([{ kind: "role", role: "textbox", name: "Text of Long Chapter", exact: true }])
    ).toEqual([byId("ed")]);
    expect(
      locateAll([
        { kind: "css", selector: ".editor" },
        { kind: "role", role: "textbox", name: "Text of " },
      ])
    ).toEqual([byId("ed")]);
  });

  it("finds a searchbox inside a dialog and ignores one outside it", () => {
    mount(`
      <input type="search" aria-label="Find by name" id="outside">
      <dialog open id="dlg"><input type="search" aria-label="Find by name" id="find"></dialog>`);
    expect(locateAll([{ kind: "role", role: "dialog" }])).toEqual([byId("dlg")]);
    expect(
      locateAll([
        { kind: "role", role: "dialog" },
        { kind: "role", role: "searchbox", name: "Find by name", exact: true },
      ])
    ).toEqual([byId("find")]);
    expect(locateAll([{ kind: "role", role: "searchbox" }])).toHaveLength(2);
  });

  it("chains a css step into a role step, scoped to the css match", () => {
    mount(`
      <div class="pane">
        <ul role="listbox" aria-label="Primary navigation">
          <li role="option" id="opt-books">Books</li>
          <li role="option" id="opt-notes">Notes</li>
        </ul>
      </div>
      <ul role="listbox" aria-label="Other">
        <li role="option" id="outside">Books</li>
      </ul>`);
    expect(
      locateAll([
        { kind: "css", selector: ".pane" },
        { kind: "role", role: "listbox", name: "Primary navigation", exact: true },
        { kind: "role", role: "option", name: serializableName(/^Books/) },
      ])
    ).toEqual([byId("opt-books")]);
  });

  it("dedups elements reached through overlapping scopes", () => {
    mount(`<div class="wrap"><div class="wrap"><div role="row" id="x">A</div></div></div>`);
    expect(
      locateAll([
        { kind: "css", selector: ".wrap" },
        { kind: "role", role: "row" },
      ])
    ).toEqual([byId("x")]);
  });

  it("keeps only the visible matches with visible()", () => {
    mount(`<button id="v1">Save</button><button id="v2">Save</button>`);
    const visibleButton = byId("v2");
    // jsdom has no layout: give one button a box, leave the other empty.
    vi.spyOn(visibleButton, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 40, 20));
    const save: LocateStep = { kind: "role", role: "button", name: "Save", exact: true };
    expect(locateAll([save])).toHaveLength(2);
    expect(locateAll([save, { kind: "visible" }])).toEqual([visibleButton]);
    expect(locateAll([save, { kind: "visible" }, { kind: "first" }])).toEqual([visibleButton]);
  });

  it("counts a display: contents element visible when a child has a box (the palette dialog)", () => {
    mount(
      `<section role="dialog" id="d" style="display: contents"><input id="i" type="search" aria-label="Find by name"></section>` +
        `<section role="dialog" id="e" style="display: contents"><span>empty</span></section>`
    );
    // jsdom has no layout: only the first dialog's child gets a box.
    vi.spyOn(byId("i"), "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 200, 30));
    const dialog: LocateStep = { kind: "role", role: "dialog" };
    expect(locateAll([dialog, { kind: "visible" }])).toEqual([byId("d")]);
  });

  it("is self-contained: the serialized source runs without the module scope", () => {
    mount(`
      <div role="grid" aria-label="Books"><div role="row" id="r1">Harbour Lights</div></div>`);
    const run: typeof locateAll = new Function(`return ${locateAll.toString()}`)();
    const steps: LocateStep[] = [
      { kind: "role", role: "grid", name: "Books" },
      { kind: "role", role: "row", name: "Harbour" },
    ];
    expect(run(steps)).toEqual([byId("r1")]);
    expect(run(steps)).toEqual(locateAll(steps));
  });
});

describe("serializableName", () => {
  it("passes strings and undefined through and turns a RegExp into source and flags", () => {
    expect(serializableName(undefined)).toBeUndefined();
    expect(serializableName("Books")).toBe("Books");
    expect(serializableName(/^Log 1\b/i)).toEqual({ source: "^Log 1\\b", flags: "i" });
  });
});
