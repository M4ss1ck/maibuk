import { useTranslation } from "react-i18next";
import { Radio, RadioGroup } from "react-aria-components";
import { DictationBarPreview } from "@/components/dictation/DictationBar";
import { SettingRow } from "@/components/settings/SettingRow";
import { useDictationStore } from "@/features/dictation/store";
import { DICTATION_BAR_SIZES, type DictationBarSize } from "@/features/dictation/types";

/**
 * The Dictation Bar's size: Hidden as a word, Compact and Full as the bar
 * itself at the size the editor draws it, so the choice shows what it costs.
 */
export function DictationBarSizeRow() {
  const { t } = useTranslation();
  const barSize = useDictationStore((s) => s.barSize);
  const setBarSize = useDictationStore((s) => s.setBarSize);

  return (
    <SettingRow id="dictationBarSize" className="py-3 space-y-2">
      <RadioGroup
        aria-label={t("dictation.bar.size")}
        orientation="horizontal"
        value={barSize}
        onChange={(value) => setBarSize(value as DictationBarSize)}
        className="flex flex-wrap items-center gap-2"
      >
        {DICTATION_BAR_SIZES.map((size) => (
          <Radio
            key={size}
            value={size}
            className="inline-flex min-h-12 cursor-pointer items-center rounded-lg border-2 border-transparent px-3 py-2 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground data-selected:border-primary data-selected:text-foreground data-focus-visible:ring-2 data-focus-visible:ring-primary data-focus-visible:ring-offset-1"
          >
            {size === "hidden" ? (
              t("dictation.bar.sizes.hidden")
            ) : (
              <>
                <DictationBarPreview size={size} />
                <span className="sr-only">{t(`dictation.bar.sizes.${size}`)}</span>
              </>
            )}
          </Radio>
        ))}
      </RadioGroup>
    </SettingRow>
  );
}
