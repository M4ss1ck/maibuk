import type { Editor } from "@tiptap/core";
import type { CommandId } from "@/lib/shortcut-registry";
import { dictationHub } from "@/features/dictation/hub";
import type { VoiceCommandRun, VoiceOutcome } from "@/features/dictation/voice-commands";

type EditorCommand = (editor: Editor) => boolean;

// `editor.commands` is typed by the extensions that declare each command; a
// command whose extension this editor did not load is simply absent.
type LooseCommands = Record<string, ((...args: unknown[]) => boolean) | undefined>;

function run(name: string, ...args: unknown[]): EditorCommand {
  return (editor) => {
    const command = (editor.commands as unknown as LooseCommands)[name];
    return command ? command(...args) : false;
  };
}

function indent(direction: "increase" | "decrease"): EditorCommand {
  return (editor) => {
    if (editor.isActive("listItem")) {
      return direction === "increase"
        ? editor.commands.sinkListItem("listItem")
        : editor.commands.liftListItem("listItem");
    }
    return run(direction === "increase" ? "increaseIndent" : "decreaseIndent")(editor);
  };
}

/**
 * What each `editor-keymap` Command does, so a Custom Shortcut can run it. The
 * extensions' own keymaps still handle the Default Shortcuts.
 */
export const EDITOR_COMMANDS: Partial<Record<CommandId, EditorCommand>> = {
  "editor.bold": run("toggleBold"),
  "editor.italic": run("toggleItalic"),
  "editor.underline": run("toggleUnderline"),
  "editor.strikethrough": run("toggleStrike"),
  "editor.highlight": run("toggleHighlight"),
  "editor.subscript": run("toggleSubscript"),
  "editor.superscript": run("toggleSuperscript"),
  "editor.code": run("toggleCode"),
  "editor.codeBlock": run("toggleCodeBlock"),
  "editor.heading1": run("toggleHeading", { level: 1 }),
  "editor.heading2": run("toggleHeading", { level: 2 }),
  "editor.heading3": run("toggleHeading", { level: 3 }),
  "editor.bulletList": run("toggleBulletList"),
  "editor.numberedList": run("toggleOrderedList"),
  "editor.taskList": run("toggleTaskList"),
  "editor.quote": run("toggleBlockquote"),
  "editor.alignLeft": run("setTextAlign", "left"),
  "editor.alignCenter": run("setTextAlign", "center"),
  "editor.alignRight": run("setTextAlign", "right"),
  "editor.alignJustify": run("setTextAlign", "justify"),
  "editor.toggleHeadingCollapse": run("toggleHeadingCollapse"),
  "editor.increaseIndent": indent("increase"),
  "editor.decreaseIndent": indent("decrease"),
  "common.undo": run("undo"),
  "common.redo": run("redo"),
  // Same guard as the Dictation extension's Escape: an idle session leaves Escape to others.
  "dictation.stop": () => {
    if (!dictationHub.isListening()) return false;
    dictationHub.stop();
    return true;
  },
};

type VoiceRunners = { on: EditorCommand; off?: EditorCommand };

/** Starts a list only when it is not already one; ends it only when it is. */
function listRunner(kind: "bulletList" | "orderedList", mode: "start" | "end"): EditorCommand {
  return (editor) => {
    const active = editor.isActive(kind);
    if (mode === "start" ? active : !active) return true;
    return kind === "bulletList"
      ? editor.commands.toggleBulletList()
      : editor.commands.toggleOrderedList();
  };
}

/** Converts the current block and is a no-op when it already is one. */
function setBlock(command: EditorCommand, active: (editor: Editor) => boolean): EditorCommand {
  return (editor) => (active(editor) ? true : command(editor));
}

/**
 * What a Voice Command runs, per Command. A verb with a polarity picks `on` or
 * `off`; a mark sets or unsets and never toggles, a list starts only when it is
 * not one and ends only when it is, and a block converts once, never back.
 * Commands not listed here run their own event-free runner.
 */
export const VOICE_RUNNERS: Partial<Record<CommandId, VoiceRunners>> = {
  "editor.bold": { on: run("setBold"), off: run("unsetBold") },
  "editor.italic": { on: run("setItalic"), off: run("unsetItalic") },
  "editor.underline": { on: run("setUnderline"), off: run("unsetUnderline") },
  "editor.strikethrough": { on: run("setStrike"), off: run("unsetStrike") },
  "editor.code": { on: run("setCode"), off: run("unsetCode") },
  "editor.bulletList": {
    on: listRunner("bulletList", "start"),
    off: listRunner("bulletList", "end"),
  },
  "editor.numberedList": {
    on: listRunner("orderedList", "start"),
    off: listRunner("orderedList", "end"),
  },
  "editor.heading1": {
    on: setBlock(run("setHeading", { level: 1 }), (editor) =>
      editor.isActive("heading", { level: 1 })
    ),
  },
  "editor.heading2": {
    on: setBlock(run("setHeading", { level: 2 }), (editor) =>
      editor.isActive("heading", { level: 2 })
    ),
  },
  "editor.heading3": {
    on: setBlock(run("setHeading", { level: 3 }), (editor) =>
      editor.isActive("heading", { level: 3 })
    ),
  },
  "editor.quote": {
    on: setBlock(run("setBlockquote"), (editor) => editor.isActive("blockquote")),
  },
};

/** Runs one Voice Command's runner on this editor. */
export function runVoiceCommand(editor: Editor, run: VoiceCommandRun): VoiceOutcome {
  const runners = VOICE_RUNNERS[run.id];
  if (runners) {
    const command = run.polarity === "off" ? (runners.off ?? runners.on) : runners.on;
    return command(editor) ? "ran" : "ignored";
  }
  const command = EDITOR_COMMANDS[run.id];
  if (!command) return "ignored";
  const ran = command(editor);
  // Undo and redo have nothing to do on an empty history: say so instead of
  // staying silent. The caller does not count an empty action as a run.
  if (!ran && (run.id === "common.undo" || run.id === "common.redo")) return "empty";
  return ran ? "ran" : "ignored";
}
