/**
 * The Plugin data-size formatter (#443): binary units labelled MB/KB, with the
 * number localized so Spanish reads "4,5 MB".
 */
import { describe, expect, it } from "vitest";
import { formatPluginDataSize } from "@/components/settings/plugin-data-size";

const MB = 1024 * 1024;

describe("formatPluginDataSize", () => {
  it("formats a whole number with no decimals in both locales", () => {
    expect(formatPluginDataSize(4 * MB, "en")).toBe("4 MB");
    expect(formatPluginDataSize(4 * MB, "es")).toBe("4 MB");
  });

  it("localizes the fraction: English a dot, Spanish a comma", () => {
    expect(formatPluginDataSize(4.5 * MB, "en")).toBe("4.5 MB");
    expect(formatPluginDataSize(4.5 * MB, "es")).toBe("4,5 MB");
  });

  it("uses KB below a megabyte and bytes below a kilobyte", () => {
    expect(formatPluginDataSize(512 * 1024, "en")).toBe("512 KB");
    expect(formatPluginDataSize(4096, "en")).toBe("4 KB");
    expect(formatPluginDataSize(512, "en")).toBe("512 B");
  });
});
