import { type RefObject, useLayoutEffect } from "react";

export function useAnchoredPopup(
  open: boolean | string,
  triggerRef: RefObject<HTMLElement | null>,
  popupRef: RefObject<HTMLElement | null>,
  align: "start" | "end" = "start",
) {
  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const popup = popupRef.current;
    if (!open || !trigger || !popup) return;
    const dialog = trigger.closest("[data-app-dialog]");
    const titlebar = document.querySelector(".window-titlebar");
    const gap = 6;
    const inset = 8;
    let frame = 0;

    const place = () => {
      const anchor = trigger.getBoundingClientRect();
      const bounds = dialog?.getBoundingClientRect();
      const left = Math.max(0, bounds?.left ?? 0) + inset;
      const right =
        Math.min(
          document.documentElement.clientWidth,
          bounds?.right ?? Infinity,
        ) - inset;
      const top = (titlebar?.getBoundingClientRect().bottom ?? 0) + inset;
      const bottom = document.documentElement.clientHeight - inset;
      if (
        anchor.bottom <= Math.max(top, bounds?.top ?? top) ||
        anchor.top >= Math.min(bottom, bounds?.bottom ?? bottom) ||
        anchor.width === 0
      ) {
        popup.style.visibility = "hidden";
        return;
      }
      popup.style.setProperty(
        "--popup-width",
        `${Math.max(0, right - left)}px`,
      );
      popup.style.setProperty("--anchor-width", `${anchor.width}px`);
      const needed = Math.min(
        popup.scrollHeight + popup.offsetHeight - popup.clientHeight,
        250,
      );
      const below = Math.max(0, bottom - anchor.bottom - gap);
      const above = Math.max(0, anchor.top - top - gap);
      const opensAbove = needed > below && above > below;
      popup.style.setProperty(
        "--popup-room",
        `${opensAbove ? above : below}px`,
      );
      const width = popup.offsetWidth;
      const preferredLeft =
        align === "end" ? anchor.right - width : anchor.left;
      popup.style.left = `${Math.max(left, Math.min(preferredLeft, right - width))}px`;
      popup.style.top = `${opensAbove ? anchor.top - gap - popup.offsetHeight : anchor.bottom + gap}px`;
      popup.style.visibility = "visible";
    };
    const schedule = (event?: Event) => {
      if (event?.target === popup) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    place();
    const observer = new ResizeObserver(() => schedule());
    observer.observe(trigger);
    observer.observe(popup);
    if (dialog) observer.observe(dialog);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [open, triggerRef, popupRef, align]);
}
