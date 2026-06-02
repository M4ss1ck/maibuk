import { useLayoutEffect, useRef, useState } from "react";
import { tagColor } from "./tagColor";

// Matches the `gap-1` spacing (0.25rem) used between row items.
const GAP = 4;

interface NoteTagsRowProps {
  tags: string[];
  dateLabel: string;
}

function TagChip({ tag, className = "" }: { tag: string; className?: string }) {
  const color = tagColor(tag);
  return (
    <span
      className={`rounded-full border px-1.5 py-0.5 text-[10px] ${className}`}
      style={{ borderColor: color, backgroundColor: `${color}22`, color }}
    >
      {tag}
    </span>
  );
}

/**
 * Renders note tags and the last-modified date on a single line, showing only
 * the tags that fit in the available width plus a "+N" counter for the rest.
 * Always shows at least one tag (truncated with an ellipsis if it is too wide).
 */
export function NoteTagsRow({ tags, dateLabel }: NoteTagsRowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(tags.length);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const compute = () => {
      // Measurement children layout: [date, ...tags, counter].
      const children = Array.from(measure.children) as HTMLElement[];
      const dateWidth = children[0].offsetWidth;
      const counterWidth = children[children.length - 1].offsetWidth;
      const tagWidths = children.slice(1, 1 + tags.length).map((el) => el.offsetWidth);

      const availableForTags = container.clientWidth - dateWidth - GAP;

      const fit = (budget: number) => {
        let used = 0;
        let count = 0;
        for (const width of tagWidths) {
          const next = used + (count > 0 ? GAP : 0) + width;
          if (next > budget) break;
          used = next;
          count += 1;
        }
        return count;
      };

      let count = fit(availableForTags);
      if (count < tags.length) {
        // Some tags overflow: reserve room for the "+N" counter.
        count = Math.max(1, fit(availableForTags - counterWidth - GAP));
      }
      setVisibleCount(count);
    };

    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(container);
    return () => observer.disconnect();
  }, [tags, dateLabel]);

  const hidden = tags.length - visibleCount;

  return (
    <div ref={containerRef} className="relative mt-1 flex w-full min-w-0 items-center gap-1">
      {tags.slice(0, visibleCount).map((tag) => (
        <TagChip key={tag} tag={tag} className="min-w-0 truncate" />
      ))}
      {hidden > 0 && <span className="shrink-0 text-[10px] text-muted-foreground">+{hidden}</span>}
      <span className="ml-auto shrink-0 text-xs text-muted-foreground">{dateLabel}</span>

      {/* Hidden layer used to measure natural widths of each item. */}
      <div aria-hidden className="absolute h-0 w-0 overflow-hidden">
        <div ref={measureRef} className="flex w-max items-center gap-1">
          <span className="shrink-0 text-xs text-muted-foreground">{dateLabel}</span>
          {tags.map((tag) => (
            <TagChip key={tag} tag={tag} className="shrink-0" />
          ))}
          {tags.length > 0 && (
            <span className="shrink-0 text-[10px] text-muted-foreground">+{tags.length}</span>
          )}
        </div>
      </div>
    </div>
  );
}
