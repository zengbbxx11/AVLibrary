import React, { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

type Option = { value: string; label: string };

export function CompactSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const selected = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  useEffect(() => {
    if (open)
      ref.current
        ?.querySelector<HTMLElement>(`[data-option-index="${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);
  const select = (index: number) => {
    if (!options[index]) return;
    onChange(options[index].value);
    setOpen(false);
  };
  return (
    <div ref={ref} className={"compact-select" + (open ? " open" : "")}>
      <button
        type="button"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="listbox"
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={() => {
          if (!open) setActive(selected);
          setOpen(!open);
        }}
        onBlur={(event) => {
          if (
            !event.currentTarget.parentElement?.contains(
              event.relatedTarget as Node,
            )
          )
            setOpen(false);
        }}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            if (!open) {
              setActive(selected);
              setOpen(true);
            } else
              setActive((current) =>
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? options.length - 1
                    : (current +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        options.length) %
                      options.length,
              );
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          } else if ((event.key === "Enter" || event.key === " ") && open) {
            event.preventDefault();
            select(active);
          } else if (event.key === "Tab") setOpen(false);
        }}
      >
        <span>{options[selected]?.label}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <ul
          id={id}
          role="listbox"
          aria-label={label + "选项"}
          className="compact-menu"
        >
          {options.map((option, index) => (
            <li
              id={`${id}-${index}`}
              data-option-index={index}
              role="option"
              aria-selected={option.value === value}
              key={option.value}
              className={index === active ? "active" : ""}
              onMouseMove={() => setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => select(index)}
            >
              <span>{option.label}</span>
              {option.value === value && <Check size={14} aria-hidden="true" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
