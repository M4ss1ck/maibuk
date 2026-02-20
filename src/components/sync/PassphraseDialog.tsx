import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { setPassphrase } from "../../features/sync/crypto";
import { getDialog, getFileSystem, IS_TAURI } from "../../lib/platform";

interface PassphraseDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void | Promise<void>;
}

export function PassphraseDialog({
  isOpen,
  onClose,
  onSuccess,
}: PassphraseDialogProps) {
  const { t } = useTranslation();
  const [passphrase, setPassphraseValue] = useState("");
  const [isPassphraseVisible, setIsPassphraseVisible] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [isDownloadingBackup, setIsDownloadingBackup] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setPassphraseValue("");
      setIsPassphraseVisible(false);
      setIsConfirmed(false);
      setIsDownloadingBackup(false);
    }
  }, [isOpen]);

  const handleClose = () => {
    if (isConfirmed) {
      void onSuccess();
    }
    onClose();
  };

  const handleDownloadBackup = async () => {
    if (!passphrase) return;

    setIsDownloadingBackup(true);
    try {
      const data = new TextEncoder().encode(passphrase);
      const filename = `maibuk-passphrase-backup-${new Date().toISOString().split("T")[0]}.txt`;

      if (IS_TAURI) {
        const dialog = await getDialog();
        const path = await dialog.save({
          defaultPath: filename,
          filters: [{ name: "Text File", extensions: ["txt"] }],
        });

        if (path) {
          const fs = await getFileSystem();
          await fs.writeFile(path, data);
        }
      } else {
        const fs = await getFileSystem();
        fs.downloadFile(filename, data, "text/plain;charset=utf-8");
      }
    } catch (error) {
      console.error("Failed to backup passphrase:", error);
    } finally {
      setIsDownloadingBackup(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphrase || isConfirmed) return;

    setPassphrase(passphrase);
    setIsConfirmed(true);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t("sync.enterPassphrase")}
      footer={
        isConfirmed ? (
          <div className="w-full">
            <Button className="w-full" onClick={handleClose}>
              {t("common.close")}
            </Button>
          </div>
        ) : (
          <div className="flex gap-2 w-full">
            <Button variant="secondary" onClick={handleClose}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleSubmit} disabled={!passphrase}>
              {t("common.confirm")}
            </Button>
          </div>
        )
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label={t("sync.passphrase")}
          type={isPassphraseVisible ? "text" : "password"}
          value={passphrase}
          onChange={(e) => setPassphraseValue(e.target.value)}
          disabled={isConfirmed}
          autoComplete="off"
          autoFocus
          endAdornment={
            <button
              type="button"
              className="p-1 text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setIsPassphraseVisible((prev) => !prev)}
              aria-label={t(
                isPassphraseVisible
                  ? "sync.hidePassphrase"
                  : "sync.showPassphrase"
              )}
            >
              {isPassphraseVisible ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </button>
          }
        />

        <p className="text-sm text-muted-foreground">
          {t("sync.passphraseHint")}
        </p>

        {isConfirmed && (
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={handleDownloadBackup}
            disabled={!passphrase || isDownloadingBackup}
          >
            {t("sync.downloadPassphraseBackup")}
          </Button>
        )}

        <div className="rounded-lg bg-yellow-50 dark:bg-yellow-900/20 p-3 text-sm text-yellow-800 dark:text-yellow-200">
          {t("sync.encryptionWarning")}
        </div>
      </form>
    </Modal>
  );
}
