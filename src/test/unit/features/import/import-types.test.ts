import { describe, expect, it } from "vitest";
import {
  COMPATIBILITY_SEVERITIES,
  canImport,
  requiresAcknowledgement,
  type CompatibilityReport,
} from "@/features/import";

function buildReport(issues: CompatibilityReport["issues"]): CompatibilityReport {
  return {
    issues,
    summary: {
      blocking: issues.filter((issue) => issue.severity === "blocking").length,
      lossy: issues.filter((issue) => issue.severity === "lossy").length,
      converted: issues.filter((issue) => issue.severity === "converted").length,
      info: issues.filter((issue) => issue.severity === "info").length,
    },
  };
}

describe("EPUB import types", () => {
  it("defines the supported compatibility severity values", () => {
    expect(COMPATIBILITY_SEVERITIES).toEqual(["blocking", "lossy", "converted", "info"]);
  });

  it("prevents import when a compatibility report has a blocking issue", () => {
    const report = buildReport([
      {
        severity: "blocking",
        code: "encrypted-epub",
        message: "Encrypted EPUB files cannot be imported.",
      },
    ]);

    expect(canImport(report)).toBe(false);
  });

  it("allows import when compatibility issues are non-blocking", () => {
    const report = buildReport([
      {
        severity: "lossy",
        code: "unsupported-media",
        message: "Audio resources will not be editable.",
      },
    ]);

    expect(canImport(report)).toBe(true);
  });

  it("requires acknowledgement when the report contains lossy, converted, or info issues", () => {
    expect(
      requiresAcknowledgement(
        buildReport([{ severity: "lossy", code: "script", message: "Scripts are removed." }])
      )
    ).toBe(true);
    expect(
      requiresAcknowledgement(
        buildReport([
          {
            severity: "converted",
            code: "xhtml-cleanup",
            message: "XHTML was normalized for the editor.",
          },
        ])
      )
    ).toBe(true);
    expect(
      requiresAcknowledgement(
        buildReport([{ severity: "info", code: "epub2-ncx", message: "EPUB 2 NCX detected." }])
      )
    ).toBe(true);
  });

  it("does not require acknowledgement for a clean report", () => {
    expect(requiresAcknowledgement(buildReport([]))).toBe(false);
  });
});
