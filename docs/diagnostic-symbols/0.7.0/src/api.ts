import { invoke, isTauri } from "@tauri-apps/api/core";
export const desktop = isTauri();
const traced = new Set(
  "scan cancel_scan add_root toggle_root save_item set_removed save_tag delete_tag save_settings bind_subtitle import_cover launch reveal rename_video backup restore_backup save_entity delete_entity merge_entity save_filter delete_filter batch_edit set_tag_group set_root_kind set_root_type separate_file detach_root relocate_root choose_primary relink_file queue_metadata job_action candidate apply_metadata fetch_cover inspect_media queue_local trim_cache export_diagnostics".split(
    " ",
  ),
);
function codeFrames(stack?: string) {
  if (!stack) return [];
  return Array.from(
    stack.matchAll(/\/assets\/index-[A-Za-z0-9_-]+\.js:(\d+):(\d+)/g),
  )
    .slice(0, 8)
    .map((m) => ({ line: +m[1], column: +m[2] }));
}
export function traceDiagnostic(
  kind: "start" | "success" | "error" | "ui_error" | "ready",
  command?: string,
  message?: string,
  durationMs?: number,
  stack?: string,
  exceptionKind?: string,
) {
  if (!desktop) return;
  void invoke("record_diagnostic", {
    entry: {
      kind,
      command,
      message: message?.slice(0, 8192),
      durationMs,
      frames: codeFrames(stack),
      exceptionKind,
    },
  }).catch(() => {});
}
export function installDiagnosticHooks() {
  if (!desktop) return;
  window.addEventListener("error", (event) =>
    traceDiagnostic(
      "ui_error",
      undefined,
      event.message,
      undefined,
      event.error?.stack,
      event.error?.name,
    ),
  );
  window.addEventListener("unhandledrejection", (event) =>
    traceDiagnostic(
      "ui_error",
      undefined,
      String(event.reason),
      undefined,
      event.reason?.stack,
      event.reason?.name,
    ),
  );
  traceDiagnostic("ready");
}
export async function api<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (!desktop) {
    if (["roots", "tags", "jobs", "file_choices"].includes(command))
      return [] as T;
    if (command === "catalog")
      return {
        performers: [],
        studios: [],
        tag_groups: [],
        saved_filters: [],
      } as T;
    if (command === "review_items") return { items: [], errors: [] } as T;
    if (command === "list_items") return { items: [], total: 0 } as T;
    if (command === "diagnostic_report")
      return {
        appVersion: "浏览器预览",
        environment: {},
        libraryStatus: {},
        events: [],
        reportKind: "preview",
      } as T;
    if (command === "get_settings")
      return {
        player: "",
        playerKind: "potplayer",
        providers: [],
      } as T;
    throw new Error("请在桌面版中使用本地文件功能。");
  }
  const start = performance.now();
  if (traced.has(command)) traceDiagnostic("start", command);
  try {
    const result = await invoke<T>(command, args);
    if (traced.has(command))
      traceDiagnostic(
        "success",
        command,
        undefined,
        Math.round(performance.now() - start),
      );
    return result;
  } catch (error) {
    if (command !== "record_diagnostic")
      traceDiagnostic(
        "error",
        command,
        String(error),
        Math.round(performance.now() - start),
        new Error().stack,
        "BackendError",
      );
    throw error;
  }
}
