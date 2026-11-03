function platformName(): string {
  const ua = (
    navigator as Navigator & {
      userAgentData?: { platform?: string };
    }
  ).userAgentData;
  return ua?.platform ?? navigator.platform ?? "";
}

export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  // Chromium reports "macOS"; Safari and the webview report "MacIntel".
  return /mac|iphone|ipad/i.test(platformName());
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = platformName();
  // An iPad asking for desktop sites reports "MacIntel"; touch points give it away.
  return (
    /^(iphone|ipad)/i.test(platform) || (/^mac/i.test(platform) && navigator.maxTouchPoints > 1)
  );
}
