import DOMPurify from "dompurify";
import type { Language } from "@/features/settings/types";

/**
 * Fetches the full Wiktionary article body for a word and returns sanitized
 * HTML. The original content is preserved verbatim; only inline styling is
 * stripped (the app controls presentation) and every link is rewritten to
 * point at the external Wiktionary page.
 */
export async function lookupWord(word: string, language: Language): Promise<string | null> {
  const normalized = word.trim();
  if (!normalized) return null;

  const html = await fetchParsedHtml(normalized, language);
  if (!html) return null;

  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.querySelector(".mw-parser-output");
  if (!body) return null;

  const pageUrl = `https://${language}.wiktionary.org/wiki/${encodeURIComponent(normalized)}`;
  cleanupBody(body, pageUrl);

  const sanitized = DOMPurify.sanitize(body.innerHTML, {
    FORBID_TAGS: ["script", "style"],
    FORBID_ATTR: ["style"],
    ADD_ATTR: ["target", "rel"],
  });

  return sanitized.trim() ? sanitized : null;
}

async function fetchParsedHtml(word: string, language: Language): Promise<string | null> {
  const url = new URL(`https://${language}.wiktionary.org/w/api.php`);
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
}

function resolveHref(href: string, pageUrl: string): string | null {
  try {
    return new URL(href, pageUrl).toString();
  } catch {
    return null;
  }
}
