import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const base = path.resolve(import.meta.dirname, "..");
const qa = path.join(base, ".qa");
const configFile = process.argv.includes("--legacy") ? "legacy-config-0.13.json" : "approved-config.json";
const config = JSON.parse(await fs.readFile(path.join(qa, configFile), "utf8"));
const { work, media, exe, port } = config;
assert.equal(config.mode, "synthetic-isolated");
assert.equal(path.dirname(work), qa);
assert.match(path.basename(work), /^native-\d+$/);
assert.equal(exe, path.join(work, "AVLibraryE2E.exe"));
assert.equal(path.dirname(media), work);
assert.equal(port, 19222);

const version = JSON.parse(await fs.readFile(path.join(base, "package.json"), "utf8")).version;
const title = "桌面联动测试影片";
const note = "真实后端保存的笔记";
const tag = "桌面验收标签";
const record = path.join(work, "native-ui-state.json");
const browser = await chromium.connectOverCDP("http://127.0.0.1:" + port, { timeout: 5000 });
const page = browser.contexts().flatMap((context) => context.pages())
  .find((candidate) => candidate.url() === "http://tauri.localhost/");

function invoke(command, args = {}) {
  return page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
}

async function list(filters = {}, removed = false) {
  return invoke("list_items", { query: "", mediaType: "", removed, offset: 0, limit: 60, filters });
}

function button(name, scope = page) {
  return scope.getByRole("button", { name, exact: true });
}

function normalPath(value) {
  return path.normalize(value.startsWith("\\\\?\\") ? value.slice(4) : value);
}

async function waitForItem(name) {
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible({ timeout: 15000 });
  const item = (await list()).items.find((value) => value.title === name);
  assert(item, "The visible card must exist in the real database");
  return item;
}

async function openFileActions(editor) {
  const summary = editor.locator("summary").filter({ hasText: "资料与文件管理" });
  if (!(await summary.evaluate((element) => element.parentElement.open))) {
    await summary.click();
  }
}

try {
  assert(page, "Start the prepared test EXE on the Windows desktop first.");
  const status = await invoke("system_status");
  assert.equal(status.version, version);
  assert.equal(normalPath(status.dataPath), path.join(work, "app-data"));

  if (process.argv.includes("--legacy")) {
    const known = JSON.parse(await fs.readFile(path.join(work, "legacy-expected.json"), "utf8"));
    const item = await waitForItem(known.title);
    for (const field of ["id", "rating", "note", "cover", "subtitle", "subtitleConfirmation", "tags"]) {
      assert.deepEqual(item[field], known[field], field);
    }
    assert.equal((await invoke("tags")).find((entry) => entry.id === known.tags[0])?.name, known.tagName);
    assert(item.cover);
    await fs.access(await invoke("cover_path", { name: item.cover }));
    console.log("PASS new EXE opened the copied 0.12.0 database and read its manual cover, subtitle, rating, tag and note");
  } else if (process.argv.includes("--restart") || process.argv.includes("--play")) {
    const known = JSON.parse(await fs.readFile(record, "utf8"));
    const reopened = await waitForItem(title);
    assert.equal(reopened.id, known.id);
    assert.equal(reopened.note, note);
    assert.deepEqual(reopened.tags, known.tags);
    assert.equal(reopened.subtitleConfirmation, "manual_confirmed");
    assert.equal((await invoke("get_settings")).scanMinutes, 60);
    await page.screenshot({ path: path.join(qa, "0.13.0-native-library.png") });
    console.log("PASS restart retained the saved and restored data");
    if (process.argv.includes("--play")) {
      const player = "C:/Program Files/DAUM/PotPlayer/PotPlayerMini64.exe";
      await fs.access(player);
      assert.equal(path.dirname(normalPath(reopened.path)), media);
      await invoke("save_settings", { settings: { ...await invoke("get_settings"), player, playerKind: "potplayer" } });
      await button("播放 " + title).click();
      await expect(page.getByText("已发出播放请求", { exact: true })).toBeVisible();
      console.log("PASS card click dispatched the synthetic video and selected subtitle to PotPlayer");
    }
  } else {
    page.setDefaultTimeout(8000);
    const editor = page.getByRole("dialog", { name: "编辑影片" });
    if (await editor.isVisible()) await button("关闭编辑", editor).click();
    let root = (await invoke("roots")).find((entry) => normalPath(entry.path) === media);
    if (!root) {
      const rootId = await invoke("add_root", { path: media, mediaType: "jav", kind: "video" });
      root = { id: rootId };
    }
    await expect.poll(async () => {
      await invoke("scan", { rootId: root.id }).catch((error) => {
        if (!String(error).includes("已有扫描")) throw error;
      });
      return (await list()).total;
    }, { timeout: 15000 }).toBe(1);
    await button("返回影片库").click();
    await button("刷新").click();
    const current = (await list()).items[0];
    assert(["www.site@JUFE-626_restored", title].includes(current.title));
    const imported = await waitForItem(current.title);
    assert(["auto_matched", "manual_confirmed"].includes(imported.subtitleConfirmation));
    await expect.poll(async () => (await list({ targetId: imported.id })).items[0]?.cover, { timeout: 15000 }).toBeTruthy();
    console.log("PASS real folder scan, subtitle matching and Windows thumbnail reached the WebView");

    await button("编辑 " + imported.title).click();
    await editor.getByLabel("显示名称").fill(title);
    await editor.getByLabel("个人笔记", { exact: true }).fill(note);
    await editor.getByLabel("新标签名称").fill(tag);
    await button("创建并选中", editor).click();
    await expect(button(tag, editor)).toHaveAttribute("aria-pressed", "true");
    await button("保存修改", editor).click();
    await expect(editor).toHaveCount(0);
    const edited = await waitForItem(title);
    assert.equal(edited.note, note);
    assert.equal(edited.tags.length, 1);
    await button("筛选影片").click();
    const filter = page.locator("#library-filter-panel");
    await button(tag, filter).click();
    await button("应用筛选", filter).click();
    await expect(page.locator(".grid .card")).toHaveCount(1);
    await expect(page.locator(".filter-summary")).toContainText(tag);
    assert.equal((await list({ tags: edited.tags })).total, 1);
    await button("清除筛选").click();
    console.log("PASS UI edit, label creation and applied filter persisted in real SQLite");

    await button("编辑 " + title).click();
    await button("查看字幕候选", editor).click();
    const subtitles = page.getByRole("dialog", { name: "字幕候选" });
    await button("选为当前字幕", subtitles.locator(".root-row").filter({ hasText: "JUFE-626.srt" })).click();
    await expect(subtitles).toHaveCount(0);
    assert.equal((await list({ targetId: edited.id })).items[0].subtitleConfirmation, "manual_confirmed");
    console.log("PASS manual subtitle selection committed from the UI");

    await button("编辑 " + title).click();
    await openFileActions(editor);
    await button("从库移除（保留文件与个人资料）", editor).click();
    await button("确认继续").click();
    await expect(page.getByRole("heading", { name: title, exact: true })).toHaveCount(0);
    assert.equal((await list({ targetId: edited.id }, true)).total, 1);
    await button("已移出项目").click();
    await button("编辑 " + title).click();
    await openFileActions(editor);
    await button("恢复项目", editor).click();
    await button("确认继续").click();
    await button("全部影片").click();
    assert.equal((await waitForItem(title)).note, note);
    await fs.access(imported.path);
    console.log("PASS UI removal and recovery preserved both the file and private fields");

    const settingsName = "播放器与资料来源";
    await button(settingsName).click();
    const settings = page.getByRole("dialog", { name: settingsName });
    await settings.getByLabel("完整目录核对间隔", { exact: true }).selectOption("60");
    await button("保存设置", settings).click();
    await expect(settings).toHaveCount(0);
    assert.equal((await invoke("get_settings")).scanMinutes, 60);
    console.log("PASS settings saved through the UI and read back through real IPC");

    const backup = path.join(work, "native-ui-backup");
    await invoke("backup", { path: backup });
    await fs.access(path.join(backup, "manifest.json"));
    await button("编辑 " + title).click();
    await editor.getByLabel("个人笔记", { exact: true }).fill("待恢复的临时改动");
    await button("保存修改", editor).click();
    await expect.poll(async () => (await list({ targetId: edited.id })).items[0]?.note).toBe("待恢复的临时改动");
    await invoke("restore_backup", { path: backup });
    await button("刷新").click();
    assert.equal((await waitForItem(title)).note, note);
    console.log("PASS real Tauri backup and restore reversed an edit made in the UI");

    await fs.writeFile(record, JSON.stringify({ id: edited.id, tags: edited.tags }, null, 2));
    await page.screenshot({ path: path.join(qa, "0.13.0-native-library.png") });
  }
} finally {
  await browser.close();
}
