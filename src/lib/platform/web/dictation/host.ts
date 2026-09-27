import type { RecognizerHost } from "@/features/dictation/types";
import { createUnsupportedHost } from "@/lib/platform/unsupported-dictation";
export function createWebRecognizerHost(): RecognizerHost {
  return createUnsupportedHost("no_audio");
}
