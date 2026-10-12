import { describe, expect, it } from "vitest";
import { pluginStartupErrorText } from "@/components/plugins/plugin-startup-error";

const t = (key: string): string =>
  ({
    "plugins.startupError.incompatible": "This Plugin needs a newer version of Maibuk.",
    "plugins.startupError.moduleRefused": "This Plugin's files could not be loaded.",
    "plugins.startupError.generic": "This Plugin failed to start.",
  })[key] ?? key;

describe("pluginStartupErrorText()", () => {
  it("localizes a stored refusal code", () => {
    expect(pluginStartupErrorText("incompatible", t)).toBe(
      "This Plugin needs a newer version of Maibuk."
    );
    expect(pluginStartupErrorText("module-refused", t)).toBe(
      "This Plugin's files could not be loaded."
    );
  });

  it("falls back to the generic sentence for a code with no copy", () => {
    expect(pluginStartupErrorText("health-check-failed", t)).toBe("This Plugin failed to start.");
  });

  it("shows a refusal's own message as it is", () => {
    expect(pluginStartupErrorText("boom", t)).toBe("boom");
  });
});
