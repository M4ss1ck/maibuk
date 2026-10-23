import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { NewReleaseChip } from "@/components/releases/ReleaseBadge";
import {
  BUNDLED_RELEASES,
  loadBundledReleaseNotes,
  releaseNotesLanguage,
} from "@/features/releases/bundled";
import { loadLocalizedNewerReleases } from "@/features/releases/release-check";
import type {
  InlineSegment,
  ReleaseNotes,
  ReleaseSection,
} from "@/features/releases/release-notes";
import { newerReleasesIn, useReleaseStore } from "@/features/releases/store";
import { openExternal } from "@/lib/platform";
import { DOWNLOAD_PAGE } from "@/constants";

function formatReleaseDate(date: string, language: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(language, { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day))
  );
}

function Inline({ segments }: { segments: InlineSegment[] }) {
  return segments.map((segment, index) => {
    const key = `${index}-${segment.kind}`;
    if (segment.kind === "code") {
      return (
        <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {segment.text}
        </code>
      );
    }
    if (segment.kind === "link") {
      return (
        <a
          key={key}
          href={segment.href}
          onClick={(event) => {
            event.preventDefault();
            void openExternal(segment.href);
          }}
          className="text-primary underline underline-offset-2 hover:no-underline"
        >
          {segment.text}
        </a>
      );
    }
    return <span key={key}>{segment.text}</span>;
  });
}

function Section({ section }: { section: ReleaseSection }) {
  const { t } = useTranslation();
  return (
    <section className="space-y-1.5">
      {section.kind && (
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t(`releases.sections.${section.kind}`)}
        </h4>
      )}
      <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed marker:text-muted-foreground">
        {section.items.map((item, index) => (
          <li key={index}>
            <Inline segments={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Release({ release, isNew }: { release: ReleaseNotes; isNew: boolean }) {
  const { i18n } = useTranslation();
  const headingId = `release-${release.number}`;
  return (
    <article aria-labelledby={headingId} className="space-y-3 py-5 first:pt-0 last:pb-0">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id={headingId} className="font-serif text-xl font-semibold tabular-nums text-foreground">
          {release.number}
        </h3>
        {isNew && <NewReleaseChip className="self-center" />}
        {release.date && (
          <time dateTime={release.date} className="ml-auto text-sm text-muted-foreground">
            {formatReleaseDate(release.date, i18n.language)}
          </time>
        )}
      </header>
      {release.sections.map((section, index) => (
        <Section key={index} section={section} />
      ))}
    </article>
  );
}

/**
 * The Release Notes: what every Release changed, newest first, in the app
 * language, as the bundled changelog of that language lists them, with any
 * newer published Releases on top. A newer Release's notes come from its
 * language's changelog file at its tag and stay English until that file
 * resolves or when it does not list them (#632). English shows until the
 * language's own file resolves, so the dialog is never empty. The footer,
 * there only when a newer Release exists, is the one download path.
 */
export function ReleaseNotesDialog() {
  const { t, i18n } = useTranslation();
  const isOpen = useReleaseStore((state) => state.isNotesOpen);
  const closeNotes = useReleaseStore((state) => state.closeNotes);
  const newerReleases = useReleaseStore((state) => state.newerReleases);
  const localizedNewerReleases = useReleaseStore((state) => state.localizedNewerReleases);

  // `useTranslation()` re-renders on `languageChanged`, so the language is
  // read straight from the hook and the loads below follow it.
  const language = i18n.language;

  // English until the language's changelog file resolves; the loader never
  // rejects and answers English for a language without a file.
  const [bundledReleases, setBundledReleases] = useState<readonly ReleaseNotes[]>(BUNDLED_RELEASES);
  useEffect(() => {
    if (!isOpen) return;
    let current = true;
    void loadBundledReleaseNotes(language).then((releases) => {
      if (current) setBundledReleases(releases);
    });
    return () => {
      current = false;
    };
  }, [isOpen, language]);

  // A language switch with the dialog open reads that language's notes for the
  // newer Releases; a language already read costs no request, and this never
  // asks for Releases.
  useEffect(() => {
    if (!isOpen) return;
    void loadLocalizedNewerReleases(language);
  }, [isOpen, language]);

  const newer = useMemo(
    () =>
      newerReleasesIn(
        newerReleases,
        localizedNewerReleases.get(releaseNotesLanguage(language))
      ),
    [newerReleases, localizedNewerReleases, language]
  );

  const newest = newer[0];

  const releases = useMemo(
    () => [
      ...newer.map((release) => ({ release, isNew: true })),
      ...bundledReleases.map((release) => ({ release, isNew: false })),
    ],
    [newer, bundledReleases]
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={closeNotes}
      title={t("releases.title")}
      size="lg"
      contentClassName="flex flex-col overflow-hidden p-0!"
      footer={
        newest ? (
          <Button
            variant="primary"
            onClick={() => void openExternal(newest.url ?? DOWNLOAD_PAGE)}
          >
            <Download className="size-4" aria-hidden="true" />
            {t("releases.download", { release: newest.number })}
          </Button>
        ) : null
      }
    >
      <section
        aria-label={t("releases.notesRegion")}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll region takes focus so arrow keys and Page Down scroll the notes
        tabIndex={0}
        data-autofocus
        className="min-h-0 flex-1 divide-y divide-border overflow-auto px-4 py-4 scrollbar-themed focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30 sm:px-6"
      >
        {releases.map(({ release, isNew }) => (
          <Release key={release.number} release={release} isNew={isNew} />
        ))}
        <p className="pt-5 text-sm">
          <a
            href={DOWNLOAD_PAGE}
            onClick={(event) => {
              event.preventDefault();
              void openExternal(DOWNLOAD_PAGE);
            }}
            className="text-primary underline underline-offset-2 hover:no-underline"
          >
            {t("releases.olderReleases")}
          </a>
        </p>
      </section>
    </Modal>
  );
}
