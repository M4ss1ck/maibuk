import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Editor } from "@/components/editor/Editor";

type EmbedTheme = "light" | "dark" | "system";

function asEmbedTheme(value: string | null): EmbedTheme {
  if (value === "light" || value === "dark" || value === "system") {
    return value;
  }
  return "system";
}

function prefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function Embed() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const theme = useMemo(() => asEmbedTheme(searchParams.get("theme")), [searchParams]);
  const [content, setContent] = useState<string | null>(null);

  useEffect(() => {
    const root = document.documentElement;

    if (theme !== "system") {
      root.classList.toggle("dark", theme === "dark");
      return;
    }

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    root.classList.toggle("dark", prefersDark());

    const onChange = (event: MediaQueryListEvent) => {
      root.classList.toggle("dark", event.matches);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  return (
    <div className="h-dvh w-full flex flex-col bg-background text-foreground">
      <Editor content={content} onUpdate={setContent} placeholder={t("embed.placeholder")} />
    </div>
  );
}
