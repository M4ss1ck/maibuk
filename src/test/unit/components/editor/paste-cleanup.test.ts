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

  it("removes empty span/font tags but keeps non-empty ones", () => {
    const out = clean("<p><span></span><span>text</span><font></font></p>", settings());
    expect(out.querySelectorAll("span")).toHaveLength(1);
    expect(out.querySelector("font")).toBeNull();
    expect(out.textContent).toBe("text");
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

// --- Group 3: category toggles (the "disabled parser" coverage) ---

describe("cleanPastedHtml() — category: removeTextColor", () => {
  it("strips inline color when enabled", () => {
    const out = clean(
      '<p style="color:red">x</p>',
      withOptions({ removeTextColor: true }),
    );
    expect(out.querySelector("p")?.style.color).toBe("");
  });

  it("keeps inline color when disabled", () => {
    const out = clean('<p style="color:red">x</p>', settings());
    expect(out.querySelector("p")?.style.color).not.toBe("");
  });
});

describe("cleanPastedHtml() — category: removeHighlight", () => {
  it("strips background-color and data-color when enabled", () => {
    const out = clean(
      '<span style="background-color:yellow" data-color="yellow">x</span>',
      withOptions({ removeHighlight: true }),
    );
    const span = out.querySelector("span");
    expect(span?.style.backgroundColor).toBe("");
    expect(span?.hasAttribute("data-color")).toBe(false);
  });

  it("unwraps <mark> elements when enabled", () => {
    const out = clean(
      "<p><mark>marked</mark></p>",
      withOptions({ removeHighlight: true }),
    );
    expect(out.querySelector("mark")).toBeNull();
    expect(out.textContent).toBe("marked");
  });

  it("keeps the highlight when disabled", () => {
    const out = clean(
      '<span style="background-color:yellow">x</span>',
      settings(),
    );
    expect(out.querySelector("span")?.style.backgroundColor).not.toBe("");
  });
});

describe("cleanPastedHtml() — category: removeFontFamily / removeFontSize", () => {
  it("strips font-family when enabled", () => {
    const out = clean(
      '<span style="font-family:Georgia">x</span>',
      withOptions({ removeFontFamily: true }),
    );
    expect(out.querySelector("span")?.style.fontFamily).toBe("");
  });

  it("strips font-size when enabled", () => {
    const out = clean(
      '<span style="font-size:24px">x</span>',
      withOptions({ removeFontSize: true }),
    );
    expect(out.querySelector("span")?.style.fontSize).toBe("");
  });
});

describe("cleanPastedHtml() — category: removeSourceSpacing", () => {
  it("strips margins and line-height when enabled", () => {
    const out = clean(
      '<p style="margin-top:12px;margin-bottom:8px;line-height:2">x</p>',
      withOptions({ removeSourceSpacing: true }),
    );
    const p = out.querySelector("p");
    expect(p?.style.marginTop).toBe("");
    expect(p?.style.lineHeight).toBe("");
  });

  it("keeps spacing when disabled", () => {
    const out = clean(
      '<p style="margin-top:12px">x</p>',
      settings(),
    );
    expect(out.querySelector("p")?.style.marginTop).toBe("12px");
  });
});

describe("cleanPastedHtml() — category: removeSourceIndent", () => {
  it("strips text-indent and margin-left when enabled", () => {
    const out = clean(
      '<p style="text-indent:40px;margin-left:20px">x</p>',
      withOptions({ removeSourceIndent: true }),
    );
    const p = out.querySelector("p");
    expect(p?.style.textIndent).toBe("");
    expect(p?.style.marginLeft).toBe("");
  });

  it("keeps indentation when disabled", () => {
    const out = clean(
      '<p style="text-indent:40px">x</p>',
      settings(),
    );
    expect(out.querySelector("p")?.style.textIndent).toBe("40px");
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

describe("cleanPastedHtml() — category: removeInlineFormatting", () => {
  it("unwraps bold/italic/underline when enabled", () => {
    const out = clean(
      "<p><strong>b</strong><em>i</em><u>u</u></p>",
      withOptions({ removeInlineFormatting: true }),
    );
    expect(out.querySelector("strong")).toBeNull();
    expect(out.querySelector("em")).toBeNull();
    expect(out.querySelector("u")).toBeNull();
    expect(out.textContent).toBe("biu");
  });

  it("keeps inline formatting when disabled", () => {
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
          options: { ...PASTE_CLEANUP_PRESETS.keepAll, removeTextColor: true },
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
      "<div>x</div><span>y</span>",
      settings({
        rules: [
          rule({ target: "cssSelector", value: ">>>", action: "delete" }),
          rule({ target: "tag", value: "div", action: "delete" }),
        ],
      }),
    );
    expect(out.querySelector("div")).toBeNull();
    expect(out.querySelector("span")).not.toBeNull();
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
