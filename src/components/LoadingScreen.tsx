import { MaibukLogo } from "./icons";

export function LoadingScreen() {
  return (
    <div className="flex items-center justify-center h-dvh bg-background">
      <div className="flex flex-col items-center">
        <MaibukLogo className="w-20 h-20 loading-entrance text-primary" />
      </div>
    </div>
  );
}
