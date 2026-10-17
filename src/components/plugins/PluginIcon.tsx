import { createElement } from "react";
import { Puzzle } from "lucide-react";
import { DynamicIcon, type IconName } from "lucide-react/dynamic";
import {
  type InlineIcon,
  type PluginIconSpec,
  allowedInlineElements,
  isInlineIcon,
} from "@/features/plugins/inline-icon";

/**
 * A Plugin contribution's icon: a Lucide name loaded lazily, inline SVG
 * elements drawn with the app icon attributes (#531), or the generic Plugin
 * icon for a relative `.svg` path (the folder's bytes are not readable from the
 * webview without the Plugin Directory adapter) and for a name the registry
 * cannot resolve. The manifest validator has already refused an unknown Lucide
 * name and any inline element outside the allowlist, so the fallback covers
 * only the loading window.
 */
export function PluginIcon({ icon, className }: { icon?: PluginIconSpec; className?: string }) {
  if (icon !== undefined && isInlineIcon(icon)) {
    return <InlineIconSvg icon={icon} className={className} />;
  }
  const isLucideName = icon !== undefined && !icon.endsWith(".svg");
  if (isLucideName) {
    return (
      <DynamicIcon
        name={icon as IconName}
        className={className}
        fallback={() => <Puzzle className={className} />}
      />
    );
  }
  return <Puzzle className={className} />;
}

// Stroke attributes match the app's own icons, so an inline icon is drawn the same way.
function InlineIconSvg({ icon, className }: { icon: InlineIcon; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {allowedInlineElements(icon.elements).map(([tag, attrs], index) =>
        createElement(tag, { key: index, ...attrs })
      )}
    </svg>
  );
}
