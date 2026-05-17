export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = (navigator as Navigator & {
    userAgentData?: { platform?: string };
  }).userAgentData;
  const platform = ua?.platform ?? navigator.platform ?? "";
  return /Mac|iPhone|iPad/.test(platform);
}
