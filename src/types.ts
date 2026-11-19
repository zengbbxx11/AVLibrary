export type MediaType = "jav" | "western" | "personal";
export interface Item {
  id: string;
  rootId: string;
  path: string;
  title: string;
  code: string;
  mediaType: MediaType;
  size: number;
  duration: number | null;
  rating: number | null;
  favorite: boolean;
  tags: string[];
  subtitle: string | null;
  subtitleConfirmation: string;
  cover: string | null;
  available: boolean;
  removed: boolean;
  addedAt: number;
  lastLaunchedAt: number | null;
  note: string;
  studio: string;
  performers: string[];
  description: string;
  releaseDate: string;
  locks: string[];
  revision: number;
  width: number | null;
  height: number | null;
  embeddedSubtitles: number | null;
  subtitleState: string;
}
export interface Root {
  id: string;
  path: string;
  mediaType: MediaType;
  enabled: boolean;
  online: boolean;
  kind: string;
  detached: boolean;
}
export interface Tag {
  id: string;
  name: string;
  groupId: string | null;
}
export interface Provider {
  id: string;
  name: string;
  mediaTypes: string[];
  searchUrl: string;
  allowedHosts: string[];
  enabled: boolean;
}
export interface Settings {
  player: string;
  playerKind: string;
  providers: Provider[];
  priorities?: Record<string, string[]>;
  scanMinutes?: number;
}
export interface Page {
  items: Item[];
  total: number;
}
export interface Entity {
  id: string;
  name: string;
  aliases?: string[];
  value?: Filters;
}
export interface Catalog {
  performers: Entity[];
  studios: Entity[];
  tag_groups: Entity[];
  saved_filters: Entity[];
}
export interface Filters {
  favorite?: boolean;
  tags?: string[];
  allTags?: boolean;
  performers?: string[];
  allPerformers?: boolean;
  studios?: string[];
  subtitle?: string;
  ratingMin?: number;
  ratingMax?: number;
  durationMin?: number;
  durationMax?: number;
  unrated?: boolean;
  targetId?: string;
}
export function normalizeFilters(value: Filters): Filters {
  const normalized = Object.fromEntries(
    Object.entries(value).filter(
      ([, v]) =>
        v !== null &&
        v !== undefined &&
        v !== false &&
        v !== "" &&
        (!Array.isArray(v) || v.length),
    ),
  ) as Filters;
  if (!normalized.tags?.length) delete normalized.allTags;
  if (!normalized.performers?.length) delete normalized.allPerformers;
  return normalized;
}
export interface Proposal {
  title: string;
  code: string;
  studio: string;
  performers: string[];
  description: string;
  releaseDate: string;
  coverUrl: string;
  sourceUrl: string;
}
export interface Job {
  id: string;
  itemId: string;
  title: string;
  state: string;
  query: string;
  provider: string;
  payload: {
    proposal?: Proposal;
    candidates?: { title: string; url: string }[];
  } | null;
  error: string;
  createdAt: number;
}
export const mediaNames: Record<MediaType, string> = {
  jav: "日本影片",
  western: "欧美影片",
  personal: "个人片段",
};
export function bytes(n: number) {
  return n >= 1073741824
    ? (n / 1073741824).toFixed(2) + " GB"
    : (n / 1048576).toFixed(1) + " MB";
}
export function minutes(n: number | null) {
  if (n == null || !Number.isFinite(n) || n <= 0) return "时长未知";
  const seconds = Math.max(1, Math.round(n));
  return seconds < 60 ? seconds + " 秒" : Math.floor(seconds / 60) + " 分钟";
}
export const subtitleNames = {
  selected: "外挂字幕已关联",
  missing: "字幕文件不可用",
  invalid: "字幕文件已变化",
  embedded: "有内嵌字幕",
  unknown: "未关联外挂 · 内嵌未检测",
  unselected: "未关联外挂 · 无内嵌",
  review: "字幕待确认",
};

export function subtitleStatus(item: Item): keyof typeof subtitleNames {
  const state = item.subtitleState;
  if (state === "missing" || state === "invalid") return state;
  if (item.subtitleConfirmation === "needs_review") return "review";
  if (state === "selected" || item.subtitle) return "selected";
  if (state === "embedded" || (item.embeddedSubtitles ?? 0) > 0)
    return "embedded";
  return item.embeddedSubtitles === 0 ? "unselected" : "unknown";
}
