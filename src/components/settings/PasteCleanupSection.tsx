import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronUp, ChevronDown } from "lucide-react";
import { useSettingsStore } from "../../features/settings/store";
import {
  PASTE_CLEANUP_PRESET_VALUES,
  PASTE_CLEANUP_OPTION_KEYS,
  PASTE_RULE_TARGET_VALUES,
  PASTE_RULE_ACTION_VALUES,
  type PasteCleanupPreset,
  type PasteRuleTarget,
  type PasteRuleAction,
} from "../../features/settings/types";
import { Select, Switch, Button, Modal, Input } from "../ui";
import { ChevronDownIcon } from "../icons";

export function PasteCleanupSection() {
  const { t } = useTranslation();
  const {
    pasteCleanup,
    setPasteCleanupPreset,
    setPasteCleanupOption,
    addPasteCleanupRule,
    updatePasteCleanupRule,
    removePasteCleanupRule,
    movePasteCleanupRule,
  } = useSettingsStore();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

  const { preset, options, rules } = pasteCleanup;

  const presetOptions = PASTE_CLEANUP_PRESET_VALUES.map((value) => ({
    value,
    label: t(`settings.pasteCleanup.preset.${value}`),
  }));
  const targetOptions = PASTE_RULE_TARGET_VALUES.map((value) => ({
    value,
    label: t(`settings.pasteCleanup.rules.targetOption.${value}`),
  }));
  const actionOptions = PASTE_RULE_ACTION_VALUES.map((value) => ({
    value,
    label: t(`settings.pasteCleanup.rules.actionOption.${value}`),
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between py-2 gap-2 sm:gap-4">
        <div>
          <p className="font-medium">
            {t("settings.pasteCleanup.preset.label")}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("settings.pasteCleanup.preset.description")}
          </p>
        </div>
        <Select<PasteCleanupPreset>
          value={preset}
          onChange={setPasteCleanupPreset}
          options={presetOptions}
        />
      </div>

      <div>
        <button
          type="button"
          onClick={() => setAdvancedOpen((open) => !open)}
          className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {t("settings.pasteCleanup.advanced")}
          <ChevronDownIcon
            className={`w-4 h-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
          />
        </button>

        {advancedOpen && (
          <div className="mt-3 space-y-3 border-l-2 border-border pl-4">
            {PASTE_CLEANUP_OPTION_KEYS.map((key) => (
              <div key={key} className="flex items-center justify-between gap-4">
                <p className="text-sm">
                  {t(`settings.pasteCleanup.option.${key}`)}
                </p>
                <Switch
                  checked={options[key]}
                  onChange={(value) => setPasteCleanupOption(key, value)}
                  label={t(`settings.pasteCleanup.option.${key}`)}
                />
              </div>
            ))}

            <div className="flex items-center justify-between gap-4 pt-1">
              <div>
                <p className="text-sm font-medium">
                  {t("settings.pasteCleanup.rules.title")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("settings.pasteCleanup.rules.count", {
                    count: rules.length,
                  })}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setRulesOpen(true)}
              >
                {t("settings.pasteCleanup.rules.manage")}
              </Button>
            </div>
          </div>
        )}
      </div>

      <Modal
        isOpen={rulesOpen}
        onClose={() => setRulesOpen(false)}
        title={t("settings.pasteCleanup.rules.title")}
        footer={
          <Button variant="ghost" onClick={() => setRulesOpen(false)}>
            {t("common.close")}
          </Button>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("settings.pasteCleanup.rules.description")}
          </p>

          {rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("settings.pasteCleanup.rules.empty")}
            </p>
          ) : (
            <div className="space-y-3">
              {rules.map((rule, index) => (
                <div
                  key={rule.id}
                  className="rounded-lg border border-border p-3 space-y-3"
                >
                  <div className="flex items-center gap-2">
                    <Input
                      value={rule.label}
                      onChange={(e) =>
                        updatePasteCleanupRule(rule.id, {
                          label: e.target.value,
                        })
                      }
                      placeholder={t(
                        "settings.pasteCleanup.rules.labelPlaceholder",
                      )}
                      aria-label={t("settings.pasteCleanup.rules.label")}
                      className="flex-1"
                    />
                    <Switch
                      checked={rule.enabled}
                      onChange={(value) =>
                        updatePasteCleanupRule(rule.id, { enabled: value })
                      }
                      label={t("settings.pasteCleanup.rules.enabled")}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select<PasteRuleTarget>
                      value={rule.target}
                      onChange={(value) =>
                        updatePasteCleanupRule(rule.id, { target: value })
                      }
                      options={targetOptions}
                    />
                    <Input
                      value={rule.value}
                      onChange={(e) =>
                        updatePasteCleanupRule(rule.id, {
                          value: e.target.value,
                        })
                      }
                      placeholder={t(
                        "settings.pasteCleanup.rules.valuePlaceholder",
                      )}
                      aria-label={t("settings.pasteCleanup.rules.value")}
                      className="flex-1 min-w-32"
                    />
                    <Select<PasteRuleAction>
                      value={rule.action}
                      onChange={(value) =>
                        updatePasteCleanupRule(rule.id, { action: value })
                      }
                      options={actionOptions}
                    />
                  </div>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => movePasteCleanupRule(rule.id, "up")}
                      disabled={index === 0}
                      aria-label={t("settings.pasteCleanup.rules.moveUp")}
                    >
                      <ChevronUp className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => movePasteCleanupRule(rule.id, "down")}
                      disabled={index === rules.length - 1}
                      aria-label={t("settings.pasteCleanup.rules.moveDown")}
                    >
                      <ChevronDown className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removePasteCleanupRule(rule.id)}
                      className="text-destructive"
                    >
                      {t("settings.pasteCleanup.rules.remove")}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <Button variant="primary" size="sm" onClick={addPasteCleanupRule}>
            {t("settings.pasteCleanup.rules.add")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
