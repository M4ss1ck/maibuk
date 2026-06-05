import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { importEpubProject } from "../../features/import/epub-import-service";
import type { CompatibilityIssue, CompatibilityReport, ImportPreview } from "../../features/import";
import { canImport, requiresAcknowledgement } from "../../features/import";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { Switch } from "../ui/Switch";

interface EpubImportDialogProps {
  isOpen: boolean;
  bytes: Uint8Array;
  fileName: string;
  report: CompatibilityReport;
  preview: ImportPreview;
  onClose: () => void;
  onImported: (bookId: string) => void;
}

const GITHUB_ISSUE_URL = "https://github.com/massick/maibuk/issues/new";

export function EpubImportDialog({
  isOpen,
  bytes,
  fileName,
  report,
  preview,
  onClose,
  onImported,
}: EpubImportDialogProps) {
  const { t } = useTranslation();
  const [acknowledged, setAcknowledged] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasBlockingIssues = !canImport(report);
  const needsAcknowledgement = requiresAcknowledgement(report);
  const canProceed = !hasBlockingIssues && (!needsAcknowledgement || acknowledged);
  const groupedIssues = useMemo(() => groupIssues(report.issues), [report.issues]);

  const handleImport = async () => {
    if (!canProceed) return;
    setIsImporting(true);
    setError(null);
    try {
      const result = await importEpubProject({ bytes, acknowledged });
      onImported(result.bookId);
      onClose();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError));
    } finally {
      setIsImporting(false);
    }
  };

  const handleReport = () => {
    window.open(buildIssueUrl(fileName, report), "_blank");
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("import.title")}
      size="wide"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isImporting}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleImport} disabled={!canProceed || isImporting}>
            {isImporting ? t("import.importing") : t("import.action")}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex items-start gap-3">
          <div className="mt-1 rounded-lg bg-muted p-2">
            <FileText className="w-5 h-5 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{fileName}</p>
            <h3 className="text-lg font-semibold text-foreground">{preview.title || fileName}</h3>
            <p className="text-sm text-muted-foreground">
              {[preview.author, preview.language].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <PreviewStat label={t("import.chapters")} value={preview.chapterCount} />
          <PreviewStat label={t("import.assets")} value={preview.assetCount} />
          <PreviewStat label={t("import.styles")} value={preview.styleCount} />
          <PreviewStat label={t("import.metadata")} value={preview.metadataCount} />
        </div>

        {report.issues.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
            <CheckCircle2 className="w-4 h-4 text-success" />
            <span>{t("import.cleanReport")}</span>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-semibold">{t("import.compatibilityReport")}</h4>
              <Button variant="secondary" size="sm" onClick={handleReport}>
                <ExternalLink className="w-4 h-4" />
                {t("import.reportUnsupported")}
              </Button>
            </div>
            {(["blocking", "lossy", "converted", "info"] as const).map((severity) => {
              const issues = groupedIssues[severity];
              if (issues.length === 0) return null;
              return (
                <div key={severity} className="rounded-lg border border-border bg-card p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <AlertTriangle className="w-4 h-4 text-muted-foreground" />
                    <span>{t(`import.severity.${severity}`)}</span>
                  </div>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {issues.map((issue) => (
                      <li key={`${issue.severity}:${issue.code}:${issue.href ?? ""}`}>
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}

        {needsAcknowledgement && !hasBlockingIssues && (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 text-sm">
            <Switch
              checked={acknowledged}
              onChange={setAcknowledged}
              label={t("import.acknowledgeWarnings")}
            />
            <span>{t("import.acknowledgeWarnings")}</span>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

function PreviewStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function groupIssues(issues: CompatibilityIssue[]): Record<CompatibilityIssue["severity"], CompatibilityIssue[]> {
  return issues.reduce<Record<CompatibilityIssue["severity"], CompatibilityIssue[]>>(
    (groups, issue) => {
      groups[issue.severity].push(issue);
      return groups;
    },
    { blocking: [], lossy: [], converted: [], info: [] }
  );
}

function buildIssueUrl(fileName: string, report: CompatibilityReport): string {
  const diagnostics = report.issues
    .map((issue) => `- ${issue.severity}: ${issue.code}${issue.href ? ` (${issue.href})` : ""}`)
    .join("\n");
  const body = [
    "EPUB import compatibility report",
    "",
    `File name: ${fileName}`,
    `Summary: ${JSON.stringify(report.summary)}`,
    "",
    "Issues:",
    diagnostics || "No compatibility issues were reported.",
  ].join("\n");
  const params = new URLSearchParams({
    title: "EPUB import unsupported feature",
    body,
  });
  return `${GITHUB_ISSUE_URL}?${params.toString()}`;
}
