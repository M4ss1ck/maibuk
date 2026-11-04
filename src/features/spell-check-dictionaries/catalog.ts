// Only the languages within the #708 budget on Hunspell WASM are listed. The
// pins follow #663 decision 7: every file comes from the upstream wooorm
// repository and is never mirrored. Re-pinning a file is an edit here; an old
// copy on a device then reads as not installed.
import type {
  DictionaryFile,
  DictionaryScript,
  SpellCheckDictionary,
} from "@/features/spell-check-dictionaries/types";

export const DICTIONARY_COMMIT = "8cfea406b505e4d7df52d5a19bce525df98c54ab";

function file(
  language: string,
  name: "index.aff" | "index.dic",
  bytes: number,
  sha256: string
): DictionaryFile {
  return {
    url: `https://raw.githubusercontent.com/wooorm/dictionaries/${DICTIONARY_COMMIT}/dictionaries/${language}/${name}`,
    bytes,
    sha256,
  };
}

function dictionary(
  language: string,
  script: DictionaryScript,
  license: string,
  aff: [bytes: number, sha256: string],
  dic: [bytes: number, sha256: string]
): SpellCheckDictionary {
  return {
    language,
    script,
    aff: file(language, "index.aff", ...aff),
    dic: file(language, "index.dic", ...dic),
    license,
    source: `https://github.com/wooorm/dictionaries/tree/${DICTIONARY_COMMIT}/dictionaries/${language}`,
  };
}

export const DICTIONARY_CATALOG: readonly SpellCheckDictionary[] = [
  dictionary(
    "fr",
    "Latin",
    "MPL-2.0",
    [199870, "05a735d34c912e4e381ff08ee7c747923ccf5cf9dca81d8467982fa1ca51c2b7"],
    [1229133, "984e933237bc1224a48f42828233be9b03228260ef67aa8e2bdddcd03a26230d"]
  ),
  dictionary(
    "de",
    "Latin",
    "(GPL-2.0 OR GPL-3.0)",
    [19199, "57fdd1b16aac2131003c91e0cf2a488becb970382a402a9ce089307301cb3ef0"],
    [1118194, "b5c781a0cf6f285fb6b9b8ab02fbea104b987104a1efdda8a835837e89e3ec77"]
  ),
  dictionary(
    "it",
    "Latin",
    "GPL-3.0",
    [70020, "5770cd3e16d494c045b4a9a4a9fcd7962577e642d0384a7129c020a12cdd2c79"],
    [1295754, "b1348fbdb6f441ea9dd7e33b2cfcb96ead39ccd5e48bf894972774cd5aa86abb"]
  ),
  dictionary(
    "pt",
    "Latin",
    "(LGPL-3.0 OR MPL-2.0)",
    [979789, "a9f3621b94eb4d6838474bf9982027758e77dcb248815f49409b1a4a477dbd27"],
    [4477692, "32e2edd83541d58613bcc83ef731a79aadf85ed57e977a16c6b5f711a7a36cee"]
  ),
  dictionary(
    "nl",
    "Latin",
    "(BSD-3-Clause OR CC-BY-3.0)",
    [46732, "b430d9cf5f4170d9e5072397927e1402b34aa877d1f4c8fbc00dab6370d87312"],
    [2489166, "be192fdc36efd39dde0fb9a5a113143e0a906782e81ed68a74a710edced378d0"]
  ),
  dictionary(
    "pl",
    "Latin",
    "(GPL-3.0 OR LGPL-3.0 OR MPL-2.0)",
    [268824, "de7b54a8fa37562d58b481cf3d87a63e3dcc2d74021f6403eb0e4f5df9ecc225"],
    [4683579, "74b6155391025419967c26913541b55b36d58e80b1028037d4a0b8ddcb18d0b7"]
  ),
  dictionary(
    "tr",
    "Latin",
    "MIT",
    [240814, "6a390c79b054ad427cf9a6bf6de43463953cc1918e7f727e9dd4ebd4f9702f42"],
    [9117192, "dc1d8f7724f4aefd117274678de431e4ea1765f2e02e6983b6ca48cbf5a7fc7c"]
  ),
  dictionary(
    "ru",
    "Cyrillic",
    "BSD-3-Clause",
    [71236, "38ce7d4af78e211e9bafe4bf7e3d6a2c420591136cb738ec6648f8fdf6524cd7"],
    [3473191, "f6047416a0204adbecf3a451b874ec8a97ee37e2cbc714466ef04d8dbcc0d6fc"]
  ),
  dictionary(
    "uk",
    "Cyrillic",
    "GPL-3.0",
    [203292, "4243327a3aa19c6db5a4fb2e0c4e3eba6ad26e7ccb8a3f4e634c28d9a2d18956"],
    [8493094, "48cbe32567a2c3c98f83d437bcd84ad3c11310e9df4d6c15d888b1e67654be31"]
  ),
  dictionary(
    "el",
    "Greek",
    "(GPL-2.0 OR LGPL-2.1 OR MPL-1.1)",
    [20058, "5d2e3580af6d3523ac4470335a4b05968e59dddc58e1a7f2b260c81342e80063"],
    [19421967, "f08daefb302600beb1b345e4fd77f4ecf6617aa080a72efe6ae7eec0ad5b2ac7"]
  ),
];

const COMMIT = /[0-9a-f]{40}/;
const SHA256 = /^[0-9a-f]{64}$/;

/** Problems with a catalog, one message each; empty when valid. */
export function validateCatalog(catalog: readonly SpellCheckDictionary[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const entry of catalog) {
    if (seen.has(entry.language)) problems.push(`duplicate language ${entry.language}`);
    seen.add(entry.language);
    if (entry.license.trim() === "") problems.push(`${entry.language}: no license`);
    for (const [name, file] of [
      ["aff", entry.aff],
      ["dic", entry.dic],
    ] as const) {
      const at = `${entry.language}/${name}`;
      if (!file.url.startsWith("https://")) problems.push(`${at}: url must be https`);
      if (!COMMIT.test(file.url)) problems.push(`${at}: url must pin the commit`);
      if (!(file.bytes > 0)) problems.push(`${at}: bytes must be > 0`);
      if (!SHA256.test(file.sha256)) problems.push(`${at}: sha256 must be 64 lowercase hex`);
    }
  }
  return problems;
}

/** Download size in decimal megabytes, for display. */
export function dictionarySizeMb(entry: SpellCheckDictionary): number {
  return Math.round((entry.aff.bytes + entry.dic.bytes) / 1_000_000);
}

export function dictionaryFor(language: string): SpellCheckDictionary | undefined {
  return DICTIONARY_CATALOG.find((entry) => entry.language === language);
}

export function dictionaryScript(language: string): DictionaryScript | null {
  if (language === "en" || language === "es") return "Latin";
  return dictionaryFor(language)?.script ?? null;
}
