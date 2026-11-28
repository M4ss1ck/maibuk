/** @jsxImportSource preact */
/**
 * The Shelf's Import surfaces (#948): the chooser that asks for files or a
 * folder, the progress card that follows a background Import, and the report
 * that lists what the Import did. The Worker owns the Import and sends its
 * state; these components only draw it and hand the author's choices back.
 *
 * The report also holds the collisions (#949): a Shelf Document's title and
 * author with another file. The author picks Keep both, Replace, or Skip per
 * row or for all, and Apply stays disabled until every row has a choice.
 *
 * Every user-visible string is a label from the Worker's catalogs. The
 * chooser and the report are Dialogs in Wide and Sheets in Narrow, the same
 * pair the removal confirmation uses.
 */

import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { Button, Dialog, Icon, IconButton, ProgressCard, Segmented, Sheet } from "./kit";
import { fill } from "./shelf-query";
import type { FrameImportCollision, FrameImportState, FrameShelfLabels } from "./types";

/** What the author chose for one collision (#949). */
export type CollisionChoice = "keep" | "replace" | "skip";

/** The chooser's two options: pick files one by one, or a whole folder. */
export type ImportKind = "files" | "folder";

export interface ImportChooserProps {
  open: boolean;
  wide: boolean;
  labels: FrameShelfLabels;
  /** Whether a folder's Documents go in a Collection named after the folder (#949). */
  collect: boolean;
  onCollectChange: (collect: boolean) => void;
  onClose: () => void;
  onPick: (kind: ImportKind) => void;
}

/** Asks whether to import files or a folder; a pick closes nothing itself. */
export function ImportChooser({
  open,
  wide,
  labels,
  collect,
  onCollectChange,
  onClose,
  onPick,
}: ImportChooserProps) {
  if (!open) return null;

  const body = (
    <>
      <p class="shelf-import__description">{labels.importDescription}</p>
      <button type="button" class="shelf-import__option" onClick={() => onPick("files")}>
        <span class="shelf-import__icon" aria-hidden="true">
          <Icon name="file" />
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
      <label class="shelf-import__collect">
        <input
          type="checkbox"
          class="shelf-import__collect-input"
          checked={collect}
          onChange={(event) => onCollectChange(event.currentTarget.checked)}
        />
        <span class="shelf-import__collect-box" aria-hidden="true">
          {collect ? <Icon name="check" /> : null}
        </span>
        <span class="shelf-import__text">
          <span class="shelf-import__collect-title">{labels.importCollectFolder}</span>
          <span class="shelf-import__option-hint">{labels.importCollectFolderHint}</span>
        </span>
      </label>
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

/**
 * The background Import's progress, or its finished card with View report.
 * While collisions wait for a choice the card cannot be dismissed (#949).
 */
export function ImportCard({ state, labels, onCancel, onViewReport, onDismiss }: ImportCardProps) {
  const done = state.status === "done";
  const waiting = done && state.report.collisions.length > 0;
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
      {waiting ? null : done ? (
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
  /** The author's choice per collision id; a row without one is undecided (#949). */
  choices?: Readonly<Record<string, CollisionChoice>>;
  onChoose?: (id: string, choice: CollisionChoice) => void;
  onChooseAll?: (choice: CollisionChoice) => void;
  /** Applies every choice; called only once each collision has one. */
  onApply?: () => void;
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
const COLLISIONS_TITLE_ID = "shelf-report-collisions-title";

/** How many collisions the report lists before "Show N more collisions", as drawn. */
export const COLLISIONS_SHOWN = 4;

interface CollisionsProps {
  report: FrameImportState["report"];
  labels: FrameShelfLabels;
  choices: Readonly<Record<string, CollisionChoice>>;
  onChoose: (id: string, choice: CollisionChoice) => void;
  onChooseAll: (choice: CollisionChoice) => void;
}

/** The collision section: its heading, Apply to all, and one row per collision (#949). */
function Collisions({ report, labels, choices, onChoose, onChooseAll }: CollisionsProps) {
  const [expanded, setExpanded] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  // "Show N more" leaves when pressed: focus moves to the first row it revealed.
  useLayoutEffect(() => {
    if (!expanded) return;
    const row = list.current?.children[COLLISIONS_SHOWN];
    row?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus();
  }, [expanded]);
  const { collisions } = report;
  const options = [
    { value: "keep", label: labels.keepBoth },
    { value: "replace", label: labels.replace },
    { value: "skip", label: labels.skip },
  ] as const;
  const first = choices[collisions[0]?.id ?? ""];
  const common =
    first !== undefined && collisions.every((collision) => choices[collision.id] === first)
      ? first
      : null;
  const shown = expanded ? collisions : collisions.slice(0, COLLISIONS_SHOWN);
  const hidden = collisions.length - shown.length;
  return (
    <section class="shelf-report__collisions" aria-labelledby={COLLISIONS_TITLE_ID}>
      <div class="shelf-report__collisions-head">
        <div class="shelf-report__collisions-title">
          <h3 id={COLLISIONS_TITLE_ID}>{labels.reportCollisions}</h3>
          <p>{labels.reportCollisionsHint}</p>
        </div>
        <span class="shelf-report__apply-all" aria-hidden="true">
          {labels.applyToAll}
        </span>
        <Segmented<CollisionChoice>
          label={labels.applyToAllLabel}
          value={common}
          options={options}
          onChange={onChooseAll}
        />
      </div>
      <ul ref={list} class="shelf-report__collision-list">
        {shown.map((collision) => (
          <CollisionRow
            key={collision.id}
            collision={collision}
            labels={labels}
            options={options}
            choice={choices[collision.id] ?? null}
            onChoose={(choice) => onChoose(collision.id, choice)}
          />
        ))}
      </ul>
      {hidden > 0 ? (
        <Button variant="ghost" class="shelf-report__more" onClick={() => setExpanded(true)}>
          {fill(hidden === 1 ? report.showMoreOne : report.showMoreOther, { count: hidden })}
        </Button>
      ) : null}
    </section>
  );
}

interface CollisionRowProps {
  collision: FrameImportCollision;
  labels: FrameShelfLabels;
  options: ReadonlyArray<{ value: CollisionChoice; label: string }>;
  choice: CollisionChoice | null;
  onChoose: (choice: CollisionChoice) => void;
}

/** One collision: the Shelf Document beside the new file, its choice, and Replace's warning. */
function CollisionRow({ collision, labels, options, choice, onChoose }: CollisionRowProps) {
  return (
    <li class="shelf-report__collision">
      <div class="shelf-report__collision-row">
        <div class="shelf-report__collision-main">
          <p class="shelf-report__collision-name">
            {collision.title}
            {collision.author === "" ? null : (
              <span class="shelf-report__collision-author"> · {collision.author}</span>
            )}
          </p>
          <div class="shelf-report__collision-sides">
            <div>
              <p class="shelf-report__label">{labels.onTheShelf}</p>
              <p class="shelf-report__side">{collision.existingText}</p>
            </div>
            <div>
              <p class="shelf-report__label">{labels.newFile}</p>
              <p class="shelf-report__side">{collision.newText}</p>
              <p class="shelf-report__file">{collision.fileName}</p>
            </div>
          </div>
        </div>
        <Segmented<CollisionChoice>
          label={collision.choiceLabel}
          value={choice}
          options={options}
          onChange={onChoose}
        />
      </div>
      {choice === "replace" ? (
        <p class="shelf-report__warning" role="note">
          <Icon name="alert" />
          {collision.replaceWarning}
        </p>
      ) : null}
    </li>
  );
}

/** What a finished Import did: the counts, the collisions, what could not be read, and each list. */
export function ImportReport({
  open,
  wide,
  state,
  labels,
  choices = {},
  onChoose = () => {},
  onChooseAll = () => {},
  onApply = () => {},
  onClose,
}: ImportReportProps) {
  if (!open) return null;

  const { report } = state;
  const { collisions } = report;
  const colliding = collisions.length > 0;
  const chosen = collisions.filter((collision) => choices[collision.id] !== undefined).length;
  const ready = colliding && chosen === collisions.length;
  const tiles: Array<{ count: number; label: string; strong?: boolean }> = [
    { count: report.added.length, label: labels.reportAdded },
    { count: report.alreadyOnShelf.length, label: labels.reportAlreadyOnShelf },
    { count: report.relinked.length, label: labels.reportRelinked },
    ...(colliding
      ? [{ count: collisions.length, label: labels.reportCollisionsTile, strong: true }]
      : []),
    { count: report.unreadable.length, label: labels.reportUnreadable },
  ];

  const lists = (
    <>
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

  const body = (
    <>
      <p class="shelf-report__subtitle">{report.subtitle}</p>
      <ul
        class={colliding ? "shelf-report__tiles shelf-report__tiles--five" : "shelf-report__tiles"}
      >
        {tiles.map((tile) => (
          <li
            key={tile.label}
            class={
              tile.strong ? "shelf-report__tile shelf-report__tile--strong" : "shelf-report__tile"
            }
          >
            <b>{tile.count}</b>
            <span>{tile.label}</span>
          </li>
        ))}
      </ul>
      {colliding ? (
        <div class="shelf-report__columns">
          <Collisions
            report={report}
            labels={labels}
            choices={choices}
            onChoose={onChoose}
            onChooseAll={onChooseAll}
          />
          <aside class="shelf-report__aside">{lists}</aside>
        </div>
      ) : (
        lists
      )}
    </>
  );

  const actions = colliding ? (
    <div class="shelf-report__footer">
      <p class="shelf-report__chosen">
        <strong>{fill(report.chosenCount, { chosen, total: collisions.length })}</strong>{" "}
        {report.chosen}
        {report.collectionText === "" ? null : ` ${report.collectionText}`}
      </p>
      <Button variant="secondary" onClick={onClose}>
        {labels.closeDecideLater}
      </Button>
      <Button
        variant="primary"
        aria-disabled={ready ? undefined : "true"}
        onClick={() => {
          if (ready) onApply();
        }}
      >
        {labels.applyChoices}
      </Button>
    </div>
  ) : (
    <div class="shelf-report__footer">
      {report.collectionText === "" ? null : (
        <p class="shelf-report__chosen">{report.collectionText}</p>
      )}
      <Button variant="secondary" onClick={onClose}>
        {labels.importClose}
      </Button>
    </div>
  );

  const reportClass = colliding
    ? "shelf-import-report shelf-import-report--collisions"
    : "shelf-import-report";
  return wide ? (
    <Dialog open onClose={onClose} title={labels.reportTitle} class={reportClass} actions={actions}>
      {body}
    </Dialog>
  ) : (
    <Sheet
      open
      onClose={onClose}
      title={labels.reportTitle}
      doneLabel={colliding ? undefined : labels.importClose}
      class={reportClass}
      actions={colliding ? actions : undefined}
    >
      {body}
    </Sheet>
  );
}
