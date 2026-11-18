import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Film,
  FolderPlus,
  Search,
  X,
  Heart,
  MoreHorizontal,
  Play,
  FolderOpen,
  CheckSquare,
  Tags,
  Subtitles,
  ImagePlus,
  RefreshCw,
  Settings as SettingsIcon,
  Library,
  HardDrive,
  Trash2,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  ListTodo,
  AlertCircle,
  Users,
  Download,
  Minus,
  Square,
  Copy,
} from "lucide-react";
import {
  api,
  desktop,
  installDiagnosticHooks,
  libraryApi,
  traceDiagnostic,
  type JobScope,
} from "./api";
import {
  JOB_PAGE_SIZE,
  PAGE_SIZE,
  useLibraryData,
  type RefreshTarget,
} from "./library-data";
import { Modal, Cover, ToggleList, FeedbackContext, useDialogs } from "./ui";
import {
  Item,
  Tag,
  Settings,
  MediaType,
  mediaNames,
  bytes,
  minutes,
  subtitleNames,
  Filters,
  normalizeFilters,
  Catalog,
  Entity,
  Provider,
} from "./types";
import { FilterSummary, FilmDetails, SelectionDialog } from "./workflows";
import { CompactSelect } from "./compact-select";
import { FilterPanel } from "./filter-panel";
import "./style.css";
import "./glass-theme.css";
import "./soft-theme.css";
const emptySettings: Settings = {
  player: "",
  playerKind: "potplayer",
  providers: [],
  scanMinutes: 30,
};
const allLibraryData: RefreshTarget[] = ["items", "roots", "catalog", "jobs"];
function readView() {
  try {
    const v = JSON.parse(localStorage.getItem("avlibrary-view") || "{}");
    return {
      size: [230, 280, 340].includes(v.size) ? v.size : 280,
      sort: ["activity", "added", "title", "rating", "duration"].includes(
        v.sort,
      )
        ? v.sort
        : "activity",
    };
  } catch {
    return { size: 280, sort: "activity" };
  }
}
function App() {
  const dialogs = useDialogs();
  const { askText, askConfirm } = dialogs;
  const [sort, setSort] = useState<string>(() => readView().sort);
  const [filterDraft, setFilterDraft] = useState<Filters>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterError, setFilterError] = useState("");
  const filterOrigin = useRef("");
  const filterButton = useRef<HTMLButtonElement>(null);
  const [actionError, setActionError] = useState("");
  const actionLock = useRef(false);
  const editorBaseline = useRef("");
  const settingsBaseline = useRef("");
  const [tagName, setTagName] = useState("");
  const [batchType, setBatchType] = useState("");
  const entityBaseline = useRef("");
  const [entityDraft, setEntityDraft] = useState<{
    id: string;
    name: string;
    aliases: string;
    groupId: string;
  } | null>(null);
  const [entityQuery, setEntityQuery] = useState("");

  const [query, setQuery] = useState(""),
    [type, setType] = useState(""),
    [removed, setRemoved] = useState(false),
    [page, setPage] = useState(0),
    [size, setSize] = useState<number>(() => readView().size),
    [filters, setFilters] = useState<Filters>({}),
    [panel, setPanel] = useState(""),
    [editing, setEditing] = useState<Item | null>(null),
    [settings, setSettings] = useState<Settings>(emptySettings),
    [busy, setBusy] = useState(""),
    [toast, setToast] = useState(""),
    [multi, setMulti] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [suggestionResults, setSuggestionResults] = useState<{
      query: string;
      items: Item[];
    }>(),
    [focus, setFocus] = useState(false),
    [previous, setPrevious] = useState<{
      type: string;
      filters: Filters;
      query: string;
      page: number;
      removed: boolean;
    } | null>(null),
    [review, setReview] = useState<{ items: any[]; errors: any[] }>({
      items: [],
      errors: [],
    }),
    [rootDraft, setRootDraft] = useState({
      path: "",
      mediaType: "jav",
      kind: "video",
    }),
    [batchTags, setBatchTags] = useState<string[]>([]),
    [entityTab, setEntityTab] = useState("tags"),
    [files, setFiles] = useState<any[]>([]),
    [scrapeIds, setScrapeIds] = useState<string[]>([]),
    [scrapeProvider, setScrapeProvider] = useState(""),
    [scrapeQuery, setScrapeQuery] = useState("");
  const [actorText, setActorText] = useState("");
  const actorBaseline = useRef("");
  const [searchQuery, setSearchQuery] = useState("");
  const [jobTab, setJobTab] = useState<JobScope>("active"),
    [jobPage, setJobPage] = useState(0);
  const [subPage, setSubPage] = useState(0);
  const [resumePlayback, setResumePlayback] = useState<Item | null>(null);
  const [playing, setPlaying] = useState("");
  const playLock = useRef(false);
  const [detail, setDetail] = useState<Item | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [systemInfo, setSystemInfo] = useState<any>(null);
  const [highlight, setHighlight] = useState("");
  const [diagnostic, setDiagnostic] = useState<Record<string, any> | null>(
    null,
  );
  const [subtitleIssue, setSubtitleIssue] = useState<{
    item: Item;
    message: string;
  } | null>(null);
  const [subChoices, setSubChoices] = useState<
      { id: string; path: string; available: boolean }[]
    >([]),
    [subQuery, setSubQuery] = useState("");
  const scroll = useRef(0);
  const {
    items,
    total,
    loading,
    loadError,
    roots,
    tags,
    catalog,
    referenceError,
    jobs,
    jobsLoading,
    jobsError,
    refresh,
    resetOrder,
  } = useLibraryData(
    {
      query: searchQuery,
      mediaType: type,
      removed,
      offset: page * PAGE_SIZE,
      limit: PAGE_SIZE,
      filters: { ...filters, sort },
    },
    query === searchQuery,
    panel === "jobs",
    jobTab,
    jobPage,
    setPage,
    setJobPage,
  );
  const suggestions =
    suggestionResults?.query === query ? suggestionResults.items : [];
  const offlineRoots = new Set(roots.filter((root) => !root.online).map((root) => root.id));
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(query), 220);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    try {
      localStorage.setItem("avlibrary-view", JSON.stringify({ size, sort }));
    } catch {}
  }, [size, sort]);
  useEffect(() => setActionError(""), [panel, editing?.id, entityDraft?.name]);
  useEffect(() => {
    if (!focus || !query.trim()) return;
    let live = true;
    const timer = setTimeout(() => {
      libraryApi
        .list({
          query,
          mediaType: "",
          removed: false,
          offset: 0,
          limit: 8,
          filters: {},
        })
        .then((p) => {
          if (live) setSuggestionResults({ query, items: p.items });
        })
        .catch(() => {});
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [focus, query]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 5500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  async function action(
    label: string,
    fn: () => Promise<unknown>,
    targets: false | RefreshTarget[] = ["items"],
  ) {
    if (actionLock.current) return false;
    actionLock.current = true;
    setActionError("");
    setBusy(label);
    try {
      const result = await fn();
      if (result === false) return false;
      if (targets) {
        try {
          await refresh(...targets);
        } catch {
          setToast(label + "已完成，部分显示未刷新。请重试刷新。");
          return true;
        }
      }
      setToast(typeof result === "string" ? result : label + "完成");
      return true;
    } catch (e) {
      if (e instanceof Error)
        traceDiagnostic(
          "ui_error",
          undefined,
          e.message,
          undefined,
          e.stack,
          e.name,
        );
      setActionError(String(e));
      setToast(String(e));
      return false;
    } finally {
      actionLock.current = false;
      setBusy("");
    }
  }
  async function openDiagnostics() {
    setPanel("diagnostics");
    await action(
      "读取诊断",
      async () => setDiagnostic(await api("diagnostic_report")),
      false,
    );
  }
  async function exportDiagnostic() {
    try {
      const path = await save({
        title: "保存诊断文件",
        defaultPath: "映库-诊断-" + Date.now() + ".json",
        filters: [{ name: "诊断文件", extensions: ["json"] }],
      });
      if (path)
        await action(
          "导出诊断文件",
          () => api("export_diagnostics", { path }),
          false,
        );
    } catch (error) {
      traceDiagnostic(
        "error",
        "export_diagnostics",
        String(error),
        undefined,
        new Error().stack,
        "BackendError",
      );
      setToast(String(error));
    }
  }
  async function loadSettings() {
    const config = await libraryApi.getSettings();
    const value = {
      ...emptySettings,
      ...config,
      providers: config.providers || [],
    };
    settingsBaseline.current = JSON.stringify(value);
    setSettings(value);
    void api("system_status")
      .then(setSystemInfo)
      .catch(() => {});
    return config;
  }
  async function dialog(opts: any) {
    try {
      return await open(opts);
    } catch (e) {
      traceDiagnostic(
        "ui_error",
        undefined,
        String(e),
        undefined,
        new Error().stack,
        "BackendError",
      );
      setToast(String(e));
      setActionError(String(e));
      return null;
    }
  }
  async function addRoot() {
    const path = await dialog({
      directory: true,
      title: "选择媒体或字幕文件夹",
    });
    if (typeof path === "string") {
      setRootDraft({ ...rootDraft, path });
      setPanel("add-root");
    }
  }
  async function play(item: Item, withoutSubtitle = false) {
    if (actionLock.current || playLock.current) return;
    playLock.current = true;
    setPlaying(item.id);
    try {
      await libraryApi.launch(item.id, withoutSubtitle);
      setToast("已发出播放请求");
    } catch (e) {
      const message = String(e);
      if (
        !withoutSubtitle &&
        (message.includes("选中字幕") || message.includes("系统默认程序"))
      ) {
        setSubtitleIssue({ item, message });
      } else {
        setToast(message);
      }
    } finally {
      playLock.current = false;
      setPlaying("");
    }
  }
  function pick(id: string) {
    setSelected((v) =>
      v.includes(id) ? v.filter((i) => i !== id) : [...v, id],
    );
  }
  function locate(item: Item) {
    if (items.some((i) => i.id === item.id)) {
      setFocus(false);
      setHighlight(item.id);
      document
        .getElementById("item-" + item.id)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    setPrevious({ type, filters, query, page, removed });
    scroll.current = window.scrollY;
    setType("");
    setRemoved(false);
    setPage(0);
    setFilters({ targetId: item.id });
    setFocus(false);
  }
  async function edit(item: Item) {
    const value = {
      ...item,
      performers: item.performers || [],
      locks: item.locks || [],
      description: item.description || "",
      studio: item.studio || "",
      releaseDate: item.releaseDate || "",
    };
    editorBaseline.current = JSON.stringify(value);
    setEditing(value);
    setActorText(value.performers.join("\n"));
    actorBaseline.current = value.performers.join("\n");
    setTagName("");
  }
  async function upload(item: Item, kind: "subtitle" | "cover") {
    const path = await dialog({
      multiple: false,
      filters: [
        {
          name: kind === "subtitle" ? "字幕" : "图片",
          extensions:
            kind === "subtitle"
              ? ["srt", "ass", "ssa", "vtt"]
              : ["jpg", "jpeg", "png", "webp"],
        },
      ],
    });
    if (typeof path === "string")
      await action(kind === "subtitle" ? "绑定字幕" : "设置封面", async () => {
        await api(kind === "subtitle" ? "bind_subtitle" : "import_cover", {
          itemId: item.id,
          path,
        });
        setEditing(null);
      });
  }
  async function scrape(ids: string[]) {
    const config = await loadSettings();
    setScrapeIds(ids);
    setScrapeProvider(config.providers?.find((p) => p.enabled)?.id || "");
    setScrapeQuery("");
    setPanel("scrape");
  }
  async function reviewOpen() {
    setReview(await api("review_items"));
    setPanel("review");
  }
  async function fileOpen(item: Item) {
    setFiles(await api("file_choices", { itemId: item.id }));
    setPanel("files");
  }
  async function batch(change: any) {
    await action("批量更新", () =>
      api("batch_edit", {
        change: {
          ids: selected,
          addTags: [],
          removeTags: [],
          mediaType: null,
          favorite: null,
          ...change,
        },
      }),
    );
  }
  const setFilter = (value: Filters) => {
    setFilters(normalizeFilters(value));
    setPage(0);
  };
  async function closeEditor() {
    if (busy) return;
    if (
      editing &&
      (JSON.stringify(editing) !== editorBaseline.current ||
        actorText !== actorBaseline.current) &&
      !(await askConfirm(
        "你修改的影片资料尚未保存。放弃这些修改？",
        "尚未保存",
        "放弃修改",
      ))
    )
      return;
    setEditing(null);
  }
  async function closeSettings() {
    if (busy) return;
    if (
      JSON.stringify(settings) !== settingsBaseline.current &&
      !(await askConfirm(
        "播放器、资料来源或扫描设置尚未保存。放弃这些修改？",
        "尚未保存",
        "放弃修改",
      ))
    )
      return;
    setResumePlayback(null);
    setPanel("");
  }
  async function createEditorTag() {
    const name = tagName.trim();
    if (!name || !editing) return;
    const current = {
      ...editing,
      performers: actorText
        .split("\n")
        .map((v) => v.trim())
        .filter(Boolean),
    };
    await action(
      "创建并选中标签",
      async () => {
        let tag = tags.find(
          (t) => t.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
        );
        if (!tag) {
          tag = { id: crypto.randomUUID(), name, groupId: null };
          await api("save_tag", { tag });
        }
        setEditing({
          ...current,
          tags: Array.from(new Set([...current.tags, tag.id])),
        });
        setTagName("");
      },
      ["catalog"],
    );
  }
  async function editorOperation(fn: () => Promise<unknown>) {
    if (
      editing &&
      (JSON.stringify(editing) !== editorBaseline.current ||
        actorText !== actorBaseline.current)
    ) {
      if (
        !(await askConfirm(
          "当前影片有未保存的修改。先保存这些修改，再继续操作？",
          "先保存影片",
          "保存并继续",
        ))
      )
        return;
      const current = {
        ...editing,
        performers: actorText
          .split("\n")
          .map((v) => v.trim())
          .filter(Boolean),
      };
      const ok = await action(
        "保存影片",
        async () => {
          if (!current.title.trim()) throw new Error("显示名称不能为空");
          await libraryApi.saveItem(current);
        },
        ["items", "catalog"],
      );
      if (!ok) return;
      try {
        const p = await libraryApi.list({
          query: "",
          mediaType: "",
          removed: current.removed,
          offset: 0,
          limit: 1,
          filters: { targetId: current.id },
        });
        const next = p.items[0];
        if (!next) throw new Error("已保存影片不在当前资料库中");
        await edit(next);
      } catch {
        setEditing(null);
        setToast("影片已保存。请刷新资料库并重新打开编辑，继续刚才的操作。");
        return;
      }
    }
    try {
      await fn();
    } catch (error) {
      setActionError(String(error));
      setToast(String(error));
    }
  }
  function openEntityDraft(value: NonNullable<typeof entityDraft>) {
    entityBaseline.current = JSON.stringify(value);
    setEntityDraft(value);
  }
  async function discardEntityDraft() {
    return (
      !entityDraft ||
      JSON.stringify(entityDraft) === entityBaseline.current ||
      (await askConfirm(
        "当前管理项目的修改尚未保存。放弃这些修改？",
        "尚未保存",
        "放弃修改",
      ))
    );
  }
  async function closeEntities() {
    if (await discardEntityDraft()) {
      setEntityDraft(null);
      setPanel("");
    }
  }
  const exitCheck = useRef<() => Promise<boolean>>(async () => true);
  const exitPending = useRef(false);
  exitCheck.current = async () => {
    if (actionLock.current) {
      setToast("操作正在进行，请完成或取消后再退出");
      return false;
    }
    if (exitPending.current || dialogs.dialog) return false;
    const dirty =
      (!!editing &&
        (JSON.stringify(editing) !== editorBaseline.current ||
          actorText !== actorBaseline.current)) ||
      (panel === "settings" &&
        JSON.stringify(settings) !== settingsBaseline.current) ||
      (!!entityDraft && JSON.stringify(entityDraft) !== entityBaseline.current);
    if (!dirty) return true;
    exitPending.current = true;
    try {
      return await askConfirm(
        "有尚未保存的修改。放弃修改并退出？选择取消可回到表单保存。",
        "退出映库",
        "放弃并退出",
      );
    } finally {
      exitPending.current = false;
    }
  };
  useEffect(() => {
    if (!desktop) return;
    let off: (() => void) | undefined,
      disposed = false;
    try {
      getCurrentWindow()
        .onCloseRequested(async (event) => {
          if (!(await exitCheck.current())) event.preventDefault();
        })
        .then((fn) => {
          if (disposed) fn();
          else off = fn;
        })
        .catch((e) => setToast("退出保护初始化失败：" + String(e)));
    } catch {}
    return () => {
      disposed = true;
      off?.();
    };
  }, []);

  useEffect(() => {
    if (!desktop) return;
    document.body.classList.add("native-window-body");
    return () => document.body.classList.remove("native-window-body");
  }, []);
  useEffect(() => {
    if (!desktop) return;
    const win = getCurrentWindow();
    let disposed = false;
    let off: (() => void) | undefined;
    const update = () => {
      void win
        .isMaximized()
        .then((value) => {
          if (!disposed) setMaximized(value);
        })
        .catch(() => {});
    };
    update();
    void win
      .onResized(update)
      .then((fn) => {
        if (disposed) fn();
        else off = fn;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      off?.();
    };
  }, []);
  function windowAction(operation: "minimize" | "toggleMaximize" | "close") {
    void getCurrentWindow()
      [operation]()
      .catch((error) => setToast("窗口操作失败：" + String(error)));
  }

  return (
    <FeedbackContext.Provider
      value={{
        busy,
        error: actionError,
        cancel: () => {
          void libraryApi.cancelScan().catch((e) => setActionError(String(e)));
        },
      }}
    >
      <div className={"app" + (desktop ? " native-window" : "")}>
        {desktop &&
          createPortal(
            <div className="window-titlebar">
              <div
                className="window-drag"
                data-tauri-drag-region="deep"
                aria-label="拖动窗口"
              >
                <Film size={15} aria-hidden="true" />
                <span>映库</span>
              </div>
              <div className="window-controls">
                <button
                  type="button"
                  aria-label="最小化窗口"
                  title="最小化"
                  onClick={() => windowAction("minimize")}
                >
                  <Minus size={16} />
                </button>
                <button
                  type="button"
                  aria-label={maximized ? "还原窗口" : "最大化窗口"}
                  title={maximized ? "还原" : "最大化"}
                  onClick={() => windowAction("toggleMaximize")}
                >
                  {maximized ? <Copy size={14} /> : <Square size={13} />}
                </button>
                <button
                  type="button"
                  aria-label="关闭映库"
                  title="关闭"
                  className="window-close"
                  onClick={() => windowAction("close")}
                >
                  <X size={17} />
                </button>
              </div>
            </div>,
            document.body,
          )}
        <aside className="sidebar">
          <button
            type="button"
            className="brand"
            aria-label="返回影片库"
            onClick={() => {
              setQuery("");
              setType("");
              setFilter({});
              setRemoved(false);
            }}
          >
            <span className="brand-icon">
              <Film size={23} />
            </span>
            <span>映库</span>
          </button>
          <div className="section-label">资料库</div>
          <nav aria-label="影片库">
            <button
              className={!type && !removed ? "active" : ""}
              aria-current={!type && !removed ? "page" : undefined}
              onClick={() => {
                setType("");
                setRemoved(false);
                setPage(0);
              }}
            >
              <Library size={18} />
              全部影片
            </button>
            {Object.entries(mediaNames).map(([k, v]) => (
              <button
                className={type === k && !removed ? "active" : ""}
                aria-current={type === k && !removed ? "page" : undefined}
                key={k}
                onClick={() => {
                  setType(k);
                  setRemoved(false);
                  setPage(0);
                }}
              >
                <Film size={18} />
                {v}
              </button>
            ))}
            <button
              className={filters.favorite ? "active" : ""}
              aria-pressed={!!filters.favorite}
              onClick={() =>
                setFilter({ ...filters, favorite: !filters.favorite })
              }
            >
              <Heart size={18} />
              我的收藏
            </button>
            <button
              className={removed ? "active" : ""}
              aria-current={removed ? "page" : undefined}
              onClick={() => {
                setRemoved(!removed);
                setPage(0);
              }}
            >
              <Trash2 size={17} />
              已移出项目
            </button>
          </nav>
          <div className="section-label row">
            个人标签
            <button
              aria-label="管理标签"
              className="icon"
              onClick={() => {
                setEntityTab("tags");
                setPanel("tag-management");
              }}
            >
              <Tags size={14} />
              管理
            </button>
          </div>
          <div className="tag-list">
            {!tags.length && (
              <button
                className="tag"
                onClick={() => {
                  setEntityTab("tags");
                  setPanel("tag-management");
                  openEntityDraft({
                    id: crypto.randomUUID(),
                    name: "",
                    aliases: "",
                    groupId: "",
                  });
                }}
              >
                ＋ 创建第一个标签
              </button>
            )}
            {tags.slice(0, 15).map((t) => (
              <button
                className={
                  "tag " + (filters.tags?.includes(t.id) ? "picked" : "")
                }
                key={t.id}
                aria-pressed={!!filters.tags?.includes(t.id)}
                onClick={() =>
                  setFilter({
                    ...filters,
                    tags: filters.tags?.includes(t.id)
                      ? filters.tags.filter((i) => i !== t.id)
                      : [...(filters.tags || []), t.id],
                  })
                }
              >
                {t.name}
              </button>
            ))}
          </div>
          <div className="section-label management-label">管理</div>
          <nav className="sidebar-bottom" aria-label="资料与系统管理">
            <button
              onClick={() => {
                setEntityTab("performers");
                setPanel("entities");
              }}
            >
              <Users size={17} />
              演员与厂商
            </button>
            <button onClick={() => setPanel("roots")}>
              <HardDrive size={17} />
              文件夹管理<span>{roots.length}</span>
            </button>
            <button onClick={() => setPanel("jobs")}>
              <ListTodo size={17} />
              后台任务
            </button>
            <button
              onClick={() => reviewOpen().catch((e) => setToast(String(e)))}
            >
              <AlertCircle size={17} />
              待确认中心
            </button>

            <button
              onClick={() =>
                loadSettings()
                  .then(() => setPanel("settings"))
                  .catch((e) => setToast(String(e)))
              }
            >
              <SettingsIcon size={17} />
              播放器与资料来源
            </button>
            <button onClick={() => setPanel("backup")}>
              <Download size={17} />
              备份与恢复
            </button>
            <button onClick={() => void openDiagnostics()}>
              <AlertCircle size={17} />
              诊断与日志
            </button>
          </nav>
        </aside>
        <main>
          <header className="library-header">
            <h1>
              {removed
                ? "已移出项目"
                : type
                  ? mediaNames[type as MediaType]
                  : "影片资料库"}
            </h1>
            <div
              className="search-wrap"
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node))
                  setFocus(false);
              }}
            >
              <Search size={19} />
              <input
                aria-label="搜索影片"
                aria-expanded={focus && suggestions.length > 0}
                aria-controls="search-suggestions"
                placeholder="搜索番号、片名、演员、标签…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                  if (filters.targetId) setFilters({});
                }}
                onFocus={() => setFocus(true)}
                onKeyDown={(e) => {
                  if (e.key === "Escape" || e.key === "Enter") {
                    if (e.key === "Enter") setSearchQuery(query);
                    setFocus(false);
                  }
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    document
                      .querySelector<HTMLButtonElement>(
                        "#search-suggestions button",
                      )
                      ?.focus();
                  }
                }}
              />
              {query && (
                <button
                  className="icon"
                  aria-label="清空搜索"
                  onClick={() => {
                    setQuery("");
                    setPage(0);
                    if (filters.targetId)
                      setFilter({ ...filters, targetId: undefined });
                    setFocus(false);
                  }}
                >
                  <X size={16} />
                </button>
              )}
              {focus && suggestions.length > 0 && (
                <div className="suggestions" id="search-suggestions">
                  {suggestions.map((i) => (
                    <button key={i.id} onClick={() => locate(i)}>
                      <Film size={18} />
                      <span>
                        {i.title}
                        <small>{i.code || mediaNames[i.mediaType]}</small>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button className="primary" onClick={addRoot}>
              <FolderPlus size={17} />
              添加文件夹
            </button>
          </header>
          <section className="content">
            {!desktop && (
              <div className="notice">
                浏览器界面预览 · 本地文件与播放需要桌面版运行。
              </div>
            )}
            {roots.some((r) => r.enabled && !r.online) && (
              <div className="notice">
                部分文件夹离线或路径已变化。
                <button onClick={() => setPanel("roots")}>
                  检查目录与迁移位置
                </button>
              </div>
            )}
            {previous && (
              <div className="notice">
                已定位到搜索影片{" "}
                <button
                  onClick={() => {
                    setType(previous.type);
                    setQuery(previous.query);
                    setSearchQuery(previous.query);
                    setFilters(previous.filters);
                    setRemoved(previous.removed);
                    setPage(previous.page);
                    setPrevious(null);
                    setTimeout(() => window.scrollTo(0, scroll.current), 100);
                  }}
                >
                  恢复原筛选
                </button>
              </div>
            )}
            <div className="toolbar">
              <div className="row toolbar-actions">
                <button
                  className="filter-chip"
                  onClick={() => {
                    setMulti(!multi);
                    setSelected([]);
                  }}
                >
                  <CheckSquare size={15} />
                  {multi ? "退出多选" : "批量管理"}
                </button>
                <button
                  ref={filterButton}
                  className={
                    "filter-chip" + (filterOpen ? " filter-active" : "")
                  }
                  aria-label="筛选影片"
                  aria-expanded={filterOpen}
                  aria-controls="library-filter-panel"
                  onClick={() => {
                    if (filterOpen) {
                      setFilterOpen(false);
                      setFilterError("");
                    } else {
                      setFilterDraft(structuredClone(filters));
                      filterOrigin.current = JSON.stringify(filters);
                      setFilterError("");
                      setFilterOpen(true);
                    }
                  }}
                >
                  <SlidersHorizontal size={15} /> 筛选
                  {Object.keys(filters).length > 0 ? " · 已应用" : ""}
                </button>
                {Object.keys(filters).length > 0 && (
                  <button
                    className="icon"
                    aria-label="清除筛选"
                    onClick={() => setFilter({})}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              <div className="row">
                <div className="view-control">
                  <span>排序</span>
                  <CompactSelect
                    label="影片排序"
                    value={sort}
                    onChange={(value) => {
                      setSort(value);
                      setPage(0);
                    }}
                    options={[
                      { value: "activity", label: "最近活动" },
                      { value: "added", label: "最近入库" },
                      { value: "title", label: "名称 A–Z" },
                      { value: "rating", label: "评分从高到低" },
                      { value: "duration", label: "时长从长到短" },
                    ]}
                  />
                </div>
                <div className="view-control">
                  <span>卡片大小</span>
                  <CompactSelect
                    label="卡片大小"
                    value={String(size)}
                    onChange={(value) => setSize(Number(value))}
                    options={[
                      { value: "230", label: "小" },
                      { value: "280", label: "中" },
                      { value: "340", label: "大" },
                    ]}
                  />
                </div>
                <button
                  className="secondary"
                  onClick={() =>
                    action(
                      "刷新资料库",
                      async () => {
                        resetOrder();
                        await refresh(...allLibraryData);
                      },
                      false,
                    )
                  }
                >
                  <RefreshCw size={15} />
                  刷新
                </button>
              </div>
            </div>
            {filterOpen && (
              <div id="library-filter-panel">
                <FilterPanel
                  draft={filterDraft}
                  setDraft={(value) => {
                    setFilterDraft(value);
                    setFilterError("");
                  }}
                  tags={tags}
                  catalog={catalog}
                  error={filterError}
                  stale={filterOrigin.current !== JSON.stringify(filters)}
                  reload={() => {
                    setFilterDraft(structuredClone(filters));
                    filterOrigin.current = JSON.stringify(filters);
                    setFilterError("");
                  }}
                  cancel={() => {
                    setFilterOpen(false);
                    setFilterError("");
                    filterButton.current?.focus();
                  }}
                  apply={() =>
                    void (async () => {
                      const { ratingMin, ratingMax, durationMin, durationMax } =
                        filterDraft;
                      if (
                        [ratingMin, ratingMax].some(
                          (value) =>
                            value !== undefined &&
                            (!Number.isInteger(value) ||
                              value < 1 ||
                              value > 5),
                        ) ||
                        [durationMin, durationMax].some(
                          (value) =>
                            value !== undefined &&
                            (!Number.isFinite(value) || value < 0),
                        )
                      ) {
                        setFilterError("评分请输入 1–5 的整数，时长不能小于 0");
                        return;
                      }
                      if (
                        (ratingMin ?? 1) > (ratingMax ?? 5) ||
                        (durationMin ?? 0) > (durationMax ?? Infinity)
                      ) {
                        setFilterError("筛选下限不能大于上限");
                        return;
                      }
                      if (
                        filterOrigin.current !== JSON.stringify(filters) &&
                        !(await askConfirm(
                          "筛选条件已在其他位置变更。应用当前面板中的条件会覆盖这些更改，继续吗？",
                          "筛选条件已变更",
                          "继续应用",
                        ))
                      )
                        return;
                      setFilter(filterDraft);
                      setFilterOpen(false);
                      setFilterError("");
                      filterButton.current?.focus();
                    })()
                  }
                  save={() =>
                    void (async () => {
                      const name = await askText("常用条件名称");
                      if (name)
                        await action(
                          "保存筛选",
                          () =>
                            api("save_filter", {
                              key:
                                catalog.saved_filters.find(
                                  (f) => f.name === name,
                                )?.id || crypto.randomUUID(),
                              name,
                              value: filterDraft,
                            }),
                          ["catalog"],
                        );
                    })()
                  }
                  removeSaved={(entry) =>
                    void action(
                      "删除保存条件",
                      () => api("delete_filter", { key: entry.id }),
                      ["catalog"],
                    )
                  }
                />
              </div>
            )}
            {multi && (
              <div className="bulk-bar row">
                <span>已选 {selected.length} 部（跨页保留）</span>
                <button
                  disabled={!selected.length}
                  onClick={() => setSelected([])}
                >
                  清空选择
                </button>
                <button
                  disabled={!selected.length}
                  onClick={() => setPanel("selection")}
                >
                  查看已选影片
                </button>
                <button
                  onClick={() =>
                    setSelected((v) =>
                      Array.from(new Set([...v, ...items.map((i) => i.id)])),
                    )
                  }
                >
                  选中本页
                </button>
                <button
                  disabled={!selected.length}
                  onClick={() => {
                    setBatchTags([]);
                    setBatchType("");
                    setPanel("batch");
                  }}
                >
                  批量编辑
                </button>
                <button
                  disabled={!selected.length}
                  onClick={() =>
                    scrape(selected).catch((e) => setToast(String(e)))
                  }
                >
                  获取资料
                </button>
                <button
                  disabled={!selected.length}
                  onClick={async () => {
                    if (
                      await askConfirm(
                        `将选中的 ${selected.length} 部影片${removed ? "恢复到资料库" : "移出资料库"}？视频文件和个人资料会保留。`,
                        "确认批量操作",
                      )
                    ) {
                      const ok = await action("移出/恢复", () =>
                        api("set_removed", {
                          ids: selected,
                          removed: !removed,
                        }),
                      );
                      if (ok) setSelected([]);
                    }
                  }}
                >
                  {removed ? "恢复" : "移出库"}
                </button>
              </div>
            )}
            {(loadError || referenceError) && (
              <div className="form-error" role="alert">
                读取资料失败：{loadError || referenceError}
                <button
                  onClick={() => {
                    void refresh("items", "catalog", "roots").catch(() => {});
                  }}
                >
                  重试
                </button>
              </div>
            )}
            <div className="library-results">
              <p role="status">
                {loading
                  ? "正在读取资料…"
                  : loadError && !items.length
                    ? ""
                    : `${total} 部影片`}
              </p>
              <FilterSummary
                filters={filters}
                tags={tags}
                catalog={catalog}
                clear={(key) =>
                  setFilter({
                    ...filters,
                    [key]: undefined,
                    ...(key === "tags" ? { allTags: undefined } : {}),
                    ...(key === "performers"
                      ? { allPerformers: undefined }
                      : {}),
                  })
                }
              />
            </div>
            {items.length ? (
              <div
                className="grid"
                style={{
                  gridTemplateColumns:
                    "repeat(auto-fill,minmax(" + size + "px,1fr))",
                }}
              >
                {items.map((item) => (
                  <article
                    key={item.id}
                    id={"item-" + item.id}
                    className={
                      "card " +
                      (selected.includes(item.id) ? "selected " : "") +
                      (filters.targetId === item.id || highlight === item.id
                        ? "highlight"
                        : "")
                    }
                  >
                    <div className="art">
                      <Cover
                        name={item.cover}
                        label={item.code}
                        type={item.mediaType}
                      />
                      <span className="media-badge">
                        {mediaNames[item.mediaType]}
                      </span>
                      <button
                        type="button"
                        className="play-overlay"
                        aria-label={
                          (multi ? "切换选择 " : "播放 ") + item.title
                        }
                        aria-busy={playing === item.id}
                        disabled={!multi && (!!playing || !!busy)}
                        onClick={() => (multi ? pick(item.id) : play(item))}
                      >
                        <span>
                          {playing === item.id ? (
                            <RefreshCw size={20} className="spin" />
                          ) : multi ? (
                            <CheckSquare size={20} />
                          ) : (
                            <Play size={20} fill="currentColor" />
                          )}
                        </span>
                      </button>
                      {multi && (
                        <input
                          className="card-check"
                          type="checkbox"
                          aria-label={"选择 " + item.title}
                          checked={selected.includes(item.id)}
                          onChange={() => pick(item.id)}
                        />
                      )}
                      <button
                        className={"favorite " + (item.favorite ? "on" : "")}
                        aria-label="收藏"
                        aria-pressed={item.favorite}
                        disabled={!!busy}
                        onClick={() =>
                          action("更新收藏", () =>
                            libraryApi.saveItem({
                              ...item,
                              favorite: !item.favorite,
                            }),
                          )
                        }
                      >
                        <Heart
                          size={18}
                          fill={item.favorite ? "currentColor" : "none"}
                        />
                      </button>
                    </div>
                    <div className="card-body">
                      <div className="row title-row">
                        <h2 title={item.title}>
                          <button
                            className="title-button"
                            onClick={() => setDetail(item)}
                          >
                            {item.title}
                          </button>
                        </h2>
                        <button
                          className="icon"
                          aria-label={"编辑 " + item.title}
                          onClick={() => edit(item)}
                        >
                          <MoreHorizontal size={20} />
                        </button>
                      </div>
                      <div className="meta-line">
                        <span>{item.code || "本地影片"}</span>
                        <span>
                          {minutes(item.duration)} · {bytes(item.size)}
                        </span>
                      </div>
                      <div
                        className="people-line"
                        title={[...(item.performers || []), item.studio]
                          .filter(Boolean)
                          .join(" · ")}
                      >
                        {item.performers?.join(" / ") ||
                          item.studio ||
                          "资料待补充"}
                      </div>
                      <div className="stars">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            aria-label={n + " 星"}
                            key={n}
                            aria-pressed={item.rating === n}
                            disabled={!!busy}
                            className={(item.rating || 0) >= n ? "lit" : ""}
                            onClick={() =>
                              action("更新评分", () =>
                                libraryApi.saveItem({
                                  ...item,
                                  rating: item.rating === n ? null : n,
                                }),
                              )
                            }
                          >
                            ★
                          </button>
                        ))}
                        <span>
                          {item.rating ? item.rating + ".0" : "未评分"}
                        </span>
                      </div>
                      <div className="card-footer">
                        <span
                          className={
                            "subtitle-state " + (item.subtitle ? "has-sub" : "")
                          }
                        >
                          <Subtitles size={13} />
                          {item.subtitleConfirmation === "needs_review"
                            ? "字幕待确认"
                            : subtitleNames[item.subtitleState] ||
                              (item.subtitle ? "外挂已选" : "未选外挂")}
                        </span>
                        {(!item.available || offlineRoots.has(item.rootId)) && (
                          <button
                            type="button"
                            className="offline"
                            aria-label={"核查离线影片 " + item.title}
                            onClick={() => edit(item)}
                          >
                            离线 · 核查
                          </button>
                        )}
                        {item.tags.slice(0, 2).map((t) => (
                          <span className="tiny-tag" key={t}>
                            {tags.find((v) => v.id === t)?.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty" hidden={loading || !!loadError}>
                <div className="empty-icon">
                  <Film size={40} />
                </div>
                <h2>
                  {removed
                    ? "暂无移出项目"
                    : query || Object.keys(filters).length
                      ? "没有找到匹配影片"
                      : "从一个文件夹开始"}
                </h2>
                <p>
                  {removed
                    ? "移出的影片会保留个人资料，可在这里恢复。"
                    : query || Object.keys(filters).length || type
                      ? "可以清除搜索和筛选条件，或切换到全部影片。"
                      : "添加本地影片，建立属于你的私人资料库。先扫描本地，联网资料由你手动获取。"}
                </p>
                {query || Object.keys(filters).length || type ? (
                  <button
                    className="secondary"
                    onClick={() => {
                      setQuery("");
                      setFilter({});
                      setType("");
                      setPage(0);
                    }}
                  >
                    查看全部影片
                  </button>
                ) : removed ? (
                  <button
                    className="secondary"
                    onClick={() => {
                      setRemoved(false);
                      setType("");
                      setPage(0);
                    }}
                  >
                    返回影片库
                  </button>
                ) : (
                  <button className="primary" onClick={addRoot}>
                    <FolderPlus size={17} />
                    添加文件夹
                  </button>
                )}
              </div>
            )}
            <footer>
              <span>
                显示 {items.length} / {total} 部
              </span>
              <div className="row">
                <button
                  className="icon"
                  aria-label="上一页"
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeft size={17} />
                </button>
                <span>{page + 1}</span>
                <button
                  className="icon"
                  aria-label="下一页"
                  disabled={(page + 1) * 60 >= total}
                  onClick={() => setPage(page + 1)}
                >
                  <ChevronRight size={17} />
                </button>
              </div>
              <span>原始文件保留在原位置</span>
            </footer>
          </section>
        </main>
        {busy && (
          <div className="busy">
            <RefreshCw className="spin" size={16} />
            {busy}…
            {busy.includes("扫描") && (
              <button
                onClick={() =>
                  void libraryApi
                    .cancelScan()
                    .catch((error) => setToast(String(error)))
                }
              >
                取消扫描
              </button>
            )}
          </div>
        )}
        {toast && (
          <div className="toast" role="status" onClick={() => setToast("")}>
            {toast}
          </div>
        )}
        {detail && (
          <FilmDetails
            item={detail}
            close={() => setDetail(null)}
            play={() => {
              void play(detail);
            }}
            edit={() => {
              void edit(detail);
              setDetail(null);
            }}
          />
        )}
        {editing && (
          <Modal
            title="编辑影片"
            close={closeEditor}
            drawer
            closeLabel="关闭编辑"
          >
            <p className="muted path">{editing.path}</p>
            {actionError.includes("资料已被其他任务修改") && (
              <button
                className="secondary"
                onClick={() =>
                  action(
                    "重新核对版本",
                    async () => {
                      const p = await libraryApi.list({
                        query: "",
                        mediaType: "",
                        removed: editing.removed,
                        offset: 0,
                        limit: 1,
                        filters: { targetId: editing.id },
                      });
                      if (!p.items[0]) throw new Error("影片已不存在");
                      if (
                        await askConfirm(
                          "当前草稿将保留。再次保存会以草稿中的资料为准覆盖最新资料，是否继续？",
                          "保留草稿重新编辑",
                          "保留草稿",
                        )
                      ) {
                        setEditing({
                          ...editing,
                          revision: p.items[0].revision,
                        });
                        return "已保留草稿，请核对后保存";
                      }
                      return false;
                    },
                    false,
                  )
                }
              >
                保留草稿并重新核对版本
              </button>
            )}
            <label>
              显示名称
              <input
                value={editing.title}
                onChange={(e) =>
                  setEditing({ ...editing, title: e.target.value })
                }
              />
            </label>
            <label>
              番号 / 作品标识
              <input
                value={editing.code}
                onChange={(e) =>
                  setEditing({ ...editing, code: e.target.value })
                }
              />
            </label>
            <label>
              媒体类型
              <select
                value={editing.mediaType}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    mediaType: e.target.value as MediaType,
                  })
                }
              >
                {Object.entries(mediaNames).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              演员（每行一位）
              <textarea
                aria-label="演员（每行一位）"
                value={actorText}
                onChange={(e) => setActorText(e.target.value)}
              />
            </label>
            <label>
              厂商
              <input
                value={editing.studio}
                onChange={(e) =>
                  setEditing({ ...editing, studio: e.target.value })
                }
              />
            </label>
            <label>
              发行日期
              <input
                type="date"
                value={editing.releaseDate}
                onChange={(e) =>
                  setEditing({ ...editing, releaseDate: e.target.value })
                }
              />
            </label>
            <label>
              简介
              <textarea
                rows={4}
                aria-label="简介"
                value={editing.description}
                onChange={(e) =>
                  setEditing({ ...editing, description: e.target.value })
                }
              />
            </label>
            <label>
              个人笔记
              <textarea
                rows={3}
                aria-label="个人笔记"
                value={editing.note}
                onChange={(e) =>
                  setEditing({ ...editing, note: e.target.value })
                }
              />
            </label>
            <label>个人标签</label>
            <ToggleList
              values={tags}
              selected={editing.tags}
              change={(v) => setEditing({ ...editing, tags: v })}
            />
            {!tags.length && (
              <p className="muted">还没有标签，可以在下方创建。</p>
            )}
            <form
              className="inline-create"
              onSubmit={(e) => {
                e.preventDefault();
                void createEditorTag();
              }}
            >
              <label className="sr-only" htmlFor="new-film-tag">
                新标签名称
              </label>
              <input
                id="new-film-tag"
                placeholder="输入新标签名称"
                value={tagName}
                onChange={(e) => setTagName(e.target.value)}
                maxLength={80}
              />
              <button className="secondary" disabled={!tagName.trim()}>
                创建并选中
              </button>
            </form>
            <p className="muted">
              点击标签可选中或取消；新建后需保存影片，才会关联到这部影片。
            </p>
            <label>人工保护字段（取消选中允许资料源刷新）</label>
            <ToggleList
              values={[
                ["title", "片名"],
                ["studio", "厂商"],
                ["performers", "演员"],
                ["description", "简介"],
                ["releaseDate", "日期"],
              ].map(([id, name]) => ({ id, name }))}
              selected={editing.locks}
              change={(v) => setEditing({ ...editing, locks: v })}
            />
            <p className="muted">修改或明确清空资料后，该字段会自动保护。</p>
            <button
              className="primary full editor-save"
              onClick={() =>
                action(
                  "保存影片",
                  async () => {
                    if (!editing.title.trim())
                      throw new Error("显示名称不能为空");
                    await libraryApi.saveItem({
                      ...editing,
                      performers: actorText
                        .split("\n")
                        .map((v) => v.trim())
                        .filter(Boolean),
                    });
                    setEditing(null);
                  },
                  ["items", "catalog"],
                )
              }
            >
              保存修改
            </button>
            <hr />
            <div className="drawer-actions">
              <details open>
                <summary>封面与字幕</summary>
                <button
                  onClick={() =>
                    editorOperation(async () => {
                      if (
                        await askConfirm(
                          "恢复自动封面后将重新读取 Windows 缩略图。旧人工图片仍保留在资料备份中。",
                          "恢复系统封面",
                          "恢复自动封面",
                        )
                      )
                        await action("恢复自动封面", async () => {
                          await api("reset_auto_cover", { itemId: editing.id });
                          setEditing(null);
                        });
                    })
                  }
                >
                  恢复自动封面
                </button>
                <button
                  onClick={() =>
                    editorOperation(() => upload(editing, "cover"))
                  }
                >
                  <ImagePlus size={17} />
                  导入封面图片
                </button>
                <button
                  onClick={() =>
                    editorOperation(async () => {
                      const ok = await action("读取系统缩略图", () =>
                        api("inspect_media", { itemId: editing.id }),
                      );
                      if (!ok) return;
                      try {
                        const p = await libraryApi.list({
                          query: "",
                          mediaType: "",
                          removed: editing.removed,
                          offset: 0,
                          limit: 1,
                          filters: { targetId: editing.id },
                        });
                        if (!p.items[0]) throw new Error("影片已不存在");
                        await edit(p.items[0]);
                      } catch {
                        setEditing(null);
                        setToast(
                          "系统缩略图读取已完成。请刷新资料库后重新打开影片。",
                        );
                      }
                    })
                  }
                >
                  <ImagePlus size={17} />
                  重新读取系统缩略图
                </button>
                <p className="muted">
                  由 Windows 自动读取缩略图和时长；已有人工封面会保留。
                </p>
                <button
                  onClick={() =>
                    editorOperation(() => upload(editing, "subtitle"))
                  }
                >
                  <Subtitles size={17} />
                  选择外挂字幕
                </button>
                <button
                  onClick={() =>
                    editorOperation(() =>
                      action(
                        "读取字幕候选",
                        async () => {
                          const choices = await api<any>("subtitle_choices", {
                            itemId: editing.id,
                          });
                          setSubChoices(choices.subtitles);
                          setSubQuery(editing.code);
                          setSubPage(0);
                          setPanel("subtitles");
                        },
                        false,
                      ),
                    )
                  }
                >
                  <Subtitles size={17} />
                  查看字幕候选
                </button>
              </details>
              <details>
                <summary>资料与文件管理</summary>
                <button
                  disabled={editing.mediaType === "personal"}
                  onClick={() => editorOperation(() => scrape([editing.id]))}
                >
                  <Download size={17} />
                  获取 / 刷新资料
                </button>
                {editing.mediaType === "personal" && (
                  <p className="muted">个人片段使用手动资料，不联网匹配。</p>
                )}
                <button
                  onClick={() => editorOperation(() => fileOpen(editing))}
                >
                  <Film size={17} />
                  主视频与重复候选
                </button>
                <button
                  onClick={() =>
                    editorOperation(async () => {
                      const name = await askText(
                        "输入新文件名（不含扩展名）",
                        editing.path
                          .split(/[\\/]/)
                          .pop()
                          ?.replace(/\.[^.]+$/, "") || "",
                      );
                      if (name)
                        await action(
                          "重命名视频",
                          async () => {
                            await api("rename_video", {
                              itemId: editing.id,
                              newName: name,
                            });
                            setEditing(null);
                          },
                          ["items", "roots"],
                        );
                    })
                  }
                >
                  <FolderOpen size={17} />
                  重命名真实视频文件
                </button>
                <button
                  onClick={() =>
                    action(
                      "打开文件夹",
                      () => api("reveal", { itemId: editing.id }),
                      false,
                    )
                  }
                >
                  <FolderOpen size={17} />
                  打开所在文件夹
                </button>
                <button
                  onClick={() =>
                    editorOperation(async () => {
                      const path = await dialog({
                        multiple: false,
                        title: "重新关联视频文件",
                      });
                      if (
                        typeof path === "string" &&
                        (await askConfirm(
                          "将该影片关联到所选视频，保留现有个人资料。目标文件夹尚未管理时会一并添加。确认文件对应正确？",
                        ))
                      )
                        await action("重新关联视频", async () => {
                          await api("relink_file", {
                            addRoot: true,
                            itemId: editing.id,
                            path,
                          });
                          setEditing(null);
                        });
                    })
                  }
                >
                  重新关联已移动视频
                </button>
                <button onClick={() => play(editing, true)}>
                  <Play size={17} />
                  本次不带外挂字幕播放
                </button>
                <button
                  onClick={() =>
                    editorOperation(async () => {
                      if (
                        await askConfirm(
                          "将该影片" +
                            (editing.removed ? "恢复到资料库" : "移出资料库") +
                            "？视频文件和个人资料会保留。",
                          "确认操作",
                        )
                      )
                        await action("移出/恢复", async () => {
                          await api("set_removed", {
                            ids: [editing.id],
                            removed: !editing.removed,
                          });
                          setEditing(null);
                        });
                    })
                  }
                >
                  <Trash2 size={17} />
                  {editing.removed
                    ? "恢复项目"
                    : "从库移除（保留文件与个人资料）"}
                </button>
              </details>
            </div>
          </Modal>
        )}
        {panel === "add-root" && (
          <Modal title="添加文件夹" close={() => setPanel("")}>
            <p className="muted">
              视频与同名字幕可以放在同一个文件夹。只有字幕单独存放时，才需要添加“字幕专用目录”。
            </p>
            <p className="path muted">{rootDraft.path}</p>
            <label>
              目录用途
              <select
                value={rootDraft.kind}
                onChange={(e) =>
                  setRootDraft({ ...rootDraft, kind: e.target.value })
                }
              >
                <option value="video">影片目录</option>
                <option value="subtitle">字幕专用目录</option>
              </select>
            </label>
            {rootDraft.kind === "video" && (
              <label>
                新入库视频的默认分类
                <select
                  value={rootDraft.mediaType}
                  onChange={(e) =>
                    setRootDraft({ ...rootDraft, mediaType: e.target.value })
                  }
                >
                  {Object.entries(mediaNames).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              className="primary full"
              onClick={() =>
                action(
                  "添加目录",
                  async () => {
                    await api("add_root", {
                      path: rootDraft.path,
                      mediaType: rootDraft.mediaType,
                      kind: rootDraft.kind,
                    });
                    setPanel("roots");
                  },
                  ["roots"],
                )
              }
            >
              添加并在后台核对
            </button>
          </Modal>
        )}
        {panel === "roots" && (
          <Modal title="文件夹管理" close={() => setPanel("")} wide>
            <p className="notice">
              换电脑或盘符后，按下面每个离线目录的“重新定位”选择对应的新文件夹，核对文件数量后确认。字幕目录也可单独定位；完成后到播放器设置检测程序路径。
            </p>
            <p className="muted">
              影片目录可同时包含视频和同名字幕；单独存放的字幕可添加为字幕专用目录。文件变化会自动核对，磁盘离线时保留资料。
            </p>
            {roots.map((r) => (
              <div className="root-row" key={r.id}>
                <div>
                  <b>
                    {r.kind === "subtitle"
                      ? "字幕目录"
                      : mediaNames[r.mediaType]}
                  </b>
                  <small className="path">{r.path}</small>
                  <small>
                    {r.detached
                      ? "已移除，资料保留"
                      : r.online
                        ? "在线"
                        : "离线"}{" "}
                    · {r.enabled ? "自动核对已启用" : "已停用"}
                  </small>
                </div>
                <div className="row wrap">
                  {r.kind !== "subtitle" && (
                    <select
                      aria-label="目录默认类型"
                      value={r.mediaType}
                      onChange={(e) =>
                        action(
                          "修改目录默认类型",
                          () =>
                            api("set_root_type", {
                              rootId: r.id,
                              mediaType: e.target.value,
                            }),
                          ["roots"],
                        )
                      }
                    >
                      {Object.entries(mediaNames).map(([id, name]) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    className="secondary"
                    disabled={!r.enabled || !!busy}
                    onClick={() =>
                      action("扫描目录", () => libraryApi.scan(r.id), [
                        "items",
                        "roots",
                        "jobs",
                      ])
                    }
                  >
                    扫描
                  </button>
                  <button
                    onClick={() =>
                      action(
                        "更新目录",
                        () =>
                          api("toggle_root", {
                            rootId: r.id,
                            enabled: !r.enabled,
                          }),
                        ["roots", "items", "jobs"],
                      )
                    }
                  >
                    {r.enabled ? "停用" : "启用"}
                  </button>
                  <button
                    onClick={async () => {
                      const path = await dialog({
                        directory: true,
                        title: "选择根目录的新位置",
                      });
                      if (typeof path !== "string") return;
                      let check:
                        | { total: number; missing: number; uncertain: number }
                        | undefined;
                      const ok = await action(
                        "检查目录新位置",
                        async () => {
                          check = await api("relocate_root", {
                            rootId: r.id,
                            path,
                            confirm: false,
                          });
                        },
                        false,
                      );
                      if (!ok || !check) return;
                      if (
                        await askConfirm(
                          "共 " +
                            check.total +
                            " 个关联文件，缺失 " +
                            check.missing +
                            " 个，身份待确认 " +
                            check.uncertain +
                            " 个。确认新目录与原目录内容对应？",
                          "确认重新定位目录",
                        )
                      ) {
                        await action(
                          "重新定位目录",
                          () =>
                            api("relocate_root", {
                              rootId: r.id,
                              path,
                              confirm: true,
                            }),
                          ["roots", "items", "jobs"],
                        );
                      }
                    }}
                  >
                    重新定位
                  </button>
                  <button
                    onClick={async () => {
                      if (
                        await askConfirm(
                          "停止自动核对这个文件夹？已入库的影片和磁盘上的文件会保留，可在此重新启用。",
                          "移除文件夹",
                        )
                      )
                        await action(
                          "移除目录",
                          () => api("detach_root", { rootId: r.id }),
                          ["roots", "items", "jobs"],
                        );
                    }}
                  >
                    移除
                  </button>
                </div>
              </div>
            ))}
            <button className="primary full" onClick={addRoot}>
              <FolderPlus size={17} />
              添加文件夹
            </button>
          </Modal>
        )}
        {panel === "selection" && (
          <SelectionDialog
            selected={selected}
            close={() => setPanel("")}
            remove={(id) =>
              setSelected((v) => v.filter((value) => value !== id))
            }
          />
        )}
        {panel === "batch" && (
          <Modal
            title={"批量编辑 · " + selected.length + " 部"}
            close={() => setPanel("")}
          >
            <label>标签</label>
            <ToggleList
              values={tags}
              selected={batchTags}
              change={setBatchTags}
            />
            <div className="row">
              <button
                className="secondary full"
                disabled={!batchTags.length || !selected.length}
                onClick={() => batch({ addTags: batchTags })}
              >
                添加所选标签
              </button>
              <button
                className="secondary full"
                disabled={!batchTags.length || !selected.length}
                onClick={() => batch({ removeTags: batchTags })}
              >
                移除所选标签
              </button>
            </div>
            <label>
              批量分类（选择后点击应用）
              <select
                value={batchType}
                onChange={(e) => setBatchType(e.target.value)}
              >
                <option value="">选择媒体类型</option>
                {Object.entries(mediaNames).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary full"
              disabled={!batchType || !selected.length}
              onClick={() => batch({ mediaType: batchType })}
            >
              应用分类到所选 {selected.length} 部
            </button>
            <div className="row">
              <button
                className="secondary full"
                onClick={() => batch({ favorite: true })}
              >
                全部收藏
              </button>
              <button
                className="secondary full"
                onClick={() => batch({ favorite: false })}
              >
                取消收藏
              </button>
            </div>
            <button
              className="primary full"
              onClick={() =>
                action("提交缩略图读取", () =>
                  api("queue_local", { ids: selected }),
                )
              }
            >
              后台读取时长与缩略图
            </button>
          </Modal>
        )}
        {(panel === "entities" || panel === "tag-management") && (
          <Modal
            title={panel === "tag-management" ? "标签管理" : "演员与厂商"}
            close={closeEntities}
            wide
          >
            <div className="row tabs wrap">
              {(panel === "tag-management"
                ? [
                    ["tags", "标签"],
                    ["tag_groups", "标签分类"],
                  ]
                : [
                    ["performers", "演员"],
                    ["studios", "厂商"],
                  ]
              ).map(([id, name]) => (
                <button
                  key={id}
                  aria-pressed={entityTab === id}
                  className={entityTab === id ? "tag picked" : "tag"}
                  onClick={async () => {
                    if (await discardEntityDraft()) {
                      setEntityTab(id);
                      setEntityDraft(null);
                      setEntityQuery("");
                    }
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
            <p className="muted">
              {panel === "tag-management"
                ? "在这里新增、修改和整理个人标签，也可以在编辑影片时创建并选中标签。"
                : "在这里管理演员、厂商及其别名。个人标签请在左侧“个人标签”旁点击“管理”。"}
            </p>
            <div className="row entity-toolbar">
              <input
                aria-label="搜索管理项目"
                placeholder="搜索名称"
                value={entityQuery}
                onChange={(e) => setEntityQuery(e.target.value)}
              />
              <button
                className="primary"
                onClick={async () => {
                  if (await discardEntityDraft())
                    openEntityDraft({
                      id: crypto.randomUUID(),
                      name: "",
                      aliases: "",
                      groupId: "",
                    });
                }}
              >
                新增
                {entityTab === "tags"
                  ? "标签"
                  : entityTab === "tag_groups"
                    ? "分类"
                    : entityTab === "performers"
                      ? "演员"
                      : "厂商"}
              </button>
            </div>
            {entityDraft && (
              <form
                className="entity-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const draft = entityDraft;
                  const ok = await action(
                    "保存管理项目",
                    () =>
                      entityTab === "tags"
                        ? api("save_tag", {
                            tag: {
                              id: draft.id,
                              name: draft.name.trim(),
                              groupId: draft.groupId || null,
                            },
                          })
                        : api("save_entity", {
                            table: entityTab,
                            key: draft.id,
                            name: draft.name.trim(),
                            aliases: draft.aliases
                              .split(/[,，\n]/)
                              .map((v) => v.trim())
                              .filter(Boolean),
                          }),
                    ["catalog", "items"],
                  );
                  if (ok) setEntityDraft(null);
                }}
              >
                <label>
                  名称
                  <input
                    autoFocus
                    required
                    maxLength={80}
                    value={entityDraft.name}
                    onChange={(e) =>
                      setEntityDraft({ ...entityDraft, name: e.target.value })
                    }
                  />
                </label>
                {entityTab === "tags" && (
                  <label>
                    标签分类
                    <select
                      aria-label="标签分类"
                      value={entityDraft.groupId}
                      onChange={(e) =>
                        setEntityDraft({
                          ...entityDraft,
                          groupId: e.target.value,
                        })
                      }
                    >
                      <option value="">未分组</option>
                      {catalog.tag_groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {["performers", "studios"].includes(entityTab) && (
                  <label>
                    别名（用逗号分隔）
                    <input
                      value={entityDraft.aliases}
                      onChange={(e) =>
                        setEntityDraft({
                          ...entityDraft,
                          aliases: e.target.value,
                        })
                      }
                    />
                  </label>
                )}
                <div className="dialog-footer">
                  <button
                    type="button"
                    className="secondary"
                    onClick={async () => {
                      if (await discardEntityDraft()) setEntityDraft(null);
                    }}
                  >
                    取消编辑
                  </button>
                  <button
                    className="primary"
                    disabled={!entityDraft.name.trim()}
                  >
                    保存{entityTab === "tags" ? "标签" : "项目"}
                  </button>
                </div>
              </form>
            )}
            {(entityTab === "tags"
              ? tags
              : catalog[entityTab as keyof Catalog] || []
            )
              .filter((t) =>
                t.name
                  .toLocaleLowerCase()
                  .includes(entityQuery.toLocaleLowerCase()),
              )
              .map((entity: Entity | Tag) => (
                <div className="root-row" key={entity.id}>
                  <div>
                    <b>{entity.name}</b>
                    {"aliases" in entity && (
                      <small>{entity.aliases?.join(" / ")}</small>
                    )}
                    {"groupId" in entity && (
                      <small>
                        {catalog.tag_groups.find((g) => g.id === entity.groupId)
                          ?.name || "未分组"}
                      </small>
                    )}
                  </div>
                  <div className="row wrap">
                    <button
                      onClick={async () => {
                        if (await discardEntityDraft())
                          openEntityDraft({
                            id: entity.id,
                            name: entity.name,
                            aliases:
                              "aliases" in entity
                                ? (entity.aliases || []).join(",")
                                : "",
                            groupId:
                              "groupId" in entity ? entity.groupId || "" : "",
                          });
                      }}
                    >
                      编辑
                    </button>
                    {entityTab !== "tag_groups" && (
                      <select
                        aria-label={"合并 " + entity.name}
                        value=""
                        onChange={async (e) => {
                          const target = e.target.value;
                          const table = entityTab;
                          if (
                            target &&
                            (await askConfirm(
                              "将“" +
                                entity.name +
                                "”的关联并入所选项目，并删除原项目。将自动备份。",
                              "合并资料",
                              "确认合并",
                            ))
                          )
                            await action(
                              "合并资料",
                              () =>
                                api("merge_entity", {
                                  table,
                                  source: entity.id,
                                  target,
                                }),
                              ["catalog", "items"],
                            );
                        }}
                      >
                        <option value="">合并到…</option>
                        {(entityTab === "tags"
                          ? tags
                          : catalog[entityTab as keyof Catalog] || []
                        )
                          .filter((t) => t.id !== entity.id)
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                      </select>
                    )}
                    <button
                      aria-label={"删除 " + entity.name}
                      onClick={async () => {
                        const table = entityTab;
                        if (
                          await askConfirm(
                            "删除“" +
                              entity.name +
                              "”及其关联？影片和视频文件会保留。",
                            "删除管理项目",
                            "确认删除",
                          )
                        )
                          await action(
                            "删除管理项目",
                            () =>
                              table === "tags"
                                ? api("delete_tag", { tagId: entity.id })
                                : api("delete_entity", {
                                    table,
                                    key: entity.id,
                                  }),
                            ["catalog", "items"],
                          );
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            {!(
              entityTab === "tags"
                ? tags
                : catalog[entityTab as keyof Catalog] || []
            ).length && (
              <p className="empty-hint">暂无项目，点击上方“新增”开始创建。</p>
            )}
          </Modal>
        )}
        {panel === "settings" && (
          <Modal title="播放器与资料来源" close={closeSettings} wide>
            <p className="muted">
              不设置路径时使用系统默认程序播放。需要自动加载已选外挂字幕时，请选择下面支持的播放器。
            </p>
            <button
              className="secondary"
              onClick={() =>
                action(
                  "检测本机环境",
                  async () => setSystemInfo(await api("system_status")),
                  false,
                )
              }
            >
              检测播放器与数据目录
            </button>
            {systemInfo && (
              <div className="notice">
                <p>
                  版本：{systemInfo.version} · 数据目录：{systemInfo.dataPath}
                </p>
                <p>
                  {systemInfo.playerAvailable
                    ? "已保存配置：播放器路径可用或使用系统默认程序"
                    : "已保存配置：播放器路径已失效，请在下方重新选择并保存"}
                </p>
                {systemInfo.detected?.map((p: any) => (
                  <button
                    key={p.path}
                    onClick={() =>
                      setSettings({
                        ...settings,
                        player: p.path,
                        playerKind: p.kind,
                      })
                    }
                  >
                    使用 {p.kind}
                  </button>
                ))}
                <button
                  onClick={() =>
                    action("打开数据目录", () => api("reveal_data"), false)
                  }
                >
                  打开数据目录
                </button>
                <p>
                  缩略图缓存：{bytes(systemInfo.previewBytes)} · 封面：
                  {bytes(systemInfo.coverBytes)} · 自动备份{" "}
                  {systemInfo.backups?.length || 0} 份（保留供手动核查）
                </p>
              </div>
            )}
            <label>
              完整目录核对间隔
              <select
                aria-label="完整目录核对间隔"
                value={settings.scanMinutes ?? 30}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    scanMinutes: Number(e.target.value),
                  })
                }
              >
                {[10, 30, 60, 120, 1440].map((n) => (
                  <option key={n} value={n}>
                    {n === 1440 ? "每天" : n + " 分钟"}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted">
              点击“保存设置”后生效。目录发生变化时仍会自动扫描对应目录。
            </p>
            <label>
              播放器程序（.exe，可选）
              <div className="row">
                <input
                  value={settings.player}
                  onChange={(e) =>
                    setSettings({ ...settings, player: e.target.value })
                  }
                />
                <button
                  onClick={async () => {
                    const p = await dialog({
                      filters: [{ name: "播放器", extensions: ["exe"] }],
                    });
                    if (typeof p === "string")
                      setSettings({ ...settings, player: p });
                  }}
                >
                  选择
                </button>
              </div>
            </label>
            <label>
              播放器类型（与所选程序一致）
              <select
                value={settings.playerKind}
                onChange={(e) =>
                  setSettings({ ...settings, playerKind: e.target.value })
                }
              >
                <option value="potplayer">PotPlayer</option>
                <option value="mpv">mpv</option>
                <option value="vlc">VLC</option>
              </select>
            </label>
            <button
              className="secondary full"
              onClick={() =>
                action(
                  "测试播放器",
                  () => api("test_player", { settings }),
                  false,
                )
              }
            >
              测试画面与字幕（无需保存设置）
            </button>
            <p className="muted">
              视频缩略图、时长和分辨率由 Windows
              自动读取，无需配置媒体工具。系统不支持的格式可手动导入封面。
            </p>
            <hr />
            <details>
              <summary>高级资料来源设置</summary>
              <h3>字段来源优先级</h3>
              <p className="muted">
                人工保护始终优先。未指定时按下方来源列表顺序取值。
              </p>
              <div className="form-grid">
                {[
                  ["title", "片名"],
                  ["studio", "厂商"],
                  ["performers", "演员"],
                  ["description", "简介"],
                  ["releaseDate", "日期"],
                ].map(([field, label]) => (
                  <label key={field}>
                    {label}首选来源
                    <select
                      value={settings.priorities?.[field]?.[0] || ""}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          priorities: {
                            ...(settings.priorities || {}),
                            [field]: e.target.value
                              ? [
                                  e.target.value,
                                  ...settings.providers
                                    .filter((p) => p.id !== e.target.value)
                                    .map((p) => p.id),
                                ]
                              : settings.providers.map((p) => p.id),
                          },
                        })
                      }
                    >
                      <option value="">按来源列表顺序</option>
                      {settings.providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <h3>手动联网来源</h3>
              <p className="muted">
                仅在你点击获取资料时查询；个人片段被后端排除。来源可能限制访问，所有结果先核查再保存。来源域名和图片
                CDN 需显式列入允许范围。
              </p>
              {settings.providers.map((p, index) => (
                <div className="provider" key={p.id}>
                  <div className="row wrap provider-tools">
                    <button
                      disabled={index === 0}
                      onClick={() =>
                        setSettings((v) => {
                          const providers = [...v.providers];
                          [providers[index - 1], providers[index]] = [
                            providers[index],
                            providers[index - 1],
                          ];
                          return { ...v, providers };
                        })
                      }
                    >
                      上移
                    </button>
                    <button
                      disabled={index === settings.providers.length - 1}
                      onClick={() =>
                        setSettings((v) => {
                          const providers = [...v.providers];
                          [providers[index], providers[index + 1]] = [
                            providers[index + 1],
                            providers[index],
                          ];
                          return { ...v, providers };
                        })
                      }
                    >
                      下移
                    </button>
                    <button
                      onClick={async () => {
                        if (
                          await askConfirm(
                            "从设置中移除来源“" +
                              p.name +
                              "”？已保存的影片资料会保留。",
                            "移除资料来源",
                            "移除来源",
                          )
                        )
                          setSettings((v) => ({
                            ...v,
                            providers: v.providers.filter((x) => x.id !== p.id),
                            priorities: Object.fromEntries(
                              Object.entries(v.priorities || {}).map(
                                ([field, ids]) => [
                                  field,
                                  ids.filter((id) => id !== p.id),
                                ],
                              ),
                            ),
                          }));
                      }}
                    >
                      移除来源
                    </button>
                  </div>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={p.enabled}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          providers: settings.providers.map((v, n) =>
                            n === index
                              ? { ...v, enabled: e.target.checked }
                              : v,
                          ),
                        })
                      }
                    />
                    {p.name}
                  </label>
                  <label>
                    搜索地址（关键词位置使用 {"{query}"}）
                    <input
                      value={p.searchUrl}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          providers: settings.providers.map((v, n) =>
                            n === index
                              ? { ...v, searchUrl: e.target.value }
                              : v,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    允许域名（逗号分隔）
                    <input
                      value={p.allowedHosts.join(",")}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          providers: settings.providers.map((v, n) =>
                            n === index
                              ? {
                                  ...v,
                                  allowedHosts: e.target.value
                                    .split(",")
                                    .map((s) => s.trim())
                                    .filter(Boolean),
                                }
                              : v,
                          ),
                        })
                      }
                    />
                  </label>
                </div>
              ))}
              <button
                className="secondary"
                onClick={async () => {
                  const name = await askText("来源名称");
                  if (name)
                    setSettings((v) => ({
                      ...v,
                      providers: [
                        ...v.providers,
                        {
                          id: crypto.randomUUID(),
                          name,
                          mediaTypes: ["jav", "western"],
                          searchUrl: "",
                          allowedHosts: [],
                          enabled: true,
                        },
                      ],
                    }));
                }}
              >
                添加结构化网页来源
              </button>
            </details>
            <div className="dialog-footer sticky-actions">
              <button className="secondary" onClick={closeSettings}>
                取消
              </button>
              <button
                className="primary"
                onClick={async () => {
                  const ok = await action(
                    "保存设置",
                    async () => {
                      for (const p of settings.providers.filter(
                        (p) => p.enabled,
                      )) {
                        if (!p.name.trim())
                          throw new Error("资料来源名称不能为空");
                        if (
                          !/^https:\/\//i.test(p.searchUrl) ||
                          !p.searchUrl.includes("{query}") ||
                          !p.allowedHosts.length
                        )
                          throw new Error(
                            "请完善已启用来源的 HTTPS 搜索地址（含 {query}）和允许域名，或先取消启用该来源。",
                          );
                      }
                      await libraryApi.saveSettings(settings);
                      setPanel("");
                    },
                    false,
                  );
                  if (ok && resumePlayback) {
                    const item = resumePlayback;
                    setResumePlayback(null);
                    await play(item);
                  }
                }}
              >
                保存设置
              </button>
            </div>
          </Modal>
        )}
        {panel === "scrape" && (
          <Modal title="获取影片资料" close={() => setPanel("")}>
            <p className="muted">
              选中 {scrapeIds.length}{" "}
              部。个人片段会跳过；已有人工保护字段保持不变。
            </p>
            <label>
              资料来源
              <select
                value={scrapeProvider}
                onChange={(e) => setScrapeProvider(e.target.value)}
              >
                <option value="">选择已启用来源</option>
                {settings.providers
                  .filter((p) => p.enabled)
                  .map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              作品 URL 或检索词（留空按影片标识查询）
              <input
                value={scrapeQuery}
                onChange={(e) => setScrapeQuery(e.target.value)}
                placeholder="https://…"
              />
            </label>
            <button
              className="primary full"
              disabled={!scrapeProvider}
              onClick={() =>
                action(
                  "提交资料任务",
                  async () => {
                    const result = await api<{
                      queued: number;
                      skipped: number;
                    }>("queue_metadata", {
                      ids: scrapeIds,
                      providerId: scrapeProvider,
                      query: scrapeQuery || null,
                    });
                    setJobTab("active");
                    setJobPage(0);
                    setPanel("jobs");
                    return (
                      "已排队 " +
                      result.queued +
                      " 部，跳过 " +
                      result.skipped +
                      " 部"
                    );
                  },
                  false,
                )
              }
            >
              手动开始获取
            </button>
          </Modal>
        )}
        {panel === "jobs" && (
          <Modal title="后台任务与资料核查" close={() => setPanel("")} wide>
            <div className="row wrap">
              {(
                [
                  ["active", "进行中"],
                  ["review", "待核查"],
                  ["failed", "失败与中断"],
                  ["history", "历史"],
                ] as const
              ).map(([id, label]) => (
                <button
                  className={jobTab === id ? "tag picked" : "tag"}
                  key={id}
                  onClick={() => {
                    setJobTab(id);
                    setJobPage(0);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="row">
              <button
                disabled={!jobPage}
                onClick={() => setJobPage((v) => v - 1)}
              >
                上一页任务
              </button>
              <span>第 {jobPage + 1} 页</span>
              <button
                disabled={jobsLoading || jobs.length < JOB_PAGE_SIZE}
                onClick={() => setJobPage((v) => v + 1)}
              >
                下一页任务
              </button>
            </div>
            <button
              className="secondary"
              onClick={() => action("刷新任务", () => refresh("jobs"), false)}
            >
              刷新
            </button>
            {jobsLoading && <p role="status">正在读取任务…</p>}
            {jobsError && (
              <p className="form-error" role="alert">
                读取任务失败：{jobsError}
              </p>
            )}
            {!jobsLoading && !jobsError && jobs.length === 0 && (
              <p className="muted">暂无后台任务</p>
            )}
            {jobs.map((job) => (
              <div className="job" key={job.id}>
                <div className="row modal-head">
                  <b>{job.title || "影片任务"}</b>
                  <span className="tag">
                    {{
                      queued: "等待",
                      running: "运行中",
                      paused: "已暂停",
                      review: "待核查",
                      saved: "完成",
                      failed: "失败",
                      cancelled: "已取消",
                      interrupted: "上次中断",
                    }[job.state] || job.state}
                  </span>
                </div>
                {job.error && <p className="error-text">{job.error}</p>}
                <div className="row">
                  {job.state === "queued" && (
                    <button
                      onClick={() =>
                        action(
                          "暂停任务",
                          () =>
                            api("job_action", { key: job.id, action: "pause" }),
                          ["jobs"],
                        )
                      }
                    >
                      暂停
                    </button>
                  )}
                  {["failed", "paused", "interrupted"].includes(job.state) && (
                    <button
                      onClick={() =>
                        action(
                          "重新提交任务",
                          () =>
                            api("job_action", {
                              key: job.id,
                              action: "resume",
                            }),
                          ["jobs"],
                        )
                      }
                    >
                      重试 / 恢复
                    </button>
                  )}
                  {!["saved", "cancelled"].includes(job.state) && (
                    <button
                      onClick={() =>
                        action(
                          "取消任务",
                          () =>
                            api("job_action", {
                              key: job.id,
                              action: "cancel",
                            }),
                          ["jobs"],
                        )
                      }
                    >
                      取消
                    </button>
                  )}
                </div>
                {job.payload?.candidates?.map((c, n) => (
                  <button
                    className="candidate"
                    key={n}
                    onClick={() =>
                      action(
                        "选择候选",
                        () => api("candidate", { key: job.id, url: c.url }),
                        ["jobs"],
                      )
                    }
                  >
                    <span>{c.title}</span>
                    <small>{c.url}</small>
                  </button>
                ))}
                {["review", "saved"].includes(job.state) &&
                  job.payload?.proposal && (
                    <div className="proposal">
                      <h3>{job.payload.proposal.title}</h3>
                      <p>
                        {job.payload.proposal.performers.join(" / ")} ·{" "}
                        {job.payload.proposal.studio} ·{" "}
                        {job.payload.proposal.releaseDate}
                      </p>
                      <p>{job.payload.proposal.description}</p>
                      <small className="path">
                        来源：{job.payload.proposal.sourceUrl}
                      </small>
                      <div className="row">
                        <button
                          disabled={job.state !== "review"}
                          className="primary"
                          onClick={() =>
                            action(
                              "保存资料",
                              () =>
                                api("apply_metadata", {
                                  key: job.id,
                                  proposal: job.payload!.proposal,
                                }),
                              ["jobs", "items", "catalog"],
                            )
                          }
                        >
                          确认保存未锁定字段
                        </button>
                        {job.payload.proposal.coverUrl && (
                          <button
                            className="secondary"
                            onClick={() =>
                              action("获取选定封面", () =>
                                api("fetch_cover", {
                                  itemId: job.itemId,
                                  providerId: job.provider,
                                  url: job.payload!.proposal!.coverUrl,
                                }),
                              )
                            }
                          >
                            选择该来源封面
                          </button>
                        )}
                      </div>
                    </div>
                  )}
              </div>
            ))}
          </Modal>
        )}
        {panel === "review" && (
          <Modal title="待确认中心" close={() => setPanel("")} wide>
            {review.items.length === 0 && review.errors.length === 0 && (
              <p className="muted">没有需要核查的项目。</p>
            )}
            {review.items.map((i) => (
              <div className="root-row" key={i.id}>
                <div>
                  <b>{i.title}</b>
                  <small>
                    {!i.available
                      ? "视频路径失效"
                      : i.subtitleConfirmation === "needs_review"
                        ? "字幕需要核查"
                        : "同标识重复候选"}
                  </small>
                  <small className="path">{i.path}</small>
                </div>
                <button
                  className="secondary"
                  onClick={async () => {
                    const result = await libraryApi.list({
                      query: "",
                      mediaType: "",
                      removed: false,
                      offset: 0,
                      limit: 1,
                      filters: { targetId: i.id },
                    });
                    setPanel("");
                    if (result.items[0]) edit(result.items[0]);
                  }}
                >
                  核查
                </button>
              </div>
            ))}
            {review.errors.map((e) => (
              <p className="error-text" key={e.id}>
                {e.error}
              </p>
            ))}
          </Modal>
        )}
        {panel === "files" && editing && (
          <Modal title="主视频与重复候选" close={() => setPanel("")} wide>
            <p className="muted">
              只有你确认属于同一作品时才关联。其他文件保留；更换主视频后字幕需要重新核查。
            </p>
            {files.map((f) => (
              <div className="root-row" key={f.id}>
                <div>
                  <b>
                    {f.isPrimary && f.itemId === editing.id
                      ? "当前主视频"
                      : "候选视频"}
                  </b>
                  <small className="path">{f.path}</small>
                  <small>
                    {bytes(f.size)} · {f.available ? "在线" : "离线"}
                  </small>
                </div>
                <button
                  className="secondary"
                  onClick={async () => {
                    if (
                      await askConfirm(
                        "确认这是同一作品，并将该文件设为主视频？其他影片条目中的个人资料会保留，但关联文件归于当前作品。",
                      )
                    )
                      action("选择主视频", async () => {
                        await api("choose_primary", {
                          itemId: editing.id,
                          fileId: f.id,
                        });
                        setEditing(null);
                        setPanel("");
                      });
                  }}
                >
                  设为主视频
                </button>
                {f.itemId === editing.id && !f.isPrimary && (
                  <button
                    className="secondary"
                    onClick={() =>
                      action("分为独立影片", async () => {
                        await api("separate_file", { fileId: f.id });
                        setFiles(
                          await api("file_choices", { itemId: editing.id }),
                        );
                      })
                    }
                  >
                    分为独立影片
                  </button>
                )}
              </div>
            ))}
          </Modal>
        )}
        {panel === "subtitles" && editing && (
          <Modal title="字幕候选" close={() => setPanel("")} wide>
            <p className="muted">
              同番号不保证同步。选择后会保留人工绑定；离线字幕可在原位置恢复后继续使用。
            </p>
            <p>当前绑定：{editing.subtitle || "未绑定"}</p>
            <div className="row wrap">
              <button
                onClick={() =>
                  action("取消字幕绑定", async () => {
                    await api("clear_subtitle", {
                      itemId: editing.id,
                      allowAuto: false,
                    });
                    setEditing(null);
                    setPanel("");
                  })
                }
              >
                取消绑定并停止自动匹配
              </button>
              <button
                onClick={() =>
                  action("恢复字幕自动匹配", async () => {
                    await api("clear_subtitle", {
                      itemId: editing.id,
                      allowAuto: true,
                    });
                    setEditing(null);
                    setPanel("");
                  })
                }
              >
                清空绑定并恢复自动匹配
              </button>
            </div>
            <div className="row">
              <button
                disabled={!subPage}
                onClick={() => setSubPage((v) => v - 1)}
              >
                上一页字幕
              </button>
              <span>第 {subPage + 1} 页</span>
              <button
                disabled={
                  (subPage + 1) * 50 >=
                  subChoices.filter((s) =>
                    s.path
                      .toLowerCase()
                      .replaceAll("-", "")
                      .includes(subQuery.toLowerCase().replaceAll("-", "")),
                  ).length
                }
                onClick={() => setSubPage((v) => v + 1)}
              >
                下一页字幕
              </button>
            </div>
            <input
              aria-label="筛选字幕候选"
              value={subQuery}
              onChange={(e) => {
                setSubQuery(e.target.value);
                setSubPage(0);
              }}
              placeholder="按文件名或番号筛选"
            />
            {subChoices
              .filter((s) =>
                s.path
                  .toLowerCase()
                  .replaceAll("-", "")
                  .includes(subQuery.toLowerCase().replaceAll("-", "")),
              )
              .sort((a, b) => {
                const rank = (s: { path: string }) =>
                  s.path === editing.subtitle
                    ? 0
                    : s.path.replace(/[\\/][^\\/]+$/, "") ===
                        editing.path.replace(/[\\/][^\\/]+$/, "")
                      ? 1
                      : 2;
                return rank(a) - rank(b) || a.path.localeCompare(b.path);
              })
              .slice(subPage * 50, (subPage + 1) * 50)
              .map((s) => (
                <div className="root-row" key={s.id}>
                  <span className="path">{s.path}</span>
                  <button
                    disabled={!s.available}
                    className="secondary"
                    onClick={() =>
                      action("确认字幕", async () => {
                        await api("bind_subtitle", {
                          itemId: editing.id,
                          path: s.path,
                        });
                        setPanel("");
                        setEditing(null);
                      })
                    }
                  >
                    {s.available ? "选为当前字幕" : "离线"}
                  </button>
                </div>
              ))}
            <button
              className="primary full"
              onClick={() => upload(editing, "subtitle")}
            >
              从其他位置选择字幕
            </button>
          </Modal>
        )}
        {subtitleIssue && (
          <Modal title="字幕需要处理" close={() => setSubtitleIssue(null)}>
            <p>{subtitleIssue.message}</p>
            <button
              className="secondary full"
              onClick={async () => {
                await loadSettings();
                setResumePlayback(subtitleIssue.item);
                setSubtitleIssue(null);
                setPanel("settings");
              }}
            >
              设置播放器
            </button>
            <p className="muted">
              原字幕绑定会保留。你可以重新选择字幕，或仅本次不带外挂字幕播放。
            </p>
            <button
              className="primary full"
              onClick={() => {
                const item = subtitleIssue.item;
                setSubtitleIssue(null);
                void upload(item, "subtitle");
              }}
            >
              重新选择字幕
            </button>
            <button
              className="secondary full"
              onClick={() => {
                const item = subtitleIssue.item;
                setSubtitleIssue(null);
                void play(item, true);
              }}
            >
              本次不带外挂字幕播放
            </button>
            <button
              className="secondary full"
              onClick={() => setSubtitleIssue(null)}
            >
              取消播放
            </button>
          </Modal>
        )}
        {panel === "diagnostics" && (
          <Modal title="诊断与日志" close={() => setPanel("")} wide>
            <p>
              遇到问题后，点击“导出诊断文件”，把得到的 JSON
              文件发送给协助排查的人即可。
            </p>
            <p className="muted">
              只保存在本机，不会自动上传。日志不保存片名、笔记、完整路径、网址或媒体内容；错误只记录分类、错误码和代码位置。日志自动轮换并清理旧记录。
            </p>
            {diagnostic ? (
              <>
                <div className="diagnostic-summary">
                  <span>软件版本：{diagnostic.appVersion}</span>
                  <span>
                    系统：
                    {diagnostic.environment?.operatingSystem || "浏览器预览"}
                  </span>
                  <span>
                    WebView2：
                    {diagnostic.environment?.webviewVersion || "未读取"}
                  </span>
                  <span>
                    资料库检查：
                    {diagnostic.libraryStatus?.integrity === "ok"
                      ? "正常"
                      : "未取得或需检查"}
                  </span>
                  <span>最近诊断记录：{diagnostic.events?.length || 0} 条</span>
                </div>
                <details>
                  <summary>查看导出内容（已脱敏）</summary>
                  <pre className="diagnostic-preview" aria-label="诊断内容预览">
                    {JSON.stringify(diagnostic, null, 2)}
                  </pre>
                </details>
              </>
            ) : (
              <p className="muted">
                {busy === "读取诊断"
                  ? "正在读取诊断信息…"
                  : "未取得诊断信息，可点击刷新重试。"}
              </p>
            )}
            {!desktop && (
              <p className="muted">
                浏览器预览不生成或导出本地日志，请在桌面版使用。
              </p>
            )}
            <div className="row">
              <button
                className="secondary"
                onClick={() => void openDiagnostics()}
              >
                刷新诊断信息
              </button>
              <button
                className="primary"
                disabled={!desktop || !diagnostic}
                onClick={() => void exportDiagnostic()}
              >
                导出诊断文件
              </button>
            </div>
            <p className="muted">
              如果软件无法打开，可发送程序旁
              app-data/logs/latest-diagnostic.json；若也未生成，请保留错误截图。
            </p>
          </Modal>
        )}
        {panel === "backup" && (
          <Modal title="备份与恢复" close={() => setPanel("")}>
            <p>
              备份包括个人资料、设置、标签及选定封面，不包含原始视频和外部字幕文件。
            </p>
            <button
              className="primary full"
              onClick={() =>
                action(
                  "备份资料",
                  async () => {
                    const path = await dialog({
                      directory: true,
                      title: "选择备份父目录",
                    });
                    if (typeof path !== "string") return false;
                    await api("backup", {
                      path: path + "/AVLibrary-backup-" + Date.now(),
                    });
                  },
                  false,
                )
              }
            >
              导出完整资料备份
            </button>
            <button
              className="secondary full"
              onClick={() =>
                action(
                  "恢复备份",
                  async () => {
                    const path = await dialog({
                      directory: true,
                      title: "选择包含 manifest.json 的备份目录",
                    });
                    if (typeof path !== "string") return false;
                    if (
                      !(await askConfirm(
                        "恢复会替换当前资料，先自动保存当前资料副本。继续？",
                      ))
                    )
                      return false;
                    await libraryApi.restore(path);
                    resetOrder();
                  },
                  allLibraryData,
                )
              }
            >
              从备份恢复
            </button>
            <button
              className="secondary full"
              onClick={() =>
                action(
                  "清理未使用预览缓存",
                  () =>
                    api<number>("trim_cache").then(
                      (n) => "已清理 " + bytes(n) + " 未使用缓存",
                    ),
                  false,
                )
              }
            >
              清理过期画面预览
            </button>
          </Modal>
        )}
        {dialogs.dialog}
      </div>
    </FeedbackContext.Provider>
  );
}
installDiagnosticHooks();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
