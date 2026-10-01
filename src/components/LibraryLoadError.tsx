import { useTranslation } from "react-i18next";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui";

interface LibraryLoadErrorProps {
  error: string;
  onRetry: () => void;
}

/**
 * Shown in place of a Gallery's empty state when the Library could not be
 * read. An empty Gallery would tell the author their work is gone.
 */
export function LibraryLoadError({ error, onRetry }: LibraryLoadErrorProps) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center py-20 sm:py-28 text-center"
    >
      <h3 className="text-2xl sm:text-3xl font-semibold mb-3 tracking-tight">
        {t("libraryLoad.title")}
      </h3>
      <p className="text-muted-foreground mb-4 max-w-md leading-relaxed">{t("libraryLoad.body")}</p>
      <p className="mb-8 max-w-md break-words rounded-lg border border-border bg-card px-3 py-2 font-mono text-xs text-muted-foreground">
        {error}
      </p>
      <Button size="lg" onClick={onRetry}>
        <RotateCw className="w-5 h-5" />
        {t("libraryLoad.retry")}
      </Button>
    </div>
  );
}
