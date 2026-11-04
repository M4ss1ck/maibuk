// Spell Check Dictionaries on the web live in the Cache API, one entry per
// file. The install marker written last is what makes a complete pair.
import type { SpellCheckDictionaryFiles } from "@/features/spell-check-dictionaries/types";

export const SPELL_CHECK_CACHE_NAME = "maibuk-spellcheck-v1";
const key = (language: string, name: string) => `/spell-check/${language}/${name}`;

async function removeAll(language: string): Promise<void> {
  const cache = await caches.open(SPELL_CHECK_CACHE_NAME);
  const prefix = `/spell-check/${language}/`;
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname;
    if (path.startsWith(prefix)) await cache.delete(path);
  }
}

export const webSpellCheckDictionaryFiles: SpellCheckDictionaryFiles = {
  async read(language, name) {
    const cache = await caches.open(SPELL_CHECK_CACHE_NAME);
    const response = await cache.match(key(language, name));
    return response ? new Uint8Array(await response.arrayBuffer()) : null;
  },
  async write(language, name, data) {
    const cache = await caches.open(SPELL_CHECK_CACHE_NAME);
    await cache.put(key(language, name), new Response(new Uint8Array(data)));
  },
  remove: removeAll,
};
