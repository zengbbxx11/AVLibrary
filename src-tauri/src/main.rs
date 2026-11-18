#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod catalog;
mod diagnostics;
mod media;
mod metadata;
mod native_media;
mod scanner;
mod maintenance;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, State};
fn stamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
type Result<T> = std::result::Result<T, String>;
struct AppState {
    db: Mutex<Connection>,
    data: PathBuf,
    cancel: AtomicBool,
    scanning: AtomicBool,
    shutdown: AtomicBool,
    decoder: Mutex<()>,
    tool_job: usize,
}
#[track_caller]
fn err(e: impl std::fmt::Display) -> String {
    let message = e.to_string();
    diagnostics::error(diagnostics::EventKind::BackendError, &message);
    message
}
fn db(s: &AppState) -> Result<std::sync::MutexGuard<'_, Connection>> {
    s.db.lock().map_err(err)
}
fn kind_ok(k: &str) -> Result<()> {
    if ["jav", "western", "personal"].contains(&k) {
        Ok(())
    } else {
        Err("无效媒体类型".into())
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Root {
    id: String,
    path: String,
    media_type: String,
    enabled: bool,
    online: bool,
    kind: String,
    detached: bool,
}
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Item {
    id: String,
    root_id: String,
    path: String,
    title: String,
    code: String,
    media_type: String,
    size: i64,
    duration: Option<f64>,
    rating: Option<i64>,
    favorite: bool,
    tags: Vec<String>,
    subtitle: Option<String>,
    subtitle_confirmation: String,
    cover: Option<String>,
    available: bool,
    removed: bool,
    added_at: i64,
    last_launched_at: Option<i64>,
    note: String,
    #[serde(flatten, default)]
    details: catalog::Details,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Page {
    items: Vec<Item>,
    total: i64,
}
#[derive(Serialize, Deserialize)]
struct Tag {
    id: String,
    name: String,
    #[serde(default, rename = "groupId")]
    group_id: Option<String>,
}
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
struct Settings {
    player: String,
    player_kind: String,
    #[serde(default = "metadata::defaults")]
    providers: Vec<metadata::Provider>,
    priorities: std::collections::HashMap<String, Vec<String>>,
    scan_minutes: Option<u64>,
}
fn initialize(path: &Path) -> Result<Connection> {
    let mut c = Connection::open(path).map_err(err)?;
    let version: i64 = c
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(err)?;
    if version > 3 {
        return Err("数据库来自更高版本，拒绝写入".into());
    }
    c.execute_batch("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE;
CREATE TABLE IF NOT EXISTS roots(id TEXT PRIMARY KEY,path TEXT NOT NULL UNIQUE,media_type TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY,root_id TEXT NOT NULL REFERENCES roots(id),path TEXT NOT NULL UNIQUE,identity TEXT,title TEXT NOT NULL,code TEXT NOT NULL DEFAULT '',media_type TEXT NOT NULL,size INTEGER NOT NULL CHECK(size>=0),duration REAL,rating INTEGER CHECK(rating BETWEEN 1 AND 5),favorite INTEGER NOT NULL DEFAULT 0,subtitle TEXT,subtitle_confirmation TEXT NOT NULL DEFAULT 'unselected',cover TEXT,available INTEGER NOT NULL DEFAULT 1,removed INTEGER NOT NULL DEFAULT 0,added_at INTEGER NOT NULL,last_launched_at INTEGER,note TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS item_identity ON items(identity); CREATE INDEX IF NOT EXISTS item_code ON items(code);
CREATE TABLE IF NOT EXISTS tags(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS item_tags(item_id TEXT REFERENCES items(id),tag_id TEXT REFERENCES tags(id),PRIMARY KEY(item_id,tag_id));
CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,item_id TEXT NOT NULL,old_path TEXT NOT NULL,new_path TEXT NOT NULL,identity TEXT NOT NULL,state TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS operation_temps(op_id TEXT PRIMARY KEY,path TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS launches(id TEXT PRIMARY KEY,item_id TEXT NOT NULL,launched_at INTEGER NOT NULL,result TEXT NOT NULL);
").map_err(err)?;
    if version > 0 && version < 3 && path != Path::new(":memory:") {
        let copy = path.with_extension(format!("pre-v3-{}.db", stamp()));
        let mut output = Connection::open(copy).map_err(err)?;
        let backup = rusqlite::backup::Backup::new(&c, &mut output).map_err(err)?;
        backup
            .run_to_completion(32, std::time::Duration::from_millis(1), None)
            .map_err(err)?;
    }
    catalog::migrate(&mut c, version)?;
    c.execute_batch("CREATE TABLE IF NOT EXISTS subtitle_versions(subtitle_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL)").map_err(err)?;
    Ok(c)
}
fn identity(path: &Path) -> Option<String> {
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
        };
        let f = fs::File::open(path).ok()?;
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        if unsafe { GetFileInformationByHandle(f.as_raw_handle(), &mut info) } == 0 {
            return None;
        }
        return Some(format!(
            "{}:{}:{}",
            info.dwVolumeSerialNumber, info.nFileIndexHigh, info.nFileIndexLow
        ));
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        None
    }
}
fn normalize_code(name: &str) -> String {
    static FC2: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    if let Some(c) = FC2
        .get_or_init(|| {
            regex::Regex::new(r"(?i)(?:^|[^a-z0-9])FC2[-_ ]*(?:PPV[-_ ]*)?(\d{5,9})(?:[^0-9]|$)")
                .unwrap()
        })
        .captures(name)
    {
        return format!("FC2-PPV-{}", &c[1]);
    }

    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| {
        regex::Regex::new(r"(?i)(?:^|[^a-z])([a-z]{2,8})[-_ ]?(\d{3,6})(?:[^0-9]|$)").unwrap()
    });
    re.captures(name)
        .map(|c| format!("{}-{}", c[1].to_uppercase(), &c[2]))
        .unwrap_or_default()
}
fn is_video(p: &Path) -> bool {
    matches!(
        p.extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase()
            .as_str(),
        "mp4" | "mkv" | "avi" | "wmv" | "mov" | "m4v" | "webm" | "ts" | "mpg" | "mpeg"
    )
}
fn is_sub(p: &Path) -> bool {
    matches!(
        p.extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase()
            .as_str(),
        "srt" | "ass" | "ssa" | "vtt"
    )
}
#[tauri::command]
async fn roots(app: tauri::AppHandle) -> Result<Vec<Root>> {
    tauri::async_runtime::spawn_blocking(move || {
        let s = app.state::<AppState>();
        let mut roots = read_roots(&*db(&s)?)?;
        for root in &mut roots {
            root.online = Path::new(&root.path).is_dir();
        }
        Ok(roots)
    }).await.map_err(err)?
}
fn read_roots(c: &Connection) -> Result<Vec<Root>> {
    let mut q = c
        .prepare("SELECT r.id,r.path,r.media_type,r.enabled,coalesce(m.kind,'video'),coalesce(m.detached,0) FROM roots r LEFT JOIN root_meta m ON m.root_id=r.id")
        .map_err(err)?;
    let rows = q
        .query_map([], |r| {
            let path: String = r.get(1)?;
            Ok(Root {
                id: r.get(0)?,
                online: false,
                path,
                media_type: r.get(2)?,
                enabled: r.get(3)?,
                kind: r.get(4)?,
                detached: r.get(5)?,
            })
        })
        .map_err(err)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(rows)
}
#[tauri::command]
fn add_root(path: String, media_type: String, kind:Option<String>, s: State<AppState>) -> Result<String> {
    let kind=kind.unwrap_or_else(||"video".into());
    if !["video","subtitle"].contains(&kind.as_str()){return Err("目录用途无效".into());}
    kind_ok(&media_type)?;
    let p = fs::canonicalize(path).map_err(err)?;
    if !p.is_dir() {
        return Err("请选择文件夹".into());
    }
    let mut c = db(&s)?;
    let paths = c
        .prepare("SELECT path FROM roots")
        .map_err(err)?
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(err)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(err)?;
    let a = p.to_string_lossy().to_lowercase();
    for old in paths {
        let b = fs::canonicalize(&old)
            .unwrap_or_else(|_| PathBuf::from(old))
            .to_string_lossy()
            .to_lowercase();
        if a == b || a.starts_with(&(b.clone() + "\\")) || b.starts_with(&(a.clone() + "\\")) {
            return Err("此目录与已有根目录重叠".into());
        }
    }
    let key=id();let tx=c.transaction().map_err(err)?;
    tx.execute("INSERT INTO roots(id,path,media_type) VALUES(?1,?2,?3)",params![key,p.to_string_lossy(),media_type]).map_err(err)?;
    tx.execute("INSERT INTO root_meta(root_id,kind) VALUES(?1,?2)",params![key,kind]).map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(key)
}
#[tauri::command]
fn toggle_root(root_id: String, enabled: bool, s: State<AppState>) -> Result<()> {
    set_root_enabled(&mut *db(&s)?, &root_id, enabled)
}
fn set_root_enabled(c: &mut Connection, root: &str, enabled: bool) -> Result<()> {
    let tx = c.transaction().map_err(err)?;
    if tx
        .execute(
            "UPDATE roots SET enabled=?1 WHERE id=?2",
            params![enabled, root],
        )
        .map_err(err)?
        != 1
    {
        return Err("目录不存在".into());
    }
    if enabled {
        tx.execute("UPDATE root_meta SET detached=0 WHERE root_id=?1", [root])
            .map_err(err)?;
    } else {
        tx.execute("UPDATE jobs SET state='cancelled',updated_at=?1 WHERE item_id IN(SELECT id FROM items WHERE root_id=?2) AND state IN('queued','running','paused','review')",params![stamp(),root]).map_err(err)?;
    }
    tx.commit().map_err(err)
}
fn walk(p: &Path, out: &mut Vec<PathBuf>, cancel: &AtomicBool) -> Result<()> {
    for entry in fs::read_dir(p).map_err(err)? {
        if cancel.load(Ordering::Relaxed) {
            return Err("扫描已取消，保留现有资料".into());
        }
        let entry = entry.map_err(err)?;
        let ty = entry.file_type().map_err(err)?;
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if fs::symlink_metadata(entry.path())
                .map_err(err)?
                .file_attributes()
                & 0x400
                != 0
            {
                continue;
            }
        }
        if ty.is_symlink() {
            continue;
        }
        if ty.is_dir() {
            walk(&entry.path(), out, cancel)?
        } else if ty.is_file() {
            out.push(entry.path())
        }
    }
    Ok(())
}
#[tauri::command]
fn cancel_scan(s: State<AppState>) {
    s.cancel.store(true, Ordering::Relaxed);
}
#[tauri::command]
async fn scan(app: tauri::AppHandle, root_id: String) -> Result<usize> {
    tauri::async_runtime::spawn_blocking(move || {
        scanner::scan_root(&app.state::<AppState>(), &root_id)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn list_items(
    query: String,
    media_type: String,
    removed: bool,
    offset: i64,
    limit: i64,
    filters: Option<catalog::Filters>,
    app: tauri::AppHandle,
) -> Result<Page> {
    tauri::async_runtime::spawn_blocking(move || {
        catalog::list(
            &*db(&app.state::<AppState>())?,
            &query,
            &media_type,
            removed,
            offset,
            limit,
            &filters.unwrap_or_default(),
        )
    }).await.map_err(err)?
}
#[tauri::command]
fn save_item(item: Item, s: State<AppState>) -> Result<()> {
    catalog::save(&mut *db(&s)?, &item)
}
#[tauri::command]
fn set_removed(ids: Vec<String>, removed: bool, s: State<AppState>) -> Result<()> {
    let mut c = db(&s)?;
    let tx = c.transaction().map_err(err)?;
    for item in ids {
        tx.execute(
            "UPDATE items SET removed=?1 WHERE id=?2",
            params![removed, item],
        )
        .map_err(err)?;
    }
    tx.execute("UPDATE jobs SET state='cancelled' WHERE item_id IN(SELECT id FROM items WHERE removed=1) AND state IN('queued','running','paused','review')",[]).map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(())
}
#[tauri::command]
fn tags(s: State<AppState>) -> Result<Vec<Tag>> {
    let c = db(&s)?;
    let mut q = c
        .prepare("SELECT t.id,t.name,m.group_id FROM tags t LEFT JOIN tag_meta m ON m.tag_id=t.id ORDER BY name")
        .map_err(err)?;
    let rows = q
        .query_map([], |r| {
            Ok(Tag {
                id: r.get(0)?,
                name: r.get(1)?,
                group_id: r.get(2)?,
            })
        })
        .map_err(err)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(rows)
}
#[tauri::command]
fn save_tag(tag: Tag, s: State<AppState>) -> Result<()> {
    let mut c=db(&s)?;
    save_tag_impl(&mut c, &tag)
}
fn save_tag_impl(c: &mut Connection, tag: &Tag) -> Result<()> {
    let name=tag.name.trim();
    if name.is_empty(){return Err("标签名不能为空".into());}
    if name.chars().count()>80{return Err("标签名最多 80 个字符".into());}
    if tag.id.is_empty(){return Err("标签标识无效".into());}
    let tx=c.transaction().map_err(err)?;
    let exists:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM tags WHERE name=?1 COLLATE NOCASE AND id!=?2)",params![name,tag.id],|r|r.get(0)).map_err(err)?;
    if exists{return Err("同名标签已存在，请使用已有标签或在管理中合并".into());}
    if let Some(group)=&tag.group_id {
      let valid:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM tag_groups WHERE id=?1)",[group],|r|r.get(0)).map_err(err)?;
      if !valid{return Err("标签分类已不存在，请重新选择".into());}
    }
    tx.execute("INSERT INTO tags(id,name) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET name=excluded.name",params![tag.id,name]).map_err(err)?;
    tx.execute("INSERT INTO tag_meta(tag_id,group_id) VALUES(?1,?2) ON CONFLICT(tag_id) DO UPDATE SET group_id=excluded.group_id",params![tag.id,tag.group_id]).map_err(err)?;
    tx.commit().map_err(err)
}
#[tauri::command]
fn delete_tag(tag_id: String, s: State<AppState>) -> Result<()> {
    let mut c = db(&s)?;
    let tx = c.transaction().map_err(err)?;
    tx.execute("DELETE FROM item_tags WHERE tag_id=?1", [&tag_id])
        .map_err(err)?;
    tx.execute("DELETE FROM tag_meta WHERE tag_id=?1", [&tag_id])
        .map_err(err)?;
    tx.execute("DELETE FROM tags WHERE id=?1", [&tag_id])
        .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(())
}
#[tauri::command]
fn get_settings(s: State<AppState>) -> Result<Settings> {
    read_settings(&*db(&s)?, &s.data)
}
fn read_settings(c: &Connection, data: &Path) -> Result<Settings> {
    let json: Option<String> = c
        .query_row("SELECT value FROM settings WHERE id=1", [], |r| r.get(0))
        .optional()
        .map_err(err)?;
    let mut settings: Settings = json.map(|j| serde_json::from_str(&j).map_err(err))
        .unwrap_or_else(|| {
            let player = ["C:/Program Files/DAUM/PotPlayer/PotPlayerMini64.exe", "C:/Program Files (x86)/DAUM/PotPlayer/PotPlayerMini.exe"]
                .iter().find(|p| Path::new(p).is_file()).map(|s| s.to_string()).unwrap_or_default();
            Ok(Settings {player, player_kind: "potplayer".into(), providers: metadata::defaults(), ..Default::default()})
        })?;
    settings.scan_minutes = Some(maintenance::effective_interval(settings.scan_minutes, data));
    Ok(settings)
}
#[tauri::command]
fn save_settings(settings: Settings, s: State<AppState>) -> Result<()> {
    save_settings_impl(&*db(&s)?, &settings)
}
fn save_settings_impl(c: &Connection, settings: &Settings) -> Result<()> {
    if settings.scan_minutes.is_some_and(|v| !(10..=1440).contains(&v)) {
        return Err("完整核对间隔需为 10–1440 分钟".into());
    }
    c.execute("INSERT INTO settings VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET value=excluded.value", [serde_json::to_string(settings).map_err(err)?]).map_err(err)?;
    Ok(())
}

#[tauri::command]
fn bind_subtitle(item_id: String, path: String, s: State<AppState>) -> Result<()> {
    if !is_sub(Path::new(&path)) || !Path::new(&path).is_file() {
        return Err("字幕文件不存在或格式不支持".into());
    }
    scanner::bind(&mut *db(&s)?, &item_id, &path)?;
    Ok(())
}
#[tauri::command]
fn import_cover(item_id: String, path: String, s: State<AppState>) -> Result<()> {
    let p = Path::new(&path);
    let ext = p
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !["jpg", "jpeg", "png", "webp"].contains(&ext.as_str())
        || fs::metadata(p).map_err(err)?.len() > 20 * 1024 * 1024
    {
        return Err("请使用 20MB 内的 JPG/PNG/WebP 图片".into());
    }
    let revision: i64 = db(&s)?
        .query_row(
            "SELECT revision FROM items WHERE id=?1 AND removed=0",
            [&item_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    let bytes = fs::read(p).map_err(err)?;
    media::persist_cover(&s, &item_id, &bytes, &ext, "imported", revision, false)?;
    Ok(())
}
#[tauri::command]
async fn cover_path(app: tauri::AppHandle, name: String) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let s = app.state::<AppState>();
        if Path::new(&name).components().count() != 1 || name.starts_with('.') {
            return Err("无效资源路径".into());
        }
        let source = s.data.join("covers").join(&name);
        let directory = s.data.join("thumbnails");
        fs::create_dir_all(&directory).map_err(err)?;
        let target = directory.join(format!("{}.jpg", name));
        if !target.is_file() {
            static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
            let _guard = LOCK.lock().map_err(err)?;
            if !target.is_file() {
                let metadata = fs::metadata(&source).map_err(err)?;
                if metadata.len() > 20 * 1024 * 1024 {
                    return Err("图片超过预览大小限制".into());
                }
                let image = media::validate_image(&fs::read(&source).map_err(err)?)?;
                let temp = directory.join(format!("{}.jpg", id()));
                image
                    .thumbnail(640, 640)
                    .to_rgb8()
                    .save(&temp)
                    .map_err(err)?;
                fs::rename(temp, &target).map_err(err)?;
            }
        }
        Ok(target.to_string_lossy().into_owned())
    })
    .await
    .map_err(err)?
}
fn external_player_path(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("\\\\?\\UNC\\") {
        format!("\\\\{}", rest)
    } else {
        path.strip_prefix("\\\\?\\").unwrap_or(path).to_string()
    }
}
struct LaunchTarget {
    path: String,
    identity: Option<String>,
    subtitle: Option<String>,
    subtitle_identity: Option<String>,
    subtitle_confirmation: String,
    subtitle_fingerprint: Option<String>,
}

impl LaunchTarget {
    fn read(c: &Connection, item: &str) -> Result<Self> {
        c.query_row(
            "SELECT i.path,m.identity,coalesce(sub.path,i.subtitle),sub.identity,i.subtitle_confirmation,v.fingerprint
             FROM items i
             LEFT JOIN media_files m ON m.item_id=i.id AND m.is_primary=1
             LEFT JOIN subtitles sub ON sub.id=i.selected_subtitle_id
             LEFT JOIN subtitle_versions v ON v.subtitle_id=i.selected_subtitle_id
             WHERE i.id=?1 AND i.removed=0",
            [item],
            |r| Ok(Self {
                path: r.get(0)?,
                identity: r.get(1)?,
                subtitle: r.get(2)?,
                subtitle_identity: r.get(3)?,
                subtitle_confirmation: r.get(4)?,
                subtitle_fingerprint: r.get(5)?,
            }),
        ).optional().map_err(err)?.ok_or_else(|| "影片已移出或不存在，请刷新资料库".into())
    }

    fn checked_subtitle(&self, without_subtitle: bool) -> Result<Option<&str>> {
        let Some(subtitle) = self.subtitle.as_deref().filter(|_| !without_subtitle) else {
            return Ok(None);
        };
        let path = Path::new(subtitle);
        if !path.is_file() {
            return Err("选中字幕不可用，请重新选择或本次不带外挂字幕播放".into());
        }
        if let Some(expected) = &self.subtitle_fingerprint {
            if !scanner::subtitle_fingerprint(path).is_ok_and(|actual| &actual == expected) {
                return Err("选中字幕内容已变化或无法读取，请重新确认或本次不带外挂字幕播放".into());
            }
        }
        if self.subtitle_confirmation == "needs_review"
            || self.subtitle_identity.is_some() && identity(path) != self.subtitle_identity
        {
            return Err("选中字幕文件已变化或需要重新确认，请重新选择或本次不带外挂字幕播放".into());
        }
        Ok(Some(subtitle))
    }
}

#[cfg(test)]
fn subtitle_for_launch(c: &Connection, item: &str, without_subtitle: bool) -> Result<Option<String>> {
    Ok(LaunchTarget::read(c, item)?.checked_subtitle(without_subtitle)?.map(str::to_owned))
}

#[tauri::command]
async fn launch(item_id: String, without_subtitle: bool, app: tauri::AppHandle) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || launch_impl(&item_id, without_subtitle, &app.state::<AppState>()))
        .await.map_err(err)?
}

fn launch_impl(item_id: &str, without_subtitle: bool, s: &AppState) -> Result<()> {
    let (target, settings) = {
        let c = db(s)?;
        (LaunchTarget::read(&c, item_id)?, read_settings(&c, &s.data)?)
    };
    let path = &target.path;
    if !Path::new(&path).is_file() {
        return Err("视频离线或已移动，请重新核对目录".into());
    }
    if target.identity.is_some() && identity(Path::new(&path)) != target.identity {
        return Err("该路径的文件已经被替换，请先核查或重新关联，避免播放错误影片".into());
    }
    let sub = target.checked_subtitle(without_subtitle)?;
    let mut cmd = if settings.player.is_empty() {
        if sub.is_some() && !without_subtitle {
            return Err(
                "系统默认程序无法保证加载外挂字幕，请配置 PotPlayer/mpv 或本次不带字幕播放".into(),
            );
        }
        let mut c = Command::new("explorer.exe");
        c.arg(external_player_path(&path));
        c
    } else {
        let mut c = Command::new(&settings.player);
        c.arg(external_player_path(&path));
        if let Some(sub) = sub {
                match settings.player_kind.as_str() {
                    "potplayer" => {
                        c.arg(format!("/sub={}", external_player_path(sub)));
                    }
                    "mpv" => {
                        c.arg(format!("--sub-file={}", external_player_path(sub)));
                    }
                    "vlc" => {
                        c.arg(format!("--sub-file={}", external_player_path(sub)));
                    }
                    _ => return Err("未知播放器字幕参数，请选择明确的适配器".into()),
                }
        }
        c
    };
    let result = cmd.spawn().map(|_| ()).map_err(err);
    // The user-facing result reflects process startup even if recording history fails.
    let _ = record_launch(s, item_id, result.is_ok());
    result
}

fn record_launch(s: &AppState, item_id: &str, dispatched: bool) -> Result<()> {
    let mut c = db(s)?;
    let tx = c.transaction().map_err(err)?;
    let now = stamp();
    tx.execute(
        "INSERT INTO launches VALUES(?1,?2,?3,?4)",
        params![
            id(),
            item_id,
            now,
            if dispatched {
                "dispatched"
            } else {
                "failed"
            }
        ],
    )
    .map_err(err)?;
    if dispatched {
        tx.execute(
            "UPDATE items SET last_launched_at=?1 WHERE id=?2",
            params![now, item_id],
        )
        .map_err(err)?;
    }
    tx.commit().map_err(err)
}
#[tauri::command]
fn reveal(item_id: String, s: State<AppState>) -> Result<()> {
    let path: String = db(&s)?
        .query_row("SELECT path FROM items WHERE id=?1", [item_id], |r| {
            r.get(0)
        })
        .map_err(err)?;
    Command::new("explorer.exe")
        .arg(format!("/select,{}", external_player_path(&path)))
        .spawn()
        .map_err(err)?;
    Ok(())
}

#[tauri::command]
fn rename_video(item_id: String, new_name: String, s: State<AppState>) -> Result<()> {
    rename_impl(&item_id, &new_name, &s)
}
fn move_no_replace(from: &Path, to: &Path) -> Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        let from: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
        let to: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
        if unsafe { windows_sys::Win32::Storage::FileSystem::MoveFileW(from.as_ptr(), to.as_ptr()) }
            == 0
        {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        if to.exists() {
            return Err("目标已存在".into());
        }
        fs::rename(from, to).map_err(err)
    }
}
fn rename_impl(item_id: &str, new_name: &str, s: &AppState) -> Result<()> {
    let invalid = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    let name = new_name;
    let base = name.split('.').next().unwrap_or("").to_uppercase();
    if name.trim().is_empty()
        || name.chars().any(|c| c.is_control() || invalid.contains(&c))
        || name.ends_with('.')
        || name.ends_with(' ')
        || [
            "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
            "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
        ]
        .contains(&base.as_str())
    {
        return Err("文件名包含非法字符或 Windows 保留名称".into());
    }
    if s.scanning.swap(true, Ordering::SeqCst) {
        return Err("请等待扫描结束再改名".into());
    }
    struct Guard<'a>(&'a AtomicBool);
    impl Drop for Guard<'_> {
        fn drop(&mut self) {
            self.0.store(false, Ordering::SeqCst)
        }
    }
    let _guard = Guard(&s.scanning);
    let mut c = db(s)?;
    let old: String = c
        .query_row(
            "SELECT path FROM items WHERE id=?1 AND removed=0",
            [item_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    let old_path = Path::new(&old);
    let ext = old_path
        .extension()
        .and_then(|v| v.to_str())
        .ok_or("原文件缺少扩展名")?;
    let dest = old_path.with_file_name(format!("{}.{}", name, ext));
    if dest == old_path {
        return Ok(());
    }
    let ident = identity(old_path).ok_or("无法确认文件身份，暂不允许改名")?;
    let case_only = old.to_lowercase() == dest.to_string_lossy().to_lowercase()
        && identity(&dest).as_deref() == Some(&ident);
    if dest.exists() && !case_only {
        return Err("目标已存在，未改动文件".into());
    }
    let op = id();
    c.execute(
        "INSERT INTO operations VALUES(?1,?2,?3,?4,?5,'prepared')",
        params![op, item_id, old, dest.to_string_lossy(), ident],
    )
    .map_err(err)?;
    if case_only {
        let temp = old_path.with_file_name(format!(".avlibrary-{}.{}", id(), ext));
        c.execute(
            "INSERT INTO operation_temps VALUES(?1,?2)",
            params![op, temp.to_string_lossy()],
        )
        .map_err(err)?;
        move_no_replace(old_path, &temp)?;
        move_no_replace(&temp, &dest)?;
    } else {
        move_no_replace(old_path, &dest)?;
    }
    let tx = c.transaction().map_err(err)?;
    tx.execute(
        "UPDATE items SET path=?1 WHERE id=?2",
        params![dest.to_string_lossy(), item_id],
    )
    .map_err(err)?;
    tx.execute(
        "UPDATE media_files SET path=?1 WHERE item_id=?2 AND is_primary=1",
        params![dest.to_string_lossy(), item_id],
    )
    .map_err(err)?;
    tx.execute("UPDATE operations SET state='completed' WHERE id=?1", [op])
        .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(())
}

fn recover(c: &mut Connection) -> Result<()> {
    let ops = {
        let mut q=c.prepare("SELECT id,item_id,old_path,new_path,identity FROM operations WHERE state='prepared'").map_err(err)?;
        let rows = q
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                ))
            })
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        rows
    };
    for (op, item, old, new, ident) in ops {
        let temp: Option<String> = c
            .query_row(
                "SELECT path FROM operation_temps WHERE op_id=?1",
                [&op],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        if let Some(temp) = temp {
            if identity(Path::new(&temp)).as_deref() == Some(&ident) && !Path::new(&new).exists() {
                move_no_replace(Path::new(&temp), Path::new(&new))?;
            }
        }
        if old.to_lowercase() == new.to_lowercase()
            && identity(Path::new(&new)).as_deref() == Some(&ident)
        {
            let desired = Path::new(&new).file_name();
            let complete = fs::read_dir(Path::new(&new).parent().ok_or("无效改名路径")?)
                .map_err(err)?
                .filter_map(|v| v.ok())
                .any(|v| Some(v.file_name().as_os_str()) == desired);
            let resolved = if complete { &new } else { &old };
            let tx = c.transaction().map_err(err)?;
            tx.execute(
                "UPDATE items SET path=?1 WHERE id=?2",
                params![resolved, item],
            )
            .map_err(err)?;
            tx.execute(
                "UPDATE media_files SET path=?1 WHERE item_id=?2 AND is_primary=1",
                params![resolved, item],
            )
            .map_err(err)?;
            tx.execute(
                "UPDATE operations SET state=?1 WHERE id=?2",
                params![if complete { "completed" } else { "failed" }, op],
            )
            .map_err(err)?;
            tx.commit().map_err(err)?;
            continue;
        }
        if !Path::new(&old).exists() && identity(Path::new(&new)).as_deref() == Some(ident.as_str())
        {
            let tx = c.transaction().map_err(err)?;
            tx.execute("UPDATE items SET path=?1 WHERE id=?2", params![new, item])
                .map_err(err)?;
            tx.execute(
                "UPDATE media_files SET path=?1 WHERE item_id=?2 AND is_primary=1",
                params![new, item],
            )
            .map_err(err)?;
            tx.execute("UPDATE operations SET state='completed' WHERE id=?1", [op])
                .map_err(err)?;
            tx.commit().map_err(err)?;
        } else if identity(Path::new(&old)).as_deref() == Some(ident.as_str())
            && !Path::new(&new).exists()
        {
            c.execute("UPDATE operations SET state='failed' WHERE id=?1", [op])
                .map_err(err)?;
        }
    }
    Ok(())
}

fn digest(path: &Path) -> Result<String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut file = fs::File::open(path).map_err(err)?;
    let mut hash = Sha256::new();
    let mut buffer = [0; 65536];
    loop {
        let n = file.read(&mut buffer).map_err(err)?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
fn backup_name(name: &str) -> bool {
    let mut parts = Path::new(name).components();
    matches!(parts.next(), Some(std::path::Component::Normal(_))) && parts.next().is_none()
}
fn validate_backup_database(
    c: &Connection,
    covers: &Path,
    names: &std::collections::HashSet<String>,
) -> Result<()> {
    let version: i64 = c
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(err)?;
    if version != 3 {
        return Err("备份数据库实际版本不兼容".into());
    }
    let integrity: String = c
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(err)?;
    let broken: i64 = c
        .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| {
            r.get(0)
        })
        .map_err(err)?;
    if integrity != "ok" || broken != 0 {
        return Err("备份数据库完整性或关联校验失败".into());
    }
    let mut q = c.prepare("SELECT cover FROM items WHERE cover IS NOT NULL UNION SELECT path FROM cover_assets WHERE manual=1").map_err(err)?;
    let refs = q.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
    for name in refs {
        let name = name.map_err(err)?;
        if !backup_name(&name) || !names.contains(&name) || !covers.join(&name).is_file() {
            return Err("备份缺少作品封面或人工图片资源".into());
        }
    }
    Ok(())
}
fn export_backup(c: &Connection, data: &Path, dest: &Path) -> Result<()> {
    if dest.exists() {
        return Err("备份目标必须是新的目录".into());
    }
    let tmp = dest.with_extension(format!("{}.partial", id()));
    fs::create_dir_all(tmp.join("covers")).map_err(err)?;
    let mut output = Connection::open(tmp.join("library.db")).map_err(err)?;
    let job = rusqlite::backup::Backup::new(c, &mut output).map_err(err)?;
    job.run_to_completion(32, std::time::Duration::from_millis(10), None)
        .map_err(err)?;
    drop(job);
    if output
        .query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))
        .map_err(err)?
        != "ok"
    {
        return Err("备份完整性检查失败".into());
    }
    let mut files = vec![];
    for entry in fs::read_dir(data.join("covers")).map_err(err)? {
        let entry = entry.map_err(err)?;
        if entry.file_type().map_err(err)?.is_file() {
            let name = entry.file_name().to_string_lossy().to_string();
            let target = tmp.join("covers").join(&name);
            fs::copy(entry.path(), &target).map_err(err)?;
            files.push(serde_json::json!({"name":name,"sha256":digest(&target)?}));
        }
    }
    let names = files
        .iter()
        .filter_map(|f: &serde_json::Value| f["name"].as_str().map(str::to_owned))
        .collect();
    validate_backup_database(&output, &tmp.join("covers"), &names)?;
    drop(output);
    fs::write(tmp.join("manifest.json"),serde_json::to_vec_pretty(&serde_json::json!({"formatVersion":1,"schemaVersion":3,"createdAt":stamp(),"databaseSha256":digest(&tmp.join("library.db"))?,"covers":files,"externalMediaIncluded":false})).map_err(err)?).map_err(err)?;
    fs::rename(tmp, dest).map_err(err)?;
    Ok(())
}
#[tauri::command]
async fn backup(app: tauri::AppHandle, path: String) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let s = app.state::<AppState>();
        let c = db(&s)?;
        export_backup(&c, &s.data, Path::new(&path))?;
        Ok(path)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn restore_backup(app: tauri::AppHandle, path: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || restore_impl(&path, &app.state::<AppState>()))
        .await
        .map_err(err)?
}

#[derive(Default)]
struct RestoreFiles(Vec<PathBuf>);

impl RestoreFiles {
    fn copy_new(&mut self, source: &Path, target: &Path) -> Result<()> {
        let mut input = fs::File::open(source).map_err(err)?;
        let mut output = fs::OpenOptions::new().write(true).create_new(true).open(target).map_err(err)?;
        self.0.push(target.to_path_buf());
        std::io::copy(&mut input, &mut output).map_err(err)?;
        output.sync_all().map_err(err)
    }
}

impl Drop for RestoreFiles {
    fn drop(&mut self) {
        for path in &self.0 {
            if let Err(error) = fs::remove_file(path) {
                diagnostics::error(diagnostics::EventKind::BackendError, &error.to_string());
            }
        }
    }
}

fn restore_impl(path: &str, s: &AppState) -> Result<()> {
    if s.scanning.swap(true, Ordering::SeqCst) {
        return Err("请先结束扫描".into());
    }
    struct RestoreGuard<'a>(&'a AtomicBool);
    impl Drop for RestoreGuard<'_> {
        fn drop(&mut self) {
            self.0.store(false, Ordering::SeqCst);
        }
    }
    let _restore_guard = RestoreGuard(&s.scanning);
    let _decoder = s.decoder.lock().map_err(err)?;
    let source = Path::new(&path);
    let manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(source.join("manifest.json")).map_err(err)?)
            .map_err(err)?;
    if manifest["formatVersion"] != 1 || manifest["schemaVersion"] != 3 {
        return Err("备份版本不兼容".into());
    }
    let mut staging = RestoreFiles::default();
    let staged_database = s.data.join(format!("restore-{}.db", id()));
    staging.copy_new(&source.join("library.db"), &staged_database)?;
    if manifest["databaseSha256"].as_str() != Some(digest(&staged_database)?.as_str()) {
        return Err("数据库校验失败".into());
    }
    let covers = manifest["covers"].as_array().ok_or("资源清单缺失")?;
    let mut names = std::collections::HashSet::new();
    let mut assets = Vec::with_capacity(covers.len());
    for file in covers {
        let name = file["name"].as_str().ok_or("图片名缺失")?;
        if !backup_name(name) || !names.insert(name.to_string()) {
            return Err("备份图片路径越界".into());
        }
        let expected = file["sha256"].as_str().ok_or("图片校验值缺失")?;
        let input = source.join("covers").join(name);
        if digest(&input)? != expected {
            return Err("图片校验失败".into());
        }
        assets.push((input, s.data.join("covers").join(name), expected));
    }
    let input = Connection::open(&staged_database).map_err(err)?;
    validate_backup_database(&input, &source.join("covers"), &names)?;
    input.execute_batch("CREATE TABLE IF NOT EXISTS subtitle_versions(subtitle_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL)").map_err(err)?;
    input.execute(
        "UPDATE jobs SET state='interrupted',updated_at=?1 WHERE state IN('queued','running')",
        [stamp()],
    ).map_err(err)?;

    let mut c = db(&s)?;
    let mut missing = Vec::new();
    for (input, target, expected) in assets {
        match fs::symlink_metadata(&target) {
            Ok(metadata) if metadata.is_file() && digest(&target)? == expected => {}
            Ok(_) => return Err("资源名称冲突，已取消恢复并保留当前数据库".into()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => missing.push((input, target, expected)),
            Err(error) => return Err(err(error)),
        }
    }
    export_backup(
        &c,
        &s.data,
        &s.data.join(format!("before-restore-{}-{}", stamp(), id())),
    )?;
    let mut added = RestoreFiles::default();
    for (source, target, expected) in missing {
        added.copy_new(&source, &target)?;
        if digest(&target)? != expected {
            return Err("备份图片在恢复期间发生变化，已取消恢复".into());
        }
    }
    let job = rusqlite::backup::Backup::new(&input, &mut c).map_err(err)?;
    job.run_to_completion(32, std::time::Duration::from_millis(10), None)
        .map_err(err)?;
    drop(job);
    added.0.clear();
    Ok(())
}

fn show_startup_error(message: &str) {
    diagnostics::error(diagnostics::EventKind::StartupFailure, message);
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let logs = parent.join("app-data/logs");
            let _ = fs::create_dir_all(&logs);
            let safe =
                serde_json::to_vec_pretty(&diagnostics::classify(message)).unwrap_or_default();
            let _ = fs::write(logs.join("startup-error.log"), safe);
        }
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
        let text:Vec<u16>=format!("映库未能启动。\n请确认软件目录可写、已安装 Microsoft WebView2，并关闭同一目录中已运行的映库。\n\n{}",message).encode_utf16().chain(Some(0)).collect();
        let title: Vec<u16> = "映库 · 启动提示".encode_utf16().chain(Some(0)).collect();
        unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                text.as_ptr(),
                title.as_ptr(),
                MB_OK | MB_ICONERROR,
            )
        };
    }
}
fn main() {
    if native_media::worker_entry() {
        return;
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            diagnostics::initialize(&parent.join("app-data"));
        }
    }
    #[cfg(feature = "e2e")]
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "--remote-debugging-port=19222",
    );
    std::panic::set_hook(Box::new(|info| show_startup_error(&info.to_string())));
    #[allow(unused_mut)]
    let mut context = tauri::generate_context!();
    #[cfg(feature = "e2e")]
    for window in &mut context.config_mut().app.windows {
        window.additional_browser_args = Some("--remote-debugging-port=19222".into());
        window.devtools = Some(true);
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            fs::create_dir_all(data.join("covers"))?;
            #[cfg(windows)]
            {
                use std::hash::{Hash, Hasher};
                let mut hash = std::collections::hash_map::DefaultHasher::new();
                data.to_string_lossy().to_lowercase().hash(&mut hash);
                let name: Vec<u16> = format!("Local\\AVLibrary-{}", hash.finish())
                    .encode_utf16()
                    .chain(Some(0))
                    .collect();
                let handle = unsafe {
                    windows_sys::Win32::System::Threading::CreateMutexW(
                        std::ptr::null(),
                        0,
                        name.as_ptr(),
                    )
                };
                if handle.is_null() {
                    return Err(std::io::Error::last_os_error().into());
                }
                if unsafe { windows_sys::Win32::Foundation::GetLastError() }
                    == windows_sys::Win32::Foundation::ERROR_ALREADY_EXISTS
                {
                    unsafe { windows_sys::Win32::Foundation::CloseHandle(handle) };
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::AlreadyExists,
                        "同一资料目录已经打开",
                    )
                    .into());
                }
            }
            let mut connection =
                initialize(&data.join("library.db")).map_err(std::io::Error::other)?;
            recover(&mut connection).map_err(std::io::Error::other)?;
            app.manage(AppState {
                db: Mutex::new(connection),
                data,
                cancel: AtomicBool::new(false),
                scanning: AtomicBool::new(false),
                shutdown: AtomicBool::new(false),
                decoder: Mutex::new(()),
                tool_job: media::create_tool_job().map_err(std::io::Error::other)?,
            });
            {
                let s = app.state::<AppState>();
                db(&s).map_err(std::io::Error::other)?.execute(
                    "UPDATE jobs SET state='interrupted' WHERE state IN('running','queued')",
                    [],
                )?;
            }
            scanner::start_watch(app.handle().clone());
            metadata::worker(app.handle().clone());
            media::worker(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            roots,
            add_root,
            toggle_root,
            scan,
            cancel_scan,
            list_items,
            catalog::selected_items,
            save_item,
            set_removed,
            tags,
            save_tag,
            delete_tag,
            get_settings,
            save_settings,
            bind_subtitle,
            import_cover,
            cover_path,
            launch,
            reveal,
            rename_video,
            backup,
            restore_backup,
            catalog::catalog,
            catalog::save_entity,
            catalog::delete_entity,
            catalog::merge_entity,
            catalog::save_filter,
            catalog::delete_filter,
            catalog::batch_edit,
            catalog::set_tag_group,
            scanner::set_root_kind,
            scanner::set_root_type,
            scanner::separate_file,
            scanner::detach_root,
            scanner::relocate_root,
            scanner::file_choices,
            scanner::choose_primary,
            scanner::relink_file,
            scanner::subtitle_choices,
            scanner::clear_subtitle,
            scanner::review_items,
            metadata::queue_metadata,
            metadata::jobs,
            metadata::job_action,
            metadata::candidate,
            metadata::apply_metadata,
            metadata::fetch_cover,
            media::inspect_media,
            media::queue_local,
            media::trim_cache,media::reset_auto_cover,
            diagnostics::record_diagnostic,
            diagnostics::diagnostic_report,
            maintenance::system_status,maintenance::test_player,maintenance::reveal_data,
            diagnostics::export_diagnostics
        ])
        .build(context)
        .unwrap_or_else(|error| {
            show_startup_error(&error.to_string());
            std::process::exit(1)
        })
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                diagnostics::shutdown();
            }
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                if let Some(s) = app.try_state::<AppState>() {
                    s.shutdown.store(true, Ordering::SeqCst);
                    s.cancel.store(true, Ordering::SeqCst);
                }
            }
        });
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tags_keep_group_and_links_and_validate_before_commit(){
      let mut c=initialize(Path::new(":memory:")).unwrap();
      c.execute_batch("INSERT INTO tag_groups VALUES('g','主题');INSERT INTO roots VALUES('r','x','personal',1);INSERT INTO items(id,root_id,path,title,media_type,size,added_at) VALUES('i','r','x','样本','personal',1,1);").unwrap();
      let mut tag=Tag{id:"t".into(),name:"  自定义  ".into(),group_id:Some("g".into())};
      save_tag_impl(&mut c,&tag).unwrap();
      c.execute("INSERT INTO item_tags VALUES('i','t')",[]).unwrap();
      tag.name="改名".into();save_tag_impl(&mut c,&tag).unwrap();
      assert_eq!(c.query_row("SELECT group_id FROM tag_meta WHERE tag_id='t'",[],|r|r.get::<_,String>(0)).unwrap(),"g");
      assert_eq!(c.query_row("SELECT count(*) FROM item_tags WHERE tag_id='t'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
      let duplicate=Tag{id:"d".into(),name:"改名".into(),group_id:None};assert!(save_tag_impl(&mut c,&duplicate).is_err());
      tag.name="不得写入".into();tag.group_id=Some("missing".into());assert!(save_tag_impl(&mut c,&tag).is_err());
      assert_eq!(c.query_row("SELECT name FROM tags WHERE id='t'",[],|r|r.get::<_,String>(0)).unwrap(),"改名");
      tag.name=" ".into();assert!(save_tag_impl(&mut c,&tag).is_err());
      tag.name="改名".into();tag.group_id=None;save_tag_impl(&mut c,&tag).unwrap();
      assert!(c.query_row("SELECT group_id FROM tag_meta WHERE tag_id='t'",[],|r|r.get::<_,Option<String>>(0)).unwrap().is_none());
    }
    #[test]
    fn codes() {
        assert_eq!(
            normalize_code("www.98T.la@JUFE-626_restored.mp4"),
            "JUFE-626"
        );
        assert_eq!(normalize_code("jufe626"), "JUFE-626");
        assert_eq!(normalize_code("holiday clip"), "");
    }
    #[test]
    fn removed_survives() {
        let c = initialize(Path::new(":memory:")).unwrap();
        c.execute("INSERT INTO roots VALUES('r','x','personal',1)", [])
            .unwrap();
        c.execute("INSERT INTO items(id,root_id,path,title,media_type,size,added_at,removed) VALUES('i','r','a','a','personal',0,1,1)",[]).unwrap();
        c.execute("UPDATE items SET available=0 WHERE root_id='r'", [])
            .unwrap();
        assert_eq!(
            c.query_row("SELECT removed FROM items WHERE id='i'", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn rename_recovery_preserves_personal_data() {
        let dir = std::env::temp_dir().join(format!("avlibrary-test-{}", id()));
        fs::create_dir_all(&dir).unwrap();
        let old = dir.join("before.mp4");
        let new = dir.join("after.mp4");
        fs::write(&old, b"synthetic fixture").unwrap();
        let identity = identity(&old).unwrap();
        let mut c = initialize(Path::new(":memory:")).unwrap();
        c.execute("INSERT INTO roots VALUES('r','x','personal',1)", [])
            .unwrap();
        c.execute("INSERT INTO items(id,root_id,path,title,media_type,size,added_at,rating,subtitle,subtitle_confirmation) VALUES('i','r',?1,'a','personal',0,1,5,'chosen.srt','manual_confirmed')",[old.to_string_lossy()]).unwrap();
        c.execute(
            "INSERT INTO operations VALUES('op','i',?1,?2,?3,'prepared')",
            params![old.to_string_lossy(), new.to_string_lossy(), identity],
        )
        .unwrap();
        fs::rename(&old, &new).unwrap();
        recover(&mut c).unwrap();
        let (path, rating, subtitle): (String, i64, String) = c
            .query_row(
                "SELECT path,rating,subtitle FROM items WHERE id='i'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(path, new.to_string_lossy());
        assert_eq!(rating, 5);
        assert_eq!(subtitle, "chosen.srt");
        assert_eq!(
            c.query_row("SELECT state FROM operations", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "completed"
        );
        fs::remove_file(new).unwrap();
        fs::remove_dir(dir).unwrap();
    }
    #[test]
    fn newer_schema_is_not_downgraded() {
        let path = std::env::temp_dir().join(format!("avlibrary-schema-{}.db", id()));
        {
            let c = Connection::open(&path).unwrap();
            c.execute_batch("PRAGMA user_version=99").unwrap();
        }
        assert!(initialize(&path).is_err());
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn backup_covers_have_hashes_and_database_is_consistent() {
        let dir = std::env::temp_dir().join(format!("avlibrary-backup-test-{}", id()));
        let data = dir.join("data");
        fs::create_dir_all(data.join("covers")).unwrap();
        fs::write(data.join("covers").join("manual.jpg"), b"fixture").unwrap();
        let c = initialize(&data.join("library.db")).unwrap();
        let dest = dir.join("export");
        export_backup(&c, &data, &dest).unwrap();
        let manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(dest.join("manifest.json")).unwrap()).unwrap();
        assert_eq!(
            manifest["covers"][0]["sha256"].as_str().unwrap(),
            digest(&dest.join("covers/manual.jpg")).unwrap()
        );
        assert_eq!(
            manifest["databaseSha256"].as_str().unwrap(),
            digest(&dest.join("library.db")).unwrap()
        );
        assert!(export_backup(&c, &data, &dest).is_err());
        drop(c);
        fs::remove_dir_all(dir).unwrap();
    }
}

#[cfg(test)]
mod integration;
