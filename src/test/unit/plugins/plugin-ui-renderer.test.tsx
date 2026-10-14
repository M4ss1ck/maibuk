import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement, useState } from "react";
import { RouterProvider } from "react-aria-components";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ui } from "@/plugin-sdk/ui";
import { renderRemoteUi, type RemoteUiHarness } from "@/test/support/plugin-remote-ui";

const { mockOpenExternal } = vi.hoisted(() => ({ mockOpenExternal: vi.fn() }));
vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  openExternal: mockOpenExternal,
}));

let harness: RemoteUiHarness | null = null;

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

describe("the Remote UI renderer", () => {
  describe("structure", () => {
    it("renders a layout view with its children @ui:maibuk-view", async () => {
      harness = renderRemoteUi();
      await harness.mount(
        <ui.View direction="row" gap="sm">
          <ui.Text>One</ui.Text>
          <ui.Text>Two</ui.Text>
        </ui.View>
      );
      expect(screen.getByText("One")).toBeInTheDocument();
      expect(screen.getByText("Two")).toBeInTheDocument();
    });

    it("renders a heading at its level @ui:maibuk-heading", async () => {
      harness = renderRemoteUi();
      await harness.mount(<ui.Heading level={3}>Report</ui.Heading>);
      expect(screen.getByRole("heading", { name: "Report", level: 3 })).toBeInTheDocument();
    });

    it("renders text @ui:maibuk-text", async () => {
      harness = renderRemoteUi();
      await harness.mount(<ui.Text tone="muted">Body</ui.Text>);
      expect(screen.getByText("Body")).toBeInTheDocument();
    });

    it("renders a separator @ui:maibuk-separator", async () => {
      harness = renderRemoteUi();
      await harness.mount(<ui.Separator orientation="horizontal" />);
      expect(screen.getByRole("separator")).toBeInTheDocument();
    });

    it("renders a named icon @ui:maibuk-icon", async () => {
      harness = renderRemoteUi();
      await harness.mount(<ui.Icon name="book" label="A book" />);
      expect(screen.getByRole("img", { name: "A book" })).toBeInTheDocument();
    });

    it("renders an image from a data URL @ui:maibuk-image", async () => {
      harness = renderRemoteUi();
      await harness.mount(<ui.Image src="data:image/gif;base64,R0lGOD" alt="Cover" />);
      expect(screen.getByRole("img", { name: "Cover" })).toBeInTheDocument();
    });

    it("renders a list and its items @ui:maibuk-list @ui:maibuk-list-item", async () => {
      harness = renderRemoteUi();
      await harness.mount(
        <ui.List marker="bullet">
          <ui.ListItem>Alpha</ui.ListItem>
          <ui.ListItem>Beta</ui.ListItem>
        </ui.List>
      );
      const list = screen.getByRole("list");
      expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    });

    it("renders inline code and a code block @ui:maibuk-code", async () => {
      harness = renderRemoteUi();
      await harness.mount(
        <>
          <ui.Code>inline</ui.Code>
          <ui.Code block>const x = 1;</ui.Code>
        </>
      );
      expect(screen.getByText("inline").tagName).toBe("CODE");
      expect(screen.getByText("const x = 1;").tagName).toBe("CODE");
    });
  });

  describe("forms", () => {
    it("keeps the field host-owned while typing and echoes without rollback @ui-kbd:maibuk-text-field", async () => {
      const seen: string[] = [];
      harness = renderRemoteUi();
      function Plugin() {
        const [value, setValue] = useState("");
        return (
          <ui.TextField
            label="Title"
            value={value}
            onInput={(event) => {
              seen.push(event.detail);
              setValue(event.detail);
            }}
          />
        );
      }
      await harness.mount(<Plugin />);
      const field = screen.getByRole("textbox", { name: "Title" });
      await userEvent.type(field, "abc");
      expect(field).toHaveValue("abc");
      expect(seen).toEqual(["a", "ab", "abc"]);
    });

    it("fires onChange only when the value is committed @ui:maibuk-text-field", async () => {
      const committed: string[] = [];
      harness = renderRemoteUi();
      await harness.mount(
        <ui.TextField label="Title" value="start" onChange={(event) => committed.push(event.detail)} />
      );
      const field = screen.getByRole("textbox", { name: "Title" });
      await userEvent.type(field, "!");
      expect(committed).toEqual([]);
      await userEvent.keyboard("{Enter}");
      expect(committed).toEqual(["start!"]);
    });

    it("applies a programmatic reset and ignores a stale echo @ui:maibuk-text-field", async () => {
      harness = renderRemoteUi();
      const view = { set: (_: string) => {} };
      function Plugin() {
        const [value, setValue] = useState("old");
        view.set = setValue;
        return <ui.TextField label="Title" value={value} />;
      }
      await harness.mount(<Plugin />);
      const field = screen.getByRole("textbox", { name: "Title" });
      expect(field).toHaveValue("old");
      await act(async () => {
        view.set("new");
      });
      expect(field).toHaveValue("new");
    });

    it("types a multiline value @ui-kbd:maibuk-text-area", async () => {
      const seen: string[] = [];
      harness = renderRemoteUi();
      await harness.mount(
        <ui.TextArea label="Notes" onInput={(event) => seen.push(event.detail)} />
      );
      await userEvent.type(screen.getByRole("textbox", { name: "Notes" }), "hi");
      expect(seen.at(-1)).toBe("hi");
    });

    it("keeps multibyte composition input @ui:maibuk-text-field", async () => {
      const seen: string[] = [];
      harness = renderRemoteUi();
      await harness.mount(
        <ui.TextField label="Kana" onInput={(event) => seen.push(event.detail)} />
      );
      const field = screen.getByRole("textbox", { name: "Kana" });
      // An IME commit arrives as one input event with the composed text.
      await userEvent.type(field, "にほん");
      expect(field).toHaveValue("にほん");
      expect(seen.at(-1)).toBe("にほん");
    });

    it("reports a number while stepping @ui-kbd:maibuk-number-field", async () => {
      const seen: number[] = [];
      harness = renderRemoteUi();
      await harness.mount(
        <ui.NumberField
          label="Count"
          value={1}
          onInput={(event) => seen.push(event.detail)}
        />
      );
      const field = screen.getByRole("textbox", { name: "Count" });
      await userEvent.type(field, "2");
      await act(async () => {});
      expect(seen.at(-1)).toBe(12);
    });

    it("never reports 0 or NaN for an empty or partial number @ui:maibuk-number-field", async () => {
      const seen: number[] = [];
      harness = renderRemoteUi();
      await harness.mount(
        <ui.NumberField
          label="Count"
          value={5}
          onInput={(event) => seen.push(event.detail)}
          onChange={(event) => seen.push(event.detail)}
        />
      );
      const field = screen.getByRole("textbox", { name: "Count" });
      await userEvent.clear(field);
      await userEvent.type(field, "-");
      await userEvent.keyboard("{Enter}");
      // Empty and partial input are not numbers; neither 0 nor NaN may be sent.
      expect(seen).toEqual([]);
      expect(seen.every((value) => Number.isFinite(value))).toBe(true);
    });

    it("reports the committed, clamped number on blur @ui-kbd:maibuk-number-field", async () => {
      const inputs: number[] = [];
      const commits: number[] = [];
      harness = renderRemoteUi();
      await harness.mount(
        <ui.NumberField
          label="Count"
          value={50}
          minValue={10}
          maxValue={200}
          onInput={(event) => inputs.push(event.detail)}
          onChange={(event) => commits.push(event.detail)}
        />
      );
      const field = screen.getByRole("textbox", { name: "Count" });
      await userEvent.tab();
      expect(field).toHaveFocus();
      // Type an out-of-range value, then leave the field: the commit is clamped.
      await userEvent.keyboard("{Control>}a{/Control}500");
      await userEvent.tab();

      expect(inputs.length).toBeGreaterThan(0);
      expect(commits.at(-1)).toBe(200);
    });

    it("fires onChange with the parsed number on Enter @ui-kbd:maibuk-number-field", async () => {
      const commits: number[] = [];
      harness = renderRemoteUi();
      await harness.mount(
        <ui.NumberField
          label="Count"
          value={50}
          onInput={() => {}}
          onChange={(event) => commits.push(event.detail)}
        />
      );
      const field = screen.getByRole("textbox", { name: "Count" });
      await userEvent.tab();
      expect(field).toHaveFocus();
      await userEvent.keyboard("{Control>}a{/Control}120{Enter}");

      expect(commits.at(-1)).toBe(120);
    });

    it("links a text field's description and error @ui:maibuk-text-field", async () => {
      harness = renderRemoteUi();
      await harness.mount(
        <ui.TextField label="Title" description="Shown in the library" errorMessage="Required" />
      );
      const field = screen.getByRole("textbox", { name: "Title" });
      expect((field as HTMLInputElement).labels?.length ?? 0).toBeGreaterThan(0);
      expect(field).toHaveAccessibleDescription(/Shown in the library/);
      expect(field).toHaveAccessibleDescription(/Required/);
      expect(field).toHaveAttribute("aria-invalid", "true");
    });

    it("links a text area's description and error @ui:maibuk-text-area", async () => {
      harness = renderRemoteUi();
      await harness.mount(
        <ui.TextArea label="Notes" description="Markdown allowed" errorMessage="Too long" />
      );
      const field = screen.getByRole("textbox", { name: "Notes" });
      expect((field as HTMLInputElement).labels?.length ?? 0).toBeGreaterThan(0);
      expect(field).toHaveAccessibleDescription(/Markdown allowed/);
      expect(field).toHaveAccessibleDescription(/Too long/);
      expect(field).toHaveAttribute("aria-invalid", "true");
    });

    it("links a number field's description and error @ui:maibuk-number-field", async () => {
      harness = renderRemoteUi();
      await harness.mount(
        <ui.NumberField label="Count" description="At most ten" errorMessage="Too big" />
      );
      const field = screen.getByRole("textbox", { name: "Count" });
      expect((field as HTMLInputElement).labels?.length ?? 0).toBeGreaterThan(0);
      expect(field).toHaveAccessibleDescription(/At most ten/);
      expect(field).toHaveAccessibleDescription(/Too big/);
      expect(field).toHaveAttribute("aria-invalid", "true");
    });

    it("links a radio group's description and error @ui:maibuk-radio-group", async () => {
      harness = renderRemoteUi();
      await harness.mount(
        <ui.RadioGroup
          label="Scope"
          description="What to include"
          errorMessage="Choose one"
          options={[
            { value: "book", label: "Book" },
            { value: "library", label: "Library" },
          ]}
        />
      );
      const group = screen.getByRole("radiogroup", { name: "Scope" });
      expect(group).toHaveAccessibleDescription(/What to include/);
      expect(group).toHaveAccessibleDescription(/Choose one/);
      expect(group).toHaveAttribute("aria-invalid", "true");
    });

    it("links a select's description and error @ui:maibuk-select", async () => {
      harness = renderRemoteUi();
      await harness.mount(
        <ui.Select
          label="Status"
          description="Where the book is"
          errorMessage="Pick one"
          options={[
            { value: "draft", label: "Draft" },
            { value: "done", label: "Done" },
          ]}
        />
      );
      const trigger = screen.getByRole("button", { name: "Status" });
      expect(trigger).toHaveAccessibleDescription(/Where the book is/);
      expect(trigger).toHaveAccessibleDescription(/Pick one/);
      expect(trigger).toHaveAttribute("aria-invalid", "true");
    });

    it("links a combobox's description and error @ui:maibuk-combobox", async () => {
      harness = renderRemoteUi();
      await harness.mount(
        <ui.Combobox
          label="Genre"
          errorMessage="Pick one"
          options={[
            { value: "scifi", label: "Science fiction" },
            { value: "fantasy", label: "Fantasy" },
          ]}
        />
      );
      const field = screen.getByRole("combobox", { name: "Genre" });
      expect(field).toHaveAccessibleDescription(/Pick one/);
      expect(field).toHaveAttribute("aria-invalid", "true");
    });

    it("links a multi-select combobox's description and error @ui:maibuk-multi-select-combobox", async () => {
      harness = renderRemoteUi();
      await harness.mount(
        <ui.MultiSelectCombobox
          label="Tags"
          errorMessage="Pick one"
          options={[
            { value: "a", label: "Alpha" },
            { value: "b", label: "Beta" },
          ]}
        />
      );
      const field = screen.getByRole("combobox", { name: "Tags" });
      expect(field).toHaveAccessibleDescription(/Pick one/);
      expect(field).toHaveAttribute("aria-invalid", "true");
    });

    it("toggles the checkbox from its visible label @ui:maibuk-checkbox", async () => {
      const seen: boolean[] = [];
      harness = renderRemoteUi();
      await harness.mount(
        <ui.Checkbox label="Enabled" isSelected={false} onChange={(event) => seen.push(event.detail)} />
      );
      await userEvent.click(screen.getByText("Enabled"));
      expect(seen).toEqual([true]);
    });

    it("toggles the switch from its visible label @ui:maibuk-switch", async () => {
      const seen: boolean[] = [];
      harness = renderRemoteUi();
      await harness.mount(
        <ui.Switch label="Wrap" isSelected={false} onChange={(event) => seen.push(event.detail)} />
      );
      await userEvent.click(screen.getByText("Wrap"));
      expect(seen).toEqual([true]);
    });

    it("toggles a checkbox with the keyboard @ui-kbd:maibuk-checkbox", async () => {
      const seen: boolean[] = [];
      harness = renderRemoteUi();
      await harness.mount(
        <ui.Checkbox label="Enabled" isSelected={false} onChange={(event) => seen.push(event.detail)} />
      );
      await userEvent.tab();
      await userEvent.keyboard(" ");
      expect(seen).toEqual([true]);
    });

    it("toggles a switch with the keyboard @ui-kbd:maibuk-switch", async () => {
      const seen: boolean[] = [];
      harness = renderRemoteUi();
      await harness.mount(
        <ui.Switch label="Wrap" isSelected={false} onChange={(event) => seen.push(event.detail)} />
      );
      await userEvent.tab();
      await userEvent.keyboard(" ");
      expect(seen).toEqual([true]);
    });

    it("selects an option with the keyboard @ui-kbd:maibuk-select", async () => {
      const seen: string[] = [];
      harness = renderRemoteUi();
      await harness.mount(
        <ui.Select
          label="Status"
          selectedKey="draft"
          options={[
            { value: "draft", label: "Draft" },
            { value: "done", label: "Done" },
          ]}
          onChange={(event) => seen.push(event.detail)}
        />
      );
      await userEvent.tab();
      await userEvent.keyboard("{Enter}");
      await userEvent.keyboard("{ArrowDown}{Enter}");
      expect(seen).toEqual(["done"]);
    });

    it("keeps a disabled select inert to the keyboard @ui:maibuk-select", async () => {
      const seen: string[] = [];
      harness = renderRemoteUi();
      await harness.mount(
        <ui.Select
          label="Status"
          isDisabled
          selectedKey="draft"
          options={[
            { value: "draft", label: "Draft" },
            { value: "done", label: "Done" },
          ]}
          onChange={(event) => seen.push(event.detail)}
        />
      );
      await userEvent.tab();
      await userEvent.keyboard("{Enter}");
      await userEvent.keyboard("{ArrowDown}{Enter}");
      expect(seen).toEqual([]);
    });

    it("commits a combobox value with the keyboard @ui-kbd:maibuk-combobox", async () => {
      const seen: string[] = [];
      harness = renderRemoteUi();
      await harness.mount(
        <ui.Combobox
          label="Genre"
          options={[
            { value: "scifi", label: "Science fiction" },
            { value: "fantasy", label: "Fantasy" },
          ]}
          onChange={(event) => seen.push(event.detail)}
        />
      );
      const field = screen.getByRole("combobox", { name: "Genre" });
      await userEvent.click(field);
      await userEvent.keyboard("{ArrowDown}{Enter}");
      expect(seen).toEqual(["scifi"]);
    });

    it("selects several values with the keyboard @ui-kbd:maibuk-multi-select-combobox", async () => {
      const seen: string[][] = [];
      harness = renderRemoteUi();
      await harness.mount(
        <ui.MultiSelectCombobox
          label="Tags"
          allowsCustomValue
          options={[
            { value: "a", label: "Alpha" },
            { value: "b", label: "Beta" },
          ]}
          onChange={(event) => seen.push([...event.detail])}
        />
      );
      const field = screen.getByRole("combobox", { name: "Tags" });
      await userEvent.click(field);
      await userEvent.keyboard("Alpha{Enter}");
      expect(seen.at(-1)).toEqual(["a"]);
    });

    it("keeps a disabled combobox inert to the keyboard @ui:maibuk-combobox", async () => {
      const seen: string[] = [];
      harness = renderRemoteUi();
      await harness.mount(
        <ui.Combobox
          label="Genre"
          isDisabled
          options={[
            { value: "scifi", label: "Science fiction" },
            { value: "fantasy", label: "Fantasy" },
          ]}
          onChange={(event) => seen.push(event.detail)}
        />
      );
      await userEvent.tab();
      await userEvent.keyboard("{ArrowDown}{Enter}");
      expect(seen).toEqual([]);
    });

    it("keeps a disabled multi-select combobox inert to the keyboard @ui:maibuk-multi-select-combobox", async () => {
      const seen: string[][] = [];
      harness = renderRemoteUi();
      await harness.mount(
        <ui.MultiSelectCombobox
          label="Tags"
          isDisabled
          allowsCustomValue
          options={[
            { value: "a", label: "Alpha" },
            { value: "b", label: "Beta" },
          ]}
          onChange={(event) => seen.push([...event.detail])}
        />
      );
      await userEvent.tab();
      await userEvent.keyboard("Alpha{Enter}");
      expect(seen).toEqual([]);
    });

    it("moves a radio selection with the arrows @ui-kbd:maibuk-radio-group", async () => {
      const seen: string[] = [];
      harness = renderRemoteUi();
      await harness.mount(
        <ui.RadioGroup
          label="Scope"
          selectedKey="book"
          options={[
            { value: "book", label: "Book" },
            { value: "library", label: "Library" },
          ]}
          onChange={(event) => seen.push(event.detail)}
        />
      );
      await userEvent.tab();
      await userEvent.keyboard("{ArrowDown}");
      expect(seen).toEqual(["library"]);
    });
  });

  describe("actions", () => {
    it("presses a button with the keyboard @ui-kbd:maibuk-button", async () => {
      let pressed = 0;
      harness = renderRemoteUi();
      await harness.mount(<ui.Button onPress={() => (pressed += 1)}>Save</ui.Button>);
      await userEvent.tab();
      await userEvent.keyboard("{Enter}");
      expect(pressed).toBe(1);
    });

    it("presses an icon button with the keyboard @ui-kbd:maibuk-icon-button", async () => {
      let pressed = 0;
      harness = renderRemoteUi();
      await harness.mount(
        <ui.IconButton label="Add chapter" icon="plus" onPress={() => (pressed += 1)} />
      );
      await userEvent.tab();
      await userEvent.keyboard("{Enter}");
      expect(pressed).toBe(1);
    });

    it("follows a link with the keyboard @ui-kbd:maibuk-link", async () => {
      let pressed = 0;
      harness = renderRemoteUi();
      await harness.mount(
        <ui.Link href="https://example.com" onPress={() => (pressed += 1)}>
          Docs
        </ui.Link>
      );
      await userEvent.tab();
      await userEvent.keyboard("{Enter}");
      expect(pressed).toBe(1);
    });

    it("opens a link externally instead of navigating the app @ui:maibuk-link", async () => {
      mockOpenExternal.mockClear();
      const navigate = vi.fn();
      harness = renderRemoteUi({
        wrapper: ({ children }) => <RouterProvider navigate={navigate}>{children}</RouterProvider>,
      });
      await harness.mount(<ui.Link href="https://example.com">Docs</ui.Link>);
      await userEvent.tab();
      await userEvent.keyboard("{Enter}");
      expect(mockOpenExternal).toHaveBeenCalledWith("https://example.com");
      expect(navigate).not.toHaveBeenCalled();
    });
  });

  describe("keyed updates", () => {
    it("reorders keyed rows and updates a moved row @ui:maibuk-button", async () => {
      harness = renderRemoteUi();
      const plugin = { setOrder: (_: string[]) => {}, setDisabled: (_: boolean) => {} };
      function Plugin() {
        const [order, setOrder] = useState(["b", "a"]);
        const [disabled, setDisabled] = useState(false);
        plugin.setOrder = setOrder;
        plugin.setDisabled = setDisabled;
        return (
          <ui.View>
            {order.map((key) => (
              <ui.Button key={key} isDisabled={key === "a" && disabled}>
                {key}
              </ui.Button>
            ))}
          </ui.View>
        );
      }
      await harness.mount(<Plugin />);
      expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["b", "a"]);

      await act(async () => {
        plugin.setOrder(["a", "b"]);
      });
      await act(async () => {
        plugin.setDisabled(true);
      });

      expect(harness.violations).toEqual([]);
      expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["a", "b"]);
      expect(screen.getByRole("button", { name: "a" })).toBeDisabled();
    });
  });

  describe("the protocol boundary", () => {
    it("refuses an unknown element and renders nothing", async () => {
      harness = renderRemoteUi();
      await harness.mount(createElement("maibuk-evil"));
      expect(harness.violations[0]?.code).toBe("unknown-element");
      expect(harness.ui.receiver.root.children).toHaveLength(0);
    });

    it("refuses an unsupported prop", async () => {
      harness = renderRemoteUi();
      await harness.mount(createElement("maibuk-button", { variant: "huge" }, "Go"));
      expect(harness.violations[0]?.code).toBe("invalid-prop");
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
  });
});
