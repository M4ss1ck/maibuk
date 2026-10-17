import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LucideIcon } from "lucide-react";
import type { SVGProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { SortSelect } from "@/components/ui/SortSelect";

// Tiny stand-ins for lucide icons, so each option's icon is findable by test id.
const IconA = (props: SVGProps<SVGSVGElement>) => <svg data-testid="icon-a" {...props} />;
const IconB = (props: SVGProps<SVGSVGElement>) => <svg data-testid="icon-b" {...props} />;
const IconC = (props: SVGProps<SVGSVGElement>) => <svg data-testid="icon-c" {...props} />;

const options = [
  { value: "apple", label: "Apple", icon: IconA as unknown as LucideIcon },
  { value: "banana", label: "Banana", icon: IconB as unknown as LucideIcon },
  { value: "cherry", label: "Cherry", icon: IconC as unknown as LucideIcon },
];

const TRIGGER_LABEL = "Sort fruit: Apple";

describe("SortSelect", () => {
  describe("trigger", () => {
    it("is named by triggerLabel", () => {
      render(
        <SortSelect
          look="icon"
          value="apple"
          options={options}
          onChange={() => {}}
          triggerLabel={TRIGGER_LABEL}
        />
      );

      expect(screen.getByRole("button", { name: TRIGGER_LABEL })).toBeInTheDocument();
    });

    it("shows triggerLabel in a tooltip when focused", async () => {
      const user = userEvent.setup();
      render(
        <SortSelect
          look="icon"
          value="apple"
          options={options}
          onChange={() => {}}
          triggerLabel={TRIGGER_LABEL}
        />
      );

      await user.tab();

      expect(screen.getByRole("button", { name: TRIGGER_LABEL })).toHaveFocus();
      expect(await screen.findByRole("tooltip")).toHaveTextContent(TRIGGER_LABEL);
    });

    it("shows triggerLabel in a tooltip when hovered", async () => {
      const user = userEvent.setup();
      render(
        <SortSelect
          look="labeled"
          value="apple"
          options={options}
          onChange={() => {}}
          triggerLabel={TRIGGER_LABEL}
        />
      );

      await user.hover(screen.getByRole("button", { name: TRIGGER_LABEL }));

      expect(await screen.findByRole("tooltip")).toHaveTextContent(TRIGGER_LABEL);
    });
  });

  describe("keyboard", () => {
    it("opens with Enter, moves with ArrowDown, picks with Enter, and closes", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(
        <SortSelect
          look="labeled"
          value="apple"
          options={options}
          onChange={onChange}
          triggerLabel={TRIGGER_LABEL}
        />
      );

      const trigger = screen.getByRole("button", { name: TRIGGER_LABEL });
      trigger.focus();
      await user.keyboard("{Enter}");
      expect(screen.getByRole("listbox")).toBeInTheDocument();

      await user.keyboard("{ArrowDown}{Enter}");

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith("banana");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      await waitFor(() => expect(trigger).toHaveFocus());
    });

    it("closes with Escape without changing the value and returns focus to the trigger", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(
        <SortSelect
          look="icon"
          value="apple"
          options={options}
          onChange={onChange}
          triggerLabel={TRIGGER_LABEL}
        />
      );

      const trigger = screen.getByRole("button", { name: TRIGGER_LABEL });
      trigger.focus();
      await user.keyboard("{Enter}{End}{Escape}");

      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
      await waitFor(() => expect(trigger).toHaveFocus());
    });

    it("does not change the value when the current option is picked again", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(
        <SortSelect
          look="labeled"
          value="banana"
          options={options}
          onChange={onChange}
          triggerLabel={TRIGGER_LABEL}
        />
      );

      const trigger = screen.getByRole("button", { name: TRIGGER_LABEL });
      trigger.focus();
      await user.keyboard("{Enter}{Enter}");

      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
      await waitFor(() => expect(trigger).toHaveFocus());
    });
  });

  describe("trigger contents", () => {
    it("labeled look shows the current option's icon and label", () => {
      render(
        <SortSelect
          look="labeled"
          value="banana"
          options={options}
          onChange={() => {}}
          triggerLabel={TRIGGER_LABEL}
        />
      );

      const trigger = screen.getByRole("button", { name: TRIGGER_LABEL });
      expect(within(trigger).getByTestId("icon-b")).toBeInTheDocument();
      expect(trigger).toHaveTextContent("Banana");
    });

    it("icon look shows the current option's icon and no label text", () => {
      render(
        <SortSelect
          look="icon"
          value="banana"
          options={options}
          onChange={() => {}}
          triggerLabel={TRIGGER_LABEL}
        />
      );

      const trigger = screen.getByRole("button", { name: TRIGGER_LABEL });
      expect(within(trigger).getByTestId("icon-b")).toBeInTheDocument();
      expect(trigger).not.toHaveTextContent("Banana");
    });
  });

  describe("open list", () => {
    it("shows each option's icon and label", async () => {
      const user = userEvent.setup();
      render(
        <SortSelect
          look="labeled"
          value="apple"
          options={options}
          onChange={() => {}}
          triggerLabel={TRIGGER_LABEL}
        />
      );

      await user.click(screen.getByRole("button", { name: TRIGGER_LABEL }));

      const listbox = screen.getByRole("listbox");
      const items = within(listbox).getAllByRole("option");
      expect(items).toHaveLength(3);

      const expected = [
        { label: "Apple", testId: "icon-a" },
        { label: "Banana", testId: "icon-b" },
        { label: "Cherry", testId: "icon-c" },
      ];
      items.forEach((item, index) => {
        expect(within(item).getByTestId(expected[index].testId)).toBeInTheDocument();
        expect(item).toHaveTextContent(expected[index].label);
      });
    });
  });
});
