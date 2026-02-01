import logo from "../../src-tauri/icons/icon.png";

export function LoadingScreen() {
  return (
    <div className="flex items-center justify-center h-dvh bg-background">
      <div className="flex flex-col items-center">
        <img
          src={logo}
          alt="Maibuk"
          className="w-20 h-20 animate-pulse"
        />
      </div>
    </div>
  );
}
