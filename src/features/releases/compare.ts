/** Release numbers as numbers: "v0.10.1" → [0, 10, 1]. A missing part counts as 0. */
function parts(number: string): number[] {
  return number
    .trim()
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}

/** Negative when `a` is the older Release, positive when it is the newer one. */
export function compareReleaseNumbers(a: string, b: string): number {
  const left = parts(a);
  const right = parts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function isNewerRelease(candidate: string, installed: string): boolean {
  return compareReleaseNumbers(candidate, installed) > 0;
}
