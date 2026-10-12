import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ui } from "@/plugin-sdk/ui";
import { renderRemoteUi, type RemoteUiHarness } from "@/test/support/plugin-remote-ui";

const ROWS = 1_000;
let harness: RemoteUiHarness | null = null;

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

describe("burst typing over 1,000 updating rows", () => {
  it("never rolls the field back under delayed and out-of-order echoes", async () => {
    let setValue: (next: string) => void = () => {};
    function Plugin() {
      const [value, set] = useState("");
      setValue = set;
      const rows = Array.from({ length: ROWS }, (_, index) => `${value.length}-${index}`);
      return (
        <>
          <ui.TextField label="Query" value={value} onInput={(event) => set(event.detail)} />
          <ui.View>
            {rows.map((row, index) => (
              <ui.Text key={index}>{row}</ui.Text>
            ))}
          </ui.View>
        </>
      );
    }

    harness = renderRemoteUi();
    await harness.mount(<Plugin />);
    const field = screen.getByRole("textbox", { name: "Query" });

    // A burst with no delay: the host owns the live value, so every keystroke
    // shows even while 1,000 rows re-render behind it.
    await userEvent.type(field, "hello");
    expect(field).toHaveValue("hello");

    // Delayed, out-of-order echoes of older host values must not roll back.
    await act(async () => {
      setValue("hel");
    });
    await act(async () => {
      setValue("he");
    });
    await act(async () => {
      setValue("h");
    });
    expect(field).toHaveValue("hello");

    // A programmatic reset the host never sent takes effect.
    await act(async () => {
      setValue("");
    });
    expect(field).toHaveValue("");
  });
});
