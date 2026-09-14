import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useModalStore } from "@/components/ui/modal-store";
import { useBoundShortcutIds, useBoundShortcuts } from "@/lib/bound-shortcuts";
import { matchKeys } from "@/lib/shortcut-registry";
import { useShortcuts } from "@/lib/shortcuts";

vi.mock("@/lib/platform", () => ({ isMac: () => false }));

function SaveBinding({
  enabled = true,
  entryEnabled = true,
  onSave = () => {},
}: {
  enabled?: boolean;
  entryEnabled?: boolean;
  onSave?: () => void;
}) {
  useShortcuts(
    [
      {
        id: "editor.save",
        keys: matchKeys("editor.save"),
        onTrigger: onSave,
        allowInInput: true,
        enabled: entryEnabled,
      },
      // No id: it works, but it is not a registry shortcut and never listed.
      { keys: "escape", onTrigger: () => {} },
    ],
    { enabled }
  );
  return null;
}

function BoundList() {
  const bound = useBoundShortcuts();
  return <output data-testid="bound">{bound.join(",")}</output>;
}

function bound() {
  return screen.getByTestId("bound").textContent;
}

describe("Bound Shortcuts", () => {
  beforeEach(() => {
    useModalStore.setState({ modalIds: [], openCount: 0 });
  });

  it("lists a shortcut while the screen that binds it is mounted, and still runs it", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const { rerender } = render(
      <>
        <SaveBinding onSave={onSave} />
        <BoundList />
      </>
    );

    expect(bound()).toBe("editor.save");
    await user.keyboard("{Control>}s{/Control}");
    expect(onSave).toHaveBeenCalledTimes(1);

    rerender(<BoundList />);
    expect(bound()).toBe("");
  });

  it("stops listing a shortcut whose binding is disabled", () => {
    const { rerender } = render(
      <>
        <SaveBinding entryEnabled={false} />
        <BoundList />
      </>
    );
    expect(bound()).toBe("");

    rerender(
      <>
        <SaveBinding enabled={false} />
        <BoundList />
      </>
    );
    expect(bound()).toBe("");

    rerender(
      <>
        <SaveBinding />
        <BoundList />
      </>
    );
    expect(bound()).toBe("editor.save");
  });

  it("keeps listing a shortcut while a dialog is open, so the help can show it", () => {
    render(
      <>
        <SaveBinding />
        <BoundList />
      </>
    );

    act(() => {
      useModalStore.getState().register("help");
    });

    expect(bound()).toBe("editor.save");
  });

  it("keeps a shortcut bound while any of several bindings remains", () => {
    const { rerender } = render(
      <>
        <SaveBinding />
        <SaveBinding />
        <BoundList />
      </>
    );

    rerender(
      <>
        <SaveBinding />
        <BoundList />
      </>
    );

    expect(bound()).toBe("editor.save");
  });

  it("lists ids declared for keys handled elsewhere, in registry order", () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => {
        useBoundShortcutIds(["editor.italic", "global.showHelp", "editor.bold"], enabled);
        return useBoundShortcuts();
      },
      { initialProps: { enabled: true } }
    );

    expect(result.current).toEqual(["global.showHelp", "editor.bold", "editor.italic"]);

    rerender({ enabled: false });
    expect(result.current).toEqual([]);
  });
});
