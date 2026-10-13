/**
 * The Plugin data-size formatter (#443): binary units labelled MB/KB, with the
 * number localized so Spanish reads "4,5 MB", and the unit labels read from
 * locale keys (the caller passes `t`) so `plugin-data-size.ts` stays pure.
 */
import { describe, expect, it } from "vitest";
import "@/i18n";
import i18n from "@/i18n";
import {
  formatPluginDataSize,
  type PluginDataSizeTranslate,
} from "@/components/settings/plugin-data-size";

const MB = 1024 * 1024;
const en = i18n.getFixedT("en") as unknown as PluginDataSizeTranslate;
const es = i18n.getFixedT("es") as unknown as PluginDataSizeTranslate;

describe("formatPluginDataSize", () => {
  it("reads the unit label from the locale keys", () => {
    const keys: string[] = [];
    const translate: PluginDataSizeTranslate = (key, options) => {
      keys.push(key);
      return options.value;
    };

    formatPluginDataSize(4 * MB, "en", translate);
    formatPluginDataSize(4 * 1024, "en", translate);
    formatPluginDataSize(512, "en", translate);

    expect(keys).toEqual([
      "plugins.management.units.mb",
      "plugins.management.units.kb",
      "plugins.management.units.b",
    ]);
  });

  it("formats a whole number with no decimals in both locales", () => {
    expect(formatPluginDataSize(4 * MB, "en", en)).toBe("4 MB");
    expect(formatPluginDataSize(4 * MB, "es", es)).toBe("4 MB");
  });

  it("localizes the fraction: English a dot, Spanish a comma", () => {
    expect(formatPluginDataSize(4.5 * MB, "en", en)).toBe("4.5 MB");
    expect(formatPluginDataSize(4.5 * MB, "es", es)).toBe("4,5 MB");
  });

  it("uses KB below a megabyte and bytes below a kilobyte", () => {
    expect(formatPluginDataSize(512 * 1024, "en", en)).toBe("512 KB");
    expect(formatPluginDataSize(4096, "en", en)).toBe("4 KB");
    expect(formatPluginDataSize(512, "en", en)).toBe("512 B");
  });
});
