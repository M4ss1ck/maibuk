import { describe, expect, it } from "vitest";
import {
  CJK_FONT_COMMIT,
  LATIN_FONT_COMMIT,
  PDF_FONT_CATALOG,
  pdfFontPlan,
} from "@/features/pdf-fonts/catalog";

const POLISH = "Zażółć gęślą jaźń";
const ZH = "你好世界";
const SHA256 = /^[0-9a-f]{64}$/;

function ids(stack: readonly { id: string }[]): string[] {
  return stack.map((font) => font.id);
}

describe("PDF_FONT_CATALOG", () => {
  it("lists Latin before CJK", () => {
    expect(ids(PDF_FONT_CATALOG)).toEqual(["latin", "cjk"]);
  });

  it("pins every file to an https commit URL with a 64-hex sha256", () => {
    for (const font of PDF_FONT_CATALOG) {
      expect(font.license).toBe("OFL-1.1");
      expect(font.source.startsWith("https://")).toBe(true);
      for (const file of Object.values(font.files)) {
        if (!file) continue;
        expect(file.url.startsWith("https://")).toBe(true);
        expect(file.url).toMatch(/[0-9a-f]{40}/);
        expect(file.bytes).toBeGreaterThan(0);
        expect(file.sha256).toMatch(SHA256);
      }
    }
  });

  it("pins the Latin font to the notofonts commit and the CJK font to noto-cjk", () => {
    const latin = PDF_FONT_CATALOG[0];
    const cjk = PDF_FONT_CATALOG[1];
    expect(latin.files.regular.url).toContain(LATIN_FONT_COMMIT);
    expect(cjk.files.regular.url).toContain(CJK_FONT_COMMIT);
    expect(latin.source).toContain(LATIN_FONT_COMMIT);
    expect(cjk.source).toContain(CJK_FONT_COMMIT);
  });
});

describe("pdfFontPlan()", () => {
  it("leaves text the built-in fonts render to them", () => {
    expect(pdfFontPlan("The quick brown fox — “quoted” … €5", ["latin", "cjk"])).toEqual({
      stack: [],
      missing: false,
      offers: [],
    });
  });

  it("embeds Latin for a Polish book when it is installed", () => {
    const plan = pdfFontPlan(POLISH, ["latin"]);
    expect(ids(plan.stack)).toEqual(["latin"]);
    expect(plan.missing).toBe(false);
    expect(plan.offers).toEqual([]);
  });

  it("offers Latin for a Polish book when nothing is installed", () => {
    const plan = pdfFontPlan(POLISH, []);
    expect(ids(plan.stack)).toEqual([]);
    expect(plan.missing).toBe(true);
    expect(ids(plan.offers)).toEqual(["latin"]);
  });

  it("offers Latin for a Polish book when only CJK is installed", () => {
    const plan = pdfFontPlan(POLISH, ["cjk"]);
    expect(ids(plan.stack)).toEqual(["cjk"]);
    expect(plan.missing).toBe(true);
    expect(ids(plan.offers)).toEqual(["latin"]);
  });

  it("embeds CJK for Chinese text when it is installed", () => {
    const plan = pdfFontPlan(ZH, ["cjk"]);
    expect(ids(plan.stack)).toEqual(["cjk"]);
    expect(plan.missing).toBe(false);
    expect(plan.offers).toEqual([]);
  });

  it("offers CJK for Chinese text when nothing is installed", () => {
    const plan = pdfFontPlan(ZH, []);
    expect(ids(plan.stack)).toEqual([]);
    expect(plan.missing).toBe(true);
    expect(ids(plan.offers)).toEqual(["cjk"]);
  });

  it("offers Latin for a Chinese book with a WinAnsi character the CJK font lacks", () => {
    const plan = pdfFontPlan(`${ZH} Š`, ["cjk"]);
    expect(ids(plan.stack)).toEqual(["cjk"]);
    expect(plan.missing).toBe(true);
    expect(ids(plan.offers)).toEqual(["latin"]);
  });

  it("embeds both fonts for Chinese text that also needs a Latin character", () => {
    const plan = pdfFontPlan(`${ZH} Š`, ["latin", "cjk"]);
    expect(ids(plan.stack)).toEqual(["latin", "cjk"]);
    expect(plan.missing).toBe(false);
    expect(plan.offers).toEqual([]);
  });

  it("embeds only Latin for a Polish book with both fonts installed", () => {
    const plan = pdfFontPlan(POLISH, ["latin", "cjk"]);
    expect(ids(plan.stack)).toEqual(["latin"]);
    expect(plan.missing).toBe(false);
    expect(plan.offers).toEqual([]);
  });

  it("offers CJK alone for Chinese text that also contains ASCII", () => {
    const plan = pdfFontPlan(`${ZH} abc`, []);
    expect(ids(plan.stack)).toEqual([]);
    expect(plan.missing).toBe(true);
    expect(ids(plan.offers)).toEqual(["cjk"]);
  });

  it("offers CJK then Latin for Chinese text that also needs a Polish letter", () => {
    const plan = pdfFontPlan(`${ZH} ł`, []);
    expect(plan.missing).toBe(true);
    expect(ids(plan.offers)).toEqual(["cjk", "latin"]);
  });

  it("offers Latin for Russian text when nothing is installed", () => {
    const plan = pdfFontPlan("Съешь ещё этих мягких", []);
    expect(plan.missing).toBe(true);
    expect(ids(plan.offers)).toEqual(["latin"]);
  });

  it("offers nothing for an emoji even beside text the built-in fonts can show", () => {
    const plan = pdfFontPlan("A face 😊", ["latin", "cjk"]);
    expect(plan.missing).toBe(true);
    expect(plan.offers).toEqual([]);
  });

  it("reports an emoji as missing with nothing to offer", () => {
    const plan = pdfFontPlan("😊", ["latin", "cjk"]);
    expect(ids(plan.stack)).toEqual([]);
    expect(plan.missing).toBe(true);
    expect(plan.offers).toEqual([]);
  });
});
