import { beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import i18n from "@/i18n";
import {
  registerPluginContributions,
  resetPluginContributionsForTests,
} from "@/features/plugins/contributions";
import { resetPluginEditorHostForTests, registerPluginEditor } from "@/features/plugins/editor-host";
import { readPluginManifest } from "@/features/plugins/runtime";
import { PLUGIN_MANIFEST, pluginFolder } from "@/test/support/plugin-fixtures";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";

const { mockGetDatabase } = vi.hoisted(() => ({ mockGetDatabase: vi.fn() }));

vi.mock("@/lib/db", () => ({ getDatabase: mockGetDatabase }));

const { createPluginHandlers } = await import("@/features/plugins/handlers");
const { setPluginNavigator } = await import("@/features/plugins/navigation");

const context = { pluginId: "tracer" };

describe("createPluginHandlers(): the wired rows", () => {
  let testDb: DatabaseAdapter;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(testDb);
    await testDb.execute(
      `INSERT INTO books (id, title, subtitle, author_name, language, word_count, created_at, updated_at)
       VALUES ('b1', 'Dune', NULL, 'Frank', 'en', 10, 100, 1000)`
    );
    await testDb.execute(
      `INSERT INTO chapters (id, book_id, title, content, "order", parent_id, word_count, created_at, updated_at)
       VALUES ('c1', 'b1', 'One', '<p>Hello <script>x</script></p>', 0, NULL, 1, 100, 2000)`
    );
  });

  it("serves the Library through the real handlers", async () => {
    const handlers = createPluginHandlers(PLUGIN_MANIFEST);
    const list = handlers["library.books.list"];
    const get = handlers["library.books.get"];
    const chapter = handlers["library.chapters.get"];
    if (!list || !get || !chapter) throw new Error("Library rows are not wired");

    await expect(list({}, context)).resolves.toMatchObject([{ id: "b1", updatedAt: 1_000_000 }]);
    await expect(get({ bookId: "b1" }, context)).resolves.toMatchObject({ id: "b1" });
    const stored = await chapter({ chapterId: "c1" }, context);
    expect(stored).toMatchObject({ id: "c1" });
    expect(stored?.content.html).not.toContain("<script");
  });

  it("keeps each Plugin's storage in its own namespace through the handlers", async () => {
    const handlers = createPluginHandlers(PLUGIN_MANIFEST);
    const set = handlers["storage.set"];
    const get = handlers["storage.get"];
    const keys = handlers["storage.keys"];
    const del = handlers["storage.delete"];
    if (!set || !get || !keys || !del) throw new Error("storage rows are not wired");

    await expect(get({ key: "missing" }, context)).resolves.toBeNull();
    await expect(set({ key: "a", value: { n: 1 } }, context)).resolves.toBeNull();
    await expect(get({ key: "a" }, context)).resolves.toEqual({ n: 1 });
    await expect(keys({}, context)).resolves.toEqual(["a"]);
    await del({ key: "a" }, context);
    await expect(keys({}, context)).resolves.toEqual([]);

    const other = { pluginId: "other" };
    await set({ key: "a", value: "mine" }, other);
    await expect(get({ key: "a" }, context)).resolves.toBeNull();
  });

  it("opens an entity through the registered navigator", async () => {
    const navigate = vi.fn();
    const unregister = setPluginNavigator(navigate);
    try {
      const open = createPluginHandlers(PLUGIN_MANIFEST)["navigation.openEntity"];
      if (!open) throw new Error("navigation.openEntity is not wired");
      await expect(
        open({ entity: { kind: "chapter", id: "c1" } }, context)
      ).resolves.toBeNull();
      expect(navigate).toHaveBeenCalledWith("/book/b1", {
        state: { openChapterId: "c1" },
      });
    } finally {
      unregister();
    }
  });

  it("opens a Plugin page, defaulting to the caller's own Plugin", async () => {
    const folder = pluginFolder(
      {},
      {
        id: "tracer",
        name: "Tracer",
        platforms: ["desktop"],
        contributes: {
          commands: [{ id: "open", label: "Open", contexts: ["global"], navigates: true }],
          pages: [{ id: "report", title: "Report", command: "open" }],
        },
      }
    );
    const parsed = readPluginManifest(folder);
    if (!parsed.ok) throw new Error("fixture manifest is invalid");
    const unregisterContrib = registerPluginContributions({ manifest: parsed.manifest, folder });
    const navigate = vi.fn();
    const unregisterNav = setPluginNavigator(navigate);
    try {
      const open = createPluginHandlers(PLUGIN_MANIFEST)["navigation.openPage"];
      if (!open) throw new Error("navigation.openPage is not wired");
      // No pluginId: the caller's own Plugin, taken from the handler context.
      await expect(open({ pageId: "report" }, context)).resolves.toEqual({ status: "opened" });
      expect(navigate).toHaveBeenCalledWith("/plugin/tracer/report");
      await expect(open({ pageId: "ghost" }, context)).resolves.toEqual({ status: "not-found" });
    } finally {
      unregisterNav();
      unregisterContrib();
      resetPluginContributionsForTests();
    }
  });

  it("reads the app language through language.get", async () => {
    const read = createPluginHandlers(PLUGIN_MANIFEST)["language.get"];
    if (!read) throw new Error("language.get is not wired");
    await i18n.changeLanguage("es");
    try {
      await expect(read({}, context)).resolves.toEqual({ language: "es" });
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("returns a typed no-target from the editor rows with no focused editor", async () => {
    resetPluginEditorHostForTests();
    const handlers = createPluginHandlers(PLUGIN_MANIFEST);
    expect(handlers["editor.getContent"]?.({}, context)).toEqual({ status: "no-target" });
    expect(handlers["editor.getSelection"]?.({}, context)).toEqual({ status: "no-target" });
    expect(handlers["editor.reveal"]?.({ range: { from: 0, to: 1 } }, context)).toEqual({
      status: "no-target",
    });
    expect(
      handlers["editor.setHighlights"]?.({ kind: "info", ranges: [] }, context)
    ).toEqual({ status: "no-target" });
  });

  it("serves the focused editor through the wired handlers", async () => {
    resetPluginEditorHostForTests();
    const editor = new Editor({ extensions: createRichTextExtensions(), content: "<p>Hello</p>" });
    document.body.appendChild(editor.view.dom);
    editor.view.dom.focus();
    const unregister = registerPluginEditor({
      id: "handler-editor",
      editor,
      entity: { kind: "chapter", id: "c1" },
    });
    try {
      const handlers = createPluginHandlers(PLUGIN_MANIFEST);
      expect(handlers["editor.getContent"]?.({}, context)).toMatchObject({
        status: "ok",
        entity: { kind: "chapter", id: "c1" },
        content: { text: "Hello" },
      });
      expect(
        handlers["editor.setHighlights"]?.(
          { kind: "info", ranges: [{ from: 0, to: 5 }] },
          { pluginId: "tracer" }
        )
      ).toEqual({ status: "applied" });
      expect(editor.view.dom.querySelectorAll(".plugin-highlight--info")).toHaveLength(1);
    } finally {
      unregister();
      editor.view.dom.remove();
      editor.destroy();
    }
  });
});
