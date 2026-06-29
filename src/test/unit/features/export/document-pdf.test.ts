import { vi, describe, expect, it, beforeEach } from "vitest";

const { mockToBlob, mockPdf } = vi.hoisted(() => {
  const mockToBlob = vi.fn().mockResolvedValue(new Blob(["fake-pdf"], { type: "application/pdf" }));
  const mockPdf = vi.fn().mockReturnValue({ toBlob: mockToBlob });
  return { mockToBlob, mockPdf };
});

vi.mock("@react-pdf/renderer", () => ({
  pdf: mockPdf,
  Font: { registerHyphenationCallback: vi.fn() },
  Document: "Document",
  Page: "Page",
  View: "View",
  Text: "Text",
  Image: "Image",
  Link: "Link",
  StyleSheet: { create: (styles: Record<string, unknown>) => styles },
}));

import { generateDocumentPdf } from "@/features/export/document-pdf";

describe("generateDocumentPdf()", () => {
  beforeEach(() => {
    mockPdf.mockClear();
    mockToBlob.mockClear();
  });

  it("returns the rendered PDF blob", async () => {
    const blob = await generateDocumentPdf("<p>Hello</p>", "My Note");
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("application/pdf");
    expect(mockPdf).toHaveBeenCalledTimes(1);
    expect(mockToBlob).toHaveBeenCalledTimes(1);
  });

  it("renders without throwing when the title is empty", async () => {
    await expect(generateDocumentPdf("<p>Body only</p>", "")).resolves.toBeInstanceOf(Blob);
    expect(mockPdf).toHaveBeenCalledTimes(1);
  });
});
