import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PluginToolbarButton } from "@/components/plugins/PluginToolbarButton";
import {
  registerPluginContributions,
  resetPluginContributionsForTests,
} from "@/features/plugins/contributions";
import { clearToolbarPressed, setToolbarPressed } from "@/features/plugins/toolbar-pressed";
import {
  registerPluginEditor,
  resetPluginEditorHostForTests,
} from "@/features/plugins/editor-host";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import { readPluginManifest } from "@/features/plugins/runtime";
import type { PluginLifecycle, PluginRuntime } from "@/features/plugins/types";
import type { Chapter } from "@/features/chapters/types";
import { useChapterStore } from "@/features/chapters/store";
import { platformMismatchManifest, pluginFolder } from "@/test/support/plugin-fixtures";

const cleanups: Array<() => void> = [];

let lifecycleStatus: "ready" | "stopped" = "ready";
let brokerRequest = vi.fn(async () => null);

vi.mock("@/hooks/usePluginSurface", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/hooks/usePluginSurface")>();
  return {
    ...mod,
    useInstalledPluginLifecycle: () => stubLifecycle,
    usePluginLifecycleRevision: () => 0,
    usePluginSurface: () => undefined,
  };
});

const stubLifecycle = {
  state: (pluginId: string) =>
    pluginId === "sample"
      ? lifecycleStatus === "ready"
        ? { status: "ready", startReason: "launch" }
        : { status: "stopped", reason: null, refusal: null }
      : null,
  runtime: (pluginId: string) =>
    pluginId === "sample" && lifecycleStatus === "ready"
      ? ({ broker: { request: brokerRequest }, stop: vi.fn() } as unknown as PluginRuntime)
      : null,
} as unknown as PluginLifecycle;

function registerSample(): void {
  const folder = pluginFolder(
    {},
    {
      id: "sample",
      name: "Sample",
      platforms: ["desktop"],
      contributes: {
        commands: [
          { id: "plain", label: "Plain", contexts: ["global"] },
          { id: "targeted", label: "Targeted", contexts: ["global"], targets: ["chapter"] },
          { id: "inEditor", label: "In editor", contexts: ["editor"] },
        ],
        toolbarButtons: [
          { id: "plainButton", command: "plain", icon: "book-open" },
          { id: "targetButton", command: "targeted", icon: "book-open" },
          { id: "editorButton", command: "inEditor", icon: "book-open" },
          {
            id: "inlineButton",
            command: "plain",
            icon: { elements: [["path", { d: "M4 20h16" }]] },
          },
          {
            id: "inlineToggle",
            command: "plain",
            icon: { elements: [["path", { d: "M4 20h16" }]] },
            toggle: true,
          },
        ],
      },
    }
  );
  const parsed = readPluginManifest(folder);
  if (!parsed.ok) throw new Error("fixture manifest is invalid");
  cleanups.push(registerPluginContributions({ manifest: parsed.manifest, folder }));
}

/** The #482 repro, registered without the validator (which now refuses it). */
function registerRepro(): void {
  cleanups.push(
    registerPluginContributions({
      manifest: platformMismatchManifest(),
      folder: { name: "probe", files: [] },
    })
  );
}

/** The button lives in the editor toolbar, so it always renders under the router. */
function renderButton(id: string, path = "/book/b1"): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <PluginToolbarButton id={id as never} iconSize="md" />
    </MemoryRouter>
  );
}

/** A Chapter open in the editor is the item the author is in. */
function seedOpenChapter(id: string): void {
  useChapterStore.setState({ currentChapter: { id } as unknown as Chapter });
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  resetPluginEditorHostForTests();
  resetPluginContributionsForTests();
  useChapterStore.setState({ currentChapter: null });
  lifecycleStatus = "ready";
  brokerRequest = vi.fn(async () => null);
});

describe("PluginToolbarButton with an inline icon (#531)", () => {
  it("renders the inline icon and follows the Plugin's ready state", () => {
    registerSample();
    lifecycleStatus = "stopped";
    const { unmount } = render(
      <MemoryRouter initialEntries={["/book/b1"]}>
        <PluginToolbarButton id={"plugin.sample.inlineButton" as never} iconSize="md" />
      </MemoryRouter>
    );
    const button = screen.getByRole("button", { name: "Plain" });
    expect(button.querySelector("svg path")?.getAttribute("d")).toBe("M4 20h16");
    expect(button).toBeDisabled();
    unmount();
    lifecycleStatus = "ready";
    renderButton("plugin.sample.inlineButton");
    expect(screen.getByRole("button", { name: "Plain" })).toBeEnabled();
  });
});

describe("PluginToolbarButton inline icon with a Toggle Button (#531)", () => {
  it("follows the pressed state the Plugin sets, alongside the disabled state", () => {
    registerSample();
    lifecycleStatus = "ready";
    const { unmount } = render(
      <MemoryRouter initialEntries={["/book/b1"]}>
        <PluginToolbarButton id={"plugin.sample.inlineToggle" as never} iconSize="md" />
      </MemoryRouter>
    );
    const button = screen.getByRole("button", { name: "Plain" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button.querySelector("svg path")?.getAttribute("d")).toBe("M4 20h16");
    act(() => setToolbarPressed("sample", "inlineToggle", true));
    expect(screen.getByRole("button", { name: "Plain" })).toHaveAttribute("aria-pressed", "true");
    unmount();
    lifecycleStatus = "stopped";
    renderButton("plugin.sample.inlineToggle");
    const stopped = screen.getByRole("button", { name: "Plain" });
    expect(stopped).toBeDisabled();
    expect(stopped).not.toHaveAttribute("aria-pressed", "true");
    clearToolbarPressed("sample");
    lifecycleStatus = "ready";
  });
});

describe("PluginToolbarButton with targets (#395, #446)", () => {
  it("stays visible but disabled when its Command needs a target and none is in context", () => {
    registerSample();

    renderButton("plugin.sample.targetButton");
    // Visible for discovery (#395: editor buttons remain visible), but unavailable:
    // an Item Menu supplies its item as the target, and with no suitable item in
    // context the Command is unavailable rather than guessed.
    const button = screen.getByRole("button", { name: "Targeted" });
    expect(button).toBeInTheDocument();
    expect(button).toBeDisabled();
  });

  it("enables a targetless Command once its Plugin is ready", () => {
    registerSample();

    renderButton("plugin.sample.plainButton");
    expect(screen.getByRole("button", { name: "Plain" })).toBeEnabled();
  });

  it("runs its Command from the keyboard once ready", async () => {
    registerSample();
    lifecycleStatus = "ready";
    const user = userEvent.setup();

    renderButton("plugin.sample.plainButton");
    const button = screen.getByRole("button", { name: "Plain" });
    button.focus();
    expect(button).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(brokerRequest).toHaveBeenCalledWith("command.run", { id: "plain" });
  });

  it("does nothing from the keyboard until ready", async () => {
    registerSample();
    lifecycleStatus = "stopped";
    const user = userEvent.setup();

    renderButton("plugin.sample.plainButton");
    const button = screen.getByRole("button", { name: "Plain" });
    expect(button).toBeDisabled();
    button.focus();
    await user.keyboard("{Enter}");

    expect(brokerRequest).not.toHaveBeenCalled();
  });

  it("enables a targeted Command with a Chapter open and runs it on that target from the keyboard", async () => {
    registerSample();
    seedOpenChapter("ch-1");
    const user = userEvent.setup();

    renderButton("plugin.sample.targetButton");
    const button = screen.getByRole("button", { name: "Targeted" });
    expect(button).toBeEnabled();
    button.focus();
    expect(button).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(brokerRequest).toHaveBeenCalledWith("command.run", {
      id: "targeted",
      target: { kind: "chapter", id: "ch-1" },
    });
  });

  it("keeps a targeted Command disabled with no Chapter open", () => {
    registerSample();

    renderButton("plugin.sample.targetButton");
    expect(screen.getByRole("button", { name: "Targeted" })).toBeDisabled();
  });
});

// #482: a toolbar button whose Command the platform filter dropped used to
// reach the editor toolbar, where reading its Command's label threw and
// crashed the toolbar.
describe("PluginToolbarButton with a filtered Command (#482)", () => {
  it("renders nothing instead of reading a Command the registry does not hold", () => {
    registerRepro();

    expect(() => renderButton("plugin.probe.b")).not.toThrow();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

// An `editor` Context Command acts on the target editor; with none on screen
// (the Embed editor registers none) the button is unavailable instead of a
// silent no-op.
describe("PluginToolbarButton for an editor Command", () => {
  function mountEditor(): Editor {
    const editor = new Editor({ extensions: createRichTextExtensions(), content: "<p>one</p>" });
    document.body.appendChild(editor.view.dom);
    cleanups.push(() => {
      editor.view.dom.remove();
      editor.destroy();
    });
    return editor;
  }

  it("is disabled while no editor is the target", () => {
    registerSample();

    renderButton("plugin.sample.editorButton");
    expect(screen.getByRole("button", { name: "In editor" })).toBeDisabled();
  });

  it("enables once an editor is on screen, without its caret, and runs from the keyboard", async () => {
    registerSample();
    const user = userEvent.setup();
    renderButton("plugin.sample.editorButton");
    const button = screen.getByRole("button", { name: "In editor" });
    expect(button).toBeDisabled();

    act(() => {
      registerPluginEditor({
        id: "e1",
        editor: mountEditor(),
        entity: { kind: "note", id: "n1" },
        language: "en",
      });
    });

    expect(button).toBeEnabled();
    button.focus();
    await user.keyboard("{Enter}");
    expect(brokerRequest).toHaveBeenCalledWith("command.run", { id: "inEditor" });
  });

  it("disables again once the editor unmounts", async () => {
    registerSample();
    renderButton("plugin.sample.editorButton");
    let dispose = () => {};
    act(() => {
      dispose = registerPluginEditor({
        id: "e1",
        editor: mountEditor(),
        entity: { kind: "ephemeral", id: "ephemeral" },
        language: "es",
      });
    });
    expect(screen.getByRole("button", { name: "In editor" })).toBeEnabled();

    act(() => dispose());

    await waitFor(() => expect(screen.getByRole("button", { name: "In editor" })).toBeDisabled());
  });
});
