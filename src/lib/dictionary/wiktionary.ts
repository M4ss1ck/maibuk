import DOMPurify from "dompurify";
import { baseLanguage, type WritingLanguage } from "@/lib/writing-language";

/** The base language's Wiktionary, English when the tag names none. */
export function wiktionaryOrigin(language: WritingLanguage): string {
  return `https://${baseLanguage(language) ?? "en"}.wiktionary.org`;
}

/** A word's page on the base language's Wiktionary. */
export function wiktionaryPageUrl(word: string, language: WritingLanguage): string {
  return `${wiktionaryOrigin(language)}/wiki/${encodeURIComponent(word)}`;
}

/**
 * Fetches the full Wiktionary article body for a word and returns sanitized
 * HTML. The original content is preserved verbatim; only inline styling is
 * stripped (the app controls presentation) and every link is rewritten to
 * point at the external Wiktionary page.
 */
export async function lookupWord(word: string, language: WritingLanguage): Promise<string | null> {
  const normalized = word.trim();
  if (!normalized) return null;

  const html = await fetchParsedHtml(normalized, language);
  if (!html) return null;

  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.querySelector(".mw-parser-output");
  if (!body) return null;

  const pageUrl = wiktionaryPageUrl(normalized, language);
  cleanupBody(body, pageUrl);

  const sanitized = DOMPurify.sanitize(body.innerHTML, {
    FORBID_TAGS: ["script", "style"],
    FORBID_ATTR: ["style"],
    ADD_ATTR: ["target", "rel"],
  });

  return sanitized.trim() ? sanitized : null;
}

async function fetchParsedHtml(word: string, language: WritingLanguage): Promise<string | null> {
  const url = new URL(`${wiktionaryOrigin(language)}/w/api.php`);
  url.searchParams.set("action", "parse");
  url.searchParams.set("page", word);
  url.searchParams.set("prop", "text");
  url.searchParams.set("formatversion", "2");
  url.searchParams.set("redirects", "true");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");

  const response = await fetch(url.toString());
  if (!response.ok) return null;

  const data = (await response.json()) as { parse?: { text?: string } };
  return data?.parse?.text ?? null;
}

function cleanupBody(body: Element, pageUrl: string) {
  // Drop editing UI and empty placeholders that are not dictionary content.
  for (const el of body.querySelectorAll(".mw-editsection, .mw-empty-elt")) {
    el.remove();
  }

  // Rewrite links to absolute external URLs; leave in-page anchors (#cite_…)
  // untouched so footnote/reference jumps still work inside the dialog.
  for (const anchor of body.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#")) continue;

    const absolute = resolveHref(href, pageUrl);
    if (absolute) {
      anchor.setAttribute("href", absolute);
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer");
    } else {
      anchor.removeAttribute("href");
    }
  }

  // Wiktionary serves images and pronunciation audio with protocol-relative
  // URLs (//thumb.wikimedia.org/…). Those resolve against the app's origin,
  // which is tauri://localhost on desktop, so they never load. Pin them to
  // the page's https origin.
  for (const media of body.querySelectorAll("[src]")) {
    const src = media.getAttribute("src");
    if (!src) continue;
    const absolute = resolveHref(src, pageUrl);
    if (absolute) media.setAttribute("src", absolute);
    else media.removeAttribute("src");
  }
  for (const media of body.querySelectorAll("[srcset]")) {
    media.setAttribute("srcset", resolveSrcset(media.getAttribute("srcset") ?? "", pageUrl));
  }
}

/** Resolves each `url descriptor` candidate; a comma followed by whitespace separates them. */
function resolveSrcset(srcset: string, pageUrl: string): string {
  return srcset
    .split(/,\s+/)
    .map((candidate) => {
      const [url, ...descriptor] = candidate.trim().split(/\s+/);
      const absolute = url ? resolveHref(url, pageUrl) : null;
      return absolute ? [absolute, ...descriptor].join(" ") : null;
    })
    .filter((candidate): candidate is string => candidate !== null)
    .join(", ");
}

function resolveHref(href: string, pageUrl: string): string | null {
  try {
    return new URL(href, pageUrl).toString();
  } catch {
    return null;
  }
}
