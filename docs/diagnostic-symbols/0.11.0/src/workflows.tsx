import React, { useEffect, useState, useRef } from "react";
import { api } from "./api";
import { Modal } from "./ui";
import { Item, Filters, Tag, Catalog, mediaNames, minutes } from "./types";
export function FilterSummary({
  filters,
  tags,
  catalog,
  clear,
}: {
  filters: Filters;
  tags: Tag[];
  catalog: Catalog;
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
    performers:
      "演员：" +
      (filters.performers || [])
        .map((id) => catalog.performers.find((v) => v.id === id)?.name || id)
        .join("、"),
    studios:
      "厂商：" +
      (filters.studios || [])
        .map((id) => catalog.studios.find((v) => v.id === id)?.name || id)
        .join("、"),
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

interface SelectedPage {
  items: { id: string; title: string; removed: boolean; available: boolean }[];
  total: number;
}
export function SelectionDialog({
  selected,
  close,
  remove,
}: {
  selected: string[];
  close: () => void;
  remove: (id: string) => void;
}) {
  const [page, setPage] = useState(0),
    [retry, setRetry] = useState(0);
  const [result, setResult] = useState<SelectedPage>({ items: [], total: 0 });
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const request = useRef<{
    key: string;
    promise: Promise<SelectedPage>;
  } | null>(null);
  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError("");
    const key = JSON.stringify([selected, page, retry]);
    if (request.current?.key !== key)
      request.current = {
        key,
        promise: api<SelectedPage>("selected_items", {
          ids: selected,
          offset: page * 50,
        }),
      };
    request.current.promise
      .then((value) => {
        if (disposed) return;
        const last = Math.max(0, Math.ceil(value.total / 50) - 1);
        if (page > last) {
          setPage(last);
          return;
        }
        setResult(value);
        setLoading(false);
      })
      .catch((e) => {
        if (!disposed) {
          setError(String(e));
          setLoading(false);
        }
      });
    return () => {
      disposed = true;
    };
  }, [selected, page, retry]);
  return (
    <Modal title={"已选影片 · " + selected.length + " 部"} close={close}>
      <p className="muted">每页显示 50 部。取消选择只影响本次批量范围。</p>
      {loading ? (
        <p role="status">正在读取已选影片…</p>
      ) : error ? (
        <div role="alert">
          <p>{error}</p>
          <button onClick={() => setRetry((v) => v + 1)}>
            重试读取已选影片
          </button>
        </div>
      ) : (
        <>
          {result.total < selected.length && (
            <p className="notice">
              部分已选资料已被合并或不再存在，列表只显示仍可管理的影片。
            </p>
          )}
          {result.total === 0 && <p>没有可显示的已选影片。</p>}
          {result.items.map((item) => (
            <div className="root-row" key={item.id}>
              <span>
                {item.title}
                {item.removed && <small className="muted"> · 已移出库</small>}
                {!item.available && (
                  <small className="muted"> · 文件离线</small>
                )}
              </span>
              <button
                aria-label={"取消选择 " + item.title}
                onClick={() => remove(item.id)}
              >
                取消选择
              </button>
            </div>
          ))}
          <div className="row sticky-actions selection-pagination">
            <button
              aria-label="上一页已选影片"
              disabled={page === 0}
              onClick={() => setPage((v) => v - 1)}
            >
              上一页
            </button>
            <span>
              第 {page + 1} / {Math.max(1, Math.ceil(result.total / 50))} 页 ·
              可查看 {result.total} 部
            </span>
            <button
              aria-label="下一页已选影片"
              disabled={(page + 1) * 50 >= result.total}
              onClick={() => setPage((v) => v + 1)}
            >
              下一页
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
