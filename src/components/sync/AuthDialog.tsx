import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../ui/Modal";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { useSyncStore } from "../../features/sync/store";
import { openExternal } from "../../lib/platform";

interface AuthDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AuthDialog({ isOpen, onClose }: AuthDialogProps) {
  const { t } = useTranslation();
  const { apiUrl, setApiUrl, login, register } =
    useSyncStore();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [serverUrl, setServerUrl] = useState(apiUrl);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Sync local serverUrl with store apiUrl whenever the dialog opens
  useEffect(() => {
    if (isOpen) {
      setServerUrl(apiUrl);
      setError(null);
    }
  }, [isOpen, apiUrl]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (serverUrl !== apiUrl) {
        setApiUrl(serverUrl);
      }

      if (mode === "login") {
        await login(email, password);
      } else {
        await register(email, password);
      }

      setEmail("");
      setPassword("");
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("sync.syncError"),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={mode === "login" ? t("sync.login") : t("sync.register")}
      footer={
        <div className="flex gap-2 w-full">
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || !serverUrl || !email || !password}
          >
            {loading
              ? t("sync.syncing")
              : mode === "login"
                ? t("sync.login")
                : t("sync.register")}
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-lg bg-info-bg p-3 text-sm text-info-text">
          <p className="mb-1">{t("sync.infoCardText")}</p>
          <button
            type="button"
            onClick={() => openExternal("https://maibuk.massick.dev/sync")}
            className="text-info-link hover:underline font-medium"
          >
            {t("sync.infoCardLearnMore")}
          </button>
        </div>

        <Input
          label={t("sync.serverUrl")}
          type="url"
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
          placeholder="https://sync.example.com"
        />

        <Input
          label={t("sync.email")}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />

        <Input
          label={t("sync.password")}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={
            mode === "login" ? "current-password" : "new-password"
          }
        />

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={() =>
              setMode(mode === "login" ? "register" : "login")
            }
            className="text-sm text-primary hover:underline"
          >
            {mode === "login"
              ? t("sync.switchToRegister")
              : t("sync.switchToLogin")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
