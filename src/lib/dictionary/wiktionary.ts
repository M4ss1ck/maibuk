import type { Language } from "../../features/settings/types";
import type {
  DictionaryEntry,
  DictionaryMeaning,
  DictionaryDefinition,
  DictionaryTranslation,
} from "./types";

export async function lookupWord(word: string, language: Language): Promise<DictionaryEntry | null> {
  const normalized = word.trim();
  if (!normalized) return null;

  if (language === "es") {
    return lookupSpanish(normalized);
  }

  return lookupEnglish(normalized);
}

async function lookupEnglish(word: string): Promise<DictionaryEntry | null> {
  const url = `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}?redirect=true&origin=*`;
  const response = await fetch(url);
  if (!response.ok) return null;

  const data = (await response.json()) as Record<string, unknown>;
  const entries = data?.en;
  if (!Array.isArray(entries)) return null;

  const meanings: DictionaryMeaning[] = [];
  let phonetic: string | undefined;

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;

    const typedEntry = entry as {
      partOfSpeech?: string;
      definitions?: Array<{ definition?: string; examples?: string[] }>;
      pronunciations?: { ipa?: string[] };
    };

    if (!phonetic && typedEntry.pronunciations?.ipa?.length) {
      phonetic = typedEntry.pronunciations.ipa[0];
    }

    const definitions = (typedEntry.definitions || [])
      .map((def): DictionaryDefinition | null => {
        const text = def.definition ? cleanText(def.definition) : "";
        if (!text) return null;
        const example = def.examples?.[0] ? cleanText(def.examples[0]) : undefined;
        return { definition: text, example };
      })
      .filter((def): def is DictionaryDefinition => def !== null);

    if (definitions.length === 0) continue;

    meanings.push({
      partOfSpeech: typedEntry.partOfSpeech || "Definition",
      definitions,
    });
  }

  if (meanings.length === 0) return null;

  const translations = await fetchTranslations(word, "en");

  return {
    word,
    phonetic,
    meanings,
    translations: translations.length > 0 ? translations : undefined,
  };
}

async function lookupSpanish(word: string): Promise<DictionaryEntry | null> {
  const container = await fetchParsedContainer(word, "es");
  if (!container) return null;

  const meanings: DictionaryMeaning[] = [];
  const spanishHeading = findSpanishHeading(container);

  if (spanishHeading) {
    let node = spanishHeading.nextElementSibling;
    let currentPart = "";

    while (node && node.tagName !== "H2") {
      if (node.tagName === "H3" || node.tagName === "H4") {
        currentPart = cleanText(node.textContent || "");
      } else if (node.tagName === "OL") {
        const definitions = extractDefinitionsFromList(node);
        if (definitions.length > 0) {
          meanings.push({
            partOfSpeech: currentPart || "Definición",
            definitions,
          });
        }
      } else {
        const list = node.querySelector("ol");
        if (list) {
          const definitions = extractDefinitionsFromList(list);
          if (definitions.length > 0) {
            meanings.push({
              partOfSpeech: currentPart || "Definición",
              definitions,
            });
          }
        }
      }
      node = node.nextElementSibling;
    }
  }

  if (meanings.length === 0) {
    const firstList = container.querySelector("ol");
    if (!firstList) return null;
    const definitions = extractDefinitionsFromList(firstList);
    if (definitions.length === 0) return null;
    meanings.push({
      partOfSpeech: "Definición",
      definitions,
    });
  }

  const translations = extractTranslations(container, "Traducciones");

  return {
    word,
    meanings,
    translations: translations.length > 0 ? translations : undefined,
  };
}

function findSpanishHeading(container: Element): HTMLElement | null {
  const headlineById = container.querySelector("span.mw-headline#Español");
  if (headlineById?.closest("h2")) {
    return headlineById.closest("h2") as HTMLElement;
  }

  const headlineByText = Array.from(container.querySelectorAll("span.mw-headline")).find(
    (element) => element.textContent?.trim().toLowerCase() === "español"
  );
  return headlineByText?.closest("h2") as HTMLElement | null;
}

function extractDefinitionsFromList(list: Element): DictionaryDefinition[] {
  const items = Array.from(list.querySelectorAll(":scope > li"));
  return items
    .map((item) => cleanText(item.textContent || ""))
    .filter((text) => text.length > 0)
    .map((text) => ({ definition: text }));
}

function cleanText(text: string): string {
  const stripped = htmlToText(text);
  return stripped.replace(/\s+/g, " ").replace(/\[\d+\]/g, "").trim();
}

function htmlToText(text: string): string {
  if (typeof window !== "undefined" && "DOMParser" in window) {
    const doc = new DOMParser().parseFromString(text, "text/html");
    return doc.body.textContent || "";
  }
  return text.replace(/<[^>]*>/g, "");
}

async function fetchTranslations(word: string, language: Language): Promise<DictionaryTranslation[]> {
  const container = await fetchParsedContainer(word, language);
  if (!container) return [];
  return extractTranslations(container, language === "es" ? "Traducciones" : "Translations");
}

async function fetchParsedContainer(word: string, language: Language): Promise<Element | null> {
  const url = new URL(`https://${language}.wiktionary.org/w/api.php`);
  url.searchParams.set("action", "parse");
  url.searchParams.set("page", word);
  url.searchParams.set("prop", "text");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");

  const response = await fetch(url.toString());
  if (!response.ok) return null;

  const data = (await response.json()) as {
    parse?: { text?: { "*": string } };
  };

  const html = data?.parse?.text?.["*"];
  if (!html) return null;

  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.querySelector(".mw-parser-output");
}

function extractTranslations(container: Element, label: string): DictionaryTranslation[] {
  const targetHeading = Array.from(container.querySelectorAll("span.mw-headline")).find(
    (element) => element.textContent?.trim().toLowerCase() === label.toLowerCase()
  );

  const heading = targetHeading?.closest("h2, h3, h4, h5") as HTMLElement | null;
  if (!heading) return [];

  const translations: DictionaryTranslation[] = [];
  let node = heading.nextElementSibling;

  while (node && !/^H[2-5]$/.test(node.tagName)) {
    const items = Array.from(node.querySelectorAll("li"));
    for (const item of items) {
      const parsed = parseTranslationLine(item.textContent || "");
      if (!parsed) continue;
      addTranslation(translations, parsed);
    }
    node = node.nextElementSibling;
  }

  return translations;
}

function parseTranslationLine(text: string): DictionaryTranslation | null {
  const cleaned = cleanText(text);
  if (!cleaned) return null;

  const separatorIndex = cleaned.indexOf(":");
  if (separatorIndex === -1) return null;

  const language = cleaned.slice(0, separatorIndex).trim();
  const rest = cleaned.slice(separatorIndex + 1).trim();
  if (!language || !rest) return null;

  const words = rest
    .split(/[;,·•]/)
    .map((value) => value.replace(/\([^)]*\)/g, "").trim())
    .filter((value) => value.length > 0);

  if (words.length === 0) return null;

  return {
    language,
    words: Array.from(new Set(words)),
  };
}

function addTranslation(target: DictionaryTranslation[], incoming: DictionaryTranslation) {
  const existing = target.find(
    (entry) => entry.language.toLowerCase() === incoming.language.toLowerCase()
  );
  if (!existing) {
    target.push(incoming);
    return;
  }

  const merged = new Set(existing.words);
  for (const word of incoming.words) {
    merged.add(word);
  }
  existing.words = Array.from(merged);
}
