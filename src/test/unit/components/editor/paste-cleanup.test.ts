import { describe, expect, it } from "vitest";
import { cleanPastedHtml } from "../../../../components/editor/paste-cleanup";
import { PASTE_CLEANUP_PRESETS } from "../../../../features/settings/types";
import type {
  PasteCleanupOptions,
  PasteCleanupRule,
  PasteCleanupSettings,
  PasteRuleAction,
  PasteRuleTarget,
} from "../../../../features/settings/types";

// --- Helpers ---

function settings(
  overrides: Partial<PasteCleanupSettings> = {},
): PasteCleanupSettings {
  return {
    preset: "keepAll",
    options: { ...PASTE_CLEANUP_PRESETS.keepAll },
    rules: [],
    ...overrides,
  };
}

function withOptions(
  partial: Partial<PasteCleanupOptions>,
): PasteCleanupSettings {
  return settings({
    options: { ...PASTE_CLEANUP_PRESETS.keepAll, ...partial },
  });
}

let ruleCounter = 0;
function rule(overrides: Partial<PasteCleanupRule> = {}): PasteCleanupRule {
  ruleCounter += 1;
  return {
    id: `r${ruleCounter}`,
    enabled: true,
    label: "",
    target: "tag" as PasteRuleTarget,
    value: "",
    action: "delete" as PasteRuleAction,
    ...overrides,
  };
}

function parse(html: string): HTMLElement {
  return new DOMParser().parseFromString(html, "text/html").body;
}

function clean(html: string, s: PasteCleanupSettings): HTMLElement {
  return parse(cleanPastedHtml(html, s));
}

// --- Group 1: hygiene (runs under every preset) ---

describe("cleanPastedHtml() — hygiene", () => {
  it("unwraps a Google Docs <b> wrapper", () => {
    const out = clean(
      '<b id="docs-internal-guid-abc"><p>Hi</p></b>',
      settings(),
    );
    expect(out.querySelector("b")).toBeNull();
    expect(out.querySelectorAll("p")).toHaveLength(1);
    expect(out.textContent).toBe("Hi");
  });

  it("unwraps a Google Docs <span> wrapper", () => {
    const out = clean(
      '<span id="docs-internal-guid-xyz"><p>Body</p></span>',
      settings(),
    );
    expect(out.querySelector("span")).toBeNull();
    expect(out.textContent).toBe("Body");
  });

  it("removes Word <o:p> namespaced elements", () => {
    const out = clean("<p>Hello<o:p></o:p></p>", settings());
    expect(out.querySelector("o\\:p")).toBeNull();
    expect(out.textContent).toBe("Hello");
  });

  it("removes HTML comments (Word conditional comments)", () => {
    const out = clean("<p>A<!--[if gte mso 9]><xml/><![endif]-->B</p>", settings());
    expect(out.textContent).toBe("AB");
  });

  it("strips mso- style declarations and Mso classes", () => {
    const out = clean(
      '<p class="MsoNormal" style="mso-pagination:none;color:red">x</p>',
      settings(),
    );
    const p = out.querySelector("p");
    expect(p?.hasAttribute("class")).toBe(false);
    expect(p?.getAttribute("style")?.toLowerCase()).not.toContain("mso-");
  });

  it("removes docs-/kix- ids, classes and data attributes", () => {
    const out = clean(
      '<p id="docs-x" class="kix-line" data-kix-id="1" data-x="keep">t</p>',
      settings(),
    );
    const p = out.querySelector("p");
    expect(p?.hasAttribute("id")).toBe(false);
    expect(p?.hasAttribute("class")).toBe(false);
    expect(p?.hasAttribute("data-kix-id")).toBe(false);
    expect(p?.getAttribute("data-x")).toBe("keep");
  });

  it("keeps non-Google ids and classes", () => {
    const out = clean('<p id="my-para" class="my-class">t</p>', settings());
    const p = out.querySelector("p");
    expect(p?.getAttribute("id")).toBe("my-para");
    expect(p?.getAttribute("class")).toBe("my-class");
  });

  it("removes empty span/font tags", () => {
    const out = clean("<p><span></span><span>x</span><font></font></p>", settings());
    expect(out.querySelector("font")).toBeNull();
    expect(out.textContent).toBe("x");
  });

  it("normalizes h4/h5/h6 to h3 and leaves h1-h3 untouched", () => {
    const out = clean("<h1>A</h1><h4>B</h4><h5>C</h5><h6>D</h6>", settings());
    expect(out.querySelectorAll("h1")).toHaveLength(1);
    expect(out.querySelectorAll("h3")).toHaveLength(3);
    expect(out.querySelector("h4")).toBeNull();
  });

  it("does not throw on malformed HTML", () => {
    expect(() => cleanPastedHtml("<p>unclosed<span>text", settings())).not.toThrow();
    const out = clean("<p>unclosed<span>text", settings());
    expect(out.textContent).toContain("text");
  });

  it("returns an empty string for empty input", () => {
    expect(cleanPastedHtml("", settings())).toBe("");
  });
});

// --- Group 2: default behavior (keepAll) ---

describe("cleanPastedHtml() — keepAll preset", () => {
  it("preserves source colors, fonts, sizes and indentation", () => {
    const out = clean(
      '<p style="color:rgb(255,0,0);font-family:Georgia;font-size:24px;text-indent:40px">x</p>',
      settings(),
    );
    const style = out.querySelector("p")?.getAttribute("style") ?? "";
    expect(style).toContain("color");
    expect(style).toContain("font-family");
    expect(style).toContain("font-size");
    expect(style).toContain("text-indent");
  });

  it("caps excessive source margins at 24px", () => {
    const out = clean(
      '<p style="margin-top:100px;margin-bottom:8px">x</p>',
      settings(),
    );
    const p = out.querySelector("p");
    expect(p?.style.marginTop).toBe("24px");
    expect(p?.style.marginBottom).toBe("8px");
  });

  it("mirrors span background-color as data-color for the Highlight extension", () => {
    const out = clean(
      '<span style="background-color:rgb(255,255,0)">hl</span>',
      settings(),
    );
    expect(out.querySelector("span")?.getAttribute("data-color")).toBe(
      "rgb(255, 255, 0)",
    );
  });
});

// --- Group 3: strip-list + structural categories ---

describe("cleanPastedHtml() — strippedProperties", () => {
  it("strips each listed property and keeps the rest", () => {
    const out = clean(
      '<p style="color:red;font-size:24px;font-family:Georgia">x</p>',
      withOptions({ strippedProperties: ["color", "font-size"] }),
    );
    const p = out.querySelector("p");
    expect(p?.style.color).toBe("");
    expect(p?.style.fontSize).toBe("");
    expect(p?.style.fontFamily).not.toBe("");
  });

  it("keeps every property when the list is empty", () => {
    const out = clean('<p style="color:red">x</p>', settings());
    expect(out.querySelector("p")?.style.color).not.toBe("");
  });

  it("removes data-color when background-color is stripped", () => {
    const out = clean(
      '<span class="keep" style="background-color:yellow" data-color="yellow">x</span>',
      withOptions({ strippedProperties: ["background-color"] }),
    );
    const span = out.querySelector<HTMLSpanElement>("span.keep");
    expect(span?.style.backgroundColor).toBe("");
    expect(span?.hasAttribute("data-color")).toBe(false);
  });
});

describe("cleanPastedHtml() — unwrapBareInlineTags", () => {
  it("unwraps a span that has no attributes", () => {
    const out = clean("<p><span>text</span></p>", settings());
    expect(out.querySelector("span")).toBeNull();
    expect(out.querySelector("p")?.textContent).toBe("text");
  });

  it("unwraps a bare <font> element", () => {
    const out = clean("<p><font>text</font></p>", settings());
    expect(out.querySelector("font")).toBeNull();
    expect(out.textContent).toBe("text");
  });

  it("keeps spans that still carry attributes", () => {
    const out = clean(
      '<p><span class="keep">a</span><span style="color:red">b</span></p>',
      settings(),
    );
    expect(out.querySelectorAll("span")).toHaveLength(2);
  });

  it("leaves bare block elements alone", () => {
    const out = clean("<div>text</div>", settings());
    expect(out.querySelector("div")).not.toBeNull();
  });

  it("strips a junk span down to clean text (the end-to-end chain)", () => {
    const out = clean(
      '<p><span style="font-family:-webkit-standard;font-size:medium">x</span></p>',
      withOptions({ strippedProperties: ["font-family", "font-size"] }),
    );
    expect(out.querySelector("span")).toBeNull();
    expect(out.querySelector("p")?.outerHTML).toBe("<p>x</p>");
  });
});

describe("cleanPastedHtml() — category: demoteHeadings", () => {
  it("converts headings to paragraphs when enabled", () => {
    const out = clean(
      "<h2>Title</h2>",
      withOptions({ demoteHeadings: true }),
    );
    expect(out.querySelector("h2")).toBeNull();
    expect(out.querySelector("p")?.textContent).toBe("Title");
  });

  it("keeps headings when disabled", () => {
    const out = clean("<h2>Title</h2>", settings());
    expect(out.querySelector("h2")).not.toBeNull();
  });
});

describe("cleanPastedHtml() — category: stripLinks", () => {
  it("unwraps links to plain text when enabled", () => {
    const out = clean(
      '<p><a href="https://x.com">link</a></p>',
      withOptions({ stripLinks: true }),
    );
    expect(out.querySelector("a")).toBeNull();
    expect(out.textContent).toBe("link");
  });

  it("keeps links when disabled", () => {
    const out = clean('<a href="https://x.com">link</a>', settings());
    expect(out.querySelector("a")).not.toBeNull();
  });
});

describe("cleanPastedHtml() — category: flattenLists", () => {
  it("flattens list items to paragraphs when enabled", () => {
    const out = clean(
      "<ul><li>A</li><li>B</li></ul>",
      withOptions({ flattenLists: true }),
    );
    expect(out.querySelector("ul")).toBeNull();
    expect(Array.from(out.querySelectorAll("p")).map((p) => p.textContent)).toEqual([
      "A",
      "B",
    ]);
  });

  it("flattens nested lists fully", () => {
    const out = clean(
      "<ul><li>A<ul><li>A1</li></ul></li></ul>",
      withOptions({ flattenLists: true }),
    );
    expect(out.querySelector("ul")).toBeNull();
    expect(out.querySelectorAll("p")).toHaveLength(2);
  });

  it("keeps lists when disabled", () => {
    const out = clean("<ul><li>A</li></ul>", settings());
    expect(out.querySelector("ul")).not.toBeNull();
  });
});

describe("cleanPastedHtml() — category: removeImages", () => {
  it("removes images when enabled", () => {
    const out = clean(
      '<p>text</p><img src="x.png" alt="">',
      withOptions({ removeImages: true }),
    );
    expect(out.querySelector("img")).toBeNull();
    expect(out.textContent).toBe("text");
  });

  it("keeps images when disabled", () => {
    const out = clean('<img src="x.png" alt="">', settings());
    expect(out.querySelector("img")).not.toBeNull();
  });
});

describe("cleanPastedHtml() — category: unwrapFormattingTags", () => {
  it("unwraps bold/italic/underline tags when enabled", () => {
    const out = clean(
      "<p><strong>b</strong><em>i</em><u>u</u></p>",
      withOptions({ unwrapFormattingTags: true }),
    );
    expect(out.querySelector("strong")).toBeNull();
    expect(out.querySelector("em")).toBeNull();
    expect(out.querySelector("u")).toBeNull();
    expect(out.textContent).toBe("biu");
  });

  it("keeps formatting tags when disabled", () => {
    const out = clean("<p><strong>b</strong></p>", settings());
    expect(out.querySelector("strong")).not.toBeNull();
  });
});

// --- Group 3b: preset end-to-end ---

describe("cleanPastedHtml() — preset end-to-end", () => {
  it("matchBook strips styling but keeps structure", () => {
    const out = clean(
      '<h2 style="color:red">Title</h2><p><a href="x">link</a> <strong>bold</strong></p>',
      settings({ preset: "matchBook", options: PASTE_CLEANUP_PRESETS.matchBook }),
    );
    expect(out.querySelector("h2")?.style.color).toBe("");
    expect(out.querySelector("h2")).not.toBeNull();
    expect(out.querySelector("a")).not.toBeNull();
    expect(out.querySelector("strong")).not.toBeNull();
  });

  it("plainText reduces content to plain paragraphs and text", () => {
    const out = clean(
      '<h2>Title</h2><p><a href="x">link</a> <strong>bold</strong></p>',
      settings({ preset: "plainText", options: PASTE_CLEANUP_PRESETS.plainText }),
    );
    expect(out.querySelector("h2")).toBeNull();
    expect(out.querySelector("a")).toBeNull();
    expect(out.querySelector("strong")).toBeNull();
    expect(out.textContent).toContain("Title");
    expect(out.textContent).toContain("link");
  });
});

// --- Group 4: custom rule application ---

describe("cleanPastedHtml() — custom rules", () => {
  it("deletes elements matching a tag rule", () => {
    const out = clean(
      "<p>keep</p><div>drop</div>",
      settings({ rules: [rule({ target: "tag", value: "div", action: "delete" })] }),
    );
    expect(out.querySelector("div")).toBeNull();
    expect(out.textContent).toBe("keep");
  });

  it("unwraps elements matching a tag rule", () => {
    const out = clean(
      "<div><p>x</p></div>",
      settings({ rules: [rule({ target: "tag", value: "div", action: "unwrap" })] }),
    );
    expect(out.querySelector("div")).toBeNull();
    expect(out.querySelector("p")?.textContent).toBe("x");
  });

  it("removes the style attribute for a cssClass + removeStyle rule", () => {
    const out = clean(
      '<p class="foo" style="color:red">x</p>',
      settings({
        rules: [rule({ target: "cssClass", value: "foo", action: "removeStyle" })],
      }),
    );
    expect(out.querySelector("p")?.hasAttribute("style")).toBe(false);
  });

  it("clears only the matched property for a fontFamily + removeStyle rule", () => {
    const out = clean(
      '<span style="font-family:Comic Sans MS;color:red">x</span>',
      settings({
        rules: [
          rule({
            target: "fontFamily",
            value: "Comic Sans MS",
            action: "removeStyle",
          }),
        ],
      }),
    );
    const span = out.querySelector("span");
    expect(span?.style.fontFamily).toBe("");
    expect(span?.style.color).not.toBe("");
  });

  it("clears only matching styleDeclaration values", () => {
    const out = clean(
      '<span style="font-size: medium; color: rgb(0, 0, 0); font-weight: 700">drop</span><span style="font-size: medium; color: red">keep</span>',
      settings({
        rules: [
          rule({
            target: "styleDeclaration",
            value: "span { font-size: medium; color: rgb(0, 0, 0); }",
            action: "removeStyle",
          }),
        ],
      }),
    );
    const spans = out.querySelectorAll("span");
    expect(spans[0]?.style.fontSize).toBe("");
    expect(spans[0]?.style.color).toBe("");
    expect(spans[0]?.style.fontWeight).toBe("700");
    expect(spans[1]?.style.fontSize).toBe("");
    expect(spans[1]?.style.color).toBe("red");
  });

  it("clears only the selected -webkit-standard font family", () => {
    const out = clean(
      '<span style="font-family: -webkit-standard; color: red">drop</span><span style="font-family: Georgia; color: red">keep</span>',
      settings({
        rules: [
          rule({
            target: "styleDeclaration",
            value: "font-family: -webkit-standard",
            action: "removeStyle",
          }),
        ],
      }),
    );
    const spans = out.querySelectorAll("span");
    expect(spans[0]?.style.fontFamily).toBe("");
    expect(spans[0]?.style.color).toBe("red");
    expect(spans[1]?.style.fontFamily).toBe("Georgia");
    expect(spans[1]?.style.color).toBe("red");
  });

  it("clears selected font-size and red color values with or without trailing semicolons", () => {
    const input =
      '<span style="font-size: medium; color: red; font-weight: 700">drop</span><span style="font-size: 12px; color: red">keep-color</span><span style="font-size: medium; color: blue">keep-size</span>';

    for (const value of [
      "font-size: medium; color: red;",
      "font-size: medium; color: red",
    ]) {
      const out = clean(
        input,
        settings({
          rules: [
            rule({
              target: "styleDeclaration",
              value,
              action: "removeStyle",
            }),
          ],
        }),
      );
      const spans = out.querySelectorAll("span");
      expect(spans[0]?.style.fontSize).toBe("");
      expect(spans[0]?.style.color).toBe("");
      expect(spans[0]?.style.fontWeight).toBe("700");
      expect(spans[1]?.style.fontSize).toBe("12px");
      expect(spans[1]?.style.color).toBe("");
      expect(spans[2]?.style.fontSize).toBe("");
      expect(spans[2]?.style.color).toBe("blue");
    }
  });

  it("applies styleDeclaration blocks to their nested tag targets", () => {
    const out = clean(
      '<p><span style="font-size: medium; color: red">span</span><em style="font-size: medium; color: red">em</em><strong style="font-size: medium; color: red">strong</strong></p>',
      settings({
        rules: [
          rule({
            target: "styleDeclaration",
            value: "span { font-size: medium; }\nem { color: red; }",
            action: "removeStyle",
          }),
        ],
      }),
    );
    const span = out.querySelector("span");
    const em = out.querySelector("em");
    const strong = out.querySelector("strong");
    expect(span?.style.fontSize).toBe("");
    expect(span?.style.color).toBe("red");
    expect(em?.style.fontSize).toBe("medium");
    expect(em?.style.color).toBe("");
    expect(strong?.style.fontSize).toBe("medium");
    expect(strong?.style.color).toBe("red");
  });

  it("matches a styleDeclaration when only one selected declaration remains", () => {
    const out = clean(
      '<span style="font-size: medium; color: rgb(0, 0, 0);">x</span>',
      settings({
        rules: [
          rule({
            target: "styleDeclaration",
            value:
              "span { font-family: -webkit-standard; font-size: medium; color: rgb(0, 0, 0); }",
            action: "removeStyle",
          }),
        ],
      }),
    );
    expect(out.textContent).toBe("x");
    expect(out.querySelector("span")).toBeNull();
  });

  it("deletes elements matching a raw cssSelector rule", () => {
    const out = clean(
      '<p>a</p><p class="x">b</p>',
      settings({
        rules: [rule({ target: "cssSelector", value: "p.x", action: "delete" })],
      }),
    );
    expect(out.querySelectorAll("p")).toHaveLength(1);
    expect(out.textContent).toBe("a");
  });

  it("ignores disabled rules", () => {
    const out = clean(
      "<div>x</div>",
      settings({
        rules: [
          rule({ enabled: false, target: "tag", value: "div", action: "delete" }),
        ],
      }),
    );
    expect(out.querySelector("div")).not.toBeNull();
  });

  it("skips rules with an empty value", () => {
    const out = clean(
      "<div>x</div>",
      settings({ rules: [rule({ target: "tag", value: "  ", action: "delete" })] }),
    );
    expect(out.querySelector("div")).not.toBeNull();
  });
});

// --- Group 5: rule ordering / precedence ---

describe("cleanPastedHtml() — rule ordering", () => {
  const input = '<div class="box"><p>X</p></div>';
  const deleteBox = rule({ target: "cssClass", value: "box", action: "delete" });
  const unwrapDiv = rule({ target: "tag", value: "div", action: "unwrap" });

  it("delete-then-unwrap removes the content", () => {
    const out = clean(input, settings({ rules: [deleteBox, unwrapDiv] }));
    expect(out.textContent).toBe("");
  });

  it("unwrap-then-delete preserves the content", () => {
    const out = clean(input, settings({ rules: [unwrapDiv, deleteBox] }));
    expect(out.querySelector("p")?.textContent).toBe("X");
  });

  it("runs category cleanup before custom rules without error", () => {
    expect(() =>
      cleanPastedHtml(
        '<p style="color:red">x</p>',
        settings({
          options: { ...PASTE_CLEANUP_PRESETS.keepAll, strippedProperties: ["color"] },
          rules: [rule({ target: "textColor", value: "red", action: "removeStyle" })],
        }),
      ),
    ).not.toThrow();
  });
});

// --- Group 6: invalid rule safety ---

describe("cleanPastedHtml() — invalid rule safety", () => {
  it("skips a rule with an invalid CSS selector and still applies later rules", () => {
    const out = clean(
      '<div>x</div><span class="keep">y</span>',
      settings({
        rules: [
          rule({ target: "cssSelector", value: ">>>", action: "delete" }),
          rule({ target: "tag", value: "div", action: "delete" }),
        ],
      }),
    );
    expect(out.querySelector("div")).toBeNull();
    expect(out.querySelector("span.keep")).not.toBeNull();
  });

  it("does not throw on an invalid tag selector", () => {
    expect(() =>
      cleanPastedHtml(
        "<p>x</p>",
        settings({ rules: [rule({ target: "tag", value: "1bad", action: "delete" })] }),
      ),
    ).not.toThrow();
  });

  it("does not throw when rules run against malformed HTML", () => {
    expect(() =>
      cleanPastedHtml(
        "<p>unclosed<span>text",
        settings({ rules: [rule({ target: "tag", value: "span", action: "unwrap" })] }),
      ),
    ).not.toThrow();
  });
});
