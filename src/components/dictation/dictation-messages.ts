import type { TFunction } from "i18next";
import type { SessionNotice } from "@/features/dictation/session";
import { commandLabel, type CommandId } from "@/lib/shortcut-registry";

const commandName = (t: TFunction, id: CommandId): string => commandLabel(id, t);

export interface NoticeMessage {
  toast?: { variant: "error" | "info"; text: string };
  announce?: string;
}

export function noticeMessage(notice: SessionNotice, t: TFunction): NoticeMessage {
  switch (notice.kind) {
    case "started":
      return {
        announce: t("dictation.announceStarted", {
          language: t(`dictation.languages.${notice.language}`),
        }),
      };
    case "stopped":
      return { announce: t("dictation.announceStopped") };
    case "caps_lock":
      return { announce: t(notice.on ? "dictation.announceCapsOn" : "dictation.announceCapsOff") };
    case "scratch_refused":
      return { announce: t("dictation.scratchRefused") };
    case "scratch_empty":
      return { announce: t("dictation.scratchEmpty") };
    case "voice_command": {
      const command = commandName(t, notice.id);
      const key =
        notice.polarity === "on"
          ? "dictation.voiceCommandOn"
          : notice.polarity === "off"
            ? "dictation.voiceCommandOff"
            : "dictation.voiceCommand";
      return { announce: t(key, { command }) };
    }
    case "voice_command_empty":
      return {
        announce: t(
          notice.id === "common.redo" ? "dictation.nothingToRedo" : "dictation.nothingToUndo"
        ),
      };
    case "voice_command_unavailable": {
      const command = commandName(t, notice.id);
      return { announce: t("dictation.voiceCommandUnavailable", { command }) };
    }
    case "voice_command_refused": {
      const command = commandName(t, notice.id);
      const key =
        notice.reason === "dialog"
          ? "dictation.voiceCommandRefusedDialog"
          : notice.reason === "dialog_refused"
            ? "dictation.voiceCommandRefusedDialogStuck"
            : "dictation.voiceCommandRefusedTutorial";
      return { announce: t(key, { command }) };
    }
    case "voice_that_refused":
      return { announce: t("dictation.voiceThatRefused") };
    case "voice_that_empty":
      return { announce: t("dictation.voiceThatEmpty") };
    case "click_pressed":
      return { announce: t("dictation.clickPressed", { name: notice.name }) };
    case "click_choices":
      return { announce: t("dictation.clickChoices", { count: notice.count }) };
    case "click_not_found":
      return { announce: t("dictation.clickNotFound", { name: notice.name }) };
    case "orphan_copied": {
      const text = t("dictation.orphanCopied");
      return { toast: { variant: "info", text }, announce: text };
    }
    case "orphan_lost": {
      const text = t("dictation.orphanLost", { text: notice.text });
      return { toast: { variant: "info", text }, announce: text };
    }
    case "handoff_no_editor":
      return { announce: t("dictation.handoffNoEditor") };
    case "field_secret_refused":
      return { announce: t("dictation.fieldSecretRefused") };
    case "field_layout_ignored":
      return { announce: t("dictation.fieldNoLineBreaks") };
    case "error": {
      const text = t(`dictation.errors.${notice.code}`, {
        language: notice.language ? t(`dictation.languages.${notice.language}`) : "",
      });
      const variant = notice.code === "no_target" || notice.code === "cancelled" ? "info" : "error";
      return { toast: { variant, text }, announce: text };
    }
  }
}
