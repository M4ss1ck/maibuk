export type {
  DictionaryScript,
  SpellCheckDictionary,
} from "@/features/spell-check-dictionaries/types";
export {
  DICTIONARY_CATALOG,
  DICTIONARY_COMMIT,
  dictionaryFor,
  dictionaryScript,
  dictionarySizeMb,
  validateCatalog,
} from "@/features/spell-check-dictionaries/catalog";
export {
  installDictionary,
  isDictionaryInstalled,
  readInstalledDictionary,
} from "@/features/spell-check-dictionaries/install";
export {
  dictionaryStatus,
  useSpellCheckDictionaries,
  type DictionaryStatus,
  type SpellCheckDictionariesState,
} from "@/features/spell-check-dictionaries/store";
