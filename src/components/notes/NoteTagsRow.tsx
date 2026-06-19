import { useLayoutEffect, useRef, useState } from "react";
import { tagColor } from "./tagColor";

const GAP = 4;

interface NoteTagsRowProps {
  tags: string[];
  dateLabel: string;
  datePosition?: "left" | "right";
}

function TagChip({
  tag,
  className = "",
}: {
  tag: string;
  className?: string;
}) {
  const color = tagColor(tag);

  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-[10px] text-foreground ${className}`}
      style={{ backgroundColor: `${color}22` }}
      title={tag}
    >
      {tag}
    </span>
  );
}

export function NoteTagsRow({ tags, dateLabel, datePosition = "right" }: NoteTagsRowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(tags.length > 0 ? 1 : 0);
  const [showHiddenTags, setShowHiddenTags] = useState(false);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const calculateVisibleTags = () => {
      const children = Array.from(measure.children) as HTMLElement[];
      if (children.length === 0) {
        setVisibleCount(0);
        return;
      }

      const dateWidth = children[0]?.offsetWidth ?? 0;
      const counterWidth = children[children.length - 1]?.offsetWidth ?? 0;
      const tagWidths = children
        .slice(1, 1 + tags.length)
        .map((el) => el.offsetWidth);
      const availableForTags = container.clientWidth - dateWidth;

      if (availableForTags <= 0 || tagWidths.every((width) => width === 0)) {
        setVisibleCount(tags.length > 0 ? 1 : 0);
        return;
      }

      let used = 0;
      let nextVisibleCount = 0;

      for (let i = 0; i < tagWidths.length; i += 1) {
        const hiddenAfterThis = tags.length - i - 1;
        const widthWithGap = tagWidths[i] + (nextVisibleCount > 0 ? GAP : 0);
        const reserveForCounter = hiddenAfterThis > 0 ? counterWidth + GAP : 0;

        if (used + widthWithGap + reserveForCounter > availableForTags) {
          break;
        }

        used += widthWithGap;
        nextVisibleCount += 1;
      }

      setVisibleCount(Math.max(tags.length > 0 ? 1 : 0, nextVisibleCount));
    };

    calculateVisibleTags();

    const observer = new ResizeObserver(calculateVisibleTags);
    observer.observe(container);
    return () => observer.disconnect();
  }, [tags]);

  const hiddenTags = tags.slice(visibleCount);
  const hiddenCount = hiddenTags.length;

  const dateEl = (
    <span
      className={`shrink-0 text-xs text-muted-foreground ${
        datePosition === "right" ? "ml-auto" : ""
      }`}
    >
      {dateLabel}
    </span>
  );

  return (
    <div ref={containerRef} className="relative flex min-w-0 items-center gap-1">
      {datePosition === "left" && dateEl}

      {tags.slice(0, visibleCount).map((tag) => (
        <TagChip key={tag} tag={tag} className="min-w-0 truncate" />
      ))}

      {hiddenCount > 0 && (
        <button
          type="button"
          className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation();
            setShowHiddenTags((current) => !current);
          }}
          onBlur={(event) => {
            if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) {
              setShowHiddenTags(false);
            }
          }}
          aria-expanded={showHiddenTags}
        >
          +{hiddenCount}
        </button>
      )}

      {datePosition === "right" && dateEl}

      {showHiddenTags && hiddenCount > 0 && (
        <div className="absolute left-0 top-full z-20 mt-1 flex max-w-56 flex-wrap gap-1 rounded-lg border border-border bg-background p-2 shadow-lg">
          {hiddenTags.map((tag) => (
            <TagChip key={tag} tag={tag} className="shrink-0" />
          ))}
        </div>
      )}

      <div
        ref={measureRef}
        className="invisible absolute -left-[9999px] top-0 flex gap-1"
        aria-hidden="true"
      >
        <span className="text-xs">{dateLabel}</span>
        {tags.map((tag) => (
          <TagChip key={tag} tag={tag} className="shrink-0" />
        ))}
        {tags.length > 0 && <span className="text-[10px]">+{tags.length}</span>}
      </div>
    </div>
  );
}
