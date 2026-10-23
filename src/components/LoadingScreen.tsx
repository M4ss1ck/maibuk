import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MaibukLogo } from "@/components/icons";
import { consumeStartupEntrance, startupEntranceDelay } from "@/lib/startup-screen";

export function LoadingScreen() {
  const { t } = useTranslation();
  // Read once, during the first render: index.html's startup screen already
  // played part of the logo entrance, and this mount continues it rather than
  // starting it over with a flicker.
  const [delay] = useState(startupEntranceDelay);

  useEffect(() => {
    consumeStartupEntrance();
  }, []);

  return (
    <div className="flex items-center justify-center h-dvh bg-background">
      <div className="flex flex-col items-center">
        <MaibukLogo
          className="w-20 h-20 loading-entrance text-primary"
          style={delay === null ? undefined : { animationDelay: delay }}
        />
        <span className="sr-only" role="status">
          {t("startup.loading")}
        </span>
      </div>
    </div>
  );
}
