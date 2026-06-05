import type { CompatibilityIssue } from "./types";

export interface XhtmlReference {
  kind: "asset" | "link";
  originalHref: string;
  resolvedHref: string;
  assetId?: string;
}

export interface NormalizeXhtmlInput {
  html: string;
  baseHref: string;
  assetHrefMap: Map<string, string>;
}

export interface NormalizeXhtmlResult {
  html: string;
  issues: CompatibilityIssue[];
  referencedAssetIds: string[];
  references: XhtmlReference[];
}

export function normalizeXhtmlToEditorHtml(input: NormalizeXhtmlInput): NormalizeXhtmlResult {
  const document = new DOMParser().parseFromString(input.html, "text/html");
  const sourceRoot = document.body;
  const issues: CompatibilityIssue[] = [];
  const references: XhtmlReference[] = [];
  const referencedAssetIds: string[] = [];

  removeUnsupportedElements(sourceRoot, issues);
  collectAndNormalizeLinks(sourceRoot, input.baseHref, references);
  normalizeImages(sourceRoot, input, references, referencedAssetIds);
  unwrapUnsupportedElements(sourceRoot);

  return {
    html: sourceRoot.innerHTML.trim(),
    issues,
    referencedAssetIds,
    references,
  };
}

function removeUnsupportedElements(root: HTMLElement, issues: CompatibilityIssue[]): void {
  for (const style of Array.from(root.querySelectorAll("style"))) {
    issues.push({
      severity: "lossy",
      code: "removed-style-tag",
      message: "Embedded style tags are imported as book styles instead of chapter content.",
    });
    style.remove();
  }

  for (const script of Array.from(root.querySelectorAll("script"))) {
    issues.push({
      severity: "lossy",
      code: "removed-script-tag",
      message: "Script tags cannot be represented in Maibuk editor content.",
    });
    script.remove();
  }
}

function collectAndNormalizeLinks(
  root: HTMLElement,
  baseHref: string,
  references: XhtmlReference[]
): void {
  for (const link of Array.from(root.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const originalHref = link.getAttribute("href");
    if (!originalHref) continue;
    references.push({
      kind: "link",
      originalHref,
      resolvedHref: resolveHref(baseHref, originalHref),
    });
  }
}

function normalizeImages(
  root: HTMLElement,
  input: NormalizeXhtmlInput,
  references: XhtmlReference[],
  referencedAssetIds: string[]
): void {
  for (const image of Array.from(root.querySelectorAll<HTMLImageElement>("img[src]"))) {
    const originalHref = image.getAttribute("src");
    if (!originalHref) continue;

    const resolvedHref = resolveHref(input.baseHref, originalHref);
    const assetId = input.assetHrefMap.get(resolvedHref);
    references.push({ kind: "asset", originalHref, resolvedHref, assetId });

    if (!assetId) continue;

    referencedAssetIds.push(assetId);
    image.setAttribute("src", `maibuk-asset:${assetId}`);

    const figure = root.ownerDocument.createElement("figure");
    figure.setAttribute("data-image", "");
    const replacementImage = image.cloneNode(false);
    figure.appendChild(replacementImage);
    const caption = root.ownerDocument.createElement("figcaption");
    figure.appendChild(caption);
    image.replaceWith(figure);
  }
}

function unwrapUnsupportedElements(root: HTMLElement): void {
  const allowedElements = new Set([
    "A",
    "BLOCKQUOTE",
    "BODY",
    "BR",
    "EM",
    "FIGCAPTION",
    "FIGURE",
    "H1",
    "H2",
    "H3",
    "HR",
    "IMG",
    "LI",
    "OL",
    "P",
    "S",
    "STRONG",
    "SUB",
    "SUP",
    "U",
    "UL",
  ]);

  for (const element of Array.from(root.querySelectorAll("*"))) {
    if (allowedElements.has(element.tagName)) continue;
    element.replaceWith(...Array.from(element.childNodes));
  }
}

function resolveHref(baseHref: string, href: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) {
    return href;
  }

  const [hrefWithoutHash, hash] = href.split("#", 2);
  const baseDir = dirname(baseHref);
  const segments = `${baseDir}/${hrefWithoutHash}`
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".");
  const resolved: string[] = [];

  for (const segment of segments) {
    if (segment === "..") {
      resolved.pop();
    } else {
      resolved.push(segment);
    }
  }

  return `${resolved.join("/")}${hash ? `#${hash}` : ""}`;
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}
