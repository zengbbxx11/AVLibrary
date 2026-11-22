import React, { useEffect, useState, useRef, useMemo } from "react";
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
  type SearchSuggestion,
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
  playbackTime,
  Filters,
  normalizeFilters,
  Catalog,
  Entity,
  Provider,
} from "./types";
import {
  FilterSummary,
  FilmDetails,
  SelectionDialog,
  SubtitleStatus,
  CardTags,
} from "./workflows";
import { CompactSelect } from "./compact-select";
import { useAnchoredPopup } from "./anchored-popup";
import { FilterPanel } from "./filter-panel";
import { groupTags } from "./tag-groups";
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
      size: v.size === 230 ? 230 : 280,
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
function matchesEntity(entity: Entity | Tag, query: string) {
  const value = query.trim().toLocaleLowerCase();
  return [
    entity.name,
    ...("aliases" in entity ? entity.aliases || [] : []),
  ].some((name) => name.toLocaleLowerCase().includes(value));
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
  const entitySearch = useRef<HTMLInputElement>(null);
  const entityEditTrigger = useRef<HTMLButtonElement | null>(null);
  const [entityMenu, setEntityMenu] = useState("");
  const entityMenuTrigger = useRef<HTMLButtonElement>(null);
  const entityMenuPopup = useRef<HTMLDivElement>(null);
  useAnchoredPopup(entityMenu, entityMenuTrigger, entityMenuPopup, "end");
  const [managementReturn, setManagementReturn] = useState<{
    tab: "tags" | "categories";
    id: string;
    scrollTop: number;
  } | null>(null);
  const restoreManagement = useRef<typeof managementReturn>(null);
  const [tagGroup, setTagGroup] = useState("");
  const [unusedTagsOnly, setUnusedTagsOnly] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [mergeSource, setMergeSource] = useState<Entity | Tag | null>(null);
  const [mergeQuery, setMergeQuery] = useState("");

  const [query, setQuery] = useState(""),
    [type, setType] = useState(""),
    [removed, setRemovedView] = useState(false),
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
      items: SearchSuggestion[];
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
      mediaType: "personal",
      kind: "video",
      categoryId: "",
      newCategory: "",
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
  const [composingSearch, setComposingSearch] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const libraryTitle = useRef<HTMLHeadingElement>(null);
  const pendingLocation = useRef<string | null>(null);
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
      mediaType: "",
      removed,
      offset: page * PAGE_SIZE,
      limit: PAGE_SIZE,
      filters: { ...filters, sort, ...(type ? { categoryId: type } : {}) },
    },
    composingSearch || query === searchQuery,
    panel === "jobs",
    jobTab,
    jobPage,
    setPage,
    setJobPage,
  );
  const suggestions =
    suggestionResults?.query === query ? suggestionResults.items : [];
  const showSuggestions = focus && !composingSearch && suggestions.length > 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const categories = catalog.categories ?? [];
  const categoryName = categories.find(
    (category) => category.id === type,
  )?.name;
  const pinnedTags = useMemo(() => tags.filter((tag) => tag.pinned), [tags]);
  const managedEntities =
    entityTab === "tags" ? tags : catalog[entityTab as keyof Catalog] || [];
  const visibleEntities =
    panel === "tags" || panel === "entities"
      ? managedEntities.filter(
          (entity) =>
            (entityTab === "tags" && entityDraft?.id === entity.id) ||
            (matchesEntity(entity, entityQuery) &&
              (entityTab !== "tags" ||
                ((!tagGroup ||
                  ("groupId" in entity &&
                    (entity.groupId ?? "__none") === tagGroup)) &&
                  (!unusedTagsOnly ||
                    ("totalUsageCount" in entity &&
                      entity.totalUsageCount === 0))))),
        )
      : [];
  const singleSelectedTag =
    selectedTags.length === 1
      ? tags.find((tag) => tag.id === selectedTags[0])
      : undefined;
  const entitySections =
    entityTab === "tags"
      ? groupTags(visibleEntities, catalog.tag_groups)
      : [{ id: entityTab, name: "", tags: visibleEntities }];
  useEffect(() => {
    const state = restoreManagement.current;
    if (!state || panel !== (state.tab === "tags" ? "tags" : "entities"))
      return;
    const frame = requestAnimationFrame(() => {
      restoreManagement.current = null;
      const dialog = entitySearch.current?.closest("[data-app-dialog]");
      if (!dialog) return;
      const link = Array.from(
        dialog.querySelectorAll<HTMLButtonElement>("[data-browse-entity]"),
      ).find((button) => button.dataset.browseEntity === state.id);
      dialog.scrollTop = state.scrollTop;
      link?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [panel]);
  const hasSearchCriteria = !!query.trim() || Object.keys(filters).length > 0;
  const offlineRoots = useMemo(
    () => new Set(roots.filter((root) => !root.online).map((root) => root.id)),
    [roots],
  );
  const tagsById = useMemo(
    () => new Map(tags.map((tag) => [tag.id, tag])),
    [tags],
  );
  useEffect(() => {
    if (composingSearch) return;
    const timer = setTimeout(() => setSearchQuery(query), 220);
    return () => clearTimeout(timer);
  }, [query, composingSearch]);
  useEffect(() => {
    try {
      localStorage.setItem("avlibrary-view", JSON.stringify({ size, sort }));
    } catch {}
  }, [size, sort]);
  useEffect(() => setActionError(""), [panel, editing?.id, entityDraft?.name]);
  useEffect(() => {
    if (!focus || composingSearch || !query.trim()) return;
    let live = true;
    const timer = setTimeout(() => {
      libraryApi
        .suggestions(query)
        .then((items) => {
          if (live) setSuggestionResults({ query, items });
        })
        .catch(() => {});
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [focus, query, composingSearch]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 5500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    const id = pendingLocation.current;
    if (!id) return;
    if (filters.targetId !== id) {
      pendingLocation.current = null;
      return;
    }
    if (loading) return;
    pendingLocation.current = null;
    if (document.activeElement === libraryTitle.current) focusLocatedCard(id);
  }, [filters.targetId, loading]);
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
      setRootDraft({
        path,
        mediaType: "personal",
        kind: "video",
        categoryId: "",
        newCategory: "",
      });
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
  function setRemoved(value: boolean) {
    if (value === removed) return;
    setSelected([]);
    setRemovedView(value);
  }
  function changePage(next: number) {
    setPage(next);
    libraryTitle.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
  function showAllFilms() {
    setManagementReturn(null);
    setQuery("");
    setSearchQuery("");
    setFilters({});
    setType("");
    setRemoved(false);
    setPrevious(null);
    setHighlight("");
    setFocus(false);
    changePage(0);
  }
  function browseFilmsWith(criteria: Filters) {
    setDetail(null);
    setPanel("");
    showAllFilms();
    setFilter(criteria);
  }
  function focusLocatedCard(id: string) {
    const card = document.getElementById("item-" + id);
    card?.focus({ preventScroll: true });
    card?.scrollIntoView({ block: "center" });
  }
  function locate(item: SearchSuggestion) {
    setFocus(false);
    if (items.some((i) => i.id === item.id)) {
      pendingLocation.current = null;
      setHighlight(item.id);
      focusLocatedCard(item.id);
      return;
    }
    setPrevious({ type, filters, query, page, removed });
    scroll.current = window.scrollY;
    setType("");
    setRemoved(false);
    setPage(0);
    setFilters({ targetId: item.id });
    setHighlight("");
    pendingLocation.current = item.id;
    libraryTitle.current?.focus({ preventScroll: true });
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
    await action(
      "批量更新",
      () =>
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
      ["items", "catalog"],
    );
  }
  const setFilter = (value: Filters) => {
    setFilters(normalizeFilters(value));
    setPage(0);
  };
  async function closeEditor() {
    if (busy) return false;
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
      return false;
    setEditing(null);
    return true;
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
  async function createEditorTag(forBatch = false) {
    const name = tagName.trim();
    if (!name || (!forBatch && !editing)) return;
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
        const tagId = tag.id;
        if (forBatch) {
          setBatchTags((current) => Array.from(new Set([...current, tagId])));
        } else {
          setEditing(
            (current) =>
              current && {
                ...current,
                tags: Array.from(new Set([...current.tags, tagId])),
              },
          );
        }
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
  function finishEntityEdit() {
    setEntityDraft(null);
    if (entityEditTrigger.current?.isConnected)
      entityEditTrigger.current.focus();
    else entitySearch.current?.focus();
  }
  function resetEntityList(tab: string) {
    setEntityMenu("");
    setEntityTab(tab);
    setEntityQuery("");
    setTagGroup("");
    setUnusedTagsOnly(false);
    setSelectedTags([]);
    setMergeSource(null);
  }
  function openManagement(tab: string) {
    setManagementReturn(null);
    resetEntityList(tab);
    setPanel(tab === "tags" ? "tags" : "entities");
    void refresh("catalog").catch((error) => setToast(String(error)));
  }
  function openMerge(entity: Entity | Tag) {
    setEntityDraft(null);
    setMergeQuery("");
    setMergeSource(entity);
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
      setEntityMenu("");
      setPanel("");
    }
  }
  function renderEntityForm() {
    return (
      entityDraft && (
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
                  : entityTab === "categories"
                    ? api("save_category", {
                        key: draft.id,
                        name: draft.name.trim(),
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
            if (ok) {
              if (
                entityTab === "tags" &&
                (!matchesEntity(
                  { id: draft.id, name: draft.name },
                  entityQuery,
                ) ||
                  (tagGroup && tagGroup !== (draft.groupId || "__none")))
              ) {
                setEntityQuery("");
                setTagGroup("");
              }
              finishEntityEdit();
            }
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
            <div className="entity-group-field">
              <span>标签分组</span>
              <CompactSelect
                label="标签分组"
                value={entityDraft.groupId}
                onChange={(groupId) =>
                  setEntityDraft({
                    ...entityDraft,
                    groupId,
                  })
                }
                options={[
                  { value: "", label: "未分组" },
                  ...catalog.tag_groups.map(({ id, name }) => ({
                    value: id,
                    label: name,
                  })),
                ]}
              />
            </div>
          )}
          {entityTab === "performers" && (
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
                if (await discardEntityDraft()) finishEntityEdit();
              }}
            >
              取消编辑
            </button>
            <button className="primary" disabled={!entityDraft.name.trim()}>
              保存{entityTab === "tags" ? "标签" : "项目"}
            </button>
          </div>
        </form>
      )
    );
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
            onClick={showAllFilms}
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
            {categories.length > 0 && (
              <div
                className="category-nav"
                role="group"
                aria-label="按分类浏览"
              >
                {categories.map(({ id, name }) => (
                  <button
                    className={type === id && !removed ? "active" : ""}
                    aria-current={type === id && !removed ? "page" : undefined}
                    key={id}
                    onClick={() => {
                      setType(id);
                      setRemoved(false);
                      setPage(0);
                    }}
                  >
                    <Film size={18} />
                    <span className="category-name" title={name}>
                      {name}
                    </span>
                  </button>
                ))}
              </div>
            )}
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
          <nav aria-label="标签">
            <button onClick={() => openManagement("tags")}>
              <Tags size={17} />
              标签管理
            </button>
          </nav>
          {pinnedTags.length > 0 && (
            <>
              <div className="section-label">常用标签</div>
              <div className="tag-list">
                {pinnedTags.map((t) => (
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
            </>
          )}
          <nav className="sidebar-bottom" aria-label="资料与系统管理">
            <div className="section-label management-label">管理</div>
            <button onClick={() => openManagement("categories")}>
              <Library size={17} />
              分类管理
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
            <div
              className="search-wrap"
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node))
                  setFocus(false);
              }}
            >
              <Search size={19} />
              <input
                ref={searchInput}
                aria-label="搜索影片"
                aria-expanded={showSuggestions}
                aria-controls={
                  showSuggestions ? "search-suggestions" : undefined
                }
                placeholder="搜索番号、片名、演员、标签…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setFocus(true);
                  if (
                    !composingSearch &&
                    !(e.nativeEvent as InputEvent).isComposing
                  ) {
                    setPage(0);
                    if (filters.targetId) setFilters({});
                  }
                }}
                onCompositionStart={() => setComposingSearch(true)}
                onCompositionEnd={(e) => {
                  setComposingSearch(false);
                  setQuery(e.currentTarget.value);
                  setPage(0);
                  if (filters.targetId) setFilters({});
                }}
                onFocus={() => setFocus(true)}
                onKeyDown={(e) => {
                  if (composingSearch || e.nativeEvent.isComposing) return;
                  if (e.key === "Escape" || e.key === "Enter") {
                    if (e.key === "Enter") setSearchQuery(query);
                    setFocus(false);
                  }
                  if (e.key === "ArrowDown" && showSuggestions) {
                    e.preventDefault();
                    e.currentTarget.parentElement
                      ?.querySelector<HTMLButtonElement>(
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
                    setSearchQuery("");
                    setPage(0);
                    if (filters.targetId)
                      setFilter({ ...filters, targetId: undefined });
                    searchInput.current?.focus();
                    setFocus(false);
                  }}
                >
                  <X size={16} />
                </button>
              )}
              {showSuggestions && (
                <div
                  className="suggestions"
                  id="search-suggestions"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      searchInput.current?.focus();
                      setFocus(false);
                    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                      e.preventDefault();
                      const buttons = Array.from(
                        e.currentTarget.querySelectorAll("button"),
                      );
                      const index = buttons.findIndex(
                        (button) => button === e.target,
                      );
                      const next = index + (e.key === "ArrowDown" ? 1 : -1);
                      if (next < 0) searchInput.current?.focus();
                      else buttons[next]?.focus();
                    }
                  }}
                >
                  {suggestions.map((i) => (
                    <button key={i.id} onClick={() => locate(i)}>
                      <Film size={18} />
                      <span>
                        {i.title}
                        {i.code && <small>{i.code}</small>}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
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
                className={"filter-chip" + (filterOpen ? " filter-active" : "")}
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
            <div className="toolbar library-view-toolbar">
              <div className="library-heading-row">
                <h1
                  className="library-heading"
                  ref={libraryTitle}
                  tabIndex={-1}
                >
                  {removed ? "已移出项目" : categoryName || "全部影片"}
                </h1>
                <span className="library-count" role="status">
                  {loading
                    ? "正在读取资料…"
                    : loadError && !items.length
                      ? ""
                      : `${total} 部影片`}
                </span>
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
                <div
                  className="card-density"
                  role="group"
                  aria-label="卡片大小"
                >
                  <button
                    type="button"
                    aria-pressed={size === 280}
                    onClick={() => setSize(280)}
                  >
                    中
                  </button>
                  <button
                    type="button"
                    aria-pressed={size === 230}
                    onClick={() => setSize(230)}
                  >
                    小
                  </button>
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
                  disabled={loading || items.length === 0}
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
                    setTagName("");
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
              {managementReturn && (
                <button
                  className="secondary return-management"
                  onClick={() => {
                    restoreManagement.current = managementReturn;
                    setPanel(
                      managementReturn.tab === "tags" ? "tags" : "entities",
                    );
                    setManagementReturn(null);
                  }}
                >
                  返回{managementReturn.tab === "tags" ? "标签" : "分类"}管理
                </button>
              )}
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
                data-density={size === 230 ? "small" : "medium"}
              >
                {items.map((item) => (
                  <article
                    key={item.id}
                    id={"item-" + item.id}
                    tabIndex={-1}
                    aria-labelledby={"item-title-" + item.id}
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
                      {item.categoryId && (
                        <span className="media-badge">
                          {
                            categories.find(
                              (category) => category.id === item.categoryId,
                            )?.name
                          }
                        </span>
                      )}
                      <span className="card-runtime">
                        {playbackTime(item.duration)}
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
                        <h2 id={"item-title-" + item.id} title={item.title}>
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
                          {typeof item.size === "number" &&
                          Number.isFinite(item.size)
                            ? bytes(item.size)
                            : "大小未知"}
                        </span>
                        <span>
                          {item.width && item.height
                            ? `${item.width}×${item.height}`
                            : "分辨率未知"}
                        </span>
                      </div>
                      {!!item.performers?.length && (
                        <div className="people-line">
                          {item.performers.join(" / ")}
                        </div>
                      )}
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
                        <SubtitleStatus item={item} />
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
                      </div>
                      <CardTags ids={item.tags} tags={tagsById} />
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
                    ? hasSearchCriteria
                      ? "没有找到匹配的移出项目"
                      : "暂无移出项目"
                    : hasSearchCriteria
                      ? "没有找到匹配影片"
                      : categoryName
                        ? "暂无" + categoryName
                        : "从一个文件夹开始"}
                </h2>
                <p>
                  {hasSearchCriteria
                    ? "可以调整搜索或筛选条件，或查看全部影片。"
                    : removed
                      ? "移出的影片会保留个人资料，可在这里恢复。"
                      : type
                        ? "可以查看全部影片，或添加包含此类影片的文件夹。"
                        : "添加本地影片，建立属于你的私人资料库。先扫描本地，联网资料由你手动获取。"}
                </p>
                {hasSearchCriteria || (type && !removed) ? (
                  <button className="secondary" onClick={showAllFilms}>
                    查看全部影片
                  </button>
                ) : removed ? (
                  <button className="secondary" onClick={showAllFilms}>
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
              <div className="row" role="navigation" aria-label="资料库分页">
                <button
                  className="icon"
                  aria-label="上一页"
                  disabled={loading || page === 0}
                  onClick={() => changePage(page - 1)}
                >
                  <ChevronLeft size={17} />
                </button>
                <span aria-current="page">
                  {loading
                    ? `第 ${page + 1} 页`
                    : `第 ${page + 1} / ${pageCount} 页`}
                </span>
                <button
                  className="icon"
                  aria-label="下一页"
                  disabled={loading || page + 1 >= pageCount}
                  onClick={() => changePage(page + 1)}
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
            actors={catalog.performers}
            browseActor={(id) => browseFilmsWith({ performers: [id] })}
            category={
              categories.find((category) => category.id === detail.categoryId)
                ?.name
            }
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
              分类
              <select
                value={editing.categoryId ?? ""}
                onChange={(e) =>
                  setEditing({ ...editing, categoryId: e.target.value })
                }
              >
                <option value="">未分类</option>
                {categories.map(({ id, name }) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              资料来源
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
            <button
              type="button"
              className="secondary actor-management"
              onClick={() => openManagement("performers")}
            >
              管理演员资料
            </button>
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
              values={tags.filter(
                (tag) =>
                  editing.tags.includes(tag.id) ||
                  tag.name
                    .toLocaleLowerCase()
                    .includes(tagName.trim().toLocaleLowerCase()),
              )}
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
                placeholder="搜索或创建标签"
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
                  <p className="muted">此影片设为仅本地整理。</p>
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
              <>
                <label>
                  新入库视频的默认分类
                  <select
                    value={rootDraft.categoryId}
                    onChange={(e) =>
                      setRootDraft({ ...rootDraft, categoryId: e.target.value })
                    }
                  >
                    <option value="">未分类</option>
                    {categories.map(({ id, name }) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                    <option value="__new">新建分类…</option>
                  </select>
                </label>
                {rootDraft.categoryId === "__new" && (
                  <label>
                    新分类名称
                    <input
                      maxLength={80}
                      value={rootDraft.newCategory}
                      onChange={(e) =>
                        setRootDraft({
                          ...rootDraft,
                          newCategory: e.target.value,
                        })
                      }
                    />
                  </label>
                )}
                <label>
                  资料来源
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
              </>
            )}
            <button
              className="primary full"
              disabled={
                rootDraft.kind === "video" &&
                rootDraft.categoryId === "__new" &&
                !rootDraft.newCategory.trim()
              }
              onClick={() =>
                action(
                  "添加目录",
                  async () => {
                    await api("add_root", {
                      path: rootDraft.path,
                      mediaType: rootDraft.mediaType,
                      kind: rootDraft.kind,
                      ...(rootDraft.kind === "video" && rootDraft.categoryId
                        ? rootDraft.categoryId === "__new"
                          ? { newCategory: rootDraft.newCategory.trim() }
                          : { categoryId: rootDraft.categoryId }
                        : {}),
                    });
                    setPanel("roots");
                  },
                  ["roots", "catalog"],
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
                      : categories.find(
                          (category) => category.id === r.categoryId,
                        )?.name || "未分类"}
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
                    <>
                      <select
                        aria-label={"新入库默认分类 " + r.path}
                        value={r.categoryId ?? ""}
                        onChange={(e) =>
                          action(
                            "修改目录默认分类",
                            () =>
                              api("set_root_category", {
                                rootId: r.id,
                                categoryId: e.target.value || null,
                              }),
                            ["roots", "catalog"],
                          )
                        }
                      >
                        <option value="">未分类</option>
                        {categories.map(({ id, name }) => (
                          <option key={id} value={id}>
                            {name}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label={"新入库资料来源 " + r.path}
                        value={r.mediaType}
                        onChange={(e) =>
                          action(
                            "修改新入库资料来源",
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
                    </>
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
            <label>
              搜索或创建标签
              <input
                value={tagName}
                onChange={(e) => setTagName(e.target.value)}
                maxLength={80}
              />
            </label>
            {tagName.trim() && (
              <button
                className="secondary"
                onClick={() => void createEditorTag(true)}
              >
                创建并选中
              </button>
            )}
            <ToggleList
              values={tags.filter(
                (tag) =>
                  batchTags.includes(tag.id) ||
                  tag.name
                    .toLocaleLowerCase()
                    .includes(tagName.trim().toLocaleLowerCase()),
              )}
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
                <option value="">选择分类</option>
                <option value="__none">未分类</option>
                {categories.map(({ id, name }) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary full"
              disabled={!batchType || !selected.length}
              onClick={() =>
                batch({ categoryId: batchType === "__none" ? "" : batchType })
              }
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
        {(panel === "entities" || panel === "tags") && (
          <Modal
            title={
              panel === "tags"
                ? "标签管理"
                : entityTab === "performers"
                  ? "演员资料管理"
                  : "分类管理"
            }
            close={closeEntities}
            wide
          >
            {panel === "tags" && (
              <div className="row tabs wrap">
                {[
                  ["tags", "全部标签"],
                  ["tag_groups", "分组管理"],
                ].map(([id, name]) => (
                  <button
                    key={id}
                    aria-pressed={entityTab === id}
                    className={entityTab === id ? "tag picked" : "tag"}
                    onClick={async () => {
                      if (await discardEntityDraft()) {
                        resetEntityList(id);
                        setEntityDraft(null);
                      }
                    }}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
            <div className="row entity-toolbar">
              <input
                ref={entitySearch}
                aria-label={entityTab === "tags" ? "搜索标签" : "搜索管理项目"}
                placeholder={
                  entityTab === "performers"
                    ? "搜索名称或别名"
                    : entityTab === "tags"
                      ? "搜索标签"
                      : "搜索名称"
                }
                value={entityQuery}
                onChange={(e) => setEntityQuery(e.target.value)}
              />
              <button
                className="primary"
                onClick={async (event) => {
                  const trigger = event.currentTarget;
                  if (await discardEntityDraft()) {
                    entityEditTrigger.current = trigger;
                    openEntityDraft({
                      id: crypto.randomUUID(),
                      name: "",
                      aliases: "",
                      groupId:
                        entityTab === "tags" && tagGroup !== "__none"
                          ? tagGroup
                          : "",
                    });
                  }
                }}
              >
                新增
                {entityTab === "tags"
                  ? "标签"
                  : entityTab === "tag_groups"
                    ? "分组"
                    : entityTab === "categories"
                      ? "分类"
                      : "演员"}
              </button>
            </div>
            {entityTab === "tags" && (
              <div className="row wrap entity-filters">
                <CompactSelect
                  label="按标签分组筛选"
                  value={tagGroup}
                  onChange={setTagGroup}
                  options={[
                    { value: "", label: "全部分组" },
                    { value: "__none", label: "未分组" },
                    ...catalog.tag_groups.map(({ id, name }) => ({
                      value: id,
                      label: name,
                    })),
                  ]}
                />
                <label className="row">
                  <input
                    type="checkbox"
                    checked={unusedTagsOnly}
                    onChange={(e) => setUnusedTagsOnly(e.target.checked)}
                  />
                  仅未使用
                </label>
                <span className="muted" role="status">
                  {visibleEntities.length} 个标签
                </span>
              </div>
            )}
            {entityTab === "tags" && selectedTags.length > 0 && (
              <div className="row wrap entity-filters">
                <span role="status">已选 {selectedTags.length} 个标签</span>
                <button
                  className="secondary"
                  onClick={() => setSelectedTags([])}
                >
                  清空选择
                </button>
                <select
                  aria-label="批量换组"
                  value=""
                  onChange={async (e) => {
                    const group = e.target.value;
                    if (!group) return;
                    if (
                      await action(
                        "标签换组",
                        () =>
                          api("organize_tags", {
                            tagIds: selectedTags,
                            groupId: group === "__none" ? null : group,
                            removeUnused: false,
                          }),
                        ["catalog"],
                      )
                    )
                      setSelectedTags([]);
                  }}
                >
                  <option value="">移动到分组…</option>
                  <option value="__none">未分组</option>
                  {catalog.tag_groups.map(({ id, name }) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
                <button
                  className="secondary"
                  disabled={
                    !selectedTags.every(
                      (id) =>
                        tags.find((tag) => tag.id === id)?.totalUsageCount ===
                        0,
                    )
                  }
                  onClick={async () => {
                    if (
                      await askConfirm(
                        `删除选中的 ${selectedTags.length} 个未使用标签？`,
                        "清理标签",
                        "确认删除",
                      )
                    ) {
                      if (
                        await action(
                          "删除未使用标签",
                          () =>
                            api("organize_tags", {
                              tagIds: selectedTags,
                              groupId: null,
                              removeUnused: true,
                            }),
                          ["catalog"],
                        )
                      )
                        setSelectedTags([]);
                    }
                  }}
                >
                  删除未使用标签
                </button>
                {singleSelectedTag && (
                  <>
                    <button
                      className="secondary"
                      aria-pressed={!!singleSelectedTag.pinned}
                      onClick={() =>
                        action(
                          "更新常用标签",
                          () =>
                            api("pin_tag", {
                              tagId: singleSelectedTag.id,
                              pinned: !singleSelectedTag.pinned,
                            }),
                          ["catalog"],
                        )
                      }
                    >
                      {singleSelectedTag.pinned ? "取消固定" : "固定到侧栏"}
                    </button>
                    <button
                      className="secondary"
                      disabled={tags.length < 2}
                      onClick={async () => {
                        if (await discardEntityDraft())
                          openMerge(singleSelectedTag);
                      }}
                    >
                      合并到…
                    </button>
                  </>
                )}
              </div>
            )}
            {(!entityDraft ||
              entityTab !== "tags" ||
              !tags.some((tag) => tag.id === entityDraft.id)) &&
              renderEntityForm()}
            {entitySections.map((section) => (
              <section
                key={section.id}
                className={
                  entityTab === "tags"
                    ? "manage-tag-group"
                    : entityTab === "categories"
                      ? "manage-categories"
                      : undefined
                }
              >
                {section.name && (
                  <h3>
                    {section.name}
                    <small>{section.tags.length} 个</small>
                  </h3>
                )}
                <div
                  className={
                    entityTab === "tags"
                      ? "manage-tag-chips"
                      : entityTab === "categories"
                        ? "manage-category-grid"
                        : undefined
                  }
                >
                  {section.tags.map((entity: Entity | Tag) => (
                    <React.Fragment key={entity.id}>
                      <div
                        className="root-row entity-row"
                        data-popup-open={entityMenu === entity.id || undefined}
                        onKeyDown={(event) => {
                          if (
                            event.key !== "Escape" ||
                            entityMenu !== entity.id
                          )
                            return;
                          event.preventDefault();
                          event.stopPropagation();
                          entityMenuTrigger.current?.focus();
                          setEntityMenu("");
                        }}
                      >
                        {entityTab === "tags" && (
                          <input
                            type="checkbox"
                            aria-label={"选择 " + entity.name}
                            checked={selectedTags.includes(entity.id)}
                            onChange={(e) =>
                              setSelectedTags(
                                e.target.checked
                                  ? [...selectedTags, entity.id]
                                  : selectedTags.filter(
                                      (id) => id !== entity.id,
                                    ),
                              )
                            }
                          />
                        )}
                        <div>
                          {entityTab === "categories" ||
                          entityTab === "performers" ||
                          ("groupId" in entity && entity.usageCount) ? (
                            <button
                              className="tag-film-link"
                              data-browse-entity={entity.id}
                              aria-label={
                                "usageCount" in entity
                                  ? `查看「${entity.name}」的 ${entity.usageCount} 部影片`
                                  : `查看「${entity.name}」的影片`
                              }
                              onClick={async (event) => {
                                const position =
                                  event.currentTarget.closest(
                                    "[data-app-dialog]",
                                  )?.scrollTop || 0;
                                if (!(await discardEntityDraft())) return;
                                if (
                                  entityTab === "performers" &&
                                  editing &&
                                  !(await closeEditor())
                                )
                                  return;
                                setEntityDraft(null);
                                setEntityMenu("");
                                browseFilmsWith(
                                  entityTab === "performers"
                                    ? { performers: [entity.id] }
                                    : entityTab === "tags"
                                      ? { tags: [entity.id] }
                                      : {},
                                );
                                if (entityTab === "categories")
                                  setType(entity.id);
                                if (
                                  entityTab === "categories" ||
                                  entityTab === "tags"
                                )
                                  setManagementReturn({
                                    tab: entityTab,
                                    id: entity.id,
                                    scrollTop: position,
                                  });
                              }}
                            >
                              {entity.name}
                            </button>
                          ) : (
                            <b>{entity.name}</b>
                          )}
                          {"aliases" in entity && (
                            <small>{entity.aliases?.join(" / ")}</small>
                          )}
                          {"groupId" in entity && (
                            <small>
                              {entity.usageCount ?? 0} 部
                              {entity.pinned && " · 已固定"}
                            </small>
                          )}
                          {entityTab === "categories" &&
                            "itemCount" in entity && (
                              <small>
                                {entity.itemCount} 部影片 · {entity.rootCount}{" "}
                                个默认目录
                              </small>
                            )}
                        </div>
                        {(entityTab === "tags" ||
                          entityTab === "categories") && (
                          <button
                            ref={
                              entityMenu === entity.id
                                ? entityMenuTrigger
                                : undefined
                            }
                            type="button"
                            className="entity-menu-button icon"
                            data-entity-menu={entity.id}
                            aria-label={"管理 " + entity.name}
                            aria-expanded={entityMenu === entity.id}
                            onClick={() =>
                              setEntityMenu(
                                entityMenu === entity.id ? "" : entity.id,
                              )
                            }
                          >
                            <MoreHorizontal size={17} />
                          </button>
                        )}
                        <div
                          ref={
                            entityMenu === entity.id
                              ? entityMenuPopup
                              : undefined
                          }
                          className={
                            entityTab === "tags" || entityTab === "categories"
                              ? "entity-menu anchored-popup"
                              : "row wrap"
                          }
                          hidden={
                            (entityTab === "tags" ||
                              entityTab === "categories") &&
                            entityMenu !== entity.id
                          }
                          onBlur={(event) => {
                            const trigger =
                              event.currentTarget.previousElementSibling;
                            if (
                              entityMenu === entity.id &&
                              event.relatedTarget !== trigger &&
                              !event.currentTarget.contains(event.relatedTarget)
                            )
                              setEntityMenu("");
                          }}
                        >
                          <button
                            aria-label={
                              entityTab === "tags" || entityTab === "categories"
                                ? "编辑 " + entity.name
                                : undefined
                            }
                            onClick={async (event) => {
                              const trigger = event.currentTarget;
                              if (await discardEntityDraft()) {
                                entityEditTrigger.current =
                                  (trigger.parentElement
                                    ?.previousElementSibling as HTMLButtonElement | null) ||
                                  trigger;
                                setEntityMenu("");
                                openEntityDraft({
                                  id: entity.id,
                                  name: entity.name,
                                  aliases:
                                    "aliases" in entity
                                      ? (entity.aliases || []).join(",")
                                      : "",
                                  groupId:
                                    "groupId" in entity
                                      ? entity.groupId || ""
                                      : "",
                                });
                              }
                            }}
                          >
                            编辑
                          </button>
                          {entityTab === "performers" && (
                            <button
                              aria-label={"合并 " + entity.name}
                              onClick={async () => {
                                if (!(await discardEntityDraft())) return;
                                openMerge(entity);
                              }}
                            >
                              合并
                            </button>
                          )}
                          <button
                            aria-label={"删除 " + entity.name}
                            onClick={async () => {
                              const table = entityTab;
                              if (
                                await askConfirm(
                                  table === "categories"
                                    ? `删除分类「${entity.name}」？${"itemCount" in entity ? `${entity.itemCount} 部影片及 ${entity.rootCount} 个目录的默认分类会变为未分类。` : "分类中的影片及使用此默认分类的文件夹会变为未分类。"}`
                                    : table === "tag_groups"
                                      ? `删除分组「${entity.name}」？其中的标签会变为未分组。`
                                      : "totalUsageCount" in entity
                                        ? `删除标签「${entity.name}」？将解除 ${entity.totalUsageCount ?? 0} 部影片的标签关联，影片文件会保留。`
                                        : `删除「${entity.name}」及其关联？影片文件会保留。`,
                                  table === "tags"
                                    ? "删除标签"
                                    : "删除管理项目",
                                  "确认删除",
                                )
                              )
                                if (
                                  await action(
                                    "删除管理项目",
                                    () =>
                                      table === "tags"
                                        ? api("delete_tag", {
                                            tagId: entity.id,
                                          })
                                        : table === "categories"
                                          ? api("delete_category", {
                                              key: entity.id,
                                            })
                                          : api("delete_entity", {
                                              table,
                                              key: entity.id,
                                            }),
                                    table === "categories"
                                      ? ["catalog", "items", "roots"]
                                      : ["catalog", "items"],
                                  )
                                ) {
                                  setEntityMenu("");
                                  setSelectedTags((ids) =>
                                    ids.filter((id) => id !== entity.id),
                                  );
                                  if (
                                    table === "categories" &&
                                    type === entity.id
                                  )
                                    showAllFilms();
                                  if (
                                    table === "tags" &&
                                    filters.tags?.includes(entity.id)
                                  ) {
                                    setFilter({
                                      ...filters,
                                      tags: filters.tags.filter(
                                        (id) => id !== entity.id,
                                      ),
                                    });
                                  }
                                  if (entityDraft?.id === entity.id)
                                    setEntityDraft(null);
                                  entitySearch.current?.focus();
                                }
                            }}
                          >
                            {entityTab === "tags" ? (
                              "删除"
                            ) : (
                              <Trash2 size={16} />
                            )}
                          </button>
                        </div>
                      </div>
                      {entityTab === "tags" &&
                        entityDraft?.id === entity.id &&
                        renderEntityForm()}
                    </React.Fragment>
                  ))}
                </div>
              </section>
            ))}
            {!visibleEntities.length && (
              <p className="empty-hint">
                {entityTab === "tags"
                  ? managedEntities.length
                    ? "没有符合当前条件的标签"
                    : "还没有标签，可点「新增标签」创建。"
                  : managedEntities.length
                    ? "没有匹配的项目"
                    : "暂无项目"}
              </p>
            )}
          </Modal>
        )}
        {(panel === "entities" || panel === "tags") && mergeSource && (
          <Modal
            title={`合并「${mergeSource.name}」`}
            close={() => setMergeSource(null)}
          >
            <label>
              搜索要保留的项目
              <input
                autoFocus
                value={mergeQuery}
                onChange={(e) => setMergeQuery(e.target.value)}
              />
            </label>
            {managedEntities
              .filter(
                (target) =>
                  target.id !== mergeSource.id &&
                  matchesEntity(target, mergeQuery),
              )
              .map((target) => (
                <button
                  key={target.id}
                  className="secondary full"
                  onClick={async () => {
                    const source = mergeSource;
                    const affected =
                      "totalUsageCount" in source
                        ? `涉及 ${source.totalUsageCount ?? 0} 部关联影片。`
                        : "";
                    if (
                      await askConfirm(
                        `将「${source.name}」并入「${target.name}」。${affected}合并后保留「${target.name}」，并自动备份。`,
                        "确认合并",
                        "确认合并",
                      )
                    ) {
                      if (
                        await action(
                          "合并资料",
                          () =>
                            api("merge_entity", {
                              table: entityTab,
                              source: source.id,
                              target: target.id,
                            }),
                          ["catalog", "items"],
                        )
                      ) {
                        if (
                          entityTab === "tags" &&
                          filters.tags?.includes(source.id)
                        ) {
                          setFilter({
                            ...filters,
                            tags: Array.from(
                              new Set(
                                filters.tags.map((tag) =>
                                  tag === source.id ? target.id : tag,
                                ),
                              ),
                            ),
                          });
                        }
                        setSelectedTags((ids) =>
                          ids.filter((id) => id !== source.id),
                        );
                        setMergeSource(null);
                      }
                    }
                  }}
                >
                  {target.name}
                </button>
              ))}
          </Modal>
        )}
        {panel === "settings" && (
          <Modal title="播放器与资料来源" close={closeSettings} wide>
            <div className="settings-pane">
              <section className="settings-section">
                <h3>播放与字幕</h3>
                <p className="muted">
                  不设置路径时使用系统默认程序播放。需要自动加载已选外挂字幕时，请选择下面支持的播放器。
                </p>

                <div className="settings-fields">
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
                </div>
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
              </section>
              <section className="settings-section">
                <h3>目录核对</h3>
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
              </section>
              <section className="settings-section">
                <details>
                  <summary>本机环境与数据目录</summary>
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
                        版本：{systemInfo.version} · 数据目录：
                        {systemInfo.dataPath}
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
                          action(
                            "打开数据目录",
                            () => api("reveal_data"),
                            false,
                          )
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
                </details>
              </section>
              <section className="settings-section">
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
                    点击获取资料时才查询。设为仅本地整理的影片会跳过。来源可能限制访问，所有结果先核查再保存。来源域名和图片
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
                                providers: v.providers.filter(
                                  (x) => x.id !== p.id,
                                ),
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
              </section>
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
            </div>
          </Modal>
        )}
        {panel === "scrape" && (
          <Modal title="获取影片资料" close={() => setPanel("")}>
            <p className="muted">
              选中 {scrapeIds.length}{" "}
              部。设为仅本地整理的影片会跳过。已有人工保护字段会保留。
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
                    showAllFilms();
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
