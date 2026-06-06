export const COMPATIBILITY_SEVERITIES = ["blocking", "lossy", "converted", "info"] as const;

export type CompatibilitySeverity = (typeof COMPATIBILITY_SEVERITIES)[number];

export interface CompatibilityIssue {
  severity: CompatibilitySeverity;
  code: string;
  message: string;
  href?: string;
  details?: Record<string, unknown>;
}

export interface CompatibilityReport {
  issues: CompatibilityIssue[];
  summary: Record<CompatibilitySeverity, number>;
}

export interface ParsedEpubResource {
  id: string;
  href: string;
  absoluteHref: string;
  mediaType: string;
  properties: string[];
  data: Uint8Array;
  text?: string;
}

export interface ParsedEpubMetadata {
  namespace?: string;
  key: string;
  value: string;
  attributes: Record<string, string>;
  order: number;
}

export interface ParsedEpubSpineItem {
  idref: string;
  href: string;
  mediaType: string;
  linear: boolean;
  index: number;
  properties: string[];
}

export interface ParsedEpubNavItem {
  href: string;
  label: string;
  children: ParsedEpubNavItem[];
}

export interface ParsedEpub {
  packagePath: string;
  epubVersion?: string;
  metadata: ParsedEpubMetadata[];
  resources: ParsedEpubResource[];
  spine: ParsedEpubSpineItem[];
  nav: ParsedEpubNavItem[];
  issues: CompatibilityIssue[];
}

export interface ImportPreview {
  title?: string;
  author?: string;
  language?: string;
  chapterCount: number;
  assetCount: number;
  styleCount: number;
  metadataCount: number;
}

export function canImport(report: CompatibilityReport): boolean {
  return !report.issues.some((issue) => issue.severity === "blocking");
}

export function requiresAcknowledgement(report: CompatibilityReport): boolean {
  return report.issues.some((issue) => issue.severity !== "blocking");
}
