import type { TFunction } from "i18next";
import type { SessionNotice } from "@/features/dictation/session";
import { COMMANDS } from "@/lib/shortcut-registry";

export interface NoticeMessage {
  toast?: { variant: "error" | "info"; text: string };
  announce?: string;
}

export function noticeMessage(
  notice: SessionNotice,
  t: TFunction,
): NoticeMessage {
  switch (notice.kind) {
    case "started":
      return {
        announce: t("dictation.announceStarted", {
          language: t(`dictation.languages.${notice.language}`),
        }),
      };
    case "stopped":
      return { announce: t("dictation.announceStopped") };
    case "scratch_refused":
      return { announce: t("dictation.scratchRefused") };
    case "scratch_empty":
      return { announce: t("dictation.scratchEmpty") };
    case "voice_command": {
      const command = t(COMMANDS[notice.id].labelKey);
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
    case "orphan_copied": {
      const text = t("dictation.orphanCopied");
      return { toast: { variant: "info", text }, announce: text };
    }
    case "orphan_lost": {
      const text = t("dictation.orphanLost", { text: notice.text });
      return { toast: { variant: "info", text }, announce: text };
    }
    case "error": {
      const text = t(`dictation.errors.${notice.code}`, {
        language: notice.language
          ? t(`dictation.languages.${notice.language}`)
          : "",
      });
      const variant =
        notice.code === "no_target" || notice.code === "cancelled"
          ? "info"
          : "error";
      return { toast: { variant, text }, announce: text };
    }
  }
}
