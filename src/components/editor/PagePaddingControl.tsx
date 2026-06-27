import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { EditorPagePadding } from "../../features/settings/types";
import {
  EDITOR_PAGE_PADDING_MIN,
  EDITOR_PAGE_PADDING_MAX,
  EDITOR_PAGE_PADDING_STEP,
  clampEditorPagePadding,
} from "../../features/settings/types";

function sanitizeNumericInput(value: string): string {
  return value.replace(/[^0-9-]/g, "").replace(/(?!^)-/g, "");
}

interface PagePaddingControlProps {
  padding: EditorPagePadding;
  onChange: (value: number | Partial<EditorPagePadding>) => void;
}

export function PagePaddingControl({
  padding,
  onChange,
}: PagePaddingControlProps) {
  const { t } = useTranslation();
  const [isCustom, setIsCustom] = useState(false);

  const allEqual =
    padding.top === padding.right &&
    padding.right === padding.bottom &&
    padding.bottom === padding.left;
  const commonValue = allEqual ? padding.top : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-medium text-foreground">
        {t("editor.pagePadding")}
      </div>

      {!isCustom && (
        <SimplePaddingControl
          value={commonValue}
          onChange={onChange}
        />
      )}

      {isCustom && (
        <CustomPaddingControl padding={padding} onChange={onChange} />
      )}

      <button
        type="button"
        onClick={() => setIsCustom((prev) => !prev)}
        className="self-start text-sm text-primary hover:underline"
      >
        {isCustom ? t("editor.simplePadding") : t("editor.customizePadding")}
      </button>
    </div>
  );
}

interface SimplePaddingControlProps {
  value: number | null;
  onChange: (value: number) => void;
}

function SimplePaddingControl({ value, onChange }: SimplePaddingControlProps) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(value === null ? "" : String(value));
  }, [value]);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const commit = () => {
    if (!draft.trim()) {
      setDraft(value === null ? "" : String(value));
      return;
    }
    onChange(clampEditorPagePadding(Number(draft)));
  };

  const displayedValue = value === null ? t("editor.paddingCustom") : `${value}px`;

  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={EDITOR_PAGE_PADDING_MIN}
        max={EDITOR_PAGE_PADDING_MAX}
        step={EDITOR_PAGE_PADDING_STEP}
        value={value ?? EDITOR_PAGE_PADDING_MIN}
        disabled={value === null}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={t("editor.pagePadding")}
        className="min-w-0 flex-1"
      />
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={draft}
          placeholder={value === null ? t("editor.paddingCustom") : undefined}
          onChange={(e) => setDraft(sanitizeNumericInput(e.target.value))}
          onBlur={() => {
            commit();
            setIsEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commit();
              e.currentTarget.blur();
            }
            if (e.key === "Escape") {
              setDraft(value === null ? "" : String(value));
              setIsEditing(false);
            }
          }}
          aria-label={`${t("editor.pagePadding")} px`}
          className="h-8 w-20 shrink-0 rounded px-2 text-right text-sm text-foreground border border-border bg-background shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      ) : (
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          onFocus={() => setIsEditing(true)}
          aria-label={`${t("editor.pagePadding")} px`}
          className="h-8 w-20 shrink-0 rounded px-2 text-right text-sm transition-colors text-muted-foreground hover:text-foreground"
        >
          {displayedValue}
        </button>
      )}
    </div>
  );
}

interface CustomPaddingControlProps {
  padding: EditorPagePadding;
  onChange: (value: Partial<EditorPagePadding>) => void;
}

function CustomPaddingControl({
  padding,
  onChange,
}: CustomPaddingControlProps) {
  const { t } = useTranslation();
  const sides: Array<keyof EditorPagePadding> = ["top", "right", "bottom", "left"];

  return (
    <div className="grid grid-cols-1 gap-2">
      {sides.map((side) => (
        <PaddingSideControl
          key={side}
          side={side}
          value={padding[side]}
          onChange={(value) => onChange({ [side]: value })}
        />
      ))}
    </div>
  );
}

interface PaddingSideControlProps {
  side: keyof EditorPagePadding;
  value: number;
  onChange: (value: number) => void;
}

function PaddingSideControl({ side, value, onChange }: PaddingSideControlProps) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const commit = () => {
    if (!draft.trim()) {
      setDraft(String(value));
      return;
    }
    onChange(clampEditorPagePadding(Number(draft)));
  };

  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-sm text-muted-foreground">
        {t(`editor.pagePadding${side.charAt(0).toUpperCase()}${side.slice(1)}`)}
      </span>
      <input
        type="range"
        min={EDITOR_PAGE_PADDING_MIN}
        max={EDITOR_PAGE_PADDING_MAX}
        step={EDITOR_PAGE_PADDING_STEP}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={t(`editor.pagePadding${side.charAt(0).toUpperCase()}${side.slice(1)}`)}
        className="min-w-0 flex-1"
      />
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={draft}
          onChange={(e) => setDraft(sanitizeNumericInput(e.target.value))}
          onBlur={() => {
            commit();
            setIsEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commit();
              e.currentTarget.blur();
            }
            if (e.key === "Escape") {
              setDraft(String(value));
              setIsEditing(false);
            }
          }}
          aria-label={`${t(`editor.pagePadding${side.charAt(0).toUpperCase()}${side.slice(1)}`)} px`}
          className="h-8 w-20 shrink-0 rounded px-2 text-right text-sm text-foreground border border-border bg-background shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      ) : (
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          onFocus={() => setIsEditing(true)}
          aria-label={`${t(`editor.pagePadding${side.charAt(0).toUpperCase()}${side.slice(1)}`)} px`}
          className="h-8 w-20 shrink-0 rounded px-2 text-right text-sm transition-colors text-muted-foreground hover:text-foreground"
        >
          {value}px
        </button>
      )}
    </div>
  );
}
