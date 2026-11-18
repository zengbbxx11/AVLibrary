import React from "react";
import { Modal } from "./ui";
import { Item, Filters, Tag, mediaNames, minutes } from "./types";
export function FilterSummary({
  filters,
  tags,
  clear,
}: {
  filters: Filters;
  tags: Tag[];
  clear: (key: keyof Filters) => void;
}) {
  const labels: Partial<Record<keyof Filters, string>> = {
    favorite: "仅收藏",
    tags:
      "标签：" +
      (filters.tags || [])
        .map((id) => tags.find((t) => t.id === id)?.name || id)
        .join("、"),
    ratingMin: "评分 ≥ " + filters.ratingMin,
    ratingMax: "评分 ≤ " + filters.ratingMax,
    durationMin: "时长 ≥ " + filters.durationMin + " 分钟",
    durationMax: "时长 ≤ " + filters.durationMax + " 分钟",
    subtitle:
      "字幕：" +
      ({
        external: "外挂已选",
        embedded: "有内嵌",
        review: "待确认",
        none: "未发现",
        unknown: "未检测",
      }[filters.subtitle || ""] || filters.subtitle),
    unrated: "未评分",
    performers: "演员条件",
    studios: "厂商条件",
  };
  return (
    <div className="row wrap filter-summary">
      {Object.entries(labels)
        .filter(([key]) => {
          const v = filters[key as keyof Filters];
          return (
            v !== undefined &&
            v !== false &&
            v !== "" &&
            (!Array.isArray(v) || !!v.length)
          );
        })
        .map(([key, label]) => (
          <button
            className="tag picked"
            key={key}
            onClick={() => clear(key as keyof Filters)}
            aria-label={"移除筛选 " + label}
          >
            {label} ×
          </button>
        ))}
    </div>
  );
}
export function FilmDetails({
  item,
  close,
  edit,
  play,
}: {
  item: Item;
  close: () => void;
  edit: () => void;
  play: () => void;
}) {
  return (
    <Modal title={item.title} close={close}>
      <p>
        {mediaNames[item.mediaType]} · {minutes(item.duration)} ·{" "}
        {item.rating ? item.rating + " 星" : "未评分"}
      </p>
      <p>{item.performers?.join("、") || "未填写演员"}</p>
      <p>{item.description || "暂无简介"}</p>
      <p>{item.note || "暂无笔记"}</p>
      <p className="path muted">{item.path}</p>
      <div className="dialog-footer">
        <button className="secondary" onClick={edit}>
          编辑资料与字幕
        </button>
        <button className="primary" onClick={play}>
          播放影片
        </button>
      </div>
    </Modal>
  );
}
