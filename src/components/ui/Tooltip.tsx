import {
  FloatingArrow,
  FloatingDelayGroup,
  FloatingPortal,
  arrow,
  autoUpdate,
  flip,
  offset,
  shift,
  useDelayGroup,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useMergeRefs,
  useRole,
  useTransitionStyles,
} from "@floating-ui/react";
import { cloneElement, useRef, useState, type ReactElement, type ReactNode, type Ref } from "react";

import { KeyboardShortcut } from "@/components/ui/KeyboardShortcut";
import { lowlight } from "@/lib/lowlight";
import { IS_ANDROID } from "@/lib/platform";
import { SHORTCUTS, formatKeys, type ShortcutId } from "@/lib/shortcut-registry";

const OPEN_DELAY = 500;

type HastNode = ReturnType<typeof lowlight.highlight>["children"][number];

/**
 * Renders lowlight's hast tree as React spans so markdown hints get the
 * same `hljs-*` token markup as a markdown code block in the editor.
 */
function renderHastNodes(nodes: HastNode[]): ReactNode[] {
  return nodes.map((node, index) => {
    if (node.type === "text") return node.value;
    if (node.type === "element") {
      const className = Array.isArray(node.properties?.className)
        ? node.properties.className.join(" ")
        : undefined;
      return (
        <span key={index} className={className}>
          {renderHastNodes(node.children as HastNode[])}
        </span>
      );
    }
    return null;
  });
}

type TooltipProps = {
  content: ReactNode;
  markdown?: string | string[];
  side?: "top" | "bottom" | "left" | "right";
  disabled?: boolean;
  children: ReactElement;
} & ({ shortcut?: ShortcutId; keys?: never } | { shortcut?: never; keys?: string[] });

interface TooltipGroupProps {
  children: ReactNode;
}

export function TooltipGroup({ children }: TooltipGroupProps) {
  return (
    <FloatingDelayGroup delay={{ open: OPEN_DELAY, close: 100 }}>{children}</FloatingDelayGroup>
  );
}

export function Tooltip({
  content,
  shortcut,
  keys,
  markdown,
  side = "top",
  disabled = false,
  children,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const arrowRef = useRef<SVGSVGElement>(null);
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: side,
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip(), shift({ padding: 4 }), arrow({ element: arrowRef })],
  });
  const { delay: groupDelay } = useDelayGroup(context);
  const hover = useHover(context, {
    mouseOnly: true,
    delay: groupDelay === 0 ? { open: OPEN_DELAY, close: 0 } : groupDelay,
  });
  const focus = useFocus(context, { visibleOnly: false });
  const dismiss = useDismiss(context, { referencePress: true });
  const role = useRole(context, { role: "tooltip" });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);
  const childRef = (children.props as { ref?: Ref<HTMLElement> }).ref;
  const mergedRef = useMergeRefs([refs.setReference, childRef]);
  const { isMounted, styles: transitionStyles } = useTransitionStyles(context, {
    duration: reducedMotion ? 0 : 120,
    initial: { opacity: 0, transform: "translateY(2px)" },
    open: { opacity: 1, transform: "translateY(0)" },
  });
  // Android has no physical keyboard, so shortcut chips are noise there.
  const shortcutDefinition = IS_ANDROID
    ? null
    : shortcut
      ? SHORTCUTS[shortcut]
      : keys
        ? { keys, labelKey: "" }
        : null;

  const markdownHints = typeof markdown === "string" ? [markdown] : (markdown ?? []);

  if (disabled) return children;

  return (
    <>
      {cloneElement(
        children,
        getReferenceProps({
          ...(children.props as Record<string, unknown>),
          ref: mergedRef,
        })
      )}
      {isMounted && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            className="z-60"
            style={floatingStyles}
            {...getFloatingProps()}
          >
            <div
              className="flex max-w-xs flex-col items-start gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground shadow-lg"
              style={transitionStyles}
            >
              <div data-testid="tooltip-primary-row" className="flex items-center gap-2">
                <span>{content}</span>
                {shortcutDefinition && (
                  <KeyboardShortcut shortcut={formatKeys(shortcutDefinition)} />
                )}
              </div>
              {markdownHints.length > 0 && (
                <div
                  data-testid="tooltip-markdown-row"
                  className="flex flex-wrap gap-4 mt-2 text-muted-foreground"
                >
                  {markdownHints.map((hint) => (
                    <code
                      key={hint}
                      className="markdown-hint whitespace-nowrap font-mono leading-none"
                    >
                      {renderHastNodes(lowlight.highlight("markdown", hint).children)}
                    </code>
                  ))}
                </div>
              )}
              <FloatingArrow
                ref={arrowRef}
                context={context}
                width={10}
                height={5}
                strokeWidth={1}
                fill="var(--color-card)"
                stroke="var(--color-border)"
              />
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
