import { useLayoutEffect, useRef, useState, type ElementType, type HTMLAttributes } from "react";

interface TruncatedTextProps extends HTMLAttributes<HTMLElement> {
  text: string;
  as?: ElementType;
}

/**
 * Renders text that truncates with an ellipsis (via the caller's `truncate`
 * class) and shows the full text as a native tooltip only when it actually
 * overflows the available width.
 */
export function TruncatedText({ text, as: Tag = "span", className, ...rest }: TruncatedTextProps) {
  const ref = useRef<HTMLElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => setIsOverflowing(el.scrollWidth > el.clientWidth);
    update();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);

  return (
    <Tag ref={ref} className={className} title={isOverflowing ? text : undefined} {...rest}>
      {text}
    </Tag>
  );
}
