/** Device ABI (`getprop ro.product.cpu.abi`) to the `tauri android build --target` name. */
const TARGETS: Record<string, string> = {
  x86_64: "x86_64",
  "arm64-v8a": "aarch64",
  "armeabi-v7a": "armv7",
  x86: "i686",
};

/**
 * The single Tauri Android target the connected device runs, so the lane builds
 * one ABI instead of all four. Null for an unknown ABI: build every target.
 */
export function tauriAndroidTarget(abi: string): string | null {
  return TARGETS[abi.trim()] ?? null;
}
