import type { Editor } from "@tiptap/core";
import type { CommandId } from "@/lib/shortcut-registry";
import { dictationHub } from "@/features/dictation/hub";
import type { VoiceCommandRun } from "@/features/dictation/voice-commands";

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

type MarkRunners = { on: EditorCommand; off: EditorCommand };

/**
 * What an on-verb and an off-verb do to a mark, so a Voice Command sets or
 * unsets and never toggles. Commands not listed here run their own runner.
 */
export const VOICE_MARK_RUNNERS: Partial<Record<CommandId, MarkRunners>> = {
  "editor.bold": { on: run("setBold"), off: run("unsetBold") },
  "editor.italic": { on: run("setItalic"), off: run("unsetItalic") },
  "editor.underline": { on: run("setUnderline"), off: run("unsetUnderline") },
  "editor.strikethrough": { on: run("setStrike"), off: run("unsetStrike") },
  "editor.code": { on: run("setCode"), off: run("unsetCode") },
};

/** Runs one Voice Command's runner on this editor; the class polarity picks set or unset. */
export function runVoiceCommand(editor: Editor, run: VoiceCommandRun): boolean {
  const mark = VOICE_MARK_RUNNERS[run.id];
  if (mark) return (run.polarity === "off" ? mark.off : mark.on)(editor);
  return EDITOR_COMMANDS[run.id]?.(editor) ?? false;
}
