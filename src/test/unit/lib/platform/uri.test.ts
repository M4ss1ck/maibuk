import { describe, expect, it } from "vitest";
import { isContentUri, displayNameFromPath, extensionFromPath } from "@/lib/platform/uri";

describe("uri helpers", () => {
  it("detects Android content and file URIs", () => {
    expect(isContentUri("content://com.android.providers/doc/123")).toBe(true);
    expect(isContentUri("file:///storage/emulated/0/book.epub")).toBe(true);
    expect(isContentUri("/home/user/book.epub")).toBe(false);
    expect(isContentUri("C:\\Users\\book.epub")).toBe(false);
  });

  it("derives display names from real paths and falls back for content URIs", () => {
    expect(displayNameFromPath("/home/user/book.epub", "import")).toBe("book.epub");
    expect(displayNameFromPath("C:\\Users\\book.epub", "import")).toBe("book.epub");
    expect(displayNameFromPath("content://xyz/doc/9af3", "Imported file")).toBe("Imported file");
  });

  it("derives extensions from real paths and falls back for content URIs", () => {
    expect(extensionFromPath("/home/user/pic.PNG", "png")).toBe("png");
    expect(extensionFromPath("content://xyz/doc/9af3", "png")).toBe("png");
    expect(extensionFromPath("/home/user/noext", "png")).toBe("png");
  });
});
