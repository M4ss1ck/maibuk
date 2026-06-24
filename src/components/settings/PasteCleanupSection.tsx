import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronUp, ChevronDown, X } from "lucide-react";
import { useSettingsStore } from "../../features/settings/store";
import {
  PASTE_CLEANUP_PRESET_VALUES,
  PASTE_STRUCTURAL_OPTION_KEYS,
  PASTE_STRIP_COMMON_PROPERTIES,
  PASTE_RULE_TARGET_VALUES,
  PASTE_RULE_ACTION_VALUES,
  PASTE_RULE_TARGET_META,
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
    addStrippedProperty,
    removeStrippedProperty,
    addPasteCleanupRule,
    updatePasteCleanupRule,
    removePasteCleanupRule,
    movePasteCleanupRule,
  } = useSettingsStore();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [newProperty, setNewProperty] = useState("");
  const [focusRuleId, setFocusRuleId] = useState<string | null>(null);

  // Opened via "Add cleanup rule" from the HTML source view: jump straight to
  // the rules editor with the new rule revealed and focused.
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const state = location.state as
      | { openPasteCleanupRules?: boolean; focusPasteRuleId?: string }
      | null;
    if (!state?.openPasteCleanupRules) return;
    setAdvancedOpen(true);
    setRulesOpen(true);
    setFocusRuleId(state.focusPasteRuleId ?? null);
    // Consume the navigation state so the modal does not reopen on re-render.
    navigate(location.pathname, { replace: true, state: null });
  }, [location, navigate]);

  // Capture the targeted rule's value input without focusing as a side effect:
  // the focus is driven by a one-shot effect below so it fires exactly once
  // (on open) instead of on every keystroke/re-render.
  const focusRuleNodeRef = useRef<HTMLInputElement | null>(null);
  const captureFocusRule = useCallback((node: HTMLInputElement | null) => {
    focusRuleNodeRef.current = node;
  }, []);
  useEffect(() => {
    if (!rulesOpen || !focusRuleId) return;
    const node = focusRuleNodeRef.current;
    if (!node) return;
    node.focus();
    node.scrollIntoView({ block: "center" });
    setFocusRuleId(null);
  }, [rulesOpen, focusRuleId]);

  const promptMarkdownOnPaste = useSettingsStore(
    (state) => state.promptMarkdownOnPaste,
  );
  const setPromptMarkdownOnPaste = useSettingsStore(
    (state) => state.setPromptMarkdownOnPaste,
  );

  const { preset, options, rules } = pasteCleanup;
  const { strippedProperties } = options;

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

  const commonProperties: readonly string[] = PASTE_STRIP_COMMON_PROPERTIES;
  const customProperties = strippedProperties.filter(
    (property) => !commonProperties.includes(property),
  );

  const handleAddProperty = () => {
    const value = newProperty.trim();
    if (!value) return;
    addStrippedProperty(value);
    setNewProperty("");
  };

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

      <div className="flex flex-col sm:flex-row sm:items-center justify-between py-2 gap-2 sm:gap-4">
        <div>
          <p className="font-medium">
            {t("settings.pasteCleanup.promptMarkdownLabel")}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("settings.pasteCleanup.promptMarkdownDescription")}
          </p>
        </div>
        <Switch
          checked={promptMarkdownOnPaste}
          onChange={setPromptMarkdownOnPaste}
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
          <div className="mt-3 space-y-5 border-l-2 border-border pl-4">
            <div className="space-y-3">
              {PASTE_STRUCTURAL_OPTION_KEYS.map((key) => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-4"
                >
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
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">
                  {t("settings.pasteCleanup.strip.title")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("settings.pasteCleanup.strip.description")}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                {PASTE_STRIP_COMMON_PROPERTIES.map((property) => (
                  <div
                    key={property}
                    className="flex items-center justify-between gap-3"
                  >
                    <p className="text-sm">
                      {t(`settings.pasteCleanup.property.${property}`)}
                    </p>
                    <Switch
                      checked={strippedProperties.includes(property)}
                      onChange={(on) =>
                        on
                          ? addStrippedProperty(property)
                          : removeStrippedProperty(property)
                      }
                      label={t(`settings.pasteCleanup.property.${property}`)}
                    />
                  </div>
                ))}
              </div>

              {customProperties.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {customProperties.map((property) => (
                    <span
                      key={property}
                      className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-mono"
                    >
                      {property}
                      <button
                        type="button"
                        onClick={() => removeStrippedProperty(property)}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={t("settings.pasteCleanup.rules.remove")}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2">
                <Input
                  value={newProperty}
                  onChange={(e) => setNewProperty(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddProperty();
                    }
                  }}
                  placeholder={t(
                    "settings.pasteCleanup.strip.addPropertyPlaceholder",
                  )}
                  className="flex-1"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleAddProperty}
                >
                  {t("settings.pasteCleanup.strip.addProperty")}
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4">
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
                      ref={rule.id === focusRuleId ? captureFocusRule : undefined}
                      value={rule.value}
                      onChange={(e) =>
                        updatePasteCleanupRule(rule.id, {
                          value: e.target.value,
                        })
                      }
                      placeholder={PASTE_RULE_TARGET_META[rule.target].example}
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

          <Button
            variant="primary"
            size="sm"
            onClick={() => addPasteCleanupRule()}
          >
            {t("settings.pasteCleanup.rules.add")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
