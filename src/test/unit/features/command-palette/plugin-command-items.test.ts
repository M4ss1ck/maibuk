import { afterEach, describe, expect, it } from "vitest";
import { buildCommandItems } from "@/features/command-palette/command-items";
import { commandStates, registerCommandSource } from "@/lib/command-runner";
import { registerPluginCommands, type PluginRegistration } from "@/lib/shortcut-registry";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

const t = ((key: string) => `label:${key}`) as Parameters<typeof buildCommandItems>[0]["t"];

function register(pluginId: string, registration: PluginRegistration) {
  const unregister = registerPluginCommands(pluginId, registration);
  cleanups.push(unregister);
  return unregister;
}

const commandId = "plugin.echoes.showReport" as const;

const registration: PluginRegistration = {
  defaultLanguage: "en",
  commands: [
    {
      id: "showReport",
      label: "Show report",
      labels: { es: "Mostrar informe" },
      keywords: ["echoes", "repeated words"],
      contexts: ["global"],
      defaults: [],
    },
  ],
};

describe("buildCommandItems with Plugin Commands", () => {
  it("lists a registered Command from the live snapshot and drops it when unregistered", () => {
    register("echoes", registration);
    // Registered but unready: with no runnable binding the palette stays empty.
    expect(commandStates().has(commandId)).toBe(false);
    expect(
      buildCommandItems({ snapshot: commandStates(), t, language: "en", customVoice: {} })
    ).toEqual([]);

    const unregisterBinding = registerCommandSource(() => [{ id: commandId, onTrigger: () => {} }]);
    cleanups.push(unregisterBinding);

    const items = buildCommandItems({
      snapshot: commandStates(),
      t,
      language: "en",
      customVoice: {},
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: `command:${commandId}`,
      kind: "command",
      id: commandId,
      label: "Show report",
      state: "runnable",
    });
    expect(items[0].terms).toContain("Show report");
    expect(items[0].terms).toContain("echoes");
    expect(items[0].terms).toContain("repeated words");

    unregisterBinding();
    const after = buildCommandItems({
      snapshot: commandStates(),
      t,
      language: "en",
      customVoice: {},
    });
    expect(after).toEqual([]);
  });

  it("labels a Plugin Command in the UI language, falling back to its default language", () => {
    register("echoes", registration);

    const spanish = buildCommandItems({
      snapshot: new Map([[commandId, "runnable"]]),
      t,
      language: "es",
      customVoice: {},
    });
    expect(spanish[0].label).toBe("Mostrar informe");
    expect(spanish[0].terms).toContain("Mostrar informe");

    register("echoes", {
      defaultLanguage: "en",
      commands: [{ id: "showReport", label: "Show report", contexts: ["global"], defaults: [] }],
    });
    const fallback = buildCommandItems({
      snapshot: new Map([[commandId, "runnable"]]),
      t,
      language: "es",
      customVoice: {},
    });
    expect(fallback[0].label).toBe("Show report");
  });
});
