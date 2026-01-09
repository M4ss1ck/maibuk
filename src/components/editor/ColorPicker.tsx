import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  onClear?: () => void;
  title: string;
  icon: React.ReactNode;
}

const PRESET_COLORS = [
  "#000000", "#374151", "#6B7280", "#9CA3AF", "#D1D5DB",
  "#EF4444", "#F97316", "#EAB308", "#22C55E", "#14B8A6",
  "#3B82F6", "#6366F1", "#8B5CF6", "#EC4899", "#F43F5E",
  "#7C2D12", "#713F12", "#365314", "#164E63", "#1E3A8A",
];

export function ColorPicker({ value, onChange, onClear, title, icon }: ColorPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleToggle = () => {
    if (!isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 4,
        left: rect.left,
      });
    }
    setIsOpen(!isOpen);
  };

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleToggle}
        title={title}
        className={`p-2 rounded transition-colors hover:bg-muted flex items-center gap-1`}
      >
        <span className="relative">
          {icon}
          {value && (
            <span
              className="absolute -bottom-0.5 left-0 right-0 h-1 rounded-sm"
              style={{ backgroundColor: value }}
            />
          )}
        </span>
        <svg className="w-2 h-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && createPortal(
        <div
          ref={dropdownRef}
          className="fixed p-2 bg-background border border-border rounded-lg shadow-lg z-50 w-48"
          style={{ top: position.top, left: position.left }}
        >
          <div className="grid grid-cols-5 gap-1 mb-2">
            {PRESET_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => {
                  onChange(color);
                  setIsOpen(false);
                }}
                className={`w-7 h-7 rounded border-2 transition-transform hover:scale-110 ${value === color ? "border-primary" : "border-transparent"
                  }`}
                style={{ backgroundColor: color }}
                title={color}
              />
            ))}
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <input
              type="color"
              value={value || "#000000"}
              onChange={(e) => {
                onChange(e.target.value);
              }}
              className="w-8 h-8 cursor-pointer rounded border border-border"
              title="Custom color"
            />
            <span className="text-xs text-muted-foreground flex-1">Custom</span>
            {onClear && (
              <button
                onClick={() => {
                  onClear();
                  setIsOpen(false);
                }}
                className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted"
              >
                Clear
              </button>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
