import type { RecognizerHost } from "@/features/dictation/types";
import {
  createUnsupportedHost,
  unsupportedModelFiles,
} from "@/lib/platform/unsupported-dictation";
export function createTauriRecognizerHost(): RecognizerHost {
  return createUnsupportedHost("platform");
}
export const tauriModelFiles = unsupportedModelFiles;
