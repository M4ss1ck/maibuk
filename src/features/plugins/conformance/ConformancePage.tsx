/**
 * The test-only conformance page (#447, D3). It exists so the native build can
 * be driven to the route and the checks run in-page; it has no UI beyond a
 * status line (a `role="status"` the Keyboard lane can read), and it is imported
 * lazily only under `VITE_PLUGIN_CONFORMANCE=1`.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { runConformance } from "@/features/plugins/conformance/run";

type Status = "running" | "done" | "error";

export default function ConformancePage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>("running");

  useEffect(() => {
    let cancelled = false;
    runConformance().then(
      () => {
        if (!cancelled) setStatus("done");
      },
      () => {
        if (!cancelled) setStatus("error");
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return <p role="status">{t(`plugins.conformance.${status}`)}</p>;
}
