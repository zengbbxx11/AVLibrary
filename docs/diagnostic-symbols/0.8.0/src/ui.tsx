import React, {
  useState,
  useEffect,
  useRef,
  useContext,
  createContext,
} from "react";
import { createPortal } from "react-dom";
import { X, Film } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { api } from "./api";
const modalLayers: HTMLElement[] = [];
function syncModalLayers() {
  const top = modalLayers.at(-1);
  const app = document.getElementById("root");
  if (app) app.inert = !!top;
  for (const layer of modalLayers) {
    const backdrop = layer.parentElement;
    if (backdrop) backdrop.inert = layer !== top;
  }
}
let modalCount = 0;
let originalOverflow = "";
export const FeedbackContext = createContext<{
  busy: string;
  error: string;
  cancel?: () => void;
}>({ busy: "", error: "" });
export function Modal({
  title,
  close,
  children,
  wide = false,
  drawer = false,
  interactive = false,
  closeLabel = "关闭窗口",
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
  wide?: boolean;
  drawer?: boolean;
  interactive?: boolean;
  closeLabel?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  const feedback = useContext(FeedbackContext);
  const locked = !!feedback.busy && !interactive;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    if (!node) return;
    const focusable = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"],summary,a[href]',
        ),
      ).filter((e) => e.getClientRects().length > 0 && !e.matches(":disabled"));
    const first =
      node.querySelector<HTMLElement>("[autofocus]") ||
      focusable().find((e) => e.tagName !== "BUTTON") ||
      node;
    first.focus();
    const key = (e: KeyboardEvent) => {
      if (
        Array.from(document.querySelectorAll("[data-app-dialog]")).at(-1) !==
        node
      )
        return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (!lockedRef.current) closeRef.current();
      }
      if (e.key === "Tab") {
        const list = focusable();
        if (!list.length) {
          e.preventDefault();
          node.focus();
          return;
        }
        const index = list.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && index <= 0) {
          e.preventDefault();
          list.at(-1)?.focus();
        } else if (!e.shiftKey && (index === list.length - 1 || index < 0)) {
          e.preventDefault();
          list[0].focus();
        }
      }
    };
    document.addEventListener("keydown", key, true);
    modalLayers.push(node);
    syncModalLayers();
    if (modalCount++ === 0) {
      originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", key, true);
      const index = modalLayers.indexOf(node);
      if (index >= 0) modalLayers.splice(index, 1);
      syncModalLayers();
      if (--modalCount === 0) document.body.style.overflow = originalOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return createPortal(
    <div className={"backdrop " + (drawer ? "drawer-backdrop" : "")}>
      <section
        ref={ref}
        tabIndex={-1}
        data-app-dialog
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={drawer ? "drawer" : "modal " + (wide ? "wide" : "")}
      >
        <div className="row modal-head">
          <h2>{title}</h2>
          <button
            type="button"
            disabled={locked}
            aria-label={closeLabel}
            className="icon"
            onClick={close}
          >
            <X size={20} />
          </button>
        </div>
        {!interactive && feedback.error && (
          <p className="form-error" role="alert">
            {feedback.error}
          </p>
        )}
        {!interactive && feedback.busy && (
          <p className="working" role="status">
            正在{feedback.busy}，请稍候…
            {feedback.busy.includes("扫描") && feedback.cancel && (
              <button
                type="button"
                className="secondary"
                onClick={feedback.cancel}
              >
                取消扫描
              </button>
            )}
          </p>
        )}
        <fieldset className="dialog-body" disabled={locked}>
          {children}
        </fieldset>
      </section>
    </div>,
    document.body,
  );
}
type DialogRequest = {
  title: string;
  description?: string;
  initial?: string;
  confirmText?: string;
  kind: "text" | "confirm";
  resolve: (value: any) => void;
};
export function useDialogs() {
  const [request, setRequest] = useState<DialogRequest | null>(null);
  const [value, setValue] = useState("");
  function askText(
    title: string,
    initial = "",
    description = "",
  ): Promise<string | null> {
    setValue(initial);
    return new Promise((resolve) =>
      setRequest({ title, description, initial, kind: "text", resolve }),
    );
  }
  function askConfirm(
    description: string,
    title = "请确认",
    confirmText = "确认继续",
  ): Promise<boolean> {
    return new Promise((resolve) =>
      setRequest({ title, description, kind: "confirm", confirmText, resolve }),
    );
  }
  function finish(value: string | boolean | null) {
    const current = request;
    setRequest(null);
    current?.resolve(value);
  }
  const dialog = request && (
    <Modal
      title={request.title}
      close={() => finish(request.kind === "text" ? null : false)}
      interactive
    >
      {request.description && <p className="muted">{request.description}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (request.kind === "text" && !value.trim()) return;
          finish(request.kind === "text" ? value.trim() : true);
        }}
      >
        {request.kind === "text" && (
          <label>
            {request.title}
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
        )}
        <div className="dialog-footer">
          <button
            type="button"
            className="secondary"
            onClick={() => finish(request.kind === "text" ? null : false)}
          >
            取消
          </button>
          <button
            className="primary"
            disabled={request.kind === "text" && !value.trim()}
          >
            {request.confirmText || "保存"}
          </button>
        </div>
      </form>
    </Modal>
  );
  return { askText, askConfirm, dialog };
}
export function Cover({
  name,
  label,
  type = "personal",
}: {
  name: string | null;
  label: string;
  type?: string;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let live = true;
    if (name)
      api<string>("cover_path", { name })
        .then((p) => {
          if (live) setUrl(convertFileSrc(p));
        })
        .catch(() => {});
    else setUrl("");
    return () => {
      live = false;
    };
  }, [name]);
  return url ? (
    <img src={url} alt="影片封面" loading="lazy" onError={() => setUrl("")} />
  ) : (
    <div className={"placeholder " + type}>
      <Film size={42} />
      <span>{label || "PRIVATE COLLECTION"}</span>
    </div>
  );
}
export function ToggleList({
  values,
  selected,
  change,
}: {
  values: { id: string; name: string }[];
  selected: string[];
  change: (v: string[]) => void;
}) {
  return (
    <div className="tag-list">
      {values.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={selected.includes(t.id)}
          className={"tag " + (selected.includes(t.id) ? "picked" : "")}
          onClick={() =>
            change(
              selected.includes(t.id)
                ? selected.filter((v) => v !== t.id)
                : [...selected, t.id],
            )
          }
        >
          {t.name}
        </button>
      ))}
    </div>
  );
}
