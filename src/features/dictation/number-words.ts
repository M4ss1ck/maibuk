// Words-to-number parser for Dictation (en/es): longest valid integer prefix, 0..999999999.

import type { DictationLanguage } from "@/features/dictation/types";

export interface ParsedNumber {
  value: number;
  length: number;
}

const EN_UNITS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
};

const EN_TEENS: Record<string, number> = {
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const EN_TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

interface Below {
  value: number;
  next: number;
}

function enBelow100(words: readonly string[], pos: number, end: number): Below | null {
  if (pos >= end) return null;
  const word = words[pos];
  const unit = EN_UNITS[word];
  if (unit !== undefined) return { value: unit, next: pos + 1 };
  const teen = EN_TEENS[word];
  if (teen !== undefined) return { value: teen, next: pos + 1 };
  const ten = EN_TENS[word];
  if (ten === undefined) return null;
  // Tens take only a unit after them, never a teen or another ten.
  const follower = pos + 1 < end ? EN_UNITS[words[pos + 1]] : undefined;
  if (follower !== undefined) return { value: ten + follower, next: pos + 2 };
  return { value: ten, next: pos + 1 };
}

// Below-1000 must consume pos..end exactly; "and" without a continuation fails
// so the prefix fallback stops before it.
function enBelow1000(words: readonly string[], pos: number, end: number): number | null {
  const unit = pos < end ? EN_UNITS[words[pos]] : undefined;
  if (unit !== undefined && words[pos + 1] === "hundred") {
    let at = pos + 2;
    const base = unit * 100;
    if (at < end && words[at] === "and") {
      at += 1;
      if (at >= end) return null;
    }
    if (at === end) return base;
    const rest = enBelow100(words, at, end);
    if (rest === null || rest.next !== end) return null;
    return base + rest.value;
  }
  const below = enBelow100(words, pos, end);
  if (below === null || below.next !== end) return null;
  return below.value;
}

function enScaled(
  words: readonly string[],
  pos: number,
  end: number,
  scale: string,
  factor: number,
  parseLeft: (words: readonly string[], pos: number, end: number) => number | null,
  parseRight: (words: readonly string[], pos: number, end: number) => number | null
): number | null {
  let at = -1;
  for (let i = pos; i < end; i += 1) {
    if (words[i] === scale) {
      if (at !== -1) return null;
      at = i;
    }
  }
  if (at === -1) return parseRight(words, pos, end);
  const left = parseLeft(words, pos, at);
  if (left === null) return null;
  let rest = at + 1;
  if (rest < end && words[rest] === "and") {
    rest += 1;
    if (rest >= end) return null;
  }
  if (rest === end) return left * factor;
  const right = parseRight(words, rest, end);
  if (right === null) return null;
  return left * factor + right;
}

function enBelow1M(words: readonly string[], pos: number, end: number): number | null {
  return enScaled(words, pos, end, "thousand", 1000, enBelow1000, enBelow1000);
}

function enExact(words: readonly string[]): number | null {
  if (words.length === 0) return null;
  // "zero" never combines; anything after it starts a new number.
  if (words[0] === "zero") return words.length === 1 ? 0 : null;
  return enScaled(words, 0, words.length, "million", 1000000, enBelow1000, enBelow1M);
}

const ES_UNITS: Record<string, number> = {
  uno: 1,
  un: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
};

const ES_TEENS: Record<string, number> = {
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
};

const ES_TENS: Record<string, number> = {
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
};

const ES_TWENTIES: Record<string, number> = {
  veinte: 20,
  veintiuno: 21,
  veintiun: 21,
  veintiuna: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
};

const ES_HUNDREDS: Record<string, number> = {
  doscientos: 200,
  doscientas: 200,
  trescientos: 300,
  trescientas: 300,
  cuatrocientos: 400,
  cuatrocientas: 400,
  quinientos: 500,
  quinientas: 500,
  seiscientos: 600,
  seiscientas: 600,
  setecientos: 700,
  setecientas: 700,
  ochocientos: 800,
  ochocientas: 800,
  novecientos: 900,
  novecientas: 900,
};

function esBelow100(words: readonly string[], pos: number, end: number): Below | null {
  if (pos >= end) return null;
  const word = words[pos];
  const unit = ES_UNITS[word];
  if (unit !== undefined) return { value: unit, next: pos + 1 };
  const teen = ES_TEENS[word];
  if (teen !== undefined) return { value: teen, next: pos + 1 };
  const twenty = ES_TWENTIES[word];
  if (twenty !== undefined) return { value: twenty, next: pos + 1 };
  const ten = ES_TENS[word];
  if (ten === undefined) return null;
  // "y" joins tens to a unit only; a dangling "y" ends the number before it.
  if (pos + 1 < end && words[pos + 1] === "y") {
    const follower = pos + 2 < end ? ES_UNITS[words[pos + 2]] : undefined;
    if (follower !== undefined) return { value: ten + follower, next: pos + 3 };
  }
  return { value: ten, next: pos + 1 };
}

function esBelow1000(words: readonly string[], pos: number, end: number): number | null {
  if (pos >= end) return null;
  const word = words[pos];
  // "cien" is exactly 100; "cien mil" combines at the thousands level instead.
  if (word === "cien") return pos + 1 === end ? 100 : null;
  // "ciento" alone is not a number; it needs a below-100 after it.
  if (word === "ciento") {
    const rest = esBelow100(words, pos + 1, end);
    if (rest === null || rest.next !== end) return null;
    return 100 + rest.value;
  }
  const hundred = ES_HUNDREDS[word];
  if (hundred !== undefined) {
    if (pos + 1 === end) return hundred;
    const rest = esBelow100(words, pos + 1, end);
    if (rest === null || rest.next !== end) return null;
    return hundred + rest.value;
  }
  const below = esBelow100(words, pos, end);
  if (below === null || below.next !== end) return null;
  return below.value;
}

function esBelow1M(words: readonly string[], pos: number, end: number): number | null {
  let at = -1;
  for (let i = pos; i < end; i += 1) {
    if (words[i] === "mil") {
      if (at !== -1) return null;
      at = i;
    }
  }
  if (at === -1) return esBelow1000(words, pos, end);
  // Bare "mil" is 1000 plus an optional below-1000.
  if (at === pos) {
    if (at + 1 === end) return 1000;
    const rest = esBelow1000(words, at + 1, end);
    if (rest === null) return null;
    return 1000 + rest;
  }
  // "un mil"/"uno mil" are not Spanish; the multiplier starts at two.
  const left = esBelow1000(words, pos, at);
  if (left === null || left < 2) return null;
  if (at + 1 === end) return left * 1000;
  const rest = esBelow1000(words, at + 1, end);
  if (rest === null) return null;
  return left * 1000 + rest;
}

function esExact(words: readonly string[]): number | null {
  if (words.length === 0) return null;
  // "cero" never combines; anything after it starts a new number.
  if (words[0] === "cero") return words.length === 1 ? 0 : null;
  let at = -1;
  let singular = false;
  for (let i = 0; i < words.length; i += 1) {
    if (words[i] === "millon" || words[i] === "millones") {
      if (at !== -1) return null;
      at = i;
      singular = words[i] === "millon";
    }
  }
  if (at === -1) return esBelow1M(words, 0, words.length);
  const left = esBelow1000(words, 0, at);
  if (left === null) return null;
  if (singular) {
    // Singular "millon" pairs only with un/uno.
    if (at !== 1 || (words[0] !== "un" && words[0] !== "uno")) return null;
  } else if (left < 2) {
    return null;
  }
  if (at + 1 === words.length) return left * 1000000;
  const rest = esBelow1M(words, at + 1, words.length);
  if (rest === null) return null;
  return left * 1000000 + rest;
}

export function parseNumberWords(
  words: readonly string[],
  language: DictationLanguage
): ParsedNumber | null {
  if (words.length === 0) return null;
  // Longest valid prefix wins; a failed long prefix falls back to a shorter one.
  const cap = Math.min(words.length, 24);
  for (let length = cap; length >= 1; length -= 1) {
    const prefix = words.slice(0, length);
    const value = language === "en" ? enExact(prefix) : esExact(prefix);
    if (value !== null) return { value, length };
  }
  return null;
}
