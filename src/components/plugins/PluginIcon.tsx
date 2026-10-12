import { Puzzle } from "lucide-react";
import { DynamicIcon, type IconName } from "lucide-react/dynamic";

/**
 * A Plugin contribution's icon: a Lucide name loaded lazily, or the generic
 * Plugin icon for a relative `.svg` path (the folder's bytes are not readable
 * from the webview without the Plugin Directory adapter) and for a name the
 * registry cannot resolve. The manifest validator has already refused an
 * unknown Lucide name, so the fallback covers only the loading window.
 */
export function PluginIcon({ icon, className }: { icon?: string; className?: string }) {
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
