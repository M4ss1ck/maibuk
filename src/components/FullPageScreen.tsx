import { Outlet } from "react-router-dom";

/**
 * Wrapper for the routes that render outside <Layout>. Those pages own the
 * whole viewport, so nothing else reserves the device's safe areas for them —
 * without this their top and bottom bars sit under the Android status and
 * navigation bars and cannot be tapped. Every inset is 0 on desktop and web,
 * so this is a no-op there.
 *
 * Pages rendered here must size their root with `h-full`, not `h-dvh`: the
 * wrapper is already viewport-tall, and `h-dvh` would push the page's bottom
 * bar back under the navigation bar.
 */
export function FullPageScreen() {
  return (
    <div
      data-testid="full-page-screen"
      className="h-dvh bg-background text-foreground pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
    >
      <Outlet />
    </div>
  );
}
