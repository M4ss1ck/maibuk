import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui";

interface TableSizePickerProps {
  onSelect: (rows: number, columns: number, withHeaderRow: boolean) => void;
}

/**
 * Reusable 5×5 table-dimension grid with a header-row toggle. Reports the picked
 * dimensions and header-row preference through `onSelect`.
 */
export function TableSizePicker({ onSelect }: TableSizePickerProps) {
  const { t } = useTranslation();
  const [withHeaderRow, setWithHeaderRow] = useState(true);
  const [hoveredCell, setHoveredCell] = useState<{ row: number; col: number } | null>(null);

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-2">{t("editor.selectTableSize")}:</p>
      <div className="grid grid-cols-5 gap-0.5">
        {[1, 2, 3, 4, 5].map((row) =>
          [1, 2, 3, 4, 5].map((col) => {
            const isActive = hoveredCell && row <= hoveredCell.row && col <= hoveredCell.col;
            return (
              <button
                key={`${row}-${col}`}
                type="button"
                data-testid={`table-size-${row}-${col}`}
                onClick={() => onSelect(row, col, withHeaderRow)}
                onMouseEnter={() => setHoveredCell({ row, col })}
                onMouseLeave={() => setHoveredCell(null)}
                className={`w-full h-6 border border-muted rounded text-xs ${isActive ? "bg-primary text-white border-primary" : "hover:bg-primary hover:border-primary"}`}
                title={`${t("editor.table", { dimensions: `${row}x${col}` })}`}
              />
            );
          })
        )}
      </div>
      <div className="flex items-center justify-center mt-2">
        <p className="mr-auto text-sm text-muted-foreground">{t("editor.addHeaderRow")}</p>
        <Switch checked={withHeaderRow} onChange={setWithHeaderRow} className="h-2" />
      </div>
      <p className="text-xs text-muted-foreground mt-2 text-center">
        {hoveredCell
          ? `${t("editor.insertTable")} (${hoveredCell.row}x${hoveredCell.col})`
          : t("editor.insertTable")}
      </p>
    </div>
  );
}
