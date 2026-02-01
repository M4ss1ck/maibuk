import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useSettingsStore } from "../features/settings/store";

export function PathTracker() {
  const location = useLocation();
  const setLastPath = useSettingsStore((s) => s.setLastPath);

  useEffect(() => {
    setLastPath(location.pathname);
  }, [location.pathname, setLastPath]);

  return null;
}
