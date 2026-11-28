/** @jsxImportSource preact */
/**
 * The Shelf's Import surfaces (#948): the chooser that asks for files or a
 * folder, the progress card that follows a background Import, and the report
 * that lists what the Import did. The Worker owns the Import and sends its
 * state; these components only draw it and hand the author's choices back.
 *
 * Every user-visible string is a label from the Worker's catalogs. The
 * chooser and the report are Dialogs in Wide and Sheets in Narrow, the same
 * pair the removal confirmation uses.
 */

import { Button, Dialog, Icon, IconButton, ProgressCard, Sheet } from "./kit";
import type { FrameImportState, FrameShelfLabels } from "./types";

/** The chooser's two options: pick files one by one, or a whole folder. */
export type ImportKind = "files" | "folder";

export interface ImportChooserProps {
  open: boolean;
  wide: boolean;
  labels: FrameShelfLabels;
  onClose: () => void;
  onPick: (kind: ImportKind) => void;
}

/** Asks whether to import files or a folder; a pick closes nothing itself. */
export function ImportChooser({ open, wide, labels, onClose, onPick }: ImportChooserProps) {
  if (!open) return null;

  const body = (
    <>
      <p class="shelf-import__description">{labels.importDescription}</p>
      <button type="button" class="shelf-import__option" onClick={() => onPick("files")}>
        <span class="shelf-import__icon" aria-hidden="true">
          <Icon name="import" />
        </span>
        <span class="shelf-import__text">
          <span class="shelf-import__option-title">{labels.importFilesOption}</span>
          <span class="shelf-import__option-hint">{labels.importFilesHint}</span>
        </span>
      </button>
      <button type="button" class="shelf-import__option" onClick={() => onPick("folder")}>
        <span class="shelf-import__icon" aria-hidden="true">
          <Icon name="folder" />
        </span>
        <span class="shelf-import__text">
          <span class="shelf-import__option-title">{labels.importFolderOption}</span>
          <span class="shelf-import__option-hint">{labels.importFolderHint}</span>
        </span>
      </button>
    </>
  );

  return wide ? (
    <Dialog
      open
      onClose={onClose}
      title={labels.import}
      class="shelf-import-chooser"
      actions={
        <Button variant="ghost" onClick={onClose}>
          {labels.importClose}
        </Button>
      }
    >
      {body}
    </Dialog>
  ) : (
    <Sheet
      open
      onClose={onClose}
      title={labels.import}
      doneLabel={labels.importClose}
      class="shelf-import-chooser"
    >
      {body}
    </Sheet>
  );
}

export interface ImportCardProps {
  state: FrameImportState;
  labels: FrameShelfLabels;
  onCancel: () => void;
  onViewReport: () => void;
  onDismiss: () => void;
}

/** The background Import's progress, or its finished card with View report. */
export function ImportCard({ state, labels, onCancel, onViewReport, onDismiss }: ImportCardProps) {
  const done = state.status === "done";
  return (
    <section
      class="shelf-import-card"
      role="status"
      aria-live="polite"
      aria-label={labels.importProgressLabel}
    >
      <ProgressCard
        title={state.title}
        completed={state.processed}
        total={state.found}
        countText={state.countsText}
        cancelLabel={labels.importCancel}
        viewReportLabel={labels.importViewReport}
        complete={done}
        onCancel={onCancel}
        onViewReport={onViewReport}
      />
      {done ? (
        <div class="shelf-import-card__dismiss">
          <IconButton label={labels.importDismiss} icon="close" onClick={onDismiss} />
        </div>
      ) : (
        <>
          <span class="shelf-import-card__progress">{state.progressText}</span>
          <p class="shelf-import-card__hint">{labels.importKeepReading}</p>
        </>
      )}
    </section>
  );
}

export interface ImportReportProps {
  open: boolean;
  wide: boolean;
  state: FrameImportState;
  labels: FrameShelfLabels;
  onClose: () => void;
}

/** The names of one report list, or "None" when the list is empty. */
function NameList({ names, labels }: { names: string[]; labels: FrameShelfLabels }) {
  if (names.length === 0) return <p class="shelf-report__none">{labels.reportNone}</p>;
  return (
    <ul class="shelf-report__names">
      {names.map((name, index) => (
        <li key={`${index}-${name}`}>{name}</li>
      ))}
    </ul>
  );
}

const UNREADABLE_TITLE_ID = "shelf-report-unreadable-title";

/** What a finished Import did: the counts, what could not be read, and each list. */
export function ImportReport({ open, wide, state, labels, onClose }: ImportReportProps) {
  if (!open) return null;

  const { report } = state;
  const tiles: Array<[number, string]> = [
    [report.added.length, labels.reportAdded],
    [report.alreadyOnShelf.length, labels.reportAlreadyOnShelf],
    [report.relinked.length, labels.reportRelinked],
    [report.unreadable.length, labels.reportUnreadable],
  ];

  const body = (
    <>
      <p class="shelf-report__subtitle">{report.subtitle}</p>
      <ul class="shelf-report__tiles">
        {tiles.map(([count, label]) => (
          <li key={label} class="shelf-report__tile">
            <b>{count}</b>
            <span>{label}</span>
          </li>
        ))}
      </ul>
      {report.unreadable.length > 0 ? (
        <section class="shelf-report__unreadable" aria-labelledby={UNREADABLE_TITLE_ID}>
          <h3 id={UNREADABLE_TITLE_ID}>{labels.reportUnreadable}</h3>
          <p>{labels.reportUnreadableHint}</p>
          <ul>
            {report.unreadable.map((item, index) => (
              <li key={`${index}-${item.name}`}>
                <span class="shelf-report__name">{item.name}</span>
                <span class="shelf-report__reason">{item.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <h3 class="shelf-report__details-title">{labels.reportDetails}</h3>
      {(
        [
          [labels.reportAdded, report.added],
          [labels.reportAlreadyOnShelf, report.alreadyOnShelf],
          [labels.reportRelinkedShort, report.relinked],
        ] as const
      ).map(([label, names]) => (
        <details key={label} class="shelf-report__details">
          <summary>
            {label}
            <span class="shelf-report__count">{names.length}</span>
          </summary>
          <NameList names={names} labels={labels} />
        </details>
      ))}
      {report.duplicatesText !== "" ? (
        <p class="shelf-report__duplicates">{report.duplicatesText}</p>
      ) : null}
    </>
  );

  return wide ? (
    <Dialog
      open
      onClose={onClose}
      title={labels.reportTitle}
      class="shelf-import-report"
      actions={
        <Button variant="secondary" onClick={onClose}>
          {labels.importClose}
        </Button>
      }
    >
      {body}
    </Dialog>
  ) : (
    <Sheet
      open
      onClose={onClose}
      title={labels.reportTitle}
      doneLabel={labels.importClose}
      class="shelf-import-report"
    >
      {body}
    </Sheet>
  );
}
