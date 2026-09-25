import { useEffect, useId, useRef, type ComponentType, type RefObject } from "react";
import { useInteractOutside } from "react-aria";
import {
  Button,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  SubmenuTrigger,
} from "react-aria-components";
import { Check, ChevronRight, MoreHorizontal } from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";

export interface ItemAction {
  id: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  isDestructive?: boolean;
  isDisabled?: boolean;
  /** Marks the current choice inside a submenu (e.g. the Book a Note is filed in). */
  isCurrent?: boolean;
  onAction?: () => void;
  children?: ItemAction[];
}

interface ItemActionsMenuProps {
  /** Accessible name of the ⋯ button, e.g. "More actions for Chapter 1". */
  label: string;
  actions: ItemAction[];
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  className?: string;
  /** Visible item anchor when the ⋯ button is hidden on desktop. */
  anchorRef?: RefObject<Element | null>;
}

const POPOVER_CLASS =
  "z-50 min-w-44 max-w-72 overflow-auto rounded-lg border border-border bg-card py-1 shadow-lg focus:outline-none";

function belongsToItemMenu(target: EventTarget | null, ownerId: string) {
  return (
    target instanceof Element &&
    target.closest("[data-item-menu-owner]")?.getAttribute("data-item-menu-owner") === ownerId
  );
}

/** Non-modal Item Menus keep neighboring items reachable for another right-click. */
function useItemMenuDismissal(isOpen: boolean, onOpenChange: (isOpen: boolean) => void) {
  const menuRef = useRef<HTMLDivElement>(null);
  const ownerId = useId();
  const onCloseRef = useRef(onOpenChange);
  onCloseRef.current = onOpenChange;

  // Non-modal Popovers close on blur, but clicking an unfocusable surface
  // need not move focus. Include the portaled submenus in the same menu.
  useInteractOutside({
    ref: menuRef,
    isDisabled: !isOpen,
    onInteractOutside: (event) => {
      if (!belongsToItemMenu(event.target, ownerId)) onCloseRef.current(false);
    },
  });

  useEffect(() => {
    if (!isOpen) return;
    const document = menuRef.current?.ownerDocument;
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 2) return;
      if (belongsToItemMenu(event.target, ownerId)) return;
      onCloseRef.current(false);
    };
    // useInteractOutside deliberately ignores secondary buttons. Capture
    // closes this menu before the next item's contextmenu handler opens its own menu.
    document?.addEventListener("pointerdown", onPointerDown, true);
    return () => document?.removeEventListener("pointerdown", onPointerDown, true);
  }, [isOpen, ownerId]);

  return { menuRef, ownerId };
}

function itemClass(action: ItemAction) {
  const tone = action.isDestructive ? "text-destructive" : "text-foreground";
  return `flex cursor-pointer items-center gap-2 whitespace-nowrap px-3 py-1.5 pointer-coarse:py-2.5 text-sm ${tone} outline-none data-focused:bg-muted data-disabled:cursor-default data-disabled:opacity-50`;
}

function ActionItems({
  actions,
  label,
  autoFocus,
  onClose,
  ownerId,
}: {
  actions: ItemAction[];
  label: string;
  autoFocus?: boolean;
  onClose?: () => void;
  ownerId: string;
}) {
  return (
    <Menu
      aria-label={label}
      autoFocus={autoFocus ? "first" : undefined}
      onClose={onClose}
      className="outline-none"
      disabledKeys={actions.filter((action) => action.isDisabled).map((action) => action.id)}
      onAction={(key) => actions.find((action) => action.id === key)?.onAction?.()}
    >
      {actions.map((action) => {
        const Icon = action.icon;
        const content = (
          <>
            {Icon ? (
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            ) : action.isCurrent !== undefined ? (
              <Check
                className={`h-4 w-4 shrink-0 ${action.isCurrent ? "opacity-100" : "opacity-0"}`}
                aria-hidden="true"
              />
            ) : null}
            <span className="min-w-0 flex-1 truncate">{action.label}</span>
            {action.children && <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />}
          </>
        );

        if (action.children) {
          return (
            <SubmenuTrigger key={action.id}>
              <MenuItem id={action.id} textValue={action.label} className={itemClass(action)}>
                {content}
              </MenuItem>
              <Popover
                isNonModal
                data-item-menu-owner={ownerId}
                className={`${POPOVER_CLASS} max-h-72`}
              >
                <ActionItems actions={action.children} label={action.label} ownerId={ownerId} />
              </Popover>
            </SubmenuTrigger>
          );
        }

        return (
          <MenuItem
            key={action.id}
            id={action.id}
            textValue={action.label}
            className={itemClass(action)}
          >
            {content}
          </MenuItem>
        );
      })}
    </Menu>
  );
}

/**
 * The same action menu anchored to an existing element instead of a ⋯
 * button, for surfaces where a button on every item would be clutter (Canvas
 * nodes). Open it from `useItemContextMenu`.
 */
export function ItemActionsPopover({
  triggerRef,
  label,
  actions,
  isOpen,
  onOpenChange,
}: Omit<ItemActionsMenuProps, "className" | "anchorRef"> & {
  triggerRef: RefObject<Element | null>;
}) {
  const { menuRef, ownerId } = useItemMenuDismissal(isOpen, onOpenChange);
  return (
    <Popover
      ref={menuRef}
      data-item-menu-owner={ownerId}
      isNonModal
      triggerRef={triggerRef}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      placement="bottom start"
      className={POPOVER_CLASS}
    >
      <ActionItems
        actions={actions}
        label={label}
        ownerId={ownerId}
        autoFocus
        onClose={() => onOpenChange(false)}
      />
    </Popover>
  );
}

/**
 * ⋯ button that opens an item's actions. Pair it with `useItemContextMenu`
 * so long-press and right-click open the same menu. Supply a visible
 * `anchorRef` when CSS hides the button: display:none has no positioning box.
 */
export function ItemActionsMenu({
  label,
  actions,
  isOpen,
  onOpenChange,
  className = "",
  anchorRef,
}: ItemActionsMenuProps) {
  const { menuRef, ownerId } = useItemMenuDismissal(isOpen, onOpenChange);
  return (
    <MenuTrigger isOpen={isOpen} onOpenChange={onOpenChange}>
      <Tooltip content={label}>
        <Button
          aria-label={label}
          data-item-actions=""
          data-item-menu-owner={ownerId}
          className={`shrink-0 rounded p-1 pointer-coarse:p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-pressed:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${className}`}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </Button>
      </Tooltip>
      <Popover
        ref={menuRef}
        data-item-menu-owner={ownerId}
        isNonModal
        triggerRef={anchorRef}
        shouldCloseOnInteractOutside={(element) => !belongsToItemMenu(element, ownerId)}
        placement="bottom end"
        className={POPOVER_CLASS}
      >
        <ActionItems actions={actions} label={label} ownerId={ownerId} />
      </Popover>
    </MenuTrigger>
  );
}
