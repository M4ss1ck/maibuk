import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

export function RouteAnnouncer() {
  const { pathname } = useLocation();
  const [heading, setHeading] = useState("");
  const observerRef = useRef<MutationObserver | null>(null);

  useEffect(() => {
    const readHeading = () => {
      const el = document.querySelector("[data-route-heading]");
      const text = el?.textContent?.trim() ?? "";
      return text;
    };

    const initial = readHeading();
    if (initial) {
      setHeading(initial);
      return;
    }

    observerRef.current = new MutationObserver(() => {
      const text = readHeading();
      if (text) {
        setHeading(text);
        observerRef.current?.disconnect();
      }
    });

    observerRef.current.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      observerRef.current?.disconnect();
    };
  }, [pathname]);

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {heading}
    </div>
  );
}
