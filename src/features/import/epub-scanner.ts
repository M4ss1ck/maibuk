import { readEpub } from "./epub-reader";
import type {
  CompatibilityIssue,
  CompatibilityReport,
  CompatibilitySeverity,
  ImportPreview,
  ParsedEpub,
  ParsedEpubResource,
} from "./types";

const CONTENT_MEDIA_TYPES = new Set(["application/xhtml+xml", "text/html"]);
const STYLE_MEDIA_TYPES = new Set(["text/css"]);
const ASSET_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "font/otf",
  "font/ttf",
  "font/woff",
  "font/woff2",
  "application/font-woff",
  "application/font-woff2",
  "application/vnd.ms-opentype",
]);
const LOSSY_MEDIA_PREFIXES = ["audio/", "video/"];
const LOSSY_MEDIA_TYPES = new Set([
  "application/javascript",
  "text/javascript",
  "application/smil+xml",
  "application/pls+xml",
]);

export function scanEpub(bytes: Uint8Array): CompatibilityReport {
  const parsed = readEpub(bytes);
  const issues = [...parsed.issues, ...scanParsedEpub(parsed)];
  return {
    issues,
    summary: summarizeIssues(issues),
  };
}

export function buildImportPreview(parsed: ParsedEpub): ImportPreview {
  return {
    title: getMetadataValue(parsed, "title"),
    author: getMetadataValue(parsed, "creator"),
    language: getMetadataValue(parsed, "language"),
    chapterCount: parsed.spine.filter((item) => CONTENT_MEDIA_TYPES.has(item.mediaType)).length,
    assetCount: parsed.resources.filter(isSupportedAssetResource).length,
    styleCount: parsed.resources.filter((resource) => STYLE_MEDIA_TYPES.has(resource.mediaType)).length,
    metadataCount: parsed.metadata.length,
  };
}

function scanParsedEpub(parsed: ParsedEpub): CompatibilityIssue[] {
  const issues: CompatibilityIssue[] = [];

  for (const resource of parsed.resources) {
    if (STYLE_MEDIA_TYPES.has(resource.mediaType)) {
      issues.push({
        severity: "info",
        code: "css-resource",
        message: "CSS resources can be imported as book styles.",
        href: resource.absoluteHref,
      });
      continue;
    }

    if (isSupportedAssetResource(resource)) {
      issues.push({
        severity: "info",
        code: "asset-resource",
        message: "Image and font resources can be imported as project assets.",
        href: resource.absoluteHref,
      });
      continue;
    }

    if (resource.mediaType === "application/x-dtbncx+xml") {
      issues.push({
        severity: parsed.epubVersion?.startsWith("2") ? "info" : "converted",
        code: "epub2-ncx",
        message: "EPUB NCX navigation can be used as import guidance.",
        href: resource.absoluteHref,
      });
      continue;
    }

    if (CONTENT_MEDIA_TYPES.has(resource.mediaType)) {
      continue;
    }

    if (isLossyResource(resource)) {
      issues.push({
        severity: "lossy",
        code: "unsupported-media-type",
        message: "This EPUB resource cannot be represented in the editor yet.",
        href: resource.absoluteHref,
        details: { mediaType: resource.mediaType },
      });
    }
  }

  if (hasFixedLayoutMetadata(parsed)) {
    issues.push({
      severity: "lossy",
      code: "fixed-layout",
      message: "Fixed-layout EPUB metadata will not be preserved as fixed layout.",
    });
  }

  return issues;
}

function summarizeIssues(issues: CompatibilityIssue[]): Record<CompatibilitySeverity, number> {
  return issues.reduce<Record<CompatibilitySeverity, number>>(
    (summary, issue) => {
      summary[issue.severity] += 1;
      return summary;
    },
    { blocking: 0, lossy: 0, converted: 0, info: 0 }
  );
}

function getMetadataValue(parsed: ParsedEpub, key: string): string | undefined {
  return parsed.metadata.find((metadata) => metadata.key === key)?.value;
}

function isSupportedAssetResource(resource: ParsedEpubResource): boolean {
  return ASSET_MEDIA_TYPES.has(resource.mediaType);
}

function isLossyResource(resource: ParsedEpubResource): boolean {
  return (
    LOSSY_MEDIA_TYPES.has(resource.mediaType) ||
    LOSSY_MEDIA_PREFIXES.some((prefix) => resource.mediaType.startsWith(prefix))
  );
}

function hasFixedLayoutMetadata(parsed: ParsedEpub): boolean {
  return parsed.metadata.some(
    (metadata) =>
      metadata.key === "meta" &&
      metadata.attributes.property === "rendition:layout" &&
      metadata.value === "pre-paginated"
  );
}
