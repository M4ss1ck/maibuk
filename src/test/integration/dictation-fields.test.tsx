import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { Input as AriaInput, Label, TextField } from "react-aria-components";
import { Input } from "@/components/ui/Input";
import { attachSession, resetDictationHubForTests } from "@/features/dictation/hub";
import { installDictationFieldTracker } from "@/features/dictation/field-target";
import {
  buildPhraseTable,
  INITIAL_INTERPRETER_STATE,
  interpret,
} from "@/features/dictation/interpreter";
import { createRouter } from "@/features/dictation/router";
import {
  createDictationSession,
  type SessionNotice,
} from "@/features/dictation/session";
import { createLineStats } from "@/features/dictation/stats";
import type {
  DictationEvent,
  DictationLanguage,
  ModelSpec,
} from "@/features/dictation/types";
import { defaultVoicePhrases } from "@/features/dictation/voice-commands";
import type { CommandRunOutcome } from "@/lib/command-runner";
import { getCommand, type CommandId } from "@/lib/shortcut-registry";
import { isOutsideLayer } from "@/lib/top-layer";
import { useSettingsStore } from "@/features/settings/store";

const EN_MODEL: ModelSpec = {
  id: "test-en",
  engine: "moonshine",
  languages: ["en"],
  tier: "fast",
  platforms: ["web"],
  files: [],
  engineOptions: {},
  capabilities: { casing: false, punctuation: false, streaming: true },
};

function fakeHost() {
  let listener: ((event: DictationEvent) => void) | null = null;
  return {
    emitFinal(text: string) {
      listener?.({ type: "final", text, latencyMs: 1 });
    },
    emitPartial(text: string) {
      listener?.({ type: "partial", text });
    },
    isSupported: async () => ({ supported: true as const }),
    load: async () => {},
    start: async (onEvent: (event: DictationEvent) => void) => {
      listener = onEvent;
    },
    stop: async () => {
      listener = null;
    },
    setContext: async () => {},
    inputDevice: async () => null,
    dispose: async () => {},
  };
}

// The Session's route is the real interpreter, mapped exactly as
// src/features/dictation/runtime.ts maps it.
function makeSession({
  host,
  notify,
  copyText,
  seenModelLangs,
}: {
  host: ReturnType<typeof fakeHost>;
  notify: (notice: SessionNotice) => void;
  copyText: (text: string) => Promise<void>;
  seenModelLangs: DictationLanguage[];
}) {
  let state = INITIAL_INTERPRETER_STATE;
  const table = buildPhraseTable("en", {
    capabilities: EN_MODEL.capabilities,
  });
  return createDictationSession({
    host,
    modelFor: (language) => {
      seenModelLangs.push(language);
      return EN_MODEL;
    },
    route: createRouter((line, before, options) => {
      const output = interpret({
        line,
        before,
        capabilities: EN_MODEL.capabilities,
        table,
        state,
        verbatim: options?.verbatim === true,
      });
      state = output.state;
      if (output.result.kind === "scratch") return { kind: "scratch" };
      if (output.result.kind === "click")
        return { kind: "click", name: output.result.name };
      if (output.result.kind === "click_number")
        return { kind: "click_number", n: output.result.n };
      return {
        ...output.result,
        spokenPunctuationCount: output.spokenPunctuationCount,
        ...(output.capsLock !== undefined ? { capsLock: output.capsLock } : {}),
      };
    }),
    isEditorCommand: (id) => getCommand(id).source === "editor-keymap",
    notify,
    copyText,
    stats: createLineStats(),
  });
}

function focusEl(el: HTMLElement): void {
  el.focus();
  el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
}

let uninstall: (() => void) | null = null;
let previousLanguage: DictationLanguage;

function setupFieldSession() {
  const host = fakeHost();
  const notices: SessionNotice[] = [];
  const copyText = vi.fn(async (_text: string) => {});
  const seenModelLangs: DictationLanguage[] = [];
  const session = makeSession({
    host,
    notify: (notice) => void notices.push(notice),
    copyText,
    seenModelLangs,
  });
  attachSession(session);
  uninstall = installDictationFieldTracker();
  return { session, host, notices, copyText, seenModelLangs };
}

beforeEach(() => {
  resetDictationHubForTests();
  previousLanguage = useSettingsStore.getState().language;
});

afterEach(() => {
  uninstall?.();
  uninstall = null;
  resetDictationHubForTests();
  useSettingsStore.setState({ language: previousLanguage });
});

function RawInputForm({ onSubmit }: { onSubmit: (value: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value);
      }}
    >
      <label htmlFor="raw-title">Title</label>
      <input
        id="raw-title"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    </form>
  );
}

function SharedInputForm({ onSubmit }: { onSubmit: (value: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value);
      }}
    >
      <Input
        label="Title"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    </form>
  );
}

function AriaInputForm({ onSubmit }: { onSubmit: (value: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value);
      }}
    >
      <TextField>
        <Label>Title</Label>
        <AriaInput
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </TextField>
    </form>
  );
}

function TextareaForm({ onSubmit }: { onSubmit: (value: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value);
      }}
    >
      <label htmlFor="body">Body</label>
      <textarea
        id="body"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    </form>
  );
}

describe("dictation into plain text fields", () => {
  it.each([
    { name: "raw input", Form: RawInputForm, label: "Title" },
    { name: "shared Input", Form: SharedInputForm, label: "Title" },
    { name: "react-aria TextField", Form: AriaInputForm, label: "Title" },
    { name: "textarea", Form: TextareaForm, label: "Body" },
  ])(
    "dictates into a $name and submits the form with the dictated value",
    async ({ Form, label }) => {
      const { session, host } = setupFieldSession();
      const submitted: string[] = [];
      const { container } = render(
        <Form onSubmit={(value) => void submitted.push(value)} />
      );
      const el = screen.getByLabelText(label) as
        | HTMLInputElement
        | HTMLTextAreaElement;
      focusEl(el);
      await act(async () => {
        await session.start();
      });
      act(() => {
        host.emitFinal("My book");
      });
      expect(el.value).toBe("My book");
      fireEvent.submit(container.querySelector("form")!);
      expect(submitted).toEqual(["My book"]);
    }
  );

  it("never dictates into opted-out, read-only, disabled, or number fields", async () => {
    const { session, host } = setupFieldSession();
    // Something else owns the Session so it can start: lines keep going
    // there while the ineligible field holds DOM focus.
    const commits: string[] = [];
    session.register({
      id: "elsewhere",
      language: () => "en",
      showPartial: () => {},
      before: () => "",
      apply: (edits) => {
        void commits.push(
          edits.map((edit) => (edit.kind === "text" ? edit.text : "?")).join("")
        );
      },
    });
    session.focus("elsewhere");
    render(
      <>
        <input aria-label="off" data-dictation="off" defaultValue="" />
        <input aria-label="readonly" readOnly defaultValue="" />
        <input aria-label="disabled" disabled defaultValue="" />
        <input aria-label="number" type="number" defaultValue="" />
      </>
    );
    await act(async () => {
      await session.start();
    });
    for (const name of ["off", "readonly", "disabled", "number"]) {
      const el = screen.getByLabelText(name) as HTMLInputElement;
      focusEl(el);
      act(() => {
        host.emitFinal("hello");
      });
      expect(el.value).toBe("");
    }
    expect(commits).toEqual(["Hello", "Hello", "Hello", "Hello"]);
  });

  it("refuses a password field without reading, writing, or copying it", async () => {
    const { session, host, notices, copyText } = setupFieldSession();
    render(<input aria-label="Password" type="password" defaultValue="" />);
    const el = screen.getByLabelText("Password") as HTMLInputElement;
    focusEl(el);
    await act(async () => {
      await session.start();
    });
    act(() => {
      host.emitFinal("my secret words");
    });
    expect(el.value).toBe("");
    expect(notices).toContainEqual({ kind: "field_secret_refused" });
    expect(copyText).not.toHaveBeenCalled();
  });

  it("never shows partial text in a field and fires no input event", async () => {
    const { session, host } = setupFieldSession();
    render(
      <>
        <label htmlFor="partial">Title</label>
        <input id="partial" defaultValue="" />
      </>
    );
    const el = screen.getByLabelText("Title") as HTMLInputElement;
    const events: string[] = [];
    el.addEventListener("input", () => events.push("input"));
    focusEl(el);
    await act(async () => {
      await session.start();
    });
    act(() => {
      host.emitPartial("hel");
    });
    expect(el.value).toBe("");
    expect(events).toEqual([]);
  });

  it("picks the model for the app language until the Session overrides it", async () => {
    useSettingsStore.setState({ language: "es" });
    const { session, seenModelLangs } = setupFieldSession();
    render(<input aria-label="Title" defaultValue="" />);
    focusEl(screen.getByLabelText("Title") as HTMLInputElement);
    await act(async () => {
      await session.start();
    });
    expect(seenModelLangs).toEqual(["es"]);
    await act(async () => {
      await session.setLanguage("en");
    });
    expect(seenModelLangs).toEqual(["es", "en"]);
  });

  it("drops a paragraph break in a single-line field and announces it", async () => {
    const { session, host, notices } = setupFieldSession();
    render(
      <>
        <label htmlFor="single">Title</label>
        <input id="single" defaultValue="" />
      </>
    );
    const el = screen.getByLabelText("Title") as HTMLInputElement;
    focusEl(el);
    await act(async () => {
      await session.start();
    });
    act(() => {
      host.emitFinal("hello new paragraph");
    });
    // The words land; the break the field cannot hold does not.
    expect(el.value).toBe("Hello");
    expect(el.value).not.toContain("\n");
    expect(notices).toContainEqual({ kind: "field_layout_ignored" });
  });

  it("keeps a spoken line break in a textarea", async () => {
    const { session, host } = setupFieldSession();
    render(
      <>
        <label htmlFor="area">Body</label>
        <textarea id="area" defaultValue="" />
      </>
    );
    const el = screen.getByLabelText("Body") as HTMLTextAreaElement;
    focusEl(el);
    await act(async () => {
      await session.start();
    });
    act(() => {
      host.emitFinal("hello new line world");
    });
    expect(el.value).toBe("Hello\nWorld");
  });

  it("takes a verbatim field as heard while a normal field takes the mark", async () => {
    const { session, host } = setupFieldSession();
    render(
      <>
        <label htmlFor="verbatim">Verbatim</label>
        <input id="verbatim" data-dictation="verbatim" defaultValue="" />
        <label htmlFor="normal">Normal</label>
        <input id="normal" defaultValue="" />
      </>
    );
    const verbatim = screen.getByLabelText("Verbatim") as HTMLInputElement;
    const normal = screen.getByLabelText("Normal") as HTMLInputElement;
    focusEl(verbatim);
    await act(async () => {
      await session.start();
    });
    act(() => {
      host.emitFinal("comma");
    });
    expect(verbatim.value).toBe("comma");
    focusEl(normal);
    act(() => {
      host.emitFinal("comma");
    });
    expect(normal.value).toBe(",");
  });

  it("announces a formatting Voice Command as unavailable and changes nothing", async () => {
    const { session, host, notices } = setupFieldSession();
    render(
      <>
        <label htmlFor="voice">Title</label>
        <input id="voice" defaultValue="" />
      </>
    );
    const el = screen.getByLabelText("Title") as HTMLInputElement;
    focusEl(el);
    await act(async () => {
      await session.start();
    });
    const phrase = defaultVoicePhrases("editor.bold", "en")[0];
    expect(phrase).toBe("make bold");
    act(() => {
      host.emitFinal(phrase);
    });
    expect(el.value).toBe("");
    expect(notices).toContainEqual({
      kind: "voice_command_unavailable",
      id: "editor.bold",
    });
  });

  it("scratches the last dictated sentence from the field", async () => {
    const { session, host, notices } = setupFieldSession();
    render(
      <>
        <label htmlFor="scratch">Title</label>
        <input id="scratch" defaultValue="" />
      </>
    );
    const el = screen.getByLabelText("Title") as HTMLInputElement;
    focusEl(el);
    await act(async () => {
      await session.start();
    });
    act(() => {
      host.emitFinal("hello there period");
    });
    expect(el.value).toBe("Hello there.");
    act(() => {
      host.emitFinal("scratch that");
    });
    expect(el.value).toBe("");
    expect(notices).not.toContainEqual({ kind: "scratch_refused" });
    expect(notices).not.toContainEqual({ kind: "scratch_empty" });
  });

  it("refuses scratch after the author typed inside the dictated sentence", async () => {
    const { session, host, notices } = setupFieldSession();
    function ScratchForm() {
      const [value, setValue] = useState("");
      return (
        <>
          <label htmlFor="scratch-type">Title</label>
          <input
            id="scratch-type"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </>
      );
    }
    render(<ScratchForm />);
    const el = screen.getByLabelText("Title") as HTMLInputElement;
    focusEl(el);
    await act(async () => {
      await session.start();
    });
    act(() => {
      host.emitFinal("hello there period");
    });
    expect(el.value).toBe("Hello there.");
    fireEvent.change(el, { target: { value: "Hello there. typed" } });
    expect(el.value).toBe("Hello there. typed");
    act(() => {
      host.emitFinal("scratch that");
    });
    expect(el.value).toBe("Hello there. typed");
    expect(notices).toContainEqual({ kind: "scratch_refused" });
  });

  it("does not scratch an old sentence after focusing another field and back", async () => {
    const { session, host, notices } = setupFieldSession();
    function TwoFields() {
      const [a, setA] = useState("");
      const [b, setB] = useState("");
      return (
        <>
          <label htmlFor="field-a">First</label>
          <input
            id="field-a"
            value={a}
            onChange={(event) => setA(event.target.value)}
          />
          <label htmlFor="field-b">Second</label>
          <input
            id="field-b"
            value={b}
            onChange={(event) => setB(event.target.value)}
          />
        </>
      );
    }
    render(<TwoFields />);
    const a = screen.getByLabelText("First") as HTMLInputElement;
    const b = screen.getByLabelText("Second") as HTMLInputElement;
    focusEl(a);
    await act(async () => {
      await session.start();
    });
    act(() => {
      host.emitFinal("hello there period");
    });
    expect(a.value).toBe("Hello there.");
    // Leaving the field drops its history; coming back starts a new target.
    focusEl(b);
    focusEl(a);
    act(() => {
      host.emitFinal("scratch that");
    });
    expect(a.value).toBe("Hello there.");
    expect(notices).toContainEqual({ kind: "scratch_empty" });
  });

  it("takes the orphan path when a modal hides the editor, never touching it", async () => {
    const { session, host, copyText } = setupFieldSession();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const node = document.createElement("div");
    container.appendChild(node);
    const apply = vi.fn();
    session.register({
      id: "editor",
      language: () => "en",
      showPartial: () => {},
      before: () => "",
      apply,
      isAvailable: () => !isOutsideLayer(node),
    });
    session.focus("editor");
    await act(async () => {
      await session.start();
    });
    // A modal opens over the editor and takes focus to its own button.
    container.setAttribute("aria-hidden", "true");
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();
    act(() => {
      host.emitFinal("hello");
    });
    expect(apply).not.toHaveBeenCalled();
    expect(copyText).toHaveBeenCalledWith("Hello");
  });

  it("hands a queued line to a dialog field that mounts after the command", async () => {
    let openDialog: (() => void) | null = null;
    function Harness() {
      const [show, setShow] = useState(false);
      const [value, setValue] = useState("");
      openDialog = () => setShow(true);
      if (!show) return null;
      return (
        <div role="dialog" aria-label="New book">
          <label htmlFor="dlg-title">Title</label>
          <input
            id="dlg-title"
            autoFocus
            ref={(node) => {
              node?.focus();
              node?.dispatchEvent(
                new FocusEvent("focusin", { bubbles: true })
              );
            }}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
      );
    }
    const host = fakeHost();
    const notices: SessionNotice[] = [];
    const copyText = vi.fn(async (_text: string) => {});
    const session = createDictationSession({
      host,
      modelFor: () => EN_MODEL,
      route: createRouter((text) =>
        text === "new book"
          ? {
              kind: "voice_command",
              id: "bookList.newBook" as CommandId,
              polarity: null,
            }
          : null
      ),
      runCommand: async (id) => {
        expect(id).toBe("bookList.newBook");
        openDialog?.();
        return "ran" as CommandRunOutcome;
      },
      isEditorCommand: () => false,
      isNavigatingCommand: (id) => id === "bookList.newBook",
      notify: (notice) => void notices.push(notice),
      copyText,
      stats: createLineStats(),
    });
    attachSession(session);
    uninstall = installDictationFieldTracker();
    render(<Harness />);
    session.register({
      id: "old",
      language: () => "en",
      showPartial: () => {},
      before: () => "",
      apply: () => {},
    });
    session.focus("old");
    await act(async () => {
      await session.start();
    });
    act(() => {
      host.emitFinal("new book");
    });
    // Spoken before the dialog field takes the caret: it queues, then lands.
    act(() => {
      host.emitFinal("hello title");
    });
    await waitFor(() => {
      // The queued line routes as plain prose (the test route returns null
      // for it), so it lands as heard.
      expect(
        (screen.getByLabelText("Title") as HTMLInputElement).value
      ).toBe("hello title");
    });
  });
});
