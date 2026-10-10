/**
 * The small semver subset the Plugin API needs: concrete versions (Plugin
 * `version`, `minAppVersion`, the host's API version) and the range syntaxes an
 * author writes for `apiVersion` — `*`, exact, partial (`1.2`, `1.x`), caret,
 * tilde, comparator sets, and `||` unions. Hyphen ranges are not supported; a
 * manifest that uses one fails validation with a clear message. Prerelease
 * versions order by the semver rules; a prerelease never satisfies a range
 * written without one, so a Plugin cannot ride a prerelease API by accident.
 */

export interface Semver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly string[];
}

interface PartialVersion {
  readonly major: number | null;
  readonly minor: number | null;
  readonly patch: number | null;
}

interface Bounds {
  readonly lower: Semver | null;
  readonly lowerInclusive: boolean;
  readonly upper: Semver | null;
  readonly upperInclusive: boolean;
}

const VERSION_PATTERN =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const PARTIAL_PATTERN =
  /^(?:(x|X|\*)|(0|[1-9]\d*))(?:\.(?:(x|X|\*)|(0|[1-9]\d*)))?(?:\.(?:(x|X|\*)|(0|[1-9]\d*)))?$/;

function version(major: number, minor: number, patch: number): Semver {
  return { major, minor, patch, prerelease: [] };
}

export function parseSemver(value: string): Semver | null {
  const match = VERSION_PATTERN.exec(value);
  if (match === null) return null;
  const prerelease = match[4] === undefined ? [] : match[4].split(".");
  for (const identifier of prerelease) {
    if (/^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0"))
      return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
  };
}

function comparePrerelease(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const left = a[index];
    const right = b[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) {
      const difference = Number(left) - Number(right);
      if (difference !== 0) return difference < 0 ? -1 : 1;
      continue;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}

/** Negative when `a` is older, positive when newer; semver precedence. */
export function compareSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  return comparePrerelease(a.prerelease, b.prerelease);
}

function parsePartial(text: string): PartialVersion | null {
  const match = PARTIAL_PATTERN.exec(text);
  if (match === null) return null;
  const read = (wildcard: string | undefined, number: string | undefined): number | null =>
    wildcard !== undefined ? null : Number(number);
  const major = read(match[1], match[2]);
  const minor = major === null ? null : read(match[3], match[4]);
  const patch = minor === null ? null : read(match[5], match[6]);
  return { major, minor, patch };
}

function filled(partial: PartialVersion): Semver {
  return version(partial.major ?? 0, partial.minor ?? 0, partial.patch ?? 0);
}

function boundsFor(op: string, partial: PartialVersion): Bounds {
  if (partial.major === null) {
    return { lower: null, lowerInclusive: true, upper: null, upperInclusive: true };
  }
  const { major, minor, patch } = partial;
  if (op === "^") {
    let upper: Semver;
    if (major !== 0) upper = version(major + 1, 0, 0);
    else if (minor === null) upper = version(1, 0, 0);
    else if (minor !== 0) upper = version(0, minor + 1, 0);
    else if (patch === null) upper = version(0, 1, 0);
    else upper = version(0, 0, patch + 1);
    return { lower: filled(partial), lowerInclusive: true, upper, upperInclusive: false };
  }
  if (op === "~") {
    const upper = minor === null ? version(major + 1, 0, 0) : version(major, minor + 1, 0);
    return { lower: filled(partial), lowerInclusive: true, upper, upperInclusive: false };
  }
  if (op === ">") {
    if (patch !== null) {
      return { lower: filled(partial), lowerInclusive: false, upper: null, upperInclusive: true };
    }
    const next = minor === null ? version(major + 1, 0, 0) : version(major, minor + 1, 0);
    return { lower: next, lowerInclusive: true, upper: null, upperInclusive: true };
  }
  if (op === ">=") {
    return { lower: filled(partial), lowerInclusive: true, upper: null, upperInclusive: true };
  }
  if (op === "<") {
    const upper = minor === null ? version(major, 0, 0) : version(major, minor, 0);
    return { lower: null, lowerInclusive: true, upper, upperInclusive: false };
  }
  if (op === "<=") {
    if (patch !== null) {
      return { lower: null, lowerInclusive: true, upper: filled(partial), upperInclusive: true };
    }
    const upper = minor === null ? version(major + 1, 0, 0) : version(major, minor + 1, 0);
    return { lower: null, lowerInclusive: true, upper, upperInclusive: false };
  }
  // Exact, including a partial exact (`1.2`, `1.x`).
  if (patch !== null) {
    const exact = filled(partial);
    return { lower: exact, lowerInclusive: true, upper: exact, upperInclusive: true };
  }
  if (minor !== null) {
    return {
      lower: version(major, minor, 0),
      lowerInclusive: true,
      upper: version(major, minor + 1, 0),
      upperInclusive: false,
    };
  }
  return {
    lower: version(major, 0, 0),
    lowerInclusive: true,
    upper: version(major + 1, 0, 0),
    upperInclusive: false,
  };
}

function parseComparator(text: string): Bounds | null {
  const match = /^(>=|<=|>|<|\^|~|=)?(.*)$/.exec(text);
  if (match === null) return null;
  const op = match[1] ?? "";
  if (match[2] === "") return null;
  const partial = parsePartial(match[2]);
  if (partial === null) return null;
  // `*`, `x`, and `X` stand alone as "any"; `^x` or `>=x` is a typo.
  if (op !== "" && partial.major === null) return null;
  return boundsFor(op, partial);
}

function intersectBounds(a: Bounds, b: Bounds): Bounds {
  let lower = a.lower;
  let lowerInclusive = a.lowerInclusive;
  if (b.lower !== null && (lower === null || compareSemver(b.lower, lower) > 0)) {
    lower = b.lower;
    lowerInclusive = b.lowerInclusive;
  } else if (b.lower !== null && lower !== null && compareSemver(b.lower, lower) === 0) {
    lowerInclusive = lowerInclusive && b.lowerInclusive;
  }
  let upper = a.upper;
  let upperInclusive = a.upperInclusive;
  if (b.upper !== null && (upper === null || compareSemver(b.upper, upper) < 0)) {
    upper = b.upper;
    upperInclusive = b.upperInclusive;
  } else if (b.upper !== null && upper !== null && compareSemver(b.upper, upper) === 0) {
    upperInclusive = upperInclusive && b.upperInclusive;
  }
  return { lower, lowerInclusive, upper, upperInclusive };
}

function parseMemberBounds(member: string): Bounds[] | null {
  const tokens = member.split(/\s+/).filter((token) => token !== "");
  if (tokens.length === 0) return null;
  const bounds: Bounds[] = [];
  for (const token of tokens) {
    const parsed = parseComparator(token);
    if (parsed === null) return null;
    bounds.push(parsed);
  }
  return bounds;
}

function boundsSatisfied(bounds: Bounds, candidate: Semver): boolean {
  if (bounds.lower !== null) {
    const difference = compareSemver(candidate, bounds.lower);
    if (difference < 0 || (difference === 0 && !bounds.lowerInclusive)) return false;
  }
  if (bounds.upper !== null) {
    const difference = compareSemver(candidate, bounds.upper);
    if (difference > 0 || (difference === 0 && !bounds.upperInclusive)) return false;
  }
  if (candidate.prerelease.length > 0) {
    const tuple = `${candidate.major}.${candidate.minor}.${candidate.patch}`;
    const boundsAllow = [bounds.lower, bounds.upper].some(
      (bound) =>
        bound !== null &&
        bound.prerelease.length > 0 &&
        `${bound.major}.${bound.minor}.${bound.patch}` === tuple
    );
    if (!boundsAllow) return false;
  }
  return true;
}

/** One `||` alternative: the comparators a version must all satisfy. */
interface RangeMember {
  readonly bounds: readonly Bounds[];
}

function parseRange(range: string): RangeMember[] | null {
  const trimmed = range.trim();
  if (trimmed === "") return null;
  const members: RangeMember[] = [];
  for (const rawMember of trimmed.split("||")) {
    const member = rawMember.trim();
    if (member === "") return null;
    if (member === "*" || member === "x" || member === "X") {
      members.push({ bounds: [boundsFor("", { major: null, minor: null, patch: null })] });
      continue;
    }
    const bounds = parseMemberBounds(member);
    if (bounds === null) return null;
    members.push({ bounds });
  }
  return members;
}

export function isValidRange(range: string): boolean {
  return parseRange(range) !== null;
}

export function satisfiesRange(range: string, candidate: Semver): boolean {
  const members = parseRange(range);
  if (members === null) return false;
  return members.some((member) =>
    member.bounds.every((bounds) => boundsSatisfied(bounds, candidate))
  );
}

function memberBounds(member: RangeMember): Bounds {
  let bounds: Bounds = {
    lower: null,
    lowerInclusive: true,
    upper: null,
    upperInclusive: true,
  };
  for (const comparator of member.bounds) bounds = intersectBounds(bounds, comparator);
  return bounds;
}

export type RangeRelation = "in-range" | "wants-newer" | "wants-older";

/**
 * How one host version stands against a range. `wants-newer` means every
 * version the range admits is above this one; `wants-older` means this version
 * has moved past what the range admits (a union that spans past this version
 * also counts here).
 */
export function rangeRelation(range: string, candidate: Semver): RangeRelation {
  const members = parseRange(range);
  if (members === null) return "wants-older";
  let allBelow = true;
  for (const member of members) {
    const bounds = memberBounds(member);
    if (member.bounds.every((comparator) => boundsSatisfied(comparator, candidate))) {
      return "in-range";
    }
    const below =
      bounds.lower !== null &&
      (compareSemver(candidate, bounds.lower) < 0 ||
        (compareSemver(candidate, bounds.lower) === 0 && !bounds.lowerInclusive));
    if (!below) allBelow = false;
  }
  return allBelow ? "wants-newer" : "wants-older";
}
