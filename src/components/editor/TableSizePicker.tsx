import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ListBox, ListBoxItem } from "react-aria-components";
import { Switch } from "@/components/ui";

interface TableSizePickerProps {
  onSelect: (rows: number, columns: number, withHeaderRow: boolean) => void;
}

const SIZES = [1, 2, 3, 4, 5] as const;

/**
 * Reusable 5×5 table-dimension grid with a header-row toggle. Reports the picked
 * dimensions and header-row preference through `onSelect`. A ListBox in `grid`
 * layout: arrows move between cells, Enter inserts.
 */
export function TableSizePicker({ onSelect }: TableSizePickerProps) {
  const { t } = useTranslation();
  const [withHeaderRow, setWithHeaderRow] = useState(true);
  const [activeCell, setActiveCell] = useState<{ row: number; col: number } | null>(null);

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-2">{t("editor.selectTableSize")}</p>
      <ListBox
        aria-label={t("editor.selectTableSize")}
        layout="grid"
        selectionMode="none"
        onAction={(key) => {
          const [row, col] = String(key).split("x").map(Number);
          onSelect(row, col, withHeaderRow);
        }}
        className="grid grid-cols-5 gap-0.5 outline-none"
      >
        {SIZES.flatMap((row) =>
          SIZES.map((col) => {
            const isActive = activeCell && row <= activeCell.row && col <= activeCell.col;
            return (
              <ListBoxItem
                key={`${row}x${col}`}
                id={`${row}x${col}`}
                data-testid={`table-size-${row}-${col}`}
                aria-label={t("editor.table", { dimensions: `${row}x${col}` })}
                textValue={t("editor.table", { dimensions: `${row}x${col}` })}
                onHoverStart={() => setActiveCell({ row, col })}
                onHoverEnd={() => setActiveCell(null)}
                onFocus={() => setActiveCell({ row, col })}
                className={`flex h-6 w-full cursor-pointer items-center justify-center rounded border text-xs outline-none data-focus-visible:ring-2 data-focus-visible:ring-primary ${
                  isActive
                    ? "border-primary bg-primary text-white"
                    : "border-muted hover:border-primary hover:bg-primary hover:text-white"
                }`}
              />
            );
          })
        )}
      </ListBox>
      <div className="flex items-center justify-center mt-2">
        <p className="mr-auto text-sm text-muted-foreground">{t("editor.addHeaderRow")}</p>
        <Switch
          checked={withHeaderRow}
          onChange={setWithHeaderRow}
          className="h-2"
          label={t("editor.addHeaderRow")}
        />
      </div>
      <p className="text-xs text-muted-foreground mt-2 text-center">
        {activeCell
          ? `${t("editor.insertTable")} (${activeCell.row}x${activeCell.col})`
          : t("editor.insertTable")}
      </p>
    </div>
  );
}
