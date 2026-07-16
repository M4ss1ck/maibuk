/** Unicode standard Hangul syllable name algorithm (UAX #42 / chapter 3.12). */
const CHOSEONG = [
  "G",
  "GG",
  "N",
  "D",
  "DD",
  "R",
  "M",
  "B",
  "BB",
  "S",
  "SS",
  "",
  "J",
  "JJ",
  "C",
  "K",
  "T",
  "P",
  "H",
];
const JUNGSEONG = [
  "A",
  "AE",
  "YA",
  "YAE",
  "EO",
  "E",
  "YEO",
  "YE",
  "O",
  "WA",
  "WAE",
  "OE",
  "YO",
  "U",
  "WEO",
  "WE",
  "WI",
  "YU",
  "EU",
  "YI",
  "I",
];
const JONGSEONG = [
  "",
  "G",
  "GG",
  "GS",
  "N",
  "NJ",
  "NH",
  "D",
  "L",
  "LG",
  "LM",
  "LB",
  "LS",
  "LT",
  "LP",
  "LH",
  "M",
  "B",
  "BS",
  "S",
  "SS",
  "NG",
  "J",
  "C",
  "K",
  "T",
  "P",
  "H",
];

export function formatCodePoint(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}

export function hangulSyllableName(cp: number): string {
  const s = cp - 0xac00;
  const l = Math.floor(s / 588);
  const v = Math.floor((s % 588) / 28);
  const t = s % 28;
  return `HANGUL SYLLABLE ${CHOSEONG[l]}${JUNGSEONG[v]}${JONGSEONG[t]}`;
}

export function rangeCharName(cp: number, prefix: string): string {
  if (prefix === "HANGUL") return hangulSyllableName(cp);
  return `${prefix}-${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}
