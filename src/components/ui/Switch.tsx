import { useLayoutEffect, useRef } from "react";
import { Switch as AriaSwitch } from "react-aria-components/Switch";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  className?: string;
  id?: string;
  disabled?: boolean;
}

export function Switch({
  checked,
  onChange,
  label,
  className = "",
  id,
  disabled = false,
}: SwitchProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    inputRef.current?.setAttribute("aria-checked", String(checked));
  }, [checked]);

  return (
    <AriaSwitch
      inputRef={inputRef}
      id={id}
      isSelected={checked}
      onChange={onChange}
      isDisabled={disabled}
      aria-checked={checked}
      className={({ isSelected, isFocusVisible, isDisabled }) =>
        `group relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent bg-muted transition-colors duration-200 ease-in-out focus:outline-none ${
          isSelected ? "bg-primary" : ""
        } ${isFocusVisible ? "ring-2 ring-primary ring-offset-2" : ""} ${
          isDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
        } ${className}`
      }
    >
      {label && <span className="sr-only">{label}</span>}
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </AriaSwitch>
  );
}
