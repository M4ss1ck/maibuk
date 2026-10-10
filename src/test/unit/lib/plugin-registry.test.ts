import { afterEach, describe, expect, it } from "vitest";
import {
  COMMAND_IDS,
  commandIds,
  commandSection,
  getCommand,
  isCommandId,
  isPluginCommandDef,
  isPluginCommandId,
  pluginCommandRenames,
  pluginIdOfCommand,
  registerPluginCommands,
  resolvePluginCommandRename,
  type PluginCommandDeclaration,
  type PluginRegistration,
} from "@/lib/shortcut-registry";

const unregisters: Array<() => void> = [];
afterEach(() => {
  while (unregisters.length > 0) unregisters.pop()?.();
});

function register(pluginId: string, registration: PluginRegistration) {
  const unregister = registerPluginCommands(pluginId, registration);
  unregisters.push(unregister);
  return unregister;
}

const base: PluginCommandDeclaration = {
  id: "showReport",
  label: "Show report",
  contexts: ["global"],
  defaults: [["Mod+Alt+r"]],
};

describe("registerPluginCommands", () => {
  it("derives the full id and admits the Command while registered", () => {
    expect(commandIds()).toEqual(COMMAND_IDS);
    register("echoes", { defaultLanguage: "en", commands: [base] });

    const id = "plugin.echoes.showReport" as const;
    expect(commandIds()).toContain(id);
    expect(isCommandId(id)).toBe(true);
    expect(pluginIdOfCommand(id)).toBe("echoes");

    const definition = getCommand(id);
    expect(isPluginCommandDef(definition)).toBe(true);
    if (!isPluginCommandDef(definition)) throw new Error("expected a Plugin Command");
    expect(definition.pluginId).toBe("echoes");
    expect(definition.localId).toBe("showReport");
    expect(definition.label).toBe("Show report");
    expect(definition.defaultLanguage).toBe("en");
    expect(definition.contexts).toEqual(["global"]);
    expect(definition.defaults).toEqual([["Mod+Alt+r"]]);
  });

  it("removes the Command when unregistered, keeping its id shape known", () => {
    const unregister = registerPluginCommands("echoes", {
      defaultLanguage: "en",
      commands: [base],
    });
    unregister();

    expect(commandIds()).not.toContain("plugin.echoes.showReport");
    expect(isCommandId("plugin.echoes.showReport")).toBe(false);
    expect(isPluginCommandId("plugin.echoes.showReport")).toBe(true);
    expect(() => getCommand("plugin.echoes.showReport")).toThrow(/Unknown Command/);
  });

  it("keeps a Plugin's Commands in declaration order, after the core Commands", () => {
    register("echoes", {
      defaultLanguage: "en",
      commands: [
        { ...base, id: "second" },
        { ...base, id: "first" },
      ],
    });
    const ids = commandIds();
    expect(ids.indexOf("plugin.echoes.second")).toBeLessThan(ids.indexOf("plugin.echoes.first"));
    expect(ids.indexOf("plugin.echoes.second")).toBeGreaterThan(COMMAND_IDS.length - 1);
  });

  it("refuses an id outside the Plugin's own namespace", () => {
    expect(() =>
      register("echoes", {
        defaultLanguage: "en",
        commands: [{ ...base, id: "plugin.other.showReport" }],
      })
    ).toThrow(/namespace/);
    expect(() =>
      register("echoes", {
        defaultLanguage: "en",
        commands: [{ ...base, id: "editor.save" }],
      })
    ).toThrow(/namespace/);
    expect(() =>
      register("echoes", { defaultLanguage: "en", commands: [{ ...base, id: "ShowReport" }] })
    ).toThrow(/namespace/);
  });

  it("refuses fixed and sealed", () => {
    const fixed = { ...base, fixed: [["Mod+Alt+r"]] } as unknown as PluginCommandDeclaration;
    const sealed = { ...base, sealed: true } as unknown as PluginCommandDeclaration;
    expect(() => register("echoes", { defaultLanguage: "en", commands: [fixed] })).toThrow(/fixed/);
    expect(() => register("echoes", { defaultLanguage: "en", commands: [sealed] })).toThrow(
      /sealed/
    );
  });

  it("resolves a page id to the Plugin's own Context", () => {
    register("echoes", {
      defaultLanguage: "en",
      pages: ["report"],
      commands: [{ ...base, contexts: ["report"] }],
    });
    const definition = getCommand("plugin.echoes.showReport");
    expect(definition.contexts).toEqual(["plugin.echoes.report"]);
  });

  it("refuses a page id equal to a core Context or the reserved plugin name", () => {
    expect(() =>
      register("echoes", { defaultLanguage: "en", pages: ["editor"], commands: [] })
    ).toThrow(/reserved/);
    expect(() =>
      register("echoes", { defaultLanguage: "en", pages: ["plugin"], commands: [] })
    ).toThrow(/reserved/);
  });

  it("refuses an unknown Context", () => {
    expect(() =>
      register("echoes", {
        defaultLanguage: "en",
        commands: [{ ...base, contexts: ["nowhere"] }],
      })
    ).toThrow(/Context/);
  });

  it("refuses a rename whose target is not declared in this Plugin", () => {
    expect(() =>
      register("echoes", {
        defaultLanguage: "en",
        commands: [base],
        commandRenames: { oldReport: "missing" },
      })
    ).toThrow(/rename/);
  });

  it("refuses a cross-owner rename, since only local ids can be expressed", () => {
    expect(() =>
      register("echoes", {
        defaultLanguage: "en",
        commands: [base],
        commandRenames: { oldReport: "plugin.other.showReport" },
      })
    ).toThrow(/rename/);
  });

  it("collapses a rename chain to the Command it ends at", () => {
    register("echoes", {
      defaultLanguage: "en",
      commands: [{ ...base, id: "third" }],
      commandRenames: { first: "second", second: "third" },
    });
    expect(resolvePluginCommandRename("plugin.echoes.first")).toBe("plugin.echoes.third");
    expect(resolvePluginCommandRename("plugin.echoes.second")).toBe("plugin.echoes.third");
    expect(pluginCommandRenames().get("echoes")).toEqual({ first: "third", second: "third" });
  });

  it("files a Plugin Command under the Plugins section", () => {
    register("echoes", { defaultLanguage: "en", commands: [base] });
    expect(commandSection("plugin.echoes.showReport")).toBe("plugins");
  });

  it("re-registers a Plugin in place, and an old unregister no longer removes it", () => {
    const first = register("echoes", { defaultLanguage: "en", commands: [base] });
    register("echoes", {
      defaultLanguage: "en",
      commands: [{ ...base, label: "Show echoes" }],
    });
    first();
    expect(commandIds()).toContain("plugin.echoes.showReport");
    const definition = getCommand("plugin.echoes.showReport");
    expect(isPluginCommandDef(definition) && definition.label).toBe("Show echoes");
  });

  it("refuses an invalid Plugin id", () => {
    expect(() => register("Echoes", { defaultLanguage: "en", commands: [base] })).toThrow(
      /Plugin id/
    );
  });

  it("refuses duplicate local ids and malformed Shortcuts", () => {
    expect(() => register("echoes", { defaultLanguage: "en", commands: [base, base] })).toThrow(
      /Duplicate/
    );
    expect(() =>
      register("echoes", {
        defaultLanguage: "en",
        commands: [{ ...base, defaults: [["NotAKey"]] }],
      })
    ).toThrow(/Shortcut/);
  });
});
