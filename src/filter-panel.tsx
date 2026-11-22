import React, { useState } from "react";
import { X } from "lucide-react";
import { Catalog, Entity, Filters, Tag, normalizeFilters } from "./types";
import { groupTags } from "./tag-groups";

type Facet = { id: string; name: string; groupId?: string | null };
function FacetList({
  title,
  values,
  selected,
  change,
  all,
  changeAll,
  groups,
}: {
  title: string;
  values: Facet[];
  selected: string[];
  change: (ids: string[]) => void;
  all?: boolean;
  changeAll?: () => void;
  groups?: Entity[];
}) {
  const [query, setQuery] = useState("");
  const visible = values.filter((value) =>
    value.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const sections = groups
    ? groupTags(visible, groups)
    : [{ id: "", name: "", tags: visible }];
  return (
    <div className="facet-row">
      <div className="facet-label">{title}</div>
      <div className="facet-content">
        {(groups || values.length > 10) && (
          <input
            className="facet-search"
            aria-label={`搜索${title}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={groups ? "搜索自定义标签" : `搜索${title}`}
          />
        )}
        <div
          className={groups ? "tag-facets" : undefined}
          role="group"
          aria-label={`${title}筛选`}
        >
          <div className="facet-options">
            <button
              type="button"
              className={
                !selected.length ? "facet-chip selected" : "facet-chip"
              }
              aria-pressed={!selected.length}
              onClick={() => change([])}
            >
              全部
            </button>
            {changeAll && selected.length > 1 && (
              <button
                type="button"
                className="match-mode"
                aria-label={`${title}匹配方式`}
                onClick={changeAll}
              >
                {all ? "满足全部" : "满足任一"}
              </button>
            )}
          </div>
          {sections.map((section) => (
            <div
              key={section.id}
              className={groups ? "facet-tag-group" : undefined}
            >
              {section.name && <strong>{section.name}</strong>}
              <div className="facet-options">
                {section.tags.map((value) => (
                  <button
                    type="button"
                    key={value.id}
                    className={
                      selected.includes(value.id)
                        ? "facet-chip selected"
                        : "facet-chip"
                    }
                    aria-pressed={selected.includes(value.id)}
                    onClick={() =>
                      change(
                        selected.includes(value.id)
                          ? selected.filter((id) => id !== value.id)
                          : [...selected, value.id],
                      )
                    }
                  >
                    {value.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {!visible.length && (
            <span className="facet-empty">
              {values.length ? "没有匹配项" : `暂无${title}资料`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function FilterPanel({
  draft,
  setDraft,
  tags,
  catalog,
  error,
  stale,
  reload,
  apply,
  cancel,
  save,
  removeSaved,
}: {
  draft: Filters;
  setDraft: (value: Filters) => void;
  tags: Tag[];
  catalog: Catalog;
  error: string;
  stale: boolean;
  reload: () => void;
  apply: () => void;
  cancel: () => void;
  save: () => void;
  removeSaved: (entry: Entity) => void;
}) {
  const subtitleOptions = [
    ["", "全部"],
    ["external", "外挂已选"],
    ["review", "待确认"],
    ["unknown", "未检测"],
    ["embedded", "有内嵌"],
    ["none", "未发现"],
  ];
  const ratings = [
    { label: "全部", min: undefined, max: undefined, unrated: false },
    { label: "未评分", min: undefined, max: undefined, unrated: true },
    { label: "3 星以上", min: 3, max: undefined, unrated: false },
    { label: "4 星以上", min: 4, max: undefined, unrated: false },
    { label: "5 星", min: 5, max: 5, unrated: false },
  ];
  const durations = [
    { label: "全部", min: undefined, max: undefined },
    { label: "30 分钟以内", min: undefined, max: 30 },
    { label: "30–60 分钟", min: 30, max: 60 },
    { label: "60 分钟以上", min: 60, max: undefined },
  ];
  return (
    <section
      className="filter-panel"
      role="region"
      aria-label="筛选影片"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          cancel();
        }
      }}
    >
      <div className="filter-panel-head">
        <div>
          <strong>筛选影片</strong>
          <span>选择条件后应用到整个资料库</span>
        </div>
        <button
          type="button"
          className="icon"
          aria-label="关闭筛选"
          onClick={cancel}
        >
          <X size={17} />
        </button>
      </div>
      {stale && (
        <div className="filter-conflict" role="status">
          当前筛选已在其他位置变更。
          <button type="button" onClick={reload}>
            载入最新条件
          </button>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <FacetList
        title="标签"
        values={tags}
        groups={catalog.tag_groups}
        selected={draft.tags || []}
        change={(tags) =>
          setDraft({
            ...draft,
            tags,
            allTags: tags.length ? draft.allTags : undefined,
          })
        }
        all={draft.allTags}
        changeAll={() => setDraft({ ...draft, allTags: !draft.allTags })}
      />
      <div className="facet-row">
        <div className="facet-label">字幕</div>
        <div className="facet-options" role="group" aria-label="字幕筛选">
          {subtitleOptions.map(([value, label]) => (
            <button
              type="button"
              key={value}
              aria-pressed={(draft.subtitle || "") === value}
              className={
                (draft.subtitle || "") === value
                  ? "facet-chip selected"
                  : "facet-chip"
              }
              onClick={() =>
                setDraft({ ...draft, subtitle: value || undefined })
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="facet-row">
        <div className="facet-label">评分</div>
        <div className="facet-options" role="group" aria-label="评分筛选">
          {ratings.map((r) => (
            <button
              type="button"
              key={r.label}
              aria-pressed={
                draft.ratingMin === r.min &&
                draft.ratingMax === r.max &&
                !!draft.unrated === r.unrated
              }
              className={
                draft.ratingMin === r.min &&
                draft.ratingMax === r.max &&
                !!draft.unrated === r.unrated
                  ? "facet-chip selected"
                  : "facet-chip"
              }
              onClick={() =>
                setDraft({
                  ...draft,
                  ratingMin: r.min,
                  ratingMax: r.max,
                  unrated: r.unrated,
                })
              }
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="facet-row">
        <div className="facet-label">时长</div>
        <div className="facet-options" role="group" aria-label="时长筛选">
          {durations.map((r) => (
            <button
              type="button"
              key={r.label}
              aria-pressed={
                draft.durationMin === r.min && draft.durationMax === r.max
              }
              className={
                draft.durationMin === r.min && draft.durationMax === r.max
                  ? "facet-chip selected"
                  : "facet-chip"
              }
              onClick={() =>
                setDraft({ ...draft, durationMin: r.min, durationMax: r.max })
              }
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <details
        className="filter-details"
        open={draft.performers?.length ? true : undefined}
      >
        <summary>演员资料</summary>
        <FacetList
          title="演员"
          values={catalog.performers}
          selected={draft.performers || []}
          change={(performers) =>
            setDraft({
              ...draft,
              performers,
              allPerformers: performers.length
                ? draft.allPerformers
                : undefined,
            })
          }
          all={draft.allPerformers}
          changeAll={() =>
            setDraft({ ...draft, allPerformers: !draft.allPerformers })
          }
        />
      </details>
      <details className="filter-details">
        <summary>自定义范围</summary>
        <div className="filter-ranges">
          {(
            [
              ["ratingMin", "评分下限", 1, 5],
              ["ratingMax", "评分上限", 1, 5],
              ["durationMin", "时长下限（分钟）", 0, undefined],
              ["durationMax", "时长上限（分钟）", 0, undefined],
            ] as const
          ).map(([key, label, min, max]) => (
            <label key={key}>
              {label}
              <input
                type="number"
                min={min}
                max={max}
                value={draft[key] ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    [key]: e.target.value === "" ? undefined : +e.target.value,
                    ...((key === "ratingMin" || key === "ratingMax") &&
                    e.target.value !== ""
                      ? { unrated: false }
                      : {}),
                  })
                }
              />
            </label>
          ))}
        </div>
      </details>
      <details className="filter-details">
        <summary>
          常用条件
          {catalog.saved_filters.length
            ? ` · ${catalog.saved_filters.length}`
            : ""}
        </summary>
        <div className="saved-filters">
          {catalog.saved_filters.map((f) => (
            <span className="saved-filter" key={f.id}>
              <button
                type="button"
                className="facet-chip"
                onClick={() =>
                  setDraft(normalizeFilters(structuredClone(f.value || {})))
                }
              >
                {f.name}
              </button>
              <button
                type="button"
                className="icon"
                aria-label={"删除条件 " + f.name}
                onClick={() => removeSaved(f)}
              >
                <X size={13} />
              </button>
            </span>
          ))}
          <button type="button" className="secondary" onClick={save}>
            保存当前条件
          </button>
        </div>
      </details>
      <div className="filter-actions">
        <button
          type="button"
          className="text-action"
          onClick={() => setDraft({})}
        >
          重置条件
        </button>
        <div>
          <button type="button" className="secondary" onClick={cancel}>
            取消
          </button>
          <button type="button" className="primary" onClick={apply}>
            应用筛选
          </button>
        </div>
      </div>
    </section>
  );
}
