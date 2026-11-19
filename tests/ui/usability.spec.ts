import { test, expect, Page } from "@playwright/test";
async function fixture(page: Page) {
  await page.addInitScript(() => {
    window.prompt = () => {
      throw new Error("native prompt forbidden");
    };
    window.confirm = () => {
      throw new Error("native confirm forbidden");
    };
    const item = {
      id: "film",
      rootId: "r",
      path: "D:/fixtures/first.mp4",
      title: "测试影片",
      code: "TEST-001",
      mediaType: "personal",
      size: 100,
      duration: 60,
      rating: 4,
      favorite: false,
      tags: [] as string[],
      subtitle: null,
      subtitleConfirmation: "unselected",
      cover: null,
      available: true,
      removed: false,
      addedAt: 1,
      lastLaunchedAt: null,
      note: "",
      studio: "",
      performers: [],
      description: "",
      releaseDate: "",
      locks: [],
      revision: 0,
      width: 320,
      height: 180,
      embeddedSubtitles: null,
      subtitleState: "unknown",
    };
    const tags: any[] = [];
    const groups = [{ id: "g", name: "主题" }];
    const w = window as any;
    w.isTauri = true;
    w.calls = [];
    w.failTag = false;
    w.failSave = false;
    w.delay = 0;
    w.item = item;
    w.settings = {
      player: "",
      playerKind: "potplayer",
      providers: [],
      scanMinutes: 30,
    };
    w.callbacks = {};
    w.events = {};
    let callbackId = 0;
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    w.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      transformCallback: (fn: any) => {
        const id = ++callbackId;
        w.callbacks[id] = fn;
        return id;
      },
      unregisterCallback: (id: number) => delete w.callbacks[id],
      invoke: async (cmd: string, args: any) => {
        w.calls.push({ cmd, args });
        if (cmd === "plugin:event|listen") {
          w.events[args.event] = args.handler;
          return args.handler;
        }
        if (cmd === "plugin:event|unlisten") return;
        if (cmd === "plugin:window|is_maximized") return !!w.maximized;
        if (cmd === "plugin:window|toggle_maximize") {
          w.maximized = !w.maximized;
          const cb = w.callbacks[w.events["tauri://resize"]];
          if (cb)
            await cb({
              event: "tauri://resize",
              id: 2,
              payload: { width: 1440, height: 900 },
            });
          return;
        }
        if (cmd === "plugin:window|close") {
          const cb = w.callbacks[w.events["tauri://close-requested"]];
          if (cb)
            await cb({
              event: "tauri://close-requested",
              id: 1,
              payload: null,
            });
          return;
        }
        if (cmd === "list_items") {
          if (w.failList) throw "测试资料读取失败";
          if (w.scopeLibrary) {
            if (args.filters?.targetId && w.deferLocation) {
              await new Promise<void>((resolve) => {
                w.finishLocation = resolve;
              });
            }
            const matches =
              !args.removed &&
              (!args.mediaType || args.mediaType === item.mediaType) &&
              (!args.query || item.code.includes(args.query));
            return { items: matches ? [item] : [], total: matches ? 1 : 0 };
          }
          if (args.query && w.searchResults) {
            const result = {
              items: [{ ...item, title: args.query + " 结果" }],
              total: 1,
            };
            if (args.query === w.deferQuery && args.limit === 60) {
              await new Promise<void>((resolve) => {
                w.finishSearch = resolve;
              });
            }
            return result;
          }
          if (w.largeLibrary) {
            const count = w.remaining ?? 61;
            const rows = Array.from({ length: count }, (_, n) => ({
              ...item,
              id: "film" + n,
              title: "测试影片 " + n,
            }));
            return {
              items: rows.slice(args.offset, args.offset + args.limit),
              total: count,
            };
          }
          return { items: [structuredClone(item)], total: 1 };
        }
        if (cmd === "selected_items") {
          if (w.failSelection) throw "测试已选列表读取失败";
          const rows = args.ids
            .map((id: string) => ({
              id,
              title: id === "film" ? item.title : "测试影片 " + id.slice(4),
              removed: false,
              available: true,
            }))
            .sort((a: any, b: any) => a.title.localeCompare(b.title));
          return {
            items: rows.slice(args.offset, args.offset + 50),
            total: rows.length,
          };
        }
        if (cmd === "relocate_root") {
          if (w.failRelocate) throw "新位置与另一个已登记目录重叠";
          return { total: 1, missing: 0, uncertain: 0 };
        }
        if (cmd === "set_removed" && w.largeLibrary) {
          w.remaining = 60;
          return;
        }
        if (cmd === "subtitle_choices")
          return {
            subtitles: Array.from({ length: 120 }, (_, n) => ({
              id: "s" + n,
              path:
                "D:/fixtures/TEST-001-" + String(n).padStart(3, "0") + ".srt",
              available: true,
            })),
          };
        if (cmd === "tags") return structuredClone(tags);
        if (cmd === "roots")
          return [
            {
              id: "r",
              path: "D:/fixtures",
              mediaType: "personal",
              kind: "video",
              online: true,
              enabled: true,
            },
          ];
        if (cmd === "jobs") return [];
        if (cmd === "catalog")
          return (
            w.catalogOverride || {
              performers: [],
              studios: [],
              tag_groups: groups,
              saved_filters: [],
            }
          );
        if (cmd === "system_status")
          return {
            version: "0.8.1",
            dataPath: "D:/fixture/app-data",
            playerAvailable: false,
            detected: [{ kind: "vlc", path: "D:/fixture/vlc.exe" }],
            scanMinutes: 30,
            previewBytes: 0,
            coverBytes: 0,
            backups: [],
          };
        if (cmd === "launch" && w.needsPlayer)
          throw "系统默认程序无法加载选中字幕";
        if (cmd === "launch" && w.deferPlayback) {
          return new Promise<void>((resolve) => {
            w.finishPlayback = resolve;
          });
        }
        if (cmd === "save_settings") {
          if (w.failSettings) throw "测试设置保存失败";
          w.settings = structuredClone(args.settings);
          w.needsPlayer = false;
          return;
        }
        if (cmd === "test_player") return "已发出测试播放请求";
        if (cmd === "get_settings") return structuredClone(w.settings);
        if (cmd === "save_item") {
          if (w.failSave) throw "测试保存失败：请重试";
          Object.assign(item, args.item);
          item.revision++;
          return;
        }
        if (cmd === "save_tag") {
          if (w.delay) await new Promise((r) => setTimeout(r, w.delay));
          if (w.failTag) throw "测试标签失败：请重试";
          if (
            tags.some(
              (t) =>
                t.id !== args.tag.id &&
                t.name.toLowerCase() === args.tag.name.trim().toLowerCase(),
            )
          )
            throw "同名标签已存在";
          const old = tags.find((t) => t.id === args.tag.id);
          if (old) Object.assign(old, args.tag);
          else tags.push(args.tag);
          return;
        }
        if (cmd === "scan")
          return new Promise((_, reject) => {
            w.cancelScan = reject;
          });
        if (cmd === "cancel_scan") {
          w.cancelScan?.("扫描已取消");
          return null;
        }
        if (cmd === "plugin:dialog|open") return w.picker ?? null;
        return null;
      },
    };
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "测试影片", exact: true }),
  ).toBeVisible();
}
test("create and select tags in editor without native prompts, reuse duplicate and persist binding", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("button", { name: "编辑 测试影片", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "编辑影片" });
  await editor.getByLabel("新标签名称").fill("周末重温");
  await editor.getByRole("button", { name: "创建并选中", exact: true }).click();
  await expect(
    editor.getByRole("button", { name: "周末重温", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await editor.getByLabel("新标签名称").fill("周末重温");
  await editor.getByRole("button", { name: "创建并选中", exact: true }).click();
  await expect(editor.getByLabel("新标签名称")).toHaveValue("");
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.filter((c: any) => c.cmd === "save_tag").length,
    ),
  ).toBe(1);
  await editor.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).item.tags.length)).toBe(1);
});
test("tag manager has inline validation, groups and prevents duplicate requests", async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole("button", { name: "管理标签", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "标签管理" });
  await modal.getByRole("button", { name: "新增标签", exact: true }).click();
  await expect(
    modal.getByRole("button", { name: "保存标签", exact: true }),
  ).toBeDisabled();
  await modal.getByLabel("名称", { exact: true }).fill("自定义");
  await modal.getByLabel("标签分类", { exact: true }).selectOption("g");
  await page.evaluate(() => {
    (window as any).failTag = true;
  });
  await modal.getByRole("button", { name: "保存标签", exact: true }).click();
  await expect(modal.getByRole("alert")).toContainText("测试标签失败");
  await expect(modal.getByLabel("名称", { exact: true })).toHaveValue("自定义");
  await page.evaluate(() => {
    (window as any).failTag = false;
    (window as any).delay = 300;
  });
  await modal.getByRole("button", { name: "保存标签", exact: true }).click();
  await expect(
    modal.getByRole("button", { name: "保存标签", exact: true }),
  ).toBeDisabled();
  await expect(modal.getByText("自定义", { exact: true })).toBeVisible();
  await expect(modal.getByLabel("名称", { exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.filter((c: any) => c.cmd === "save_tag").length,
    ),
  ).toBe(2);
  await modal.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(modal.getByLabel("标签分类", { exact: true })).toHaveValue("g");
  await modal.getByRole("button", { name: "取消编辑", exact: true }).click();
  await modal.getByRole("button", { name: "删除 自定义", exact: true }).click();
  await page
    .getByRole("dialog", { name: "删除管理项目" })
    .getByRole("button", { name: "取消", exact: true })
    .click();
  expect(
    await page.evaluate(() =>
      (window as any).calls.some((c: any) => c.cmd === "delete_tag"),
    ),
  ).toBe(false);
  await page.screenshot({
    path: ".qa/ui/tags-manager.png",
    fullPage: true,
  });
});
test("editor cancel keeps draft; failed save keeps draft; discard requires explicit confirmation", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("button", { name: "编辑 测试影片", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "编辑影片" });
  await editor.getByLabel("个人笔记", { exact: true }).fill("未保存的笔记");
  await editor.getByRole("button", { name: "关闭编辑" }).click();
  const warning = page.getByRole("dialog", { name: "尚未保存" });
  await expect(warning).toBeVisible();
  await warning.getByRole("button", { name: "取消", exact: true }).click();
  await expect(editor.getByLabel("个人笔记", { exact: true })).toHaveValue(
    "未保存的笔记",
  );
  await page.evaluate(() => ((window as any).failSave = true));
  await editor.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("测试保存失败");
  await expect(editor.getByLabel("个人笔记", { exact: true })).toHaveValue(
    "未保存的笔记",
  );
  await editor.getByRole("button", { name: "关闭编辑" }).click();
  await warning.getByRole("button", { name: "放弃修改", exact: true }).click();
  await expect(editor).toHaveCount(0);
});
test("filter drafts cancel, validate then apply and sorting preferences survive reload", async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole("button", { name: "筛选影片", exact: true }).click();
  const filter = page.getByRole("region", { name: "筛选影片" });
  await filter.getByText("自定义范围", { exact: true }).click();
  await filter.getByLabel("评分下限").fill("4");
  await filter.getByRole("button", { name: "取消", exact: true }).click();
  expect(
    await page.evaluate(() =>
      (window as any).calls.some(
        (c: any) => c.cmd === "list_items" && c.args.filters.ratingMin === 4,
      ),
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "筛选影片", exact: true }).click();
  await filter.getByText("自定义范围", { exact: true }).click();
  await expect(filter.getByLabel("评分下限")).toHaveValue("");
  await filter.getByLabel("评分下限").fill("5");
  await filter.getByLabel("评分上限").fill("2");
  await filter.getByRole("button", { name: "应用筛选", exact: true }).click();
  await expect(filter.getByRole("alert")).toContainText("下限不能大于上限");
  await filter.getByLabel("评分上限").fill("5");
  await filter.getByRole("button", { name: "应用筛选", exact: true }).click();
  await expect(filter).toHaveCount(0);
  await page.getByRole("combobox", { name: "影片排序" }).click();
  await page.getByRole("option", { name: "评分从高到低" }).click();
  await page.getByRole("combobox", { name: "卡片大小" }).click();
  await page.getByRole("option", { name: "小", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("combobox", { name: "影片排序" })).toContainText(
    "评分从高到低",
  );
  await expect(page.getByRole("combobox", { name: "卡片大小" })).toContainText(
    "小",
  );
  expect(
    await page.evaluate(() =>
      (window as any).calls.some(
        (c: any) => c.cmd === "list_items" && c.args.filters.sort === "rating",
      ),
    ),
  ).toBe(true);
  await page.evaluate(() =>
    localStorage.setItem(
      "avlibrary-view",
      JSON.stringify({ size: 340, sort: "rating" }),
    ),
  );
  await page.reload();
  const size = page.getByRole("combobox", { name: "卡片大小" });
  await expect(size).toContainText("中");
  await size.click();
  await expect(page.getByRole("option")).toHaveText(["小", "中"]);
});
test("modal keyboard focus is trapped, Escape protects settings and focus returns to opener", async ({
  page,
}) => {
  await fixture(page);
  const opener = page.getByRole("button", {
    name: "播放器与资料来源",
    exact: true,
  });
  await opener.click();
  const settings = page.getByRole("dialog", { name: "播放器与资料来源" });
  await settings.getByLabel("播放器程序（.exe，可选）").fill("D:/player.exe");
  await page.keyboard.press("Escape");
  const warning = page.getByRole("dialog", { name: "尚未保存" });
  await expect(warning).toBeVisible();
  await warning.getByRole("button", { name: "取消", exact: true }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(warning.getByRole("button", { name: "关闭窗口" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    warning.getByRole("button", { name: "放弃修改", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(warning).toHaveCount(0);
  await expect(settings.getByLabel("播放器程序（.exe，可选）")).toHaveValue(
    "D:/player.exe",
  );
  await settings.getByRole("button", { name: "关闭窗口" }).click();
  await warning.getByRole("button", { name: "放弃修改", exact: true }).click();
  await expect(settings).toHaveCount(0);
  await expect(opener).toBeFocused();
});
test("batch operations state scope and require an explicit apply or removal confirmation", async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole("button", { name: "批量管理", exact: true }).click();
  await page.getByRole("button", { name: "选中本页", exact: true }).click();
  await expect(
    page.getByText("已选 1 部（跨页保留）", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "批量编辑", exact: true }).click();
  const batch = page.getByRole("dialog", { name: "批量编辑 · 1 部" });
  await batch.getByLabel("批量分类（选择后点击应用）").selectOption("western");
  expect(
    await page.evaluate(() =>
      (window as any).calls.some((c: any) => c.cmd === "batch_edit"),
    ),
  ).toBe(false);
  await batch
    .getByRole("button", { name: "应用分类到所选 1 部", exact: true })
    .click();
  await batch.getByRole("button", { name: "关闭窗口" }).click();
  await page.getByRole("button", { name: "移出库", exact: true }).click();
  const warning = page.getByRole("dialog", { name: "确认批量操作" });
  await expect(warning).toContainText("1 部影片");
  await warning.getByRole("button", { name: "取消", exact: true }).click();
  expect(
    await page.evaluate(() =>
      (window as any).calls.some((c: any) => c.cmd === "set_removed"),
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "清空选择", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "批量编辑", exact: true }),
  ).toBeDisabled();
});
test("folder purpose is saved atomically and cancelled backup never reports success", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => ((window as any).picker = "D:/subtitles"));
  await page.getByRole("button", { name: "添加文件夹", exact: true }).click();
  const folder = page.getByRole("dialog", { name: "添加文件夹" });
  await expect(folder).toContainText("视频与同名字幕可以放在同一个文件夹");
  await folder.getByLabel("目录用途").selectOption("subtitle");
  await expect(folder.getByLabel("新入库视频的默认分类")).toHaveCount(0);
  await folder
    .getByRole("button", { name: "添加并在后台核对", exact: true })
    .click();
  await expect(folder).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.find((c: any) => c.cmd === "add_root").args.kind,
    ),
  ).toBe("subtitle");
  expect(
    await page.evaluate(() =>
      (window as any).calls.some((c: any) => c.cmd === "set_root_kind"),
    ),
  ).toBe(false);
  await page
    .getByRole("dialog", { name: "文件夹管理" })
    .getByRole("button", { name: "关闭窗口" })
    .click();
  await page.evaluate(() => ((window as any).picker = null));
  await page.getByRole("button", { name: "备份与恢复", exact: true }).click();
  await page
    .getByRole("button", { name: "导出完整资料备份", exact: true })
    .click();
  await expect(page.getByText("备份资料完成", { exact: true })).toHaveCount(0);
});
test("secondary editor task saves draft first and resumes safely", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("button", { name: "编辑 测试影片", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "编辑影片" });
  await editor.getByLabel("个人笔记").fill("操作前保存");
  await editor
    .getByRole("button", { name: "重新读取系统缩略图", exact: true })
    .click();
  const warning = page.getByRole("dialog", { name: "先保存影片" });
  await expect(warning).toBeVisible();
  await warning
    .getByRole("button", { name: "保存并继续", exact: true })
    .click();
  await expect(
    page.getByText("读取系统缩略图完成", { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).item.note)).toBe(
    "操作前保存",
  );
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.filter((c: any) => c.cmd === "inspect_media")
          .length,
    ),
  ).toBe(1);
  await editor.getByRole("button", { name: "关闭编辑" }).click();
  await expect(editor).toHaveCount(0);
});
test("desktop layouts fit common window widths with labelled view controls", async ({
  page,
}) => {
  await fixture(page);
  for (const width of [1440, 1200, 1024, 960]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByLabel("影片排序")).toBeVisible();
    await expect(page.getByLabel("卡片大小")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: ".qa/ui/library-" + width + ".png",
      fullPage: true,
    });
  }
});

test("rename, saved filters and provider entry use application forms with cancellation", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("button", { name: "编辑 测试影片", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "编辑影片" });
  await editor.getByText("资料与文件管理", { exact: true }).click();
  await editor
    .getByRole("button", { name: "重命名真实视频文件", exact: true })
    .click();
  const rename = page.getByRole("dialog", {
    name: "输入新文件名（不含扩展名）",
  });
  await expect(rename.getByRole("textbox")).toHaveValue("first");
  await rename.getByRole("button", { name: "取消", exact: true }).click();
  expect(
    await page.evaluate(() =>
      (window as any).calls.some((c: any) => c.cmd === "rename_video"),
    ),
  ).toBe(false);
  await editor.getByRole("button", { name: "关闭编辑" }).click();
  await page.getByRole("button", { name: "筛选影片", exact: true }).click();
  const filter = page.getByRole("region", { name: "筛选影片" });
  await filter.getByText("自定义范围", { exact: true }).click();
  await filter.getByLabel("评分下限").fill("4");
  await filter.getByText("常用条件", { exact: true }).click();
  await filter
    .getByRole("button", { name: "保存当前条件", exact: true })
    .click();
  const name = page.getByRole("dialog", { name: "常用条件名称" });
  await name.getByRole("textbox").fill("高评分");
  await name.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("保存筛选完成", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.find((c: any) => c.cmd === "save_filter").args
          .value.ratingMin,
    ),
  ).toBe(4);
  await page.screenshot({
    path: ".qa/ui/filter.png",
    fullPage: true,
  });
  await filter.getByRole("button", { name: "取消", exact: true }).click();
  await page
    .getByRole("button", { name: "播放器与资料来源", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "播放器与资料来源" });
  await settings.getByText("高级资料来源设置", { exact: true }).click();
  await settings
    .getByRole("button", { name: "添加结构化网页来源", exact: true })
    .click();
  const source = page.getByRole("dialog", { name: "来源名称" });
  await source.getByRole("textbox").fill("新来源");
  await source.getByRole("button", { name: "保存", exact: true }).click();
  await settings.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(settings.getByRole("alert")).toContainText("请完善已启用来源");
  await settings.getByRole("button", { name: "移除来源", exact: true }).click();
  await page
    .getByRole("dialog", { name: "移除资料来源" })
    .getByRole("button", { name: "移除来源", exact: true })
    .click();
  await expect(
    settings.getByRole("button", { name: "移除来源", exact: true }),
  ).toHaveCount(0);
});

test("running scan disables duplicate submissions but keeps cancel reachable inside modal", async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole("button", { name: "文件夹管理 1", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "文件夹管理" });
  await modal.getByRole("button", { name: "扫描", exact: true }).click();
  await expect(
    modal.getByRole("button", { name: "扫描", exact: true }),
  ).toBeDisabled();
  await modal.getByRole("button", { name: "取消扫描", exact: true }).click();
  await expect(modal.getByRole("alert")).toContainText("扫描已取消");
  await expect(
    modal.getByRole("button", { name: "扫描", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => (window as any).calls.filter((c: any) => c.cmd === "scan").length,
    ),
  ).toBe(1);
});

test("actor input keeps newlines and saves each performer separately", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("button", { name: "编辑 测试影片", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "编辑影片" });
  const actors = editor.getByLabel("演员（每行一位）");
  await actors.fill("甲");
  await actors.press("End");
  await actors.press("Enter");
  await actors.pressSequentially("乙");
  await expect(actors).toHaveValue("甲\n乙");
  await editor.getByRole("button", { name: "保存修改", exact: true }).click();
  expect(await page.evaluate(() => (window as any).item.performers)).toEqual([
    "甲",
    "乙",
  ]);
});
test("native close cancellation retains unsaved draft and discard destroys window", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("button", { name: "编辑 测试影片", exact: true })
    .click();
  await page.getByLabel("个人笔记", { exact: true }).fill("未保存");
  await page.evaluate(() => {
    const w = window as any;
    void w.callbacks[w.events["tauri://close-requested"]]({
      event: "tauri://close-requested",
      id: 1,
      payload: null,
    });
  });
  const confirm = page.getByRole("dialog", { name: "退出映库" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByLabel("个人笔记", { exact: true })).toHaveValue(
    "未保存",
  );
  expect(
    await page.evaluate(() =>
      (window as any).calls.some((c: any) => c.cmd === "plugin:window|destroy"),
    ),
  ).toBe(false);
  await page.evaluate(() => {
    const w = window as any;
    void w.callbacks[w.events["tauri://close-requested"]]({
      event: "tauri://close-requested",
      id: 1,
      payload: null,
    });
  });
  await confirm
    .getByRole("button", { name: "放弃并退出", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).calls.some(
          (c: any) => c.cmd === "plugin:window|destroy",
        ),
      ),
    )
    .toBe(true);
});
test("search debounces main requests and reuses auxiliary catalog", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => ((window as any).calls = []));
  await page.getByLabel("搜索影片").pressSequentially("ABC", { delay: 30 });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).calls.some(
          (c: any) => c.cmd === "list_items" && c.args.query === "ABC",
        ),
      ),
    )
    .toBe(true);
  await page.waitForTimeout(300);
  const calls = await page.evaluate(() => (window as any).calls);
  expect(
    calls.filter((c: any) =>
      ["roots", "tags", "catalog", "jobs"].includes(c.cmd),
    ),
  ).toHaveLength(0);
  expect(
    calls.filter((c: any) => c.cmd === "list_items").length,
  ).toBeLessThanOrEqual(2);
});
test("task scopes and historical pages are sent to backend", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => ((window as any).calls = []));
  await page.getByRole("button", { name: "后台任务", exact: true }).click();
  await page.getByRole("button", { name: "失败与中断", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).calls.some(
          (c: any) => c.cmd === "jobs" && c.args.scope === "failed",
        ),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "历史", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).calls.some(
          (c: any) => c.cmd === "jobs" && c.args.scope === "history",
        ),
      ),
    )
    .toBe(true);
  await page.evaluate(() => {
    const w = window as any;
    const notify = w.callbacks[w.events["jobs-changed"]];
    notify({ event: "jobs-changed", id: 1, payload: null });
    notify({ event: "jobs-changed", id: 1, payload: null });
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).calls.filter(
            (call: any) => call.cmd === "jobs" && call.args.scope === "history",
          ).length,
      ),
    )
    .toBe(2);
  expect(
    await page.evaluate(() =>
      (window as any).calls.filter((call: any) =>
        ["list_items", "roots", "tags", "catalog"].includes(call.cmd),
      ),
    ),
  ).toEqual([]);
});

test("late search response cannot replace the newer results", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() =>
    Object.assign(window, { searchResults: true, deferQuery: "旧" }),
  );
  const search = page.getByRole("textbox", { name: "搜索影片" });
  await search.fill("旧");
  await search.press("Enter");
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).finishSearch))
    .toBe("function");
  await search.fill("新");
  await search.press("Enter");
  await expect(
    page.getByRole("heading", { name: "新 结果", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => (window as any).finishSearch());
  await expect(
    page.getByRole("heading", { name: "新 结果", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "旧 结果", exact: true }),
  ).toHaveCount(0);
});

test("a committed save remains successful when the list fails and refresh can be retried", async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole("button", { name: "编辑 测试影片" }).click();
  await page.getByLabel("显示名称").fill("已保存影片");
  await page.evaluate(() => ((window as any).failList = true));
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "编辑影片" })).toHaveCount(0);
  await expect(
    page.getByText("保存影片已完成，部分显示未刷新。请重试刷新。"),
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "测试资料读取失败" }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).item.title)).toBe(
    "已保存影片",
  );
  await page.evaluate(() => ((window as any).failList = false));
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "已保存影片", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.filter((call: any) => call.cmd === "save_item")
          .length,
    ),
  ).toBe(1);
});

test("keyboard rating and favorite actions are independent of playback and pending playback is single flight", async ({
  page,
}) => {
  await fixture(page);
  const favorite = page.getByRole("button", { name: "收藏", exact: true });
  await favorite.press("Enter");
  await expect(favorite).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "3 星", exact: true }).press("Space");
  await expect(
    page.getByRole("button", { name: "3 星", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.filter((call: any) => call.cmd === "launch")
          .length,
    ),
  ).toBe(0);
  await page.evaluate(() => ((window as any).deferPlayback = true));
  const play = page.getByRole("button", { name: "播放 测试影片", exact: true });
  await play.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(play).toHaveAttribute("aria-busy", "true");
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.filter((call: any) => call.cmd === "launch")
          .length,
    ),
  ).toBe(1);
  await page.evaluate(() => (window as any).finishPlayback());
  await expect(page.getByText("已发出播放请求", { exact: true })).toBeVisible();
  await expect(play).toBeEnabled();
});

test("removing final item on last page returns to valid page", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => ((window as any).largeLibrary = true));
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  const nextPage = page.getByRole("button", { name: "下一页", exact: true });
  await nextPage.focus();
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(0);
  await nextPage.press("Enter");
  await expect(page.getByRole("heading", { name: "影片资料库" })).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(
    page.getByRole("navigation", { name: "资料库分页" }),
  ).toContainText("第 2 / 2 页");
  await page.getByRole("button", { name: "批量管理", exact: true }).click();
  await page.getByRole("button", { name: "选中本页", exact: true }).click();
  await page.getByRole("button", { name: "移出库", exact: true }).click();
  await page.getByRole("button", { name: "确认继续", exact: true }).click();
  await expect(page.locator("footer")).toContainText("显示 60 / 60 部");
  await expect(
    page.getByRole("button", { name: "上一页", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: ".qa/ui/library-60-cards.png",
  });
});

test("batch selections do not cross into or out of removed items", async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole("button", { name: "批量管理", exact: true }).click();
  await page.getByRole("button", { name: "选中本页", exact: true }).click();
  await expect(page.locator(".bulk-bar")).toContainText("已选 1 部");
  await page.getByRole("button", { name: "已移出项目", exact: true }).click();
  await expect(page.locator(".bulk-bar")).toContainText("已选 0 部");
  await expect(
    page.getByRole("button", { name: "恢复", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "全部影片", exact: true }).click();
  await expect(page.locator(".bulk-bar")).toContainText("已选 0 部");
});

test("empty category offers a route back to the populated library", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => Object.assign(window, { scopeLibrary: true }));
  await page.getByRole("button", { name: "欧美影片", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "暂无欧美影片" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "查看全部影片" }).click();
  await expect(page.getByRole("heading", { name: "测试影片" })).toBeVisible();
});

test("empty search in removed items clears the search and returns to all films", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => Object.assign(window, { scopeLibrary: true }));
  await page.getByRole("button", { name: "已移出项目" }).click();
  const search = page.getByRole("textbox", { name: "搜索影片" });
  await search.fill("MISSING");
  await search.press("Enter");
  await expect(
    page.getByRole("heading", { name: "没有找到匹配的移出项目" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "查看全部影片" }).click();
  await expect(page.getByRole("heading", { name: "影片资料库" })).toBeFocused();
  await expect(search).toHaveValue("");
  await expect(page.getByRole("heading", { name: "测试影片" })).toBeVisible();
});

test("subtitle cards distinguish available, unverified and broken subtitles", async ({
  page,
}) => {
  await fixture(page);
  const cases = [
    ["unknown", null, null, "unselected", "未关联外挂 · 内嵌未检测"],
    ["unselected", null, 0, "unselected", "未关联外挂 · 无内嵌"],
    ["embedded", null, 1, "unselected", "有内嵌字幕"],
    [
      "selected",
      "D:/fixtures/first.srt",
      null,
      "manual_confirmed",
      "外挂字幕已关联",
    ],
    ["selected", "D:/fixtures/first.srt", null, "needs_review", "字幕待确认"],
    [
      "missing",
      "D:/fixtures/first.srt",
      null,
      "needs_review",
      "字幕文件不可用",
    ],
    [
      "invalid",
      "D:/fixtures/first.srt",
      null,
      "needs_review",
      "字幕文件已变化",
    ],
  ] as const;
  for (const [
    subtitleState,
    subtitle,
    embeddedSubtitles,
    subtitleConfirmation,
    label,
  ] of cases) {
    await page.evaluate((data) => Object.assign((window as any).item, data), {
      subtitleState,
      subtitle,
      embeddedSubtitles,
      subtitleConfirmation,
    });
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await expect(page.locator(".card .subtitle-state")).toHaveText(label);
  }
  await page.getByRole("button", { name: "测试影片", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "测试影片" })).toContainText(
    "字幕文件已变化",
  );
});
test("subtitle candidates beyond first page are accessible and unbinding is explicit", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("button", { name: "编辑 测试影片", exact: true })
    .click();
  await page.getByRole("button", { name: "查看字幕候选", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "字幕候选" });
  await modal.getByRole("button", { name: "下一页字幕", exact: true }).click();
  await modal.getByRole("button", { name: "下一页字幕", exact: true }).click();
  await expect(
    modal.getByText("D:/fixtures/TEST-001-119.srt", { exact: true }),
  ).toBeVisible();
  await modal
    .getByRole("button", { name: "取消绑定并停止自动匹配", exact: true })
    .click();
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.find((c: any) => c.cmd === "clear_subtitle").args
          .allowAuto,
    ),
  ).toBe(false);
});

test("details, detected player and test playback form an accessible flow", async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole("button", { name: "测试影片", exact: true }).click();
  const detail = page.getByRole("dialog", { name: "测试影片", exact: true });
  await expect(detail).toContainText("个人片段");
  await detail
    .getByRole("button", { name: "编辑资料与字幕", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "编辑影片" })).toBeVisible();
  await page.getByRole("button", { name: "关闭编辑" }).click();
  await page
    .getByRole("button", { name: "播放器与资料来源", exact: true })
    .click();
  await page.getByRole("button", { name: "使用 vlc", exact: true }).click();
  await expect(page.getByLabel("播放器程序（.exe，可选）")).toHaveValue(
    "D:/fixture/vlc.exe",
  );
  await page
    .getByRole("button", {
      name: "测试画面与字幕（无需保存设置）",
      exact: true,
    })
    .click();
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.find((c: any) => c.cmd === "test_player").args
          .settings.playerKind,
    ),
  ).toBe("vlc");
  await page.screenshot({
    path: ".qa/ui/player-settings.png",
    fullPage: true,
  });
});

test("saving player settings resumes interrupted playback after action lock releases", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => ((window as any).needsPlayer = true));
  await page
    .getByRole("button", { name: "播放 测试影片", exact: true })
    .click();
  await page.getByRole("button", { name: "设置播放器", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "播放器与资料来源" });
  await settings
    .getByLabel("播放器程序（.exe，可选）")
    .fill("D:/fixture/vlc.exe");
  await settings.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).calls.filter((c: any) => c.cmd === "launch").length,
      ),
    )
    .toBe(2);
  await expect(settings).toHaveCount(0);
});

test("scan interval is a settings draft with cancellation failure retention and save", async ({
  page,
}) => {
  await fixture(page);
  const opener = page.getByRole("button", {
    name: "播放器与资料来源",
    exact: true,
  });
  await opener.click();
  const settings = page.getByRole("dialog", { name: "播放器与资料来源" });
  const interval = settings.getByLabel("完整目录核对间隔", { exact: true });
  await interval.selectOption("60");
  expect(
    await page.evaluate(() =>
      (window as any).calls.some((c: any) =>
        ["set_scan_interval", "save_settings"].includes(c.cmd),
      ),
    ),
  ).toBe(false);
  await settings.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "放弃修改", exact: true }).click();
  await opener.click();
  await expect(interval).toHaveValue("30");
  await interval.selectOption("120");
  await page.evaluate(() => ((window as any).failSettings = true));
  await settings.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(settings.getByRole("alert")).toContainText("测试设置保存失败");
  await expect(interval).toHaveValue("120");
  await page.evaluate(() => ((window as any).failSettings = false));
  await settings.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(settings).toHaveCount(0);
  await opener.click();
  await expect(interval).toHaveValue("120");
  await page.screenshot({
    path: ".qa/ui/settings.png",
    fullPage: true,
  });
});
test("selected films use one paged request and removing the final page returns to page one", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => ((window as any).largeLibrary = true));
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(page.locator("footer")).toContainText("显示 60 / 61 部");
  await page.getByRole("button", { name: "批量管理", exact: true }).click();
  await page.getByRole("button", { name: "选中本页", exact: true }).click();
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.locator("footer")).toContainText("显示 1 / 61 部");
  await page.getByRole("button", { name: "选中本页", exact: true }).click();
  await page.getByRole("button", { name: "查看已选影片", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /已选影片/ });
  await expect(dialog.getByText("第 1 / 2 页 · 可查看 61 部")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.filter((c: any) => c.cmd === "selected_items")
          .length,
    ),
  ).toBe(1);
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.filter(
          (c: any) => c.cmd === "list_items" && c.args.filters.targetId,
        ).length,
    ),
  ).toBe(0);
  await dialog
    .getByRole("button", { name: "下一页已选影片", exact: true })
    .click();
  await expect(dialog.getByText("第 2 / 2 页 · 可查看 61 部")).toBeVisible();
  for (let n = 0; n < 11; n++) {
    await dialog
      .getByRole("button", { name: /^取消选择 / })
      .first()
      .click();
    await expect(dialog.getByText("正在读取已选影片…")).toHaveCount(0);
  }
  await expect(dialog.getByText("第 1 / 1 页 · 可查看 50 部")).toBeVisible();
  await page.screenshot({
    path: ".qa/ui/selection.png",
    fullPage: true,
  });
});
test("selected films can retry loading without losing selection", async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole("button", { name: "批量管理", exact: true }).click();
  await page.getByRole("button", { name: "选中本页", exact: true }).click();
  await page.evaluate(() => ((window as any).failSelection = true));
  await page.getByRole("button", { name: "查看已选影片", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "已选影片 · 1 部" });
  await expect(dialog.getByRole("alert")).toContainText("测试已选列表读取失败");
  await page.evaluate(() => ((window as any).failSelection = false));
  await dialog
    .getByRole("button", { name: "重试读取已选影片", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "取消选择 测试影片", exact: true }),
  ).toBeVisible();
});
test("relocation preview failure is visible and never sends confirmation", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => {
    (window as any).picker = "D:/other";
    (window as any).failRelocate = true;
  });
  await page.getByRole("button", { name: /文件夹管理/ }).click();
  const dialog = page.getByRole("dialog", { name: "文件夹管理" });
  await dialog.getByRole("button", { name: "重新定位", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("重叠");
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.filter(
          (c: any) => c.cmd === "relocate_root" && c.args.confirm,
        ).length,
    ),
  ).toBe(0);
});

test("tag management and people management have separate clear entry points", async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole("button", { name: "管理标签", exact: true }).click();
  const tags = page.getByRole("dialog", { name: "标签管理" });
  await expect(
    tags.getByRole("button", { name: "新增标签", exact: true }),
  ).toBeVisible();
  await expect(
    tags.getByRole("button", { name: "标签分类", exact: true }),
  ).toBeVisible();
  await expect(
    tags.getByRole("button", { name: "演员", exact: true }),
  ).toHaveCount(0);
  await tags.getByRole("button", { name: "新增标签", exact: true }).click();
  await tags.getByLabel("名称", { exact: true }).fill("回归标签");
  await tags.getByRole("button", { name: "保存标签", exact: true }).click();
  await expect(tags.getByText("回归标签", { exact: true })).toBeVisible();
  await tags.getByRole("button", { name: "关闭窗口" }).click();
  await page.getByRole("button", { name: "演员与厂商", exact: true }).click();
  const people = page.getByRole("dialog", { name: "演员与厂商" });
  await expect(
    people.getByRole("button", { name: "新增演员", exact: true }),
  ).toBeVisible();
  await expect(
    people.getByRole("button", { name: "厂商", exact: true }),
  ).toBeVisible();
  await expect(
    people.getByRole("button", { name: "标签", exact: true }),
  ).toHaveCount(0);
});
test("window controls call the native window and close preserves unsaved edits", async ({
  page,
}) => {
  await fixture(page);
  await expect(page.locator("[data-tauri-drag-region='deep']")).toHaveAttribute(
    "aria-label",
    "拖动窗口",
  );
  await page.getByRole("button", { name: "最小化窗口", exact: true }).click();
  await page.getByRole("button", { name: "最大化窗口", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "还原窗口", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "还原窗口", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "最大化窗口", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "编辑 测试影片", exact: true })
    .click();
  await page.getByLabel("个人笔记", { exact: true }).fill("草稿");
  await page.getByRole("button", { name: "关闭映库", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "退出映库" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByLabel("个人笔记", { exact: true })).toHaveValue(
    "草稿",
  );
  const calls = await page.evaluate(() =>
    (window as any).calls.map((c: any) => c.cmd),
  );
  expect(calls).toContain("plugin:window|minimize");
  expect(
    calls.filter((c: string) => c === "plugin:window|toggle_maximize"),
  ).toHaveLength(2);
  expect(calls).toContain("plugin:window|close");
  expect(calls).not.toContain("plugin:window|destroy");
});

test("compact menus support keyboard selection and escape; search has a single focus treatment", async ({
  page,
}) => {
  await fixture(page);
  const sort = page.getByRole("combobox", { name: "影片排序" });
  await sort.focus();
  await sort.press("ArrowDown");
  await expect(sort).toHaveAttribute("aria-expanded", "true");
  await sort.press("ArrowDown");
  await sort.press("Enter");
  await expect(sort).toContainText("最近入库");
  await sort.press("ArrowDown");
  await sort.press("Escape");
  await expect(sort).toHaveAttribute("aria-expanded", "false");
  await expect(sort).toContainText("最近入库");
  await sort.click();
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(sort).toHaveAttribute("aria-expanded", "false");
  const search = page.getByLabel("搜索影片");
  await search.focus();
  const styles = await search.evaluate((el) => ({
    outline: getComputedStyle(el).outlineStyle,
    parentOutline: getComputedStyle(el.parentElement!).outlineWidth,
    parentShadow: getComputedStyle(el.parentElement!).boxShadow,
  }));
  expect(styles.outline).toBe("none");
  expect(styles.parentOutline).toBe("2px");
  expect(styles.parentShadow).not.toBe("none");
  await page
    .getByRole("button", { name: "编辑 测试影片", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "编辑影片" });
  await editor.getByLabel("显示名称", { exact: true }).click();
  await expect(editor.getByLabel("显示名称", { exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  const current = editor.locator(":focus");
  const field = await current.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      border: style.borderTopColor,
      outline: style.outlineWidth,
      offset: style.outlineOffset,
    };
  });
  expect(field).toEqual({
    border: "rgba(0, 0, 0, 0)",
    outline: "2px",
    offset: "-2px",
  });
});

test("composing search text does not submit and suggestions return focus on Escape", async ({
  page,
}) => {
  await fixture(page);
  const search = page.getByLabel("搜索影片");
  await search.focus();
  await search.dispatchEvent("compositionstart");
  await search.fill("ceshi");
  await search.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await page.waitForTimeout(300);
  const submitted = await page.evaluate(() =>
    (window as any).calls.some(
      (call: any) => call.cmd === "list_items" && call.args.query === "ceshi",
    ),
  );
  expect(submitted).toBe(false);
  await search.fill("测试");
  await search.dispatchEvent("compositionend", { data: "测试" });
  const suggestion = page.locator("#search-suggestions button").first();
  await expect(suggestion).toBeVisible();
  await search.press("ArrowDown");
  await expect(suggestion).toBeFocused();
  await suggestion.press("Escape");
  await expect(search).toBeFocused();
  await expect(suggestion).toHaveCount(0);
  await page.getByRole("button", { name: "清空搜索" }).click();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("");
});
test("keyboard selection transfers focus to a visible search result card", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => Object.assign(window, { scopeLibrary: true }));
  const search = page.getByRole("textbox", { name: "搜索影片" });
  await search.fill("TEST-001");
  const suggestion = page.locator("#search-suggestions button");
  await expect(suggestion).toBeVisible();
  const card = page.getByRole("article", { name: "测试影片" });
  await expect(card).toBeVisible();
  await search.press("ArrowDown");
  await suggestion.press("Enter");
  await expect(card).toBeFocused();
  await expect(card).toHaveClass(/highlight/);
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "播放 测试影片" }),
  ).toBeFocused();
});

test("locating a result outside the current scope waits for its card to render", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() =>
    Object.assign(window, { scopeLibrary: true, deferLocation: true }),
  );
  await page.getByRole("button", { name: "欧美影片", exact: true }).click();
  const search = page.getByRole("textbox", { name: "搜索影片" });
  const suggestion = page.locator("#search-suggestions button");
  const title = page.getByRole("heading", { name: "影片资料库" });
  const card = page.getByRole("article", { name: "测试影片" });

  async function locateResult() {
    await search.fill("TEST-001");
    await expect(suggestion).toBeVisible();
    await search.press("ArrowDown");
    await suggestion.press("Enter");
    await expect(title).toBeFocused();
    await expect(card).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => typeof (window as any).finishLocation))
      .toBe("function");
  }
  const finishLocation = () =>
    page.evaluate(() => {
      const fixture = window as any;
      fixture.finishLocation();
      fixture.finishLocation = undefined;
    });
  await locateResult();
  await finishLocation();
  await expect(card).toBeFocused();
  await page.getByRole("button", { name: "恢复原筛选" }).click();
  await expect(
    page.getByRole("heading", { name: "没有找到匹配影片" }),
  ).toBeVisible();

  await locateResult();
  await search.focus();
  await finishLocation();
  await expect(card).toBeVisible();
  await expect(search).toBeFocused();
});

test("grouped filter choices apply, cancel and protect against external filter changes", async ({
  page,
}) => {
  await fixture(page);
  const open = page.getByRole("button", { name: "筛选影片", exact: true });
  await open.click();
  const filter = page.getByRole("region", { name: "筛选影片" });
  const subtitle = filter.getByRole("group", { name: "字幕筛选" });
  await subtitle.getByRole("button", { name: "外挂已选" }).click();
  await expect(
    subtitle.getByRole("button", { name: "外挂已选" }),
  ).toHaveAttribute("aria-pressed", "true");
  await filter.getByRole("button", { name: "取消", exact: true }).click();
  await open.click();
  await expect(subtitle.getByRole("button", { name: "全部" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await filter
    .getByRole("group", { name: "评分筛选" })
    .getByRole("button", { name: "4 星以上" })
    .click();
  await page.getByRole("button", { name: "我的收藏", exact: true }).click();
  await expect(filter.getByRole("status")).toContainText("其他位置变更");
  await filter.getByRole("button", { name: "应用筛选", exact: true }).click();
  const conflict = page.getByRole("dialog", { name: "筛选条件已变更" });
  await expect(conflict).toBeVisible();
  await conflict.getByRole("button", { name: "取消", exact: true }).click();
  await filter.getByRole("button", { name: "载入最新条件" }).click();
  await expect(
    filter
      .getByRole("group", { name: "评分筛选" })
      .getByRole("button", { name: "全部" }),
  ).toHaveAttribute("aria-pressed", "true");
  await filter
    .getByRole("group", { name: "评分筛选" })
    .getByRole("button", { name: "4 星以上" })
    .click();
  await filter.getByRole("button", { name: "应用筛选", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).calls.some(
          (c: any) =>
            c.cmd === "list_items" &&
            c.args.filters.favorite &&
            c.args.filters.ratingMin === 4,
        ),
      ),
    )
    .toBe(true);
});
test("large tag facet can search and apply a specific tag", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(async () => {
    for (let n = 0; n < 14; n++)
      await (window as any).__TAURI_INTERNALS__.invoke("save_tag", {
        tag: {
          id: "t" + n,
          name: "标签" + String(n).padStart(2, "0"),
          groupId: null,
        },
      });
  });
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page.getByRole("button", { name: "筛选影片", exact: true }).click();
  const filter = page.getByRole("region", { name: "筛选影片" });
  await filter.getByLabel("搜索标签").fill("标签13");
  await filter
    .getByRole("group", { name: "标签筛选" })
    .getByRole("button", { name: "标签13" })
    .click();
  await filter.getByRole("button", { name: "应用筛选" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).calls.some(
          (c: any) =>
            c.cmd === "list_items" && c.args.filters.tags?.includes("t13"),
        ),
      ),
    )
    .toBe(true);
});

test("actor and studio facets show their names in applied filters", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => {
    (window as any).catalogOverride = {
      performers: [{ id: "p1", name: "测试演员" }],
      studios: [{ id: "s1", name: "测试厂商" }],
      tag_groups: [],
      saved_filters: [],
    };
  });
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page.getByRole("button", { name: "筛选影片", exact: true }).click();
  const filter = page.getByRole("region", { name: "筛选影片" });
  await filter
    .getByRole("group", { name: "演员筛选" })
    .getByRole("button", { name: "测试演员" })
    .click();
  await filter
    .getByRole("group", { name: "厂商筛选" })
    .getByRole("button", { name: "测试厂商" })
    .click();
  await filter.getByRole("button", { name: "应用筛选" }).click();
  await expect(
    page.getByRole("button", { name: "移除筛选 演员：测试演员" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "移除筛选 厂商：测试厂商" }),
  ).toBeVisible();
});

test("older saved filter defaults do not create phantom active conditions", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => {
    (window as any).catalogOverride = {
      performers: [],
      studios: [],
      tag_groups: [],
      saved_filters: [
        {
          id: "old",
          name: "旧条件",
          value: {
            favorite: false,
            tags: [],
            allTags: true,
            performers: [],
            allPerformers: false,
            studios: [],
            subtitle: "",
            ratingMin: null,
            ratingMax: null,
            durationMin: null,
            durationMax: null,
            unrated: false,
            targetId: "",
            sort: "",
          },
        },
      ],
    };
  });
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page.getByRole("button", { name: "筛选影片", exact: true }).click();
  const f = page.getByRole("region", { name: "筛选影片" });
  await f.getByText("常用条件", { exact: false }).click();
  await f.getByRole("button", { name: "旧条件", exact: true }).click();
  await expect(
    f
      .getByRole("group", { name: "评分筛选" })
      .getByRole("button", { name: "全部" }),
  ).toHaveAttribute("aria-pressed", "true");
  await f.getByRole("button", { name: "应用筛选" }).click();
  await expect(page.getByRole("button", { name: /移除筛选/ })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "筛选影片" }),
  ).not.toContainText("已应用");
});

test("neumorphic theme restores raised and inset surfaces with readable navigation", async ({
  page,
}) => {
  await fixture(page);
  const colors = await page.evaluate(() => {
    const style = (selector: string) =>
      getComputedStyle(document.querySelector(selector)!);
    const parse = (value: string) =>
      value
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number);
    const lum = (rgb: number[]) =>
      rgb
        .map((v) => {
          v /= 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        })
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const fg = lum(parse(style(".subtitle-state").color));
    const bg = lum(parse(style(".card").backgroundColor));
    return {
      scheme: getComputedStyle(document.documentElement).colorScheme,
      scrollbarWidth: getComputedStyle(document.documentElement).scrollbarWidth,
      body: style("body").backgroundColor,
      sidebarBlur: style(".sidebar").backdropFilter,
      headerBlur: style("header").backdropFilter,
      cardShadow: style(".card").boxShadow,
      searchShadow: style(".search-wrap").boxShadow,
      contrast: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05),
      titleContrast:
        (lum(parse(style("header").backgroundColor)) + 0.05) /
        (lum(parse(style("h1").color)) + 0.05),
    };
  });
  expect(colors.scheme).toBe("light");
  expect(colors.scrollbarWidth).toBe("thin");
  expect(colors.body).toBe("rgb(224, 229, 236)");
  expect(colors.sidebarBlur).toBe("none");
  expect(colors.headerBlur).toBe("none");
  expect(colors.cardShadow).not.toBe("none");
  expect(colors.cardShadow).not.toContain("inset");
  expect(colors.searchShadow).toContain("inset");
  expect(colors.contrast).toBeGreaterThanOrEqual(4.5);
  expect(colors.titleContrast).toBeGreaterThanOrEqual(4.5);
  await expect(page.getByRole("heading", { name: "影片资料库" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "资料与系统管理" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "播放器与资料来源", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "播放器与资料来源" }),
  ).toBeVisible();
  expect(
    await page
      .locator(".backdrop")
      .evaluate((el) => getComputedStyle(el).backdropFilter),
  ).toBe("none");
});
