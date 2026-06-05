import { strFromU8, unzipSync } from "fflate";
import type {
  CompatibilityIssue,
  ParsedEpub,
  ParsedEpubMetadata,
  ParsedEpubNavItem,
  ParsedEpubResource,
  ParsedEpubSpineItem,
} from "./types";

const EMPTY_PARSED_EPUB: ParsedEpub = {
  packagePath: "",
  metadata: [],
  resources: [],
  spine: [],
  nav: [],
  issues: [],
};

export function readEpub(bytes: Uint8Array): ParsedEpub {
  const issues: CompatibilityIssue[] = [];
  let entries: Record<string, Uint8Array>;

  try {
    entries = unzipSync(bytes);
  } catch (error) {
    return {
      ...EMPTY_PARSED_EPUB,
      issues: [
        {
          severity: "blocking",
          code: "malformed-zip",
          message: "The EPUB file could not be opened as a ZIP archive.",
          details: { error: String(error) },
        },
      ],
    };
  }

  if (entries["META-INF/encryption.xml"]) {
    issues.push({
      severity: "blocking",
      code: "encrypted-epub",
      message: "Encrypted or DRM-protected EPUB files cannot be imported.",
    });
  }

  const containerEntry = entries["META-INF/container.xml"];
  if (!containerEntry) {
    return {
      ...EMPTY_PARSED_EPUB,
      issues: [
        ...issues,
        {
          severity: "blocking",
          code: "missing-container",
          message: "The EPUB is missing META-INF/container.xml.",
        },
      ],
    };
  }

  const containerXml = parseXml(toText(containerEntry), "container.xml");
  const packagePath = getPackagePath(containerXml);
  if (!packagePath) {
    return {
      ...EMPTY_PARSED_EPUB,
      issues: [
        ...issues,
        {
          severity: "blocking",
          code: "missing-package-reference",
          message: "The EPUB container does not reference an OPF package file.",
        },
      ],
    };
  }

  const packageEntry = entries[packagePath];
  if (!packageEntry) {
    return {
      ...EMPTY_PARSED_EPUB,
      packagePath,
      issues: [
        ...issues,
        {
          severity: "blocking",
          code: "missing-opf",
          message: "The EPUB package file referenced by container.xml could not be found.",
          href: packagePath,
        },
      ],
    };
  }

  const packageXml = parseXml(toText(packageEntry), packagePath);
  const packageElement = packageXml.documentElement;
  const resources = parseResources(packageXml, packagePath, entries, issues);
  const spine = parseSpine(packageXml, resources, issues);

  if (spine.length === 0) {
    issues.push({
      severity: "blocking",
      code: "missing-spine",
      message: "The EPUB package does not contain a readable spine.",
      href: packagePath,
    });
  }

  return {
    packagePath,
    epubVersion: packageElement.getAttribute("version") ?? undefined,
    metadata: parseMetadata(packageXml),
    resources,
    spine,
    nav: parseNav(resources),
    issues,
  };
}

function parseXml(xml: string, source: string): Document {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const parserError = document.querySelector("parsererror");
  if (parserError) {
    throw new Error(`Unable to parse ${source}`);
  }
  return document;
}

function getPackagePath(containerXml: Document): string | undefined {
  const rootfile = containerXml.querySelector("rootfile[full-path]");
  return rootfile?.getAttribute("full-path") ?? undefined;
}

function parseMetadata(packageXml: Document): ParsedEpubMetadata[] {
  const metadataElement = packageXml.querySelector("metadata");
  if (!metadataElement) return [];

  return Array.from(metadataElement.children).map((element, order) => ({
    namespace: element.namespaceURI ?? undefined,
    key: element.localName,
    value: element.textContent?.trim() ?? "",
    attributes: attributesToRecord(element),
    order,
  }));
}

function parseResources(
  packageXml: Document,
  packagePath: string,
  entries: Record<string, Uint8Array>,
  issues: CompatibilityIssue[]
): ParsedEpubResource[] {
  const packageDir = dirname(packagePath);

  return Array.from(packageXml.querySelectorAll("manifest > item")).map((item) => {
    const id = item.getAttribute("id") ?? "";
    const href = item.getAttribute("href") ?? "";
    const mediaType = item.getAttribute("media-type") ?? "";
    const absoluteHref = resolveHref(packageDir, href);
    const data = entries[absoluteHref] ?? new Uint8Array();

    if (!entries[absoluteHref]) {
      issues.push({
        severity: "blocking",
        code: "missing-manifest-item",
        message: "A required EPUB manifest item could not be read.",
        href: absoluteHref,
      });
    }

    return {
      id,
      href,
      absoluteHref,
      mediaType,
      properties: splitProperties(item.getAttribute("properties")),
      data,
      text: isTextMediaType(mediaType) ? toText(data) : undefined,
    };
  });
}

function parseSpine(
  packageXml: Document,
  resources: ParsedEpubResource[],
  issues: CompatibilityIssue[]
): ParsedEpubSpineItem[] {
  const resourceById = new Map(resources.map((resource) => [resource.id, resource]));

  return Array.from(packageXml.querySelectorAll("spine > itemref")).flatMap((itemref, index) => {
    const idref = itemref.getAttribute("idref") ?? "";
    const resource = resourceById.get(idref);
    if (!resource) {
      issues.push({
        severity: "blocking",
        code: "missing-spine-item",
        message: "A spine item references a manifest item that does not exist.",
        details: { idref },
      });
      return [];
    }

    return [
      {
        idref,
        href: resource.href,
        mediaType: resource.mediaType,
        linear: itemref.getAttribute("linear") !== "no",
        index,
        properties: splitProperties(itemref.getAttribute("properties")),
      },
    ];
  });
}

function parseNav(resources: ParsedEpubResource[]): ParsedEpubNavItem[] {
  const epub3Nav = resources.find((resource) => resource.properties.includes("nav"));
  if (epub3Nav?.text) {
    const items = parseEpub3Nav(epub3Nav);
    if (items.length > 0) return items;
  }

  const ncx = resources.find((resource) => resource.mediaType === "application/x-dtbncx+xml");
  if (ncx?.text) {
    return parseNcxNav(ncx);
  }

  return [];
}

function parseEpub3Nav(navResource: ParsedEpubResource): ParsedEpubNavItem[] {
  const document = new DOMParser().parseFromString(navResource.text ?? "", "text/html");
  const navs = Array.from(document.querySelectorAll("nav"));
  const toc =
    navs.find((nav) => (nav.getAttribute("epub:type") ?? "").split(/\s+/).includes("toc")) ??
    navs[0];
  const list = toc ? childByLocalName(toc, "ol") : undefined;
  return list ? parseNavList(list, dirname(navResource.absoluteHref)) : [];
}

function parseNavList(list: Element, baseDir: string): ParsedEpubNavItem[] {
  return childrenByLocalName(list, "li").flatMap((item) => {
    const anchor = childByLocalName(item, "a") ?? childByLocalName(item, "span");
    const label = anchor?.textContent?.trim() ?? "";
    const href = anchor?.getAttribute("href") ?? "";
    const childList = childByLocalName(item, "ol");
    const children = childList ? parseNavList(childList, baseDir) : [];
    if (!label && children.length === 0) return [];
    return [{ href: resolveNavHref(baseDir, href), label, children }];
  });
}

function parseNcxNav(ncxResource: ParsedEpubResource): ParsedEpubNavItem[] {
  const document = new DOMParser().parseFromString(ncxResource.text ?? "", "application/xml");
  if (document.querySelector("parsererror")) return [];
  const navMap = document.querySelector("navMap");
  return navMap ? parseNavPoints(navMap, dirname(ncxResource.absoluteHref)) : [];
}

function parseNavPoints(parent: Element, baseDir: string): ParsedEpubNavItem[] {
  return childrenByLocalName(parent, "navPoint").map((navPoint) => {
    const navLabel = childByLocalName(navPoint, "navLabel");
    const label =
      (navLabel ? childByLocalName(navLabel, "text") : undefined)?.textContent?.trim() ?? "";
    const src = childByLocalName(navPoint, "content")?.getAttribute("src") ?? "";
    return {
      href: resolveNavHref(baseDir, src),
      label,
      children: parseNavPoints(navPoint, baseDir),
    };
  });
}

function childByLocalName(parent: Element, localName: string): Element | undefined {
  return Array.from(parent.children).find((child) => child.localName === localName);
}

function childrenByLocalName(parent: Element, localName: string): Element[] {
  return Array.from(parent.children).filter((child) => child.localName === localName);
}

function resolveNavHref(baseDir: string, href: string): string {
  const withoutFragment = href.split("#")[0];
  return withoutFragment ? resolveHref(baseDir, withoutFragment) : "";
}

function attributesToRecord(element: Element): Record<string, string> {
  return Array.from(element.attributes).reduce<Record<string, string>>((attributes, attr) => {
    attributes[attr.name] = attr.value;
    return attributes;
  }, {});
}

function splitProperties(value: string | null): string[] {
  return value?.split(/\s+/).filter(Boolean) ?? [];
}

function isTextMediaType(mediaType: string): boolean {
  return (
    mediaType.startsWith("text/") ||
    mediaType === "application/xhtml+xml" ||
    mediaType === "application/xml" ||
    mediaType === "application/x-dtbncx+xml"
  );
}

function toText(data: Uint8Array): string {
  return strFromU8(data);
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function resolveHref(baseDir: string, href: string): string {
  const segments = `${baseDir}/${href}`
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

  return resolved.join("/");
}
