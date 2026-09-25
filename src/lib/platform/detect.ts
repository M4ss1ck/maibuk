export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = (
    navigator as Navigator & {
      userAgentData?: { platform?: string };
    }
  ).userAgentData;
  const platform = ua?.platform ?? navigator.platform ?? "";
  // Chromium reports "macOS"; Safari and the webview report "MacIntel".
  return /mac|iphone|ipad/i.test(platform);
}
