import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ui } from "@/plugin-sdk/ui";
import { renderRemoteUi, type RemoteUiHarness } from "@/test/support/plugin-remote-ui";

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
    it("keeps the field host-owned while typing and echoes without rollback @ui:maibuk-text-field", async () => {
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

    it("types a multiline value @ui:maibuk-text-area", async () => {
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

    it("reports a number while stepping @ui:maibuk-number-field", async () => {
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

    it("toggles a checkbox with the keyboard @ui:maibuk-checkbox", async () => {
      const seen: boolean[] = [];
      harness = renderRemoteUi();
      await harness.mount(
        <ui.Checkbox label="Enabled" isSelected={false} onChange={(event) => seen.push(event.detail)} />
      );
      await userEvent.tab();
      await userEvent.keyboard(" ");
      expect(seen).toEqual([true]);
    });

    it("toggles a switch with the keyboard @ui:maibuk-switch", async () => {
      const seen: boolean[] = [];
      harness = renderRemoteUi();
      await harness.mount(
        <ui.Switch label="Wrap" isSelected={false} onChange={(event) => seen.push(event.detail)} />
      );
      await userEvent.tab();
      await userEvent.keyboard(" ");
      expect(seen).toEqual([true]);
    });

    it("selects an option with the keyboard @ui:maibuk-select", async () => {
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

    it("commits a combobox value with the keyboard @ui:maibuk-combobox", async () => {
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

    it("selects several values with the keyboard @ui:maibuk-multi-select-combobox", async () => {
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

    it("moves a radio selection with the arrows @ui:maibuk-radio-group", async () => {
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
    it("presses a button with the keyboard @ui:maibuk-button", async () => {
      let pressed = 0;
      harness = renderRemoteUi();
      await harness.mount(<ui.Button onPress={() => (pressed += 1)}>Save</ui.Button>);
      await userEvent.tab();
      await userEvent.keyboard("{Enter}");
      expect(pressed).toBe(1);
    });

    it("presses an icon button with the keyboard @ui:maibuk-icon-button", async () => {
      let pressed = 0;
      harness = renderRemoteUi();
      await harness.mount(
        <ui.IconButton label="Add chapter" icon="plus" onPress={() => (pressed += 1)} />
      );
      await userEvent.tab();
      await userEvent.keyboard("{Enter}");
      expect(pressed).toBe(1);
    });

    it("follows a link with the keyboard @ui:maibuk-link", async () => {
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
