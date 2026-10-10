import { describe, expect, it } from "vitest";
import type { ManifestProblem } from "@/features/plugins/manifest-validate";
import {
  CONTRIBUTION_LIMITS,
  MAX_LOCALE_BYTES,
  MAX_MANIFEST_BYTES,
  parsePluginLocale,
  parsePluginManifest,
  validateManifestValue,
} from "@/features/plugins/manifest-validate";

type Mutable = Record<string, any>;

function baseManifest(): Mutable {
  return {
    manifestVersion: 1,
    id: "echoes",
    name: "Echoes",
    description: "Highlights overused words and repeated phrases.",
    author: "Andy",
    version: "1.0.0",
    apiVersion: "^0.3",
    minAppVersion: "0.11.0",
    homepage: "https://example.com/echoes",
    entry: "dist/index.js",
    platforms: ["desktop", "web", "android"],
    lifecycle: "on-demand",
    defaultLanguage: "en",
    permissions: {
      required: ["library:read"],
      optional: ["editor:decorate", "network:api.example.com"],
    },
    dataVersion: 2,
    customUi: false,
    contributes: {
      commands: [
        {
          id: "showReport",
          label: "Show report",
          keywords: ["echo", "report"],
          contexts: ["editor", "report"],
          defaults: [["Mod+Alt+r"]],
          web: [["Mod+Alt+Shift+r"]],
          targets: ["chapter"],
          navigates: true,
          voice: { phrases: { en: ["show echoes report"] } },
        },
      ],
      pages: [{ id: "report", title: "Echoes", command: "showReport" }],
      sidebarEntries: [{ page: "report", icon: "search" }],
      settingsRows: [{ id: "ignore", label: "Ignored words", keywords: ["skip"] }],
      toolbarButtons: [{ id: "toggle", command: "showReport", icon: "highlighter" }],
      itemMenuEntries: [{ command: "showReport" }],
    },
    commandRenames: { oldReport: "showReport" },
    rowRenames: { oldRow: "ignore" },
    buttonRenames: { oldButton: "toggle" },
  };
}

function problemsFor(
  change: (manifest: Mutable) => void,
  options?: Parameters<typeof validateManifestValue>[1]
): ManifestProblem[] {
  const manifest = baseManifest();
  change(manifest);
  const result = validateManifestValue(manifest, options);
  if (result.ok) throw new Error("expected the manifest to be refused");
  return result.problems;
}

function expectProblem(problems: ManifestProblem[], path: string, message: RegExp = /.*/u): void {
  const found = problems.find((problem) => problem.path === path && message.test(problem.message));
  expect(
    found,
    `no problem at "${path}" matching ${message}; got ${JSON.stringify(problems)}`
  ).toBeDefined();
}

describe("validateManifestValue: valid manifests", () => {
  it("accepts the full base manifest and keeps its fields", () => {
    const result = validateManifestValue(baseManifest());
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    expect(result.manifest.id).toBe("echoes");
    expect(result.manifest.permissions.required).toEqual(["library:read"]);
    expect(result.manifest.contributes?.commands?.[0].id).toBe("showReport");
  });

  it("collapses rename chains in the returned manifest", () => {
    const result = validateManifestValue(
      baseManifestWith((manifest) => {
        manifest.contributes.commands.push({
          id: "third",
          label: "Third",
          contexts: ["global"],
        });
        manifest.commandRenames = { first: "second", second: "third" };
      })
    );
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    expect(result.manifest.commandRenames).toEqual({ first: "third", second: "third" });
  });

  it("allows x-* keys at every level and keeps them", () => {
    const result = validateManifestValue(
      baseManifestWith((manifest) => {
        manifest["x-dev-note"] = "scratch";
        manifest.contributes.commands[0]["x-command-note"] = true;
        manifest.permissions["x-permissions-note"] = "kept";
      })
    );
    expect(result.ok).toBe(true);
  });

  it("accepts an empty contributes object and no contributes at all", () => {
    for (const clear of [
      (m: Mutable) => (m.contributes = {}),
      (m: Mutable) => delete m.contributes,
    ]) {
      const result = validateManifestValue(
        baseManifestWith((m) => {
          clear(m);
          delete m.commandRenames;
          delete m.rowRenames;
          delete m.buttonRenames;
        })
      );
      expect(result.ok, JSON.stringify(result)).toBe(true);
    }
  });
});

function baseManifestWith(change: (manifest: Mutable) => void): Mutable {
  const manifest = baseManifest();
  change(manifest);
  return manifest;
}

describe("validateManifestValue: unknown fields", () => {
  it("refuses an unknown top-level field", () => {
    expectProblem(
      problemsFor((m) => (m.permisions = {})),
      "permisions",
      /[Uu]nknown field/
    );
  });

  it("refuses fixed and sealed on a Command", () => {
    expectProblem(
      problemsFor((m) => (m.contributes.commands[0].fixed = [["Mod+Alt+r"]])),
      "contributes.commands[0].fixed",
      /[Uu]nknown field/
    );
    expectProblem(
      problemsFor((m) => (m.contributes.commands[0].sealed = true)),
      "contributes.commands[0].sealed",
      /[Uu]nknown field/
    );
  });

  it("refuses an unknown permission-shape field", () => {
    expectProblem(
      problemsFor((m) => (m.permissions.recommended = [])),
      "permissions.recommended",
      /[Uu]nknown field/
    );
  });
});

describe("validateManifestValue: required fields and basic shapes", () => {
  const required: Array<[string, string]> = [
    ["manifestVersion", "manifestVersion"],
    ["id", "id"],
    ["name", "name"],
    ["description", "description"],
    ["author", "author"],
    ["version", "version"],
    ["apiVersion", "apiVersion"],
    ["entry", "entry"],
    ["platforms", "platforms"],
    ["lifecycle", "lifecycle"],
    ["defaultLanguage", "defaultLanguage"],
    ["permissions", "permissions"],
  ];

  for (const [, field] of required) {
    it(`requires ${field}`, () => {
      expectProblem(
        problemsFor((m) => delete m[field]),
        field
      );
    });
  }

  it("refuses manifestVersion other than 1", () => {
    expectProblem(
      problemsFor((m) => (m.manifestVersion = 2)),
      "manifestVersion"
    );
  });

  it("refuses empty name, description, and author", () => {
    expectProblem(
      problemsFor((m) => (m.name = "")),
      "name"
    );
    expectProblem(
      problemsFor((m) => (m.description = "")),
      "description"
    );
    expectProblem(
      problemsFor((m) => (m.author = "")),
      "author"
    );
  });
});

describe("validateManifestValue: ids", () => {
  it("refuses ids outside the slug pattern", () => {
    for (const id of ["ab", "a".repeat(65), "Echoes", "echo es", "echoes_plugin"]) {
      expectProblem(
        problemsFor((m) => (m.id = id)),
        "id"
      );
    }
  });

  it("refuses the reserved prefixes", () => {
    expectProblem(
      problemsFor((m) => (m.id = "maibuk-echoes")),
      "id",
      /reserved/
    );
    expectProblem(
      problemsFor((m) => (m.id = "tutorial-echoes")),
      "id",
      /reserved/
    );
  });

  it("allows maibuk- for Built-in Plugins but never tutorial-", () => {
    const builtIn = validateManifestValue(
      baseManifestWith((m) => (m.id = "maibuk-echoes")),
      { builtIn: true }
    );
    expect(builtIn.ok).toBe(true);
    expectProblem(
      problemsFor((m) => (m.id = "tutorial-echoes"), { builtIn: true }),
      "id",
      /reserved/
    );
  });
});

describe("validateManifestValue: version fields", () => {
  it("refuses a version that is not semver", () => {
    expectProblem(
      problemsFor((m) => (m.version = "1.0")),
      "version"
    );
    expectProblem(
      problemsFor((m) => (m.version = "v1.0.0")),
      "version"
    );
    expectProblem(
      problemsFor((m) => (m.version = "01.2.3")),
      "version"
    );
    expectProblem(
      problemsFor((m) => (m.minAppVersion = "01.2.3")),
      "minAppVersion"
    );
  });

  it("accepts a prerelease Plugin version", () => {
    expect(validateManifestValue(baseManifestWith((m) => (m.version = "1.0.0-beta.2"))).ok).toBe(
      true
    );
  });

  it("refuses an apiVersion that is not a supported range", () => {
    for (const range of ["", "^", "1.2.3 - 2.0.0", "latest"]) {
      expectProblem(
        problemsFor((m) => (m.apiVersion = range)),
        "apiVersion"
      );
    }
  });

  it("accepts the supported range syntaxes", () => {
    for (const range of ["*", "0.3.0", "^0.3", "~0.3.1", ">=0.3.0 <0.5.0", "^0.1 || ^0.3"]) {
      expect(validateManifestValue(baseManifestWith((m) => (m.apiVersion = range))).ok, range).toBe(
        true
      );
    }
  });

  it("refuses a minAppVersion that is not a concrete version", () => {
    expectProblem(
      problemsFor((m) => (m.minAppVersion = "^0.11.0")),
      "minAppVersion"
    );
    expectProblem(
      problemsFor((m) => (m.minAppVersion = "0.11")),
      "minAppVersion"
    );
  });
});

describe("validateManifestValue: entry and homepage", () => {
  it("refuses an entry that is not a relative module path", () => {
    for (const entry of [
      "",
      "/dist/index.js",
      "../index.js",
      "dist/../index.js",
      "dist\\index.js",
      "https://example.com/index.js",
      "dist/index.js?x=1",
      "dist/index.js#x",
      "dist/index.ts",
      "dist/",
    ]) {
      expectProblem(
        problemsFor((m) => (m.entry = entry)),
        "entry"
      );
    }
  });

  it("accepts .js and .mjs relative entries in subfolders", () => {
    for (const entry of ["index.js", "dist/index.js", "dist/main.mjs", "./dist/index.js"]) {
      expect(validateManifestValue(baseManifestWith((m) => (m.entry = entry))).ok, entry).toBe(
        true
      );
    }
  });

  it("refuses a homepage that is not an http(s) URL", () => {
    expectProblem(
      problemsFor((m) => (m.homepage = "ftp://example.com")),
      "homepage"
    );
    expectProblem(
      problemsFor((m) => (m.homepage = "example.com")),
      "homepage"
    );
  });
});

describe("validateManifestValue: platforms, lifecycle, language, dataVersion, customUi", () => {
  it("refuses an empty, duplicated, or unknown platforms list", () => {
    expectProblem(
      problemsFor((m) => (m.platforms = [])),
      "platforms"
    );
    expectProblem(
      problemsFor((m) => (m.platforms = ["desktop", "desktop"])),
      "platforms"
    );
    expectProblem(
      problemsFor((m) => (m.platforms = ["ios"])),
      "platforms[0]"
    );
  });

  it("refuses an unknown lifecycle", () => {
    expectProblem(
      problemsFor((m) => (m.lifecycle = "lazy")),
      "lifecycle"
    );
  });

  it("refuses an unknown defaultLanguage", () => {
    expectProblem(
      problemsFor((m) => (m.defaultLanguage = "fr")),
      "defaultLanguage"
    );
  });

  it("refuses a dataVersion below 1 or not an integer", () => {
    expectProblem(
      problemsFor((m) => (m.dataVersion = 0)),
      "dataVersion"
    );
    expectProblem(
      problemsFor((m) => (m.dataVersion = 1.5)),
      "dataVersion"
    );
  });

  it("defaults dataVersion to 1 and keeps an explicit one", () => {
    const withoutDataVersion = validateManifestValue(baseManifestWith((m) => delete m.dataVersion));
    if (!withoutDataVersion.ok) throw new Error(JSON.stringify(withoutDataVersion.problems));
    expect(withoutDataVersion.manifest.dataVersion).toBe(1);

    const explicit = validateManifestValue(baseManifestWith((m) => (m.dataVersion = 4)));
    if (!explicit.ok) throw new Error(JSON.stringify(explicit.problems));
    expect(explicit.manifest.dataVersion).toBe(4);
  });

  it("refuses a non-boolean customUi", () => {
    expectProblem(
      problemsFor((m) => (m.customUi = "yes")),
      "customUi"
    );
  });

  it("refuses a contribution platform outside the Plugin's own", () => {
    expectProblem(
      problemsFor((m) => {
        m.platforms = ["desktop", "web"];
        m.contributes.commands[0].platforms = ["android"];
      }),
      "contributes.commands[0].platforms",
      /platforms/
    );
  });
});

describe("validateManifestValue: permissions", () => {
  it("accepts every exact permission string", () => {
    for (const permission of [
      "library:read",
      "library:write",
      "editor:read",
      "editor:decorate",
      "editor:write",
      "secrets",
      "clipboard",
      "process",
    ]) {
      const result = validateManifestValue(
        baseManifestWith((m) => (m.permissions = { required: [permission], optional: [] }))
      );
      expect(result.ok, permission).toBe(true);
    }
  });

  it("accepts network hosts, including a leading wildcard label", () => {
    for (const host of [
      "example.com",
      "api.example.com",
      "*.example.com",
      "localhost",
      "192.168.1.1",
    ]) {
      const result = validateManifestValue(
        baseManifestWith((m) => (m.permissions = { required: [`network:${host}`], optional: [] }))
      );
      expect(result.ok, host).toBe(true);
    }
  });

  it("refuses a bare wildcard host, an empty host, and malformed hosts", () => {
    for (const host of [
      "*",
      "",
      "*.",
      "EXample.com",
      "exa mple.com",
      "-example.com",
      "example-.com",
      "example.com.",
    ]) {
      expectProblem(
        problemsFor((m) => (m.permissions.required = [`network:${host}`])),
        "permissions.required[0]",
        /host/
      );
    }
  });

  it("refuses unknown permission namespaces", () => {
    expectProblem(
      problemsFor((m) => (m.permissions.required = ["network"])),
      "permissions.required[0]"
    );
    expectProblem(
      problemsFor((m) => (m.permissions.optional = ["filesystem:read"])),
      "permissions.optional[0]"
    );
  });

  it("refuses the same permission twice, across the two sets included", () => {
    expectProblem(
      problemsFor((m) => (m.permissions.required = ["library:read", "library:read"])),
      "permissions.required[1]",
      /duplicate/i
    );
    expectProblem(
      problemsFor((m) => (m.permissions.optional = ["library:read"])),
      "permissions.optional[0]",
      /both/i
    );
  });
});

describe("validateManifestValue: contribution counts", () => {
  it("refuses more entries than the cap allows", () => {
    const commands = Array.from({ length: CONTRIBUTION_LIMITS.commands + 1 }, (_, index) => ({
      id: `command${index}`,
      label: `Command ${index}`,
      contexts: ["global"],
    }));
    expectProblem(
      problemsFor((m) => (m.contributes.commands = commands)),
      "contributes.commands",
      /at most 50/
    );
  });
});

describe("validateManifestValue: commands", () => {
  it("refuses a local id outside the camelCase pattern, or a duplicate", () => {
    expectProblem(
      problemsFor((m) => (m.contributes.commands[0].id = "Show_Report")),
      "contributes.commands[0].id"
    );
    expectProblem(
      problemsFor((m) => {
        m.contributes.commands.push({ id: "showReport", label: "Again", contexts: ["global"] });
      }),
      "contributes.commands[1].id",
      /duplicate/i
    );
  });

  it("refuses an unknown Context and a page Context that is not declared", () => {
    expectProblem(
      problemsFor((m) => (m.contributes.commands[0].contexts = ["nowhere"])),
      "contributes.commands[0].contexts[0]",
      /Context/
    );
    expectProblem(
      problemsFor((m) => (m.contributes.commands[0].contexts = ["missingPage"])),
      "contributes.commands[0].contexts[0]",
      /Context/
    );
  });

  it("refuses a page id that takes a core Context name", () => {
    expectProblem(
      problemsFor((m) => {
        m.contributes.pages[0].id = "editor";
        m.contributes.commands[0].contexts = ["editor"];
      }),
      "contributes.pages[0].id",
      /Context/
    );
    expectProblem(
      problemsFor((m) => (m.contributes.pages[0].id = "plugin")),
      "contributes.pages[0].id",
      /Context/
    );
  });

  it("refuses navigates and opensDialog values that are not true", () => {
    expectProblem(
      problemsFor((m) => (m.contributes.commands[0].navigates = false)),
      "contributes.commands[0].navigates"
    );
    expectProblem(
      problemsFor((m) => (m.contributes.commands[0].opensDialog = false)),
      "contributes.commands[0].opensDialog"
    );
  });

  it("refuses a Shortcut that does not normalize", () => {
    expectProblem(
      problemsFor((m) => (m.contributes.commands[0].defaults = [["NotAKey"]])),
      "contributes.commands[0].defaults[0][0]",
      /Shortcut/
    );
    expectProblem(
      problemsFor(
        (m) => (m.contributes.commands[0].defaults = [["Mod+Alt+r", "Mod+Alt+t", "Mod+Alt+y"]])
      ),
      "contributes.commands[0].defaults[0]"
    );
    expectProblem(
      problemsFor((m) => (m.contributes.commands[0].defaults = [["Enter"]])),
      "contributes.commands[0].defaults[0][0]"
    );
  });

  it("refuses a web Shortcut the browser keeps", () => {
    expectProblem(
      problemsFor((m) => (m.contributes.commands[0].web = [["Mod+t"]])),
      "contributes.commands[0].web[0][0]",
      /web/i
    );
  });

  it("refuses empty or duplicated Contexts and targets", () => {
    expectProblem(
      problemsFor((m) => (m.contributes.commands[0].contexts = [])),
      "contributes.commands[0].contexts"
    );
    expectProblem(
      problemsFor((m) => (m.contributes.commands[0].contexts = ["editor", "editor"])),
      "contributes.commands[0].contexts[1]"
    );
    expectProblem(
      problemsFor((m) => (m.contributes.commands[0].targets = [])),
      "contributes.commands[0].targets"
    );
    expectProblem(
      problemsFor((m) => (m.contributes.commands[0].targets = ["chapter", "chapter"])),
      "contributes.commands[0].targets[1]"
    );
    expectProblem(
      problemsFor((m) => (m.contributes.commands[0].targets = ["paragraph"])),
      "contributes.commands[0].targets[0]"
    );
  });

  it("refuses a voice spec that would never answer", () => {
    expectProblem(
      problemsFor((m) => (m.contributes.commands[0].voice = { phrases: { fr: ["bonjour"] } })),
      "contributes.commands[0].voice.phrases.fr",
      /[Uu]nknown field/
    );
    expectProblem(
      problemsFor((m) => (m.contributes.commands[0].voice = { phrases: { en: ["bold"] } })),
      "contributes.commands[0].voice.phrases.en[0]",
      /phrase/i
    );
    expectProblem(
      problemsFor((m) => (m.contributes.commands[0].voice = { verbs: ["wobble"] })),
      "contributes.commands[0].voice.verbs[0]"
    );
    expectProblem(
      problemsFor(
        (m) =>
          (m.contributes.commands[0].voice = {
            phrases: { en: ["show report", "show report"] },
          })
      ),
      "contributes.commands[0].voice.phrases.en[1]",
      /duplicate/i
    );
  });

  it("refuses an empty voice spec", () => {
    expectProblem(
      problemsFor((m) => (m.contributes.commands[0].voice = {})),
      "contributes.commands[0].voice",
      /voice/i
    );
  });
});

describe("validateManifestValue: pages, sidebar entries, toolbar buttons, Item Menu entries", () => {
  it("refuses a page whose command is missing or does not navigate", () => {
    expectProblem(
      problemsFor((m) => (m.contributes.pages[0].command = "missing")),
      "contributes.pages[0].command",
      /declared Command/
    );
    expectProblem(
      problemsFor((m) => {
        delete m.contributes.commands[0].navigates;
      }),
      "contributes.pages[0].command",
      /navigates/
    );
  });

  it("refuses a duplicate page id", () => {
    expectProblem(
      problemsFor((m) =>
        m.contributes.pages.push({ id: "report", title: "Again", command: "showReport" })
      ),
      "contributes.pages[1].id",
      /duplicate/i
    );
  });

  it("refuses a sidebar entry whose page is missing, or lists one twice", () => {
    expectProblem(
      problemsFor((m) => (m.contributes.sidebarEntries[0].page = "missing")),
      "contributes.sidebarEntries[0].page",
      /declared page/
    );
    expectProblem(
      problemsFor((m) => m.contributes.sidebarEntries.push({ page: "report", icon: "search" })),
      "contributes.sidebarEntries[1].page",
      /duplicate/i
    );
  });

  it("refuses a toolbar button or Item Menu entry without its Command", () => {
    expectProblem(
      problemsFor((m) => (m.contributes.toolbarButtons[0].command = "missing")),
      "contributes.toolbarButtons[0].command",
      /declared Command/
    );
    expectProblem(
      problemsFor((m) => (m.contributes.itemMenuEntries[0].command = "missing")),
      "contributes.itemMenuEntries[0].command",
      /declared Command/
    );
  });

  it("refuses an Item Menu entry whose Command declares no targets", () => {
    expectProblem(
      problemsFor((m) => {
        delete m.contributes.commands[0].targets;
      }),
      "contributes.itemMenuEntries[0].command",
      /targets/
    );
  });

  it("refuses the same Command listed twice in an Item Menu", () => {
    expectProblem(
      problemsFor((m) => m.contributes.itemMenuEntries.push({ command: "showReport" })),
      "contributes.itemMenuEntries[1].command",
      /duplicate/i
    );
  });

  it("refuses duplicate Settings row ids", () => {
    expectProblem(
      problemsFor((m) => m.contributes.settingsRows.push({ id: "ignore", label: "Again" })),
      "contributes.settingsRows[1].id",
      /duplicate/i
    );
  });
});

describe("validateManifestValue: rename maps", () => {
  it("refuses a rename whose target is not declared", () => {
    expectProblem(
      problemsFor((m) => (m.commandRenames = { old: "missing" })),
      "commandRenames.old",
      /declared/
    );
  });

  it("refuses a rename whose source is still declared", () => {
    expectProblem(
      problemsFor((m) => (m.commandRenames = { showReport: "old" })),
      "commandRenames.showReport",
      /declared/
    );
  });

  it("refuses a rename cycle", () => {
    expectProblem(
      problemsFor((m) => {
        m.contributes.commands.push({ id: "other", label: "Other", contexts: ["global"] });
        m.commandRenames = { first: "second", second: "first" };
      }),
      "commandRenames",
      /cycle/
    );
  });

  it("validates each rename kind against its own contribution kind", () => {
    expectProblem(
      problemsFor((m) => (m.rowRenames = { oldRow: "showReport" })),
      "rowRenames.oldRow",
      /row/
    );
    expectProblem(
      problemsFor((m) => (m.buttonRenames = { oldButton: "report" })),
      "buttonRenames.oldButton",
      /button/
    );
  });
});

describe("validateManifestValue: icons", () => {
  it("accepts a known Lucide name and a relative .svg path", () => {
    expect(
      validateManifestValue(
        baseManifestWith((m) => (m.contributes.sidebarEntries[0].icon = "book-open"))
      ).ok
    ).toBe(true);
    expect(
      validateManifestValue(
        baseManifestWith((m) => (m.contributes.toolbarButtons[0].icon = "icons/echo.svg"))
      ).ok
    ).toBe(true);
  });

  it("refuses an unknown Lucide name", () => {
    expectProblem(
      problemsFor((m) => (m.contributes.sidebarEntries[0].icon = "not-an-icon")),
      "contributes.sidebarEntries[0].icon",
      /Lucide/
    );
  });

  it("refuses an .svg path outside the Plugin folder or not an svg", () => {
    for (const icon of [
      "../icon.svg",
      "/icons/icon.svg",
      "icons\\icon.svg",
      "https://x/icon.svg",
      "icons/icon.png",
    ]) {
      expectProblem(
        problemsFor((m) => (m.contributes.toolbarButtons[0].icon = icon)),
        "contributes.toolbarButtons[0].icon",
        /svg|Lucide/i
      );
    }
  });
});

describe("parsePluginManifest", () => {
  it("parses a JSON manifest text", () => {
    const result = parsePluginManifest(JSON.stringify(baseManifest()));
    expect(result.ok).toBe(true);
  });

  it("refuses text that is not JSON", () => {
    const result = parsePluginManifest("{ not json");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0].path).toBe("");
    expect(result.problems[0].message).toMatch(/JSON/);
  });

  it("refuses a manifest over the size cap", () => {
    const result = parsePluginManifest("x".repeat(MAX_MANIFEST_BYTES + 1));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0].message).toMatch(/64 KB/);
  });

  it("reads the size in UTF-8 bytes, not characters", () => {
    const padding = "é".repeat(Math.floor(MAX_MANIFEST_BYTES / 2) + 1);
    const result = parsePluginManifest(padding);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0].message).toMatch(/64 KB/);
  });
});

describe("parsePluginLocale", () => {
  function manifest() {
    const result = validateManifestValue(baseManifest());
    if (!result.ok) throw new Error("base manifest must be valid");
    return result.manifest;
  }

  it("accepts overrides for labels, titles, descriptions, keywords, and the Plugin name", () => {
    const result = parsePluginLocale(
      JSON.stringify({
        name: "Ecos",
        description: "Resalta palabras repetidas.",
        "commands.showReport.label": "Mostrar informe",
        "commands.showReport.keywords": ["eco", "informe"],
        "pages.report.title": "Ecos",
        "settingsRows.ignore.label": "Palabras ignoradas",
        "settingsRows.ignore.description": "Se omiten al buscar.",
        "settingsRows.ignore.keywords": ["omitir"],
        "x-tool": "kept",
      }),
      "es",
      manifest()
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.locale["commands.showReport.label"]).toBe("Mostrar informe");
  });

  it("accepts an empty locale object", () => {
    expect(parsePluginLocale("{}", "es", manifest()).ok).toBe(true);
  });

  it("refuses an unknown field path", () => {
    const result = parsePluginLocale(
      JSON.stringify({ "commands.missing.label": "x" }),
      "es",
      manifest()
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0].path).toBe("commands.missing.label");
  });

  it("refuses a path that is not overridable", () => {
    for (const path of [
      "author",
      "permissions.required",
      "commands.showReport.id",
      "commands.showReport.contexts",
      "commands.showReport.voice.phrases.en",
      "sidebarEntries.0.icon",
    ]) {
      expect(parsePluginLocale(JSON.stringify({ [path]: "x" }), "es", manifest()).ok, path).toBe(
        false
      );
    }
  });

  it("refuses a value that does not match the field kind", () => {
    const keywordAsString = parsePluginLocale(
      JSON.stringify({ "commands.showReport.keywords": "eco" }),
      "es",
      manifest()
    );
    expect(keywordAsString.ok).toBe(false);
    const labelAsArray = parsePluginLocale(
      JSON.stringify({ "commands.showReport.label": ["eco"] }),
      "es",
      manifest()
    );
    expect(labelAsArray.ok).toBe(false);
  });

  it("refuses a locale file over the size cap", () => {
    const result = parsePluginLocale(
      `{"name":"${"x".repeat(MAX_LOCALE_BYTES)}"}`,
      "es",
      manifest()
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0].message).toMatch(/64 KB/);
  });

  it("refuses an unsupported language", () => {
    const result = parsePluginLocale("{}", "fr", manifest());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0].message).toMatch(/language/);
  });

  it("refuses locale text that is not a JSON object", () => {
    expect(parsePluginLocale("[]", "es", manifest()).ok).toBe(false);
    expect(parsePluginLocale("nope", "es", manifest()).ok).toBe(false);
  });
});
