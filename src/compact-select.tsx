import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Check, ChevronDown } from "lucide-react";
import { useAnchoredPopup } from "./anchored-popup";

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
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useAnchoredPopup(open, trigger, list);
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
  useLayoutEffect(() => {
    const popup = list.current;
    const option = popup?.children[active];
    if (!open || !popup || !option) return;
    const bounds = popup.getBoundingClientRect();
    const item = option.getBoundingClientRect();
    if (item.top < bounds.top) popup.scrollTop += item.top - bounds.top - 5;
    else if (item.bottom > bounds.bottom)
      popup.scrollTop += item.bottom - bounds.bottom + 5;
  }, [active, open]);
  const select = (index: number) => {
    if (!options[index]) return;
    onChange(options[index].value);
    setOpen(false);
  };
  return (
    <div
      ref={ref}
      data-popup-open={open || undefined}
      className={"compact-select" + (open ? " open" : "")}
    >
      <button
        ref={trigger}
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
        <span title={options[selected]?.label}>{options[selected]?.label}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <ul
          ref={list}
          id={id}
          role="listbox"
          aria-label={label + "选项"}
          className="compact-menu anchored-popup"
        >
          {options.map((option, index) => (
            <li
              id={`${id}-${index}`}
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
