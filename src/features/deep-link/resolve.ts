// src/features/deep-link/resolve.ts - delegates to resolve-target
import { parseLinkUri } from "@/features/links/link-uri";
import type { ParsedLink } from "@/features/links/types";
import {
  resolveParsedLink as resolveParsedLinkTarget,
  type LinkOutcome,
  type LinkTarget,
  type LinkToastKey,
} from "@/features/links/resolve-target";

export type { LinkTarget, LinkOutcome, LinkToastKey };

export function selectFirstValidUrl(urls: string[] | null | undefined): ParsedLink | null {
  if (!urls || urls.length === 0) return null;
  for (const url of urls) {
    if (typeof url !== "string" || url.length === 0) continue;
    const parsed = parseLinkUri(url);
    if (parsed) return parsed;
  }
  return null;
}

export async function resolveBatch(
  urls: string[] | null | undefined
): Promise<LinkOutcome | null> {
  const parsed = selectFirstValidUrl(urls);
  if (!parsed) return null;
  const outcome = await resolveParsedLinkTarget(parsed);
  return outcome;
}
