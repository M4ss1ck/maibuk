import {
  DictationError,
  type ModelFiles,
  type RecognizerHost,
  type UnsupportedReason,
} from "@/features/dictation/types";

/** A backend that refuses: Android, Windows, macOS, and the placeholders. */
export function createUnsupportedHost(reason: UnsupportedReason): RecognizerHost {
  const refuse = async () => {
    throw new DictationError("unsupported", reason);
  };
  return {
    isSupported: async () => ({ supported: false, reason }),
    load: refuse,
    start: refuse,
    stop: async () => {},
    setContext: async () => {},
    inputDevice: async () => null,
    dispose: async () => {},
  };
}

export const unsupportedModelFiles: ModelFiles = {
  install: async () => {
    throw new DictationError("unsupported");
  },
  isComplete: async () => false,
  remove: async () => {},
};
