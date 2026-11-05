import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRegister, mockReadInstalled, mockInstalled } = vi.hoisted(() => ({
  mockRegister: vi.fn(),
  mockReadInstalled: vi.fn(),
  mockInstalled: vi.fn(),
}));

vi.mock("@react-pdf/renderer", () => ({ Font: { register: mockRegister } }));
vi.mock("@/lib/platform", () => ({ getPdfFontFiles: vi.fn(async () => ({})) }));
vi.mock("@/features/pdf-fonts/install", () => ({
  isPdfFontInstalled: mockInstalled,
  readInstalledPdfFont: mockReadInstalled,
}));

const { embeddedPdfFontFamilies } = await import("@/features/export/pdf-font-registration");

beforeEach(() => {
  mockRegister.mockClear();
  mockInstalled.mockResolvedValue(true);
  mockReadInstalled.mockResolvedValue({
    regular: new TextEncoder().encode("REGULAR"),
    bold: new TextEncoder().encode("BOLD"),
  });
});

describe("embeddedPdfFontFamilies()", () => {
  it("leaves English to the built-in fonts", async () => {
    const families = await embeddedPdfFontFamilies("The quick brown fox — “quoted” … €5");

    expect(families).toBeUndefined();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("leaves Spanish to the built-in fonts", async () => {
    const families = await embeddedPdfFontFamilies("¿Dónde está el niño? ¡Mañana!");

    expect(families).toBeUndefined();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("registers the Latin family once for Polish text", async () => {
    const families = await embeddedPdfFontFamilies("Zażółć gęślą jaźń");

    expect(families).toEqual(["Noto Serif"]);
    expect(mockRegister).toHaveBeenCalledTimes(1);
    const registered = mockRegister.mock.calls[0][0];
    expect(registered.family).toBe("Noto Serif");
    expect(registered.fonts[0].src).toMatch(/^data:font\/ttf;base64,/);
    // No italic files: the italic style borrows the regular bytes.
    expect(registered.fonts[2].src).toBe(registered.fonts[0].src);
    expect(registered.fonts[3].src).toBe(registered.fonts[1].src);
  });

  it("does not read the bytes of a family already registered this session", async () => {
    mockReadInstalled.mockClear();

    const families = await embeddedPdfFontFamilies("Zażółć gęślą jaźń");

    expect(families).toEqual(["Noto Serif"]);
    expect(mockReadInstalled).not.toHaveBeenCalled();
  });
});
