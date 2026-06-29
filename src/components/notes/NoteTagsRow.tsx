import type { ReactNode } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { tagColor } from "@/components/notes/tagColor";

const GAP = 4;

interface NoteTagsRowProps {
  tags: string[];
  dateLabel: string;
  datePosition?: "left" | "right";
  action?: ReactNode;
  interactiveOverflow?: boolean;
}

function TagChip({ tag, className = "" }: { tag: string; className?: string }) {
  const color = tagColor(tag);

  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-[10px] border font-medium ${className}`}
      style={{ color, backgroundColor: `${color}26`, borderColor: `${color}80` }}
      title={tag}
    >
      {tag}
    </span>
  );
}

export function NoteTagsRow({
  tags,
  dateLabel,
  datePosition = "right",
  action,
  interactiveOverflow = true,
}: NoteTagsRowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const actionRef = useRef<HTMLSpanElement>(null);
  const [visibleCount, setVisibleCount] = useState(0);
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
      const tagWidths = children.slice(1, 1 + tags.length).map((el) => el.offsetWidth);
      const actionWidth = actionRef.current?.offsetWidth ?? 0;
      const actionGap = actionWidth > 0 ? GAP : 0;
      const availableForTags = container.clientWidth - dateWidth - actionWidth - actionGap;

      if (availableForTags <= 0 || tagWidths.every((width) => width === 0)) {
        setVisibleCount(0);
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

      setVisibleCount(nextVisibleCount);
    };

    calculateVisibleTags();

    const observer = new ResizeObserver(calculateVisibleTags);
    observer.observe(container);
    if (actionRef.current) observer.observe(actionRef.current);
    return () => observer.disconnect();
  }, [tags, action]);

  const hiddenTags = tags.slice(visibleCount);
  const hiddenCount = hiddenTags.length;

  const dateEl = (
    <span
      className={`shrink-0 text-xs text-muted-foreground ${datePosition === "right" ? "ml-auto" : ""
        }`}
    >
      {dateLabel}
    </span>
  );

  return (
    <div ref={containerRef} className="relative flex min-w-0 items-center gap-1">
      {datePosition === "left" && dateEl}
      {action && (
        <span ref={actionRef} className="shrink-0">
          {action}
        </span>
      )}

      {tags.slice(0, visibleCount).map((tag) => (
        <TagChip key={tag} tag={tag} className="min-w-0 truncate" />
      ))}

      {hiddenCount > 0 && interactiveOverflow && (
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

      {hiddenCount > 0 && !interactiveOverflow && (
        <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] text-muted-foreground">
          +{hiddenCount}
        </span>
      )}

      {datePosition === "right" && dateEl}

      {showHiddenTags && hiddenCount > 0 && interactiveOverflow && (
        <div className="absolute left-0 top-full z-20 mt-1 flex max-w-56 flex-wrap gap-1 rounded-lg border border-border bg-background p-2 shadow-lg">
          {hiddenTags.map((tag) => (
            <TagChip key={tag} tag={tag} className="shrink-0" />
          ))}
        </div>
      )}

      <div
        ref={measureRef}
        className="invisible absolute -left-2499 top-0 flex gap-1"
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
