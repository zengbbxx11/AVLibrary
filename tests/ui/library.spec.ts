import { test, expect } from "@playwright/test";
test("browser preview is explicit, has no content network requests, settings and panels work", async ({
  page,
}) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (
      !r.url().startsWith("http://127.0.0.1:5173") &&
      !r.url().startsWith("ws://127.0.0.1:5173")
    )
      external.push(r.url());
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "筛选影片", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("我的影片库", { exact: true })).toHaveCount(0);
  await expect(page.getByText("浏览器界面预览")).toBeVisible();
  await page.getByRole("button", { name: "播放器与资料来源" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "关闭窗口" }).click();
  await page.getByRole("button", { name: "文件夹管理" }).click();
  await expect(page.getByRole("dialog", { name: "文件夹管理" })).toBeVisible();
  await page.getByRole("button", { name: "关闭窗口" }).click();
  await page.getByRole("button", { name: "批量管理" }).click();
  await expect(page.getByRole("button", { name: "退出多选" })).toBeVisible();
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
  await page.screenshot({
    path: ".qa/ui/library-empty.png",
    fullPage: true,
  });
});
test("card rating, menu and multiselect never dispatch playback; primary click does", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const item = {
      id: "sample-1",
      rootId: "r",
      path: "D:/fixtures/sample.mp4",
      title: "本地样本 · 交互测试",
      code: "TEST-001",
      mediaType: "personal",
      size: 100000000,
      duration: null,
      rating: null,
      favorite: false,
      tags: [],
      subtitle: null,
      subtitleConfirmation: "unselected",
      cover: null,
      available: true,
      removed: false,
      addedAt: 1,
      lastLaunchedAt: null,
      note: "",
    };
    (window as any).isTauri = true;
    (window as any).calls = [];
    (window as any).__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      invoke: async (cmd: string, args: any) => {
        (window as any).calls.push(cmd);
        if (cmd === "list_items") return { items: [item], total: 1 };
        if (["roots", "tags", "jobs"].includes(cmd)) return [];
        if (cmd === "catalog")
          return {
            performers: [],
            studios: [],
            tag_groups: [],
            saved_filters: [],
          };
        if (cmd === "save_item") Object.assign(item, args.item);
        return null;
      },
    };
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "本地样本 · 交互测试" }),
  ).toBeVisible();
  await expect(page.getByText(/时长未知/)).toBeVisible();
  await page.getByRole("button", { name: "3 星" }).click();
  await page.getByRole("button", { name: "编辑 本地样本 · 交互测试" }).click();
  await expect(page.getByText("编辑影片", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭编辑" }).click();
  await page.getByRole("button", { name: "批量管理" }).click();
  await page
    .getByRole("button", { name: "切换选择 本地样本 · 交互测试" })
    .click();
  expect(
    await page.evaluate(
      () => (window as any).calls.filter((v: string) => v === "launch").length,
    ),
  ).toBe(0);
  await page.getByRole("button", { name: "退出多选" }).click();
  await page.getByRole("button", { name: "播放 本地样本 · 交互测试" }).click();
  expect(
    await page.evaluate(
      () => (window as any).calls.filter((v: string) => v === "launch").length,
    ),
  ).toBe(1);
});

test("advanced management uses automatic system thumbnails without tool configuration", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const data = Array.from({ length: 9 }, (_, n) => ({
      id: "movie-" + n,
      rootId: "r",
      path: "D:/fixtures/" + n + ".mp4",
      title:
        ["海岸上的一天", "雨后的城市", "山间公路"][n % 3] + " · " + (n + 1),
      code: "TEST-" + String(n + 1).padStart(3, "0"),
      mediaType: ["personal", "western", "jav"][n % 3],
      size: 1800000000 + n * 1000000,
      duration: 2400 + n * 300,
      rating: 3 + (n % 3),
      favorite: n % 2 === 0,
      tags: ["t1"],
      subtitle: n % 2 === 0 ? "D:/test.srt" : null,
      subtitleConfirmation: "auto_matched",
      cover: null,
      available: true,
      removed: false,
      addedAt: n,
      lastLaunchedAt: null,
      note: "",
      studio: "测试厂商",
      performers: ["测试演员"],
      description: "本地测试资料",
      releaseDate: "2025-01-01",
      locks: [],
      revision: 0,
      embeddedSubtitles: 0,
      subtitleState: n % 2 === 0 ? "selected" : "unselected",
    }));
    (window as any).isTauri = true;
    (window as any).calls = [];
    (window as any).__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      invoke: async (cmd: string, args: any) => {
        (window as any).calls.push({ cmd, args });
        if (cmd === "list_items") {
          const items = args.filters?.targetId
            ? data.filter((i) => i.id === args.filters.targetId)
            : data;
          return { items, total: items.length };
        }
        if (cmd === "catalog")
          return {
            performers: [{ id: "actor", name: "测试演员", aliases: [] }],
            studios: [{ id: "studio", name: "测试厂商", aliases: [] }],
            tag_groups: [{ id: "g1", name: "个人收藏" }],
            saved_filters: [],
          };
        if (cmd === "tags")
          return [
            { id: "t1", name: "周末重温", groupId: "g1" },
            { id: "t2", name: "喜欢", groupId: "g1" },
          ];
        if (cmd === "jobs")
          return [
            {
              id: "job",
              itemId: "movie-1",
              title: "来源测试任务",
              state: "review",
              payload: {
                proposal: {
                  title: "核查片名",
                  performers: ["演员"],
                  studio: "厂商",
                  releaseDate: "2025-01-01",
                  description: "测试简介",
                  sourceUrl: "https://example.com/work",
                  coverUrl: "",
                },
              },
              error: "",
              provider: "fixture",
              createdAt: 1,
            },
          ];
        if (cmd === "get_settings")
          return {
            player: "",
            playerKind: "potplayer",
            providers: [],
          };
        if (cmd === "roots") return [];
        if (cmd === "save_item") {
          Object.assign(
            data.find((i) => i.id === args.item.id)!,
            args.item,
          );
        }
        return null;
      },
    };
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "海岸上的一天 · 1", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "筛选影片", exact: true }).click();
  await page
    .getByRole("group", { name: "评分筛选" })
    .getByRole("button", { name: "4 星以上" })
    .click();
  const tagGroup = page.getByRole("group", { name: "标签筛选" });
  await tagGroup.getByRole("button", { name: "周末重温" }).click();
  await tagGroup.getByRole("button", { name: "喜欢" }).click();
  await page.getByRole("button", { name: "标签匹配方式", exact: true }).click();
  await page.getByRole("button", { name: "应用筛选", exact: true }).click();
  expect(
    await page.evaluate(() =>
      (window as any).calls.some(
        (c: any) =>
          c.cmd === "list_items" &&
          c.args.filters.ratingMin === 4 &&
          c.args.filters.allTags,
      ),
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "后台任务" }).click();
  await expect(page.getByText("核查片名")).toBeVisible();
  await page.getByRole("button", { name: "确认保存未锁定字段" }).click();
  expect(
    await page.evaluate(() =>
      (window as any).calls.some((c: any) => c.cmd === "apply_metadata"),
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "关闭窗口" }).click();
  await page.getByRole("button", { name: "编辑 海岸上的一天 · 1" }).click();
  await expect(
    page.getByRole("button", { name: "候选画面与逐帧选图" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "重新读取系统缩略图", exact: true })
    .click();
  await expect(
    page.getByText("读取系统缩略图完成", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as any).calls.some((c: any) => c.cmd === "inspect_media"),
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "关闭编辑" }).click();
  await page
    .getByRole("button", { name: "播放器与资料来源", exact: true })
    .click();
  await expect(
    page.getByText(
      "视频缩略图、时长和分辨率由 Windows 自动读取，无需配置媒体工具。系统不支持的格式可手动导入封面。",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText(/FFMPEG|FFPROBE|FFmpeg|FFprobe/)).toHaveCount(0);
  await page.getByRole("button", { name: "关闭窗口" }).click();
  await page.screenshot({
    path: ".qa/ui/library-complete.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("changed subtitle prompts for a one-time fallback without changing binding", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const item = {
      id: "changed-sub",
      rootId: "r",
      path: "D:/fixtures/video.mp4",
      title: "字幕替换测试",
      code: "TEST-101",
      mediaType: "personal",
      size: 100,
      duration: 30,
      rating: null,
      favorite: false,
      tags: [],
      subtitle: "D:/fixtures/selected.srt",
      subtitleConfirmation: "manual_confirmed",
      subtitleState: "invalid",
      cover: null,
      available: true,
      removed: false,
      addedAt: 1,
      lastLaunchedAt: null,
      note: "",
      performers: [],
      locks: [],
      revision: 0,
    };
    (window as any).isTauri = true;
    (window as any).calls = [];
    (window as any).__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      invoke: async (cmd: string, args: any) => {
        (window as any).calls.push({ cmd, args });
        if (cmd === "list_items") return { items: [item], total: 1 };
        if (["roots", "tags", "jobs"].includes(cmd)) return [];
        if (cmd === "catalog")
          return {
            performers: [],
            studios: [],
            tag_groups: [],
            saved_filters: [],
          };
        if (cmd === "launch" && !args.withoutSubtitle)
          throw "选中字幕文件已变化或需要重新确认，请重新选择或本次不带外挂字幕播放";
        return null;
      },
    };
  });
  await page.goto("/");
  await expect(page.getByText(/30 秒/)).toBeVisible();
  await expect(page.getByText("字幕文件已变化", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "播放 字幕替换测试", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "字幕需要处理" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消播放", exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as any).calls.filter((c: any) => c.cmd === "launch").length,
    ),
  ).toBe(1);
  await page
    .getByRole("button", { name: "播放 字幕替换测试", exact: true })
    .click();
  await page
    .getByRole("button", { name: "本次不带外挂字幕播放", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "字幕需要处理" })).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(() =>
      (window as any).calls
        .filter((c: any) => c.cmd === "launch")
        .map((c: any) => c.args.withoutSubtitle),
    ),
  ).toEqual([false, false, true]);
  expect(
    await page.evaluate(() =>
      (window as any).calls.some((c: any) =>
        ["bind_subtitle", "save_item"].includes(c.cmd),
      ),
    ),
  ).toBe(false);
  await page
    .getByRole("button", { name: "播放 字幕替换测试", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "字幕需要处理" }),
  ).toBeVisible();
});

test("diagnostic preview exports one local JSON and handles save cancellation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).isTauri = true;
    (window as any).calls = [];
    (window as any).cancelExport = false;
    (window as any).__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      invoke: async (cmd: string, args: any) => {
        (window as any).calls.push({ cmd, args });
        if (cmd === "list_items") return { items: [], total: 0 };
        if (["roots", "tags", "jobs"].includes(cmd)) return [];
        if (cmd === "catalog")
          return {
            performers: [],
            studios: [],
            tag_groups: [],
            saved_filters: [],
          };
        if (cmd === "diagnostic_report")
          return {
            formatVersion: 1,
            appVersion: "0.6.1",
            environment: {
              operatingSystem: "Windows 11 (build 26100)",
              webviewVersion: "157.0.1.0",
            },
            libraryStatus: { integrity: "ok", itemCount: 2 },
            privacy: { containsPathsTitlesNotesOrUrls: false },
            events: [
              {
                kind: "command_error",
                command: "scan",
                error: { category: "file_missing", codes: ["OS ERROR 2"] },
              },
            ],
          };
        if (cmd === "plugin:dialog|save")
          return (window as any).cancelExport
            ? null
            : "D:/support/diagnostic.json";
        return null;
      },
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "诊断与日志", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "诊断与日志" })).toBeVisible();
  await expect(
    page.getByText("系统：Windows 11 (build 26100)", { exact: true }),
  ).toBeVisible();
  await page.getByText("查看导出内容（已脱敏）", { exact: true }).click();
  await expect(page.getByLabel("诊断内容预览")).toContainText("file_missing");
  await page.getByRole("button", { name: "导出诊断文件", exact: true }).click();
  await expect(
    page.getByText("导出诊断文件完成", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.find((c: any) => c.cmd === "export_diagnostics")
          .args.path,
    ),
  ).toBe("D:/support/diagnostic.json");
  await page.evaluate(() => ((window as any).cancelExport = true));
  await page.getByRole("button", { name: "导出诊断文件", exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.filter((c: any) => c.cmd === "export_diagnostics")
          .length,
    ),
  ).toBe(1);
  await page.evaluate(() => {
    const error = new TypeError("PRIVATE_TITLE");
    error.stack =
      "TypeError: PRIVATE_TITLE\n at play (http://tauri.localhost/assets/index-abc.js:12:34)\n at file:///C:/PRIVATE_PATH/video.mp4:90:2";
    window.dispatchEvent(
      new ErrorEvent("error", { message: error.message, error }),
    );
  });
  const trace = await page.evaluate(
    () =>
      (window as any).calls.find(
        (c: any) =>
          c.cmd === "record_diagnostic" && c.args.entry.kind === "ui_error",
      ).args.entry,
  );
  expect(trace.frames).toEqual([{ line: 12, column: 34 }]);
  expect(trace.exceptionKind).toBe("TypeError");
  expect(trace.stack).toBeUndefined();
  await page.screenshot({
    path: ".qa/ui/diagnostics-preview.png",
    fullPage: true,
  });
});
