import { useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Input, Label, Text, TextField } from "react-aria-components";
import { isMac } from "@/lib/platform/detect";
import { IS_WEB } from "@/lib/platform/target";
import {
  formatShortcut,
  isIgnoredKeyEvent,
  isRecordableStep,
  isReservedOnWeb,
  recordedStepFromEvent,
} from "@/lib/shortcut-keys";
import type { Shortcut, Step } from "@/lib/shortcut-registry";

export function describeShortcut(shortcut: Shortcut): string {
  const { groups } = formatShortcut(shortcut, isMac());
  return groups.map((chips) => chips.join("+")).join(" ");
}

interface ShortcutRecorderProps {
  commandLabel: string;
  /** A reason the Shortcut cannot be used (conflict with a locked key, duplicate), or null. */
  validate: (shortcut: Shortcut) => string | null;
  onRecord: (shortcut: Shortcut) => void;
  /** Escape, Tab, or leaving the field; nothing changes. */
  onCancel: (reason: "escape" | "blur") => void;
  announce: (message: string) => void;
}

/**
 * Records a Shortcut from key presses. It is a read-only text field so screen
 * readers pass every key to it (NVDA's browse mode would eat letters on a
 * button). Enter keeps one combo, a second combo makes a sequence, Escape
 * cancels, and Tab leaves: none of those three can be recorded bare.
 */
export function ShortcutRecorder({
  commandLabel,
  validate,
  onRecord,
  onCancel,
  announce,
}: ShortcutRecorderProps) {
  const { t } = useTranslation();
  const [first, setFirst] = useState<Step | null>(null);
  const [error, setError] = useState<string | null>(null);

  const finish = (shortcut: Shortcut) => {
    const problem = validate(shortcut);
    if (problem) {
      setFirst(null);
      setError(problem);
      announce(problem);
      return;
    }
    onRecord(shortcut);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    const native = event.nativeEvent;
    if (isIgnoredKeyEvent(native) || native.repeat) return;
    const bare = !event.ctrlKey && !event.metaKey && !event.altKey;
    // Tab leaves the field like anywhere else; losing focus cancels.
    if (bare && event.key === "Tab") return;

    event.preventDefault();
    event.stopPropagation();

    if (bare && !event.shiftKey && event.key === "Escape") {
      onCancel("escape");
      return;
    }
    if (bare && !event.shiftKey && event.key === "Enter") {
      if (first) finish([first]);
      else announce(t("shortcutEditor.recorder.pressFirst"));
      return;
    }

    const step = recordedStepFromEvent(native, isMac());
    if (!step) return;
    if (!isRecordableStep(step)) {
      const message = t("shortcutEditor.recorder.notAllowed", { keys: describeShortcut([step]) });
      setError(message);
      announce(message);
      return;
    }
    if (IS_WEB && isReservedOnWeb(step)) {
      const message = t("shortcutEditor.recorder.reserved", { keys: describeShortcut([step]) });
      setError(message);
      announce(message);
      return;
    }

    setError(null);
    if (first) {
      finish([first, step]);
      return;
    }
    setFirst(step);
    announce(t("shortcutEditor.recorder.firstStep", { keys: describeShortcut([step]) }));
  };

  return (
    <TextField
      isReadOnly
      autoFocus
      value={first ? describeShortcut([first]) : ""}
      className="flex min-w-48 flex-col gap-1"
      onBlur={() => onCancel("blur")}
    >
      <Label className="text-xs text-muted-foreground">
        {t("shortcutEditor.recorder.label", { command: commandLabel })}
      </Label>
      <Input
        inputMode="none"
        data-dictation="off"
        onKeyDown={onKeyDown}
        placeholder={t("shortcutEditor.recorder.placeholder")}
        className="rounded-lg border border-primary bg-background px-2 py-1 font-mono text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
      />
      {error && (
        <Text slot="errorMessage" className="text-xs text-destructive">
          {error}
        </Text>
      )}
    </TextField>
  );
}
