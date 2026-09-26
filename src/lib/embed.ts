/** The standalone Embed route: a bare editor with no app shell. */
export const EMBED_PATH = "/embed";

/**
 * Whether `pathname` is the Embed route. The Embed editor takes its theme from
 * its `?theme` parameter, so app-wide theme handling must leave it alone.
 */
export function isEmbedPath(pathname: string): boolean {
  return pathname === EMBED_PATH;
}
