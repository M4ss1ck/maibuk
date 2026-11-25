/** @jsxImportSource preact */
/**
 * The Reader Frame's Cover and ProgressCard (#943 unit 4). A Cover is the
 * generated typographic cover from the artboard, standing in while a file is
 * pending or has no artwork, with a real image laid over it once one loads.
 * ProgressCard is the Shelf's floating import card.
 *
 * Every user-visible string is a prop, so the Worker's catalogs own the copy.
 * The kit draws with the tokens in `kit.css`; the cover's colors, spine shade
 * and two-part shadow live only in `tokens.css`, so E-ink Mode and reduced
 * motion flatten them in one place.
 */

import { useEffect, useState } from "preact/hooks";
import { Button } from "./controls";

/** The artboard's eight generated-cover tone pairs. */
const TONE_COUNT = 8;

function classes(...values: Array<string | undefined>): string {
  return values.filter((value) => value !== undefined && value !== "").join(" ");
}

/** The props a Cover takes; dimensions, tone, image and states are optional. */
export interface CoverProps {
  title: string;
  author: string;
  format: string;
  /** Cover width in px; the height keeps the 2:3 ratio. Default 128. */
  width?: number;
  /** One of the eight tone pairs; wraps around. Default 0. */
  tone?: number;
  /** Real cover artwork, laid over the generated cover. */
  src?: string;
  /** A file still being imported: the muted surface with its format. */
  pending?: boolean;
  /** A file that cannot be found: the cover sits at 40% opacity. */
  missing?: boolean;
  class?: string;
}

function toneNumber(tone: number): number {
  return (((Math.round(tone) % TONE_COUNT) + TONE_COUNT) % TONE_COUNT) + 1;
}

/**
 * A generated cover at 88, 128, 176, or 40 px wide (or any width), sized from
 * the artboard: nine-percent padding with a 6 px floor, a 15% title and 7.5%
 * uppercase author, and a 2:3 box at a 4 px radius. A real image fades in
 * over it; an image error leaves the generated cover showing.
 */
export function Cover({
  title,
  author,
  format,
  width = 128,
  tone = 0,
  src,
  pending = false,
  missing = false,
  class: extra,
}: CoverProps) {
  const height = Math.round(width * 1.5);
  const pad = Math.max(6, Math.round(width * 0.09));
  const gap = Math.round(pad * 0.7);
  const titleSize = Math.max(9, Math.round(width * 0.15));
  const authorSize = Math.max(7, Math.round(width * 0.075));
  const pendingTitleSize = Math.max(9, Math.round(width * 0.1));
  const toneIndex = toneNumber(tone);

  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  // A new source is a new chance to load, even after the last one failed.
  useEffect(() => {
    setFailedSrc((current) => (current === null ? current : null));
  }, [src]);

  const showImage = src !== undefined && src !== "" && !pending && src !== failedSrc;

  return (
    <div
      class={classes("kit-cover", extra)}
      style={{ width: `${width}px`, height: `${height}px`, opacity: missing ? 0.4 : 1 }}
    >
      {pending ? (
        <div class="kit-cover__pending" style={{ padding: `${pad}px` }}>
          <span class="kit-cover__format">{format}</span>
          <span class="kit-cover__pending-title" style={{ fontSize: `${pendingTitleSize}px` }}>
            {title}
          </span>
        </div>
      ) : (
        <div
          class="kit-cover__generated"
          style={{
            background: `var(--cover-tone-${toneIndex}-bg)`,
            color: `var(--cover-tone-${toneIndex}-ink)`,
            padding: `${pad}px`,
            gap: `${gap}px`,
          }}
        >
          <span class="kit-cover__rule" aria-hidden="true" />
          <span class="kit-cover__title" style={{ fontSize: `${titleSize}px` }}>
            {title}
          </span>
          <span class="kit-cover__author" style={{ fontSize: `${authorSize}px` }}>
            {author}
          </span>
        </div>
      )}
      {showImage ? (
        <img class="kit-cover__image" src={src} alt="" onError={() => setFailedSrc(src ?? null)} />
      ) : null}
    </div>
  );
}

/** The props a ProgressCard takes; every string and action comes from the caller. */
export interface ProgressCardProps {
  title: string;
  completed: number;
  total: number;
  countText: string;
  cancelLabel: string;
  viewReportLabel: string;
  onCancel: () => void;
  onViewReport: () => void;
  complete: boolean;
  class?: string;
}

/**
 * The Shelf's floating import card: title, native progress bar, tabular
 * counts and Cancel. Once complete it swaps the bar and Cancel for View report.
 */
export function ProgressCard({
  title,
  completed,
  total,
  countText,
  cancelLabel,
  viewReportLabel,
  onCancel,
  onViewReport,
  complete,
  class: extra,
}: ProgressCardProps) {
  return (
    <div class={classes("kit-progress-card", extra)}>
      <p class="kit-progress-card__title">{title}</p>
      {complete ? null : (
        <progress class="kit-progress-card__bar" aria-label={title} value={completed} max={total} />
      )}
      <div class="kit-progress-card__row">
        <span class="kit-progress-card__count">{countText}</span>
        {complete ? (
          <Button variant="secondary" onClick={onViewReport}>
            {viewReportLabel}
          </Button>
        ) : (
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
