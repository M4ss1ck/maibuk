// src/features/links/navigate.ts
import { resolveLinkTarget, type LinkToastKey } from "@/features/links/resolve-target";

type NavigateFn = (to: string, options?: { state?: unknown }) => void;

export async function navigateToLinkTarget(
  href: string,
  navigate: NavigateFn,
  onToast?: (key: LinkToastKey) => void
): Promise<void> {
  const outcome = await resolveLinkTarget(href);
  if (!outcome) return;
  if (outcome.toastKey && onToast) {
    onToast(outcome.toastKey);
  }
  if (outcome.to) {
    const maybe = outcome as { state?: { scrollToHeadingId?: string; openChapterId?: string } };
    navigate(outcome.to, maybe.state ? { state: maybe.state } : undefined);
  }
}
