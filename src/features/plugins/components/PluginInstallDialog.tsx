/**
 * PluginInstallDialog Component
 *
 * Modal dialog for installing plugins from ZIP files.
 * Shows file picker, validation, and manifest preview.
 */

import { useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { PluginManifest } from "../types";
import { PERMISSION_INFO } from "../types";
import { canInstallPlugin, installPluginFromFile } from "../core/PluginLoader";
import { Button, Modal } from "../../../components/ui";

interface PluginInstallDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onInstalled: (manifest: PluginManifest) => void;
}

type InstallState = "idle" | "validating" | "preview" | "installing" | "success" | "error";

export function PluginInstallDialog({
  isOpen,
  onClose,
  onInstalled,
}: PluginInstallDialogProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [state, setState] = useState<InstallState>("idle");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [manifest, setManifest] = useState<PluginManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const resetState = useCallback(() => {
    setState("idle");
    setSelectedFile(null);
    setManifest(null);
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [onClose, resetState]);

  const validateFile = async (file: File) => {
    setState("validating");
    setSelectedFile(file);
    setError(null);

    const result = await canInstallPlugin(file);

    if (result.canInstall && result.manifest) {
      setManifest(result.manifest);
      setState("preview");
    } else {
      setError(result.error || t("plugins.unknownError"));
      setState("error");
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      validateFile(file);
    }
  };

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);

    const file = event.dataTransfer.files[0];
    if (file && file.name.endsWith(".zip")) {
      validateFile(file);
    } else {
      setError(t("plugins.mustBeZip"));
      setState("error");
    }
  };

  const handleInstall = async () => {
    if (!selectedFile) return;

    setState("installing");

    const result = await installPluginFromFile(selectedFile);

    if (result.success && result.manifest) {
      setState("success");
      setTimeout(() => {
        onInstalled(result.manifest!);
        handleClose();
      }, 1500);
    } else {
      setError(result.error || t("plugins.installFailed"));
      setState("error");
    }
  };

  const getRiskBadgeClass = (risk: "low" | "medium" | "high") => {
    switch (risk) {
      case "low":
        return "bg-green-500/20 text-green-600 dark:text-green-400";
      case "medium":
        return "bg-amber-500/20 text-amber-600 dark:text-amber-400";
      case "high":
        return "bg-red-500/20 text-red-600 dark:text-red-400";
    }
  };

  const renderContent = () => {
    switch (state) {
      case "idle":
        return (
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              isDragging
                ? "border-primary bg-primary/5"
                : "border-border hover:border-muted-foreground"
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              onChange={handleFileSelect}
              className="hidden"
            />
            <div className="space-y-4">
              <div className="text-4xl">📦</div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {t("plugins.dropZipHere")}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("plugins.orClickToSelect")}
                </p>
              </div>
              <Button
                variant="secondary"
                onClick={() => fileInputRef.current?.click()}
              >
                {t("plugins.selectFile")}
              </Button>
            </div>
          </div>
        );

      case "validating":
        return (
          <div className="text-center py-8">
            <div className="animate-spin text-4xl mb-4">⏳</div>
            <p className="text-sm text-muted-foreground">
              {t("plugins.validating")}
            </p>
          </div>
        );

      case "preview":
        return manifest ? (
          <div className="space-y-4">
            {/* Plugin Info */}
            <div className="p-4 bg-muted rounded-lg">
              <h4 className="font-medium text-lg">{manifest.name}</h4>
              <p className="text-sm text-muted-foreground mt-1">
                {manifest.description}
              </p>
              <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                <span>v{manifest.version}</span>
                <span>{t("common.by")} {manifest.author.name}</span>
                <span>{manifest.type}</span>
              </div>
            </div>

            {/* Permissions Preview */}
            <div>
              <h5 className="text-sm font-medium mb-2">
                {t("plugins.requestedPermissions")}
              </h5>
              <div className="flex flex-wrap gap-2">
                {manifest.permissions.map((permission) => {
                  const info = PERMISSION_INFO[permission];
                  return (
                    <span
                      key={permission}
                      className={`text-xs px-2 py-1 rounded-full ${getRiskBadgeClass(
                        info.risk
                      )}`}
                      title={info.description}
                    >
                      {info.label}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* File Info */}
            <div className="text-xs text-muted-foreground">
              <p>{t("plugins.file")}: {selectedFile?.name}</p>
              <p>{t("plugins.size")}: {((selectedFile?.size || 0) / 1024).toFixed(1)} KB</p>
            </div>
          </div>
        ) : null;

      case "installing":
        return (
          <div className="text-center py-8">
            <div className="animate-spin text-4xl mb-4">⏳</div>
            <p className="text-sm text-muted-foreground">
              {t("plugins.installing")}
            </p>
          </div>
        );

      case "success":
        return (
          <div className="text-center py-8">
            <div className="text-4xl mb-4">✅</div>
            <p className="text-sm text-green-600 dark:text-green-400">
              {t("plugins.installSuccess")}
            </p>
          </div>
        );

      case "error":
        return (
          <div className="space-y-4">
            <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-lg">
              <p className="text-sm text-destructive">{error}</p>
            </div>
            <Button variant="secondary" onClick={resetState} className="w-full">
              {t("plugins.tryAgain")}
            </Button>
          </div>
        );
    }
  };

  const renderFooter = () => {
    if (state === "preview") {
      return (
        <>
          <Button variant="ghost" onClick={handleClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleInstall}>{t("plugins.install")}</Button>
        </>
      );
    }

    if (state === "idle" || state === "error") {
      return (
        <Button variant="ghost" onClick={handleClose}>
          {t("common.cancel")}
        </Button>
      );
    }

    return null;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t("plugins.installPlugin")}
      footer={renderFooter()}
    >
      {renderContent()}
    </Modal>
  );
}
