use super::*;
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::sync::OnceLock;
const LIMIT: u64 = 256 * 1024;
const RETENTION_MS: i64 = 7 * 24 * 60 * 60 * 1000;
const COMMANDS: &[&str] = &[
    "reset_auto_cover","clear_subtitle","test_player","set_scan_interval","reveal_data","system_status","selected_items",
    "scan",
    "cancel_scan",
    "add_root",
    "toggle_root",
    "save_item",
    "set_removed",
    "save_tag",
    "delete_tag",
    "save_settings",
    "bind_subtitle",
    "import_cover",
    "launch",
    "reveal",
    "rename_video",
    "backup",
    "restore_backup",
    "save_entity",
    "delete_entity",
    "merge_entity",
    "save_filter",
    "delete_filter",
    "batch_edit",
    "set_tag_group",
    "set_root_kind",
    "set_root_type",
    "separate_file",
    "detach_root",
    "relocate_root",
    "choose_primary",
    "relink_file",
    "queue_metadata",
    "job_action",
    "candidate",
    "apply_metadata",
    "fetch_cover",
    "inspect_media",
    "queue_local",
    "trim_cache",
    "export_diagnostics",
    "list_items",
    "roots",
    "tags",
    "catalog",
    "jobs",
    "get_settings",
    "cover_path",
    "file_choices",
    "subtitle_choices",
    "review_items",
];
fn plain(e: impl std::fmt::Display) -> String {
    e.to_string()
}
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum Category {
    FileMissing,
    PermissionDenied,
    Conflict,
    Cancelled,
    Timeout,
    SourceChanged,
    StaleRevision,
    Database,
    Network,
    Image,
    Media,
    Unknown,
}
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SafeError {
    pub category: Category,
    pub codes: Vec<String>,
}
pub(super) fn classify(message: &str) -> SafeError {
    let end = message
        .char_indices()
        .nth(8192)
        .map(|(i, _)| i)
        .unwrap_or(message.len());
    let message = &message[..end];
    let lower = message.to_lowercase();
    let category = if lower.contains("os error 2")
        || lower.contains("os error 3")
        || message.contains("不存在")
        || message.contains("离线")
    {
        Category::FileMissing
    } else if lower.contains("os error 5")
        || lower.contains("permission denied")
        || message.contains("权限")
    {
        Category::PermissionDenied
    } else if message.contains("已取消") || message.contains("任务取消") {
        Category::Cancelled
    } else if message.contains("超时") || lower.contains("timed out") {
        Category::Timeout
    } else if message.contains("已变化")
        || message.contains("被替换")
        || message.contains("重新确认")
    {
        Category::SourceChanged
    } else if message.contains("修订") || message.contains("其他任务修改") {
        Category::StaleRevision
    } else if lower.contains("sqlite")
        || lower.contains("database")
        || lower.contains("constraint")
        || lower.contains("no such")
        || message.contains("数据库")
    {
        Category::Database
    } else if lower.contains("http")
        || lower.contains("dns")
        || lower.contains("connect")
        || message.contains("网络")
        || message.contains("来源")
    {
        Category::Network
    } else if message.contains("图片") || message.contains("封面") {
        Category::Image
    } else if message.contains("媒体") || message.contains("缩略图") {
        Category::Media
    } else if message.contains("已存在") || message.contains("冲突") {
        Category::Conflict
    } else {
        Category::Unknown
    };
    static CODES: OnceLock<regex::Regex> = OnceLock::new();
    let re = CODES.get_or_init(|| {
        regex::Regex::new(
            r"(?i)\b(?:0x[0-9a-f]{8}|os error [0-9]{1,6}|SQLITE_[A-Z_]{2,40}|HTTP_[1-5][0-9]{2})\b",
        )
        .unwrap()
    });
    let mut codes: Vec<String> = re
        .find_iter(message)
        .take(8)
        .map(|m| m.as_str().to_ascii_uppercase())
        .filter(|code| {
            !code.starts_with("SQLITE_")
                || [
                    "SQLITE_ERROR",
                    "SQLITE_INTERNAL",
                    "SQLITE_PERM",
                    "SQLITE_ABORT",
                    "SQLITE_BUSY",
                    "SQLITE_LOCKED",
                    "SQLITE_NOMEM",
                    "SQLITE_READONLY",
                    "SQLITE_INTERRUPT",
                    "SQLITE_IOERR",
                    "SQLITE_CORRUPT",
                    "SQLITE_NOTFOUND",
                    "SQLITE_FULL",
                    "SQLITE_CANTOPEN",
                    "SQLITE_PROTOCOL",
                    "SQLITE_SCHEMA",
                    "SQLITE_TOOBIG",
                    "SQLITE_CONSTRAINT",
                    "SQLITE_MISMATCH",
                    "SQLITE_MISUSE",
                    "SQLITE_AUTH",
                    "SQLITE_RANGE",
                    "SQLITE_NOTADB",
                    "SQLITE_NOTICE",
                    "SQLITE_WARNING",
                    "SQLITE_ROW",
                    "SQLITE_DONE",
                    "SQLITE_CONSTRAINT_UNIQUE",
                    "SQLITE_CONSTRAINT_FOREIGNKEY",
                    "SQLITE_CONSTRAINT_CHECK",
                    "SQLITE_CONSTRAINT_NOTNULL",
                    "SQLITE_CONSTRAINT_PRIMARYKEY",
                    "SQLITE_BUSY_SNAPSHOT",
                ]
                .contains(&code.as_str())
        })
        .collect();
    static HTTP: OnceLock<regex::Regex> = OnceLock::new();
    let http = HTTP.get_or_init(|| {
        regex::Regex::new(r"(?i)status(?: code)?[^0-9]{0,30}([1-5][0-9]{2})").unwrap()
    });
    if let Some(c) = http.captures(message) {
        codes.push(format!("HTTP_{}", &c[1]));
    }
    SafeError { category, codes }
}
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    AppStart,
    AppStop,
    CommandStart,
    CommandSuccess,
    CommandError,
    FrontendReady,
    FrontendError,
    BackendError,
    ScanStart,
    ScanSuccess,
    ScanError,
    MediaSuccess,
    MediaError,
    MetadataSuccess,
    MetadataError,
    StartupFailure,
}
#[derive(Serialize, Deserialize, Clone)]
pub struct CodeFrame {
    line: u32,
    column: u32,
}
fn safe_exception(name: Option<String>) -> Option<String> {
    name.filter(|s| {
        [
            "Error",
            "TypeError",
            "ReferenceError",
            "SyntaxError",
            "RangeError",
            "URIError",
            "EvalError",
            "AggregateError",
            "BackendError",
        ]
        .contains(&s.as_str())
    })
}
fn safe_frames(frames: Vec<CodeFrame>) -> Vec<CodeFrame> {
    frames
        .into_iter()
        .filter(|f| f.line > 0 && f.column > 0 && f.line <= 10_000_000 && f.column <= 10_000_000)
        .take(8)
        .collect()
}
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    time_ms: i64,
    app_version: String,
    session: String,
    kind: EventKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<SafeError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    line: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    exception_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    frames: Vec<CodeFrame>,
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Environment {
    operating_system: String,
    process_arch: String,
    native_arch: String,
    webview_version: String,
    sqlite_version: String,
    build_mode: String,
    e2e_build: bool,
}
fn numeric_version(s: &str) -> String {
    if s.len() <= 64 && !s.is_empty() && s.chars().all(|c| c.is_ascii_digit() || c == '.') {
        s.to_owned()
    } else {
        "unavailable".into()
    }
}
fn environment() -> Environment {
    #[cfg(windows)]
    let operating_system = {
        use windows::core::w;
        use windows::Win32::System::Registry::*;
        let mut value = [0u16; 32];
        let mut size = std::mem::size_of_val(&value) as u32;
        let status = unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                w!("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion"),
                w!("CurrentBuildNumber"),
                RRF_RT_REG_SZ,
                None,
                Some(value.as_mut_ptr() as _),
                Some(&mut size),
            )
        };
        if status.is_ok() {
            let len = value.iter().position(|c| *c == 0).unwrap_or(value.len());
            let text = String::from_utf16_lossy(&value[..len]);
            if let Ok(build) = text.parse::<u32>() {
                format!(
                    "Windows {} (build {})",
                    if build >= 22000 { "11" } else { "10" },
                    build
                )
            } else {
                "Windows (build unavailable)".into()
            }
        } else {
            "Windows (build unavailable)".into()
        }
    };
    #[cfg(not(windows))]
    let operating_system = std::env::consts::OS.to_string();
    let native_arch = std::env::var("PROCESSOR_ARCHITEW6432")
        .or_else(|_| std::env::var("PROCESSOR_ARCHITECTURE"))
        .ok()
        .filter(|s| ["AMD64", "ARM64", "x86", "ARM"].contains(&s.as_str()))
        .unwrap_or_else(|| "unknown".into());
    Environment {
        operating_system,
        process_arch: std::env::consts::ARCH.into(),
        native_arch,
        webview_version: numeric_version(&tauri::webview_version().unwrap_or_default()),
        sqlite_version: numeric_version(rusqlite::version()),
        build_mode: if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        }
        .into(),
        e2e_build: cfg!(feature = "e2e"),
    }
}
pub(super) struct Logger {
    dir: PathBuf,
    session: String,
    lock: Mutex<()>,
    max_bytes: u64,
    last_snapshot: std::sync::atomic::AtomicI64,
    frontend_failure: AtomicBool,
    environment: Environment,
}
impl Logger {
    pub(super) fn open(data: &Path) -> Result<Self> {
        let dir = data.join("logs");
        fs::create_dir_all(&dir).map_err(plain)?;
        let logger = Self {
            dir,
            session: id(),
            lock: Mutex::new(()),
            max_bytes: LIMIT,
            last_snapshot: std::sync::atomic::AtomicI64::new(0),
            frontend_failure: AtomicBool::new(false),
            environment: environment(),
        };
        for name in [
            "diagnostic.jsonl",
            "diagnostic.1.jsonl",
            "diagnostic.2.jsonl",
        ] {
            let file = logger.dir.join(name);
            if fs::metadata(&file)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| SystemTime::now().duration_since(t).ok())
                .is_some_and(|age| age.as_millis() > RETENTION_MS as u128)
            {
                let _ = fs::remove_file(file);
            }
        }
        Ok(logger)
    }
    fn event(
        &self,
        kind: EventKind,
        command: Option<&str>,
        message: Option<&str>,
        duration: Option<u64>,
        site: Option<(&str, u32)>,
    ) -> Event {
        let source = site
            .and_then(|(p, _)| p.rsplit(['/', '\\']).next())
            .filter(|s| {
                [
                    "main.rs",
                    "catalog.rs",
                    "scanner.rs",
                    "media.rs",
                    "metadata.rs",
                    "native_media.rs",
                    "diagnostics.rs",
                    "api.ts",
                    "main.tsx",
                ]
                .contains(s)
            })
            .map(str::to_owned);
        Event {
            time_ms: stamp(),
            app_version: env!("CARGO_PKG_VERSION").into(),
            session: self.session.clone(),
            kind,
            command: command.map(|c| {
                if COMMANDS.contains(&c) {
                    c
                } else {
                    "unknown_command"
                }
                .to_string()
            }),
            duration_ms: duration.map(|d| d.min(86_400_000)),
            error: message.map(classify),
            source,
            line: site.map(|(_, l)| l),
            exception_kind: None,
            frames: vec![],
        }
    }
    fn append(&self, event: &Event) -> Result<()> {
        let _guard = self.lock.lock().map_err(plain)?;
        let mut bytes = serde_json::to_vec(event).map_err(plain)?;
        bytes.push(b'\n');
        let current = self.dir.join("diagnostic.jsonl");
        if fs::metadata(&current).map(|m| m.len()).unwrap_or(0) + bytes.len() as u64
            > self.max_bytes
        {
            let oldest = self.dir.join("diagnostic.2.jsonl");
            if oldest.exists() {
                fs::remove_file(&oldest).map_err(plain)?;
            }
            let previous = self.dir.join("diagnostic.1.jsonl");
            if previous.exists() {
                fs::rename(&previous, &oldest).map_err(plain)?;
            }
            if current.exists() {
                fs::rename(&current, &previous).map_err(plain)?;
            }
        }
        fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(current)
            .and_then(|mut f| f.write_all(&bytes))
            .map_err(plain)
    }
    fn retained(&self) -> Vec<Event> {
        let Ok(_guard) = self.lock.lock() else {
            return vec![];
        };
        let mut events = vec![];
        for name in [
            "diagnostic.2.jsonl",
            "diagnostic.1.jsonl",
            "diagnostic.jsonl",
        ] {
            let Ok(file) = fs::File::open(self.dir.join(name)) else {
                continue;
            };
            let mut text = String::new();
            if file
                .take(self.max_bytes + 4096)
                .read_to_string(&mut text)
                .is_err()
            {
                continue;
            }
            for line in text.lines() {
                if line.len() > 4096 {
                    continue;
                }
                let Ok(mut event) = serde_json::from_str::<Event>(line) else {
                    continue;
                };
                if event.time_ms < stamp() - RETENTION_MS || event.time_ms > stamp() + 86_400_000 {
                    continue;
                }
                if uuid::Uuid::parse_str(&event.session).is_err() {
                    continue;
                }
                event.app_version = numeric_version(&event.app_version);
                event.command = event.command.map(|s| {
                    if COMMANDS.contains(&s.as_str()) {
                        s
                    } else {
                        "unknown_command".into()
                    }
                });
                event.source = event.source.filter(|s| {
                    [
                        "main.rs",
                        "catalog.rs",
                        "scanner.rs",
                        "media.rs",
                        "metadata.rs",
                        "native_media.rs",
                        "diagnostics.rs",
                        "api.ts",
                        "main.tsx",
                    ]
                    .contains(&s.as_str())
                });
                if let Some(error) = &mut event.error {
                    error.codes = error
                        .codes
                        .iter()
                        .flat_map(|s| classify(s).codes)
                        .take(8)
                        .collect();
                }
                event.exception_kind = safe_exception(event.exception_kind);
                event.frames = safe_frames(event.frames);
                events.push(event);
            }
        }
        if events.len() > 2048 {
            events.drain(..events.len() - 2048);
        }
        events
    }
    fn latest(&self, force: bool) {
        let now = stamp();
        let old = self.last_snapshot.load(Ordering::Relaxed);
        if !force
            && (now - old < 2000
                || self
                    .last_snapshot
                    .compare_exchange(old, now, Ordering::SeqCst, Ordering::Relaxed)
                    .is_err())
        {
            return;
        }
        self.last_snapshot.store(now, Ordering::Relaxed);
        let mut events = self.retained();
        if events.len() > 128 {
            events.drain(..events.len() - 128);
        }
        let report = base_report(&self.environment, events, "automatic");
        if let Ok(bytes) = serde_json::to_vec_pretty(&report) {
            let tmp = self.dir.join(format!(".diagnostic-{}.tmp", id()));
            if fs::write(&tmp, bytes).is_ok() {
                let _ = fs::rename(&tmp, self.dir.join("latest-diagnostic.json"));
            }
            let _ = fs::remove_file(tmp);
        }
    }
}
static LOGGER: OnceLock<Logger> = OnceLock::new();
pub fn initialize(data: &Path) {
    if let Ok(logger) = Logger::open(data) {
        let _ = LOGGER.set(logger);
    }
    notice(EventKind::AppStart);
    if let Some(logger) = LOGGER.get() {
        logger.latest(true);
    }
}
pub fn notice(kind: EventKind) {
    if let Some(logger) = LOGGER.get() {
        let event = logger.event(kind, None, None, None, None);
        let _ = logger.append(&event);
    }
}
#[track_caller]
pub fn error(kind: EventKind, message: &str) {
    if let Some(logger) = LOGGER.get() {
        let site = std::panic::Location::caller();
        let startup = matches!(kind, EventKind::StartupFailure);
        let event = logger.event(
            kind,
            None,
            Some(message),
            None,
            Some((site.file(), site.line())),
        );
        let _ = logger.append(&event);
        logger.latest(startup);
    }
}
pub fn shutdown() {
    notice(EventKind::AppStop);
    if let Some(logger) = LOGGER.get() {
        logger.latest(true);
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TraceKind {
    Start,
    Success,
    Error,
    UiError,
    Ready,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Trace {
    kind: TraceKind,
    #[serde(default)]
    command: Option<String>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    duration_ms: Option<u64>,
    #[serde(default)]
    exception_kind: Option<String>,
    #[serde(default)]
    frames: Vec<CodeFrame>,
}
#[tauri::command]
pub fn record_diagnostic(entry: Trace) {
    if let Some(logger) = LOGGER.get() {
        let checkpoint = matches!(&entry.kind, TraceKind::Start);
        let force = matches!(&entry.kind, TraceKind::UiError)
            && !logger.frontend_failure.swap(true, Ordering::SeqCst);
        let (kind, failure) = match entry.kind {
            TraceKind::Start => (EventKind::CommandStart, false),
            TraceKind::Success => (EventKind::CommandSuccess, false),
            TraceKind::Error => (EventKind::CommandError, true),
            TraceKind::UiError => (EventKind::FrontendError, true),
            TraceKind::Ready => (EventKind::FrontendReady, false),
        };
        let mut event = logger.event(
            kind,
            entry.command.as_deref(),
            if failure {
                entry.message.as_deref()
            } else {
                None
            },
            entry.duration_ms,
            Some(("api.ts", 0)),
        );
        event.exception_kind = safe_exception(entry.exception_kind);
        event.frames = safe_frames(entry.frames);
        let _ = logger.append(&event);
        if failure || checkpoint {
            logger.latest(force || checkpoint);
        }
    }
}
fn base_report(environment: &Environment, events: Vec<Event>, kind: &str) -> Value {
    json!({"formatVersion":1,"appVersion":env!("CARGO_PKG_VERSION"),"generatedAtMs":stamp(),"reportKind":kind,"environment":environment,"privacy":{"localOnly":true,"containsDatabase":false,"containsMedia":false,"containsPathsTitlesNotesOrUrls":false,"rawErrorMessagesIncluded":false},"logPolicy":{"segmentBytes":LIMIT,"segments":3,"retentionDays":7,"maximumExportedEvents":2048,"maximumAutomaticEvents":128},"events":events})
}
pub(super) fn snapshot(s: &AppState) -> Value {
    let mut report = if let Some(logger) = LOGGER.get() {
        base_report(&logger.environment, logger.retained(), "manual")
    } else {
        base_report(&environment(), vec![], "manual")
    };
    let summary = (|| -> std::result::Result<Value, String> {
        let c = s.db.lock().map_err(plain)?;
        let schema: i64 = c
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(plain)?;
        let integrity: String = c
            .query_row("PRAGMA quick_check(1)", [], |r| r.get(0))
            .map_err(plain)?;
        let items: i64 = c
            .query_row("SELECT count(*) FROM items", [], |r| r.get(0))
            .map_err(plain)?;
        let roots: i64 = c
            .query_row("SELECT count(*) FROM roots", [], |r| r.get(0))
            .map_err(plain)?;
        let unavailable: i64 = c
            .query_row(
                "SELECT count(*) FROM items WHERE available=0 AND removed=0",
                [],
                |r| r.get(0),
            )
            .map_err(plain)?;
        let failures: i64 = c
            .query_row("SELECT count(*) FROM jobs WHERE state='failed'", [], |r| {
                r.get(0)
            })
            .map_err(plain)?;
        let missing_covers: i64 = c
            .query_row(
                "SELECT count(*) FROM items WHERE removed=0 AND cover IS NULL",
                [],
                |r| r.get(0),
            )
            .map_err(plain)?;
        let unknown_duration: i64 = c
            .query_row(
                "SELECT count(*) FROM items WHERE removed=0 AND duration IS NULL",
                [],
                |r| r.get(0),
            )
            .map_err(plain)?;
        let unsupported:i64=c.query_row("SELECT count(*) FROM jobs WHERE kind='local' AND state='saved' AND error LIKE 'Windows 未提供%'",[],|r|r.get(0)).map_err(plain)?;
        let settings: Option<String> = c
            .query_row("SELECT value FROM settings WHERE id=1", [], |r| r.get(0))
            .optional()
            .map_err(plain)?;
        let settings = settings
            .and_then(|v| serde_json::from_str::<Settings>(&v).ok())
            .unwrap_or_default();
        let player = if ["potplayer", "mpv", "vlc"].contains(&settings.player_kind.as_str()) {
            settings.player_kind.as_str()
        } else {
            "system_or_unknown"
        };
        Ok(
            json!({"schemaVersion":schema,"integrity":if integrity=="ok"{"ok"}else{"failed"},"itemCount":items,"rootCount":roots,"unavailableItemCount":unavailable,"failedJobCount":failures,"missingCoverCount":missing_covers,"unknownDurationCount":unknown_duration,"systemThumbnailUnavailableJobCount":unsupported,"playerKind":player,"playerConfigured":!settings.player.is_empty(),"enabledProviderCount":settings.providers.iter().filter(|p|p.enabled).count(),"mediaBackend":"windows_shell","externalMediaToolsRequired":false}),
        )
    })();
    report["libraryStatus"] = summary
        .unwrap_or_else(|message| json!({"status":"unavailable","error":classify(&message)}));
    report
}
#[tauri::command]
pub async fn diagnostic_report(app: tauri::AppHandle) -> Result<Value> {
    tauri::async_runtime::spawn_blocking(move || snapshot(&app.state::<AppState>()))
        .await
        .map_err(plain)
}
pub(super) fn write_report(report: &Value, target: &Path) -> Result<()> {
    if target
        .extension()
        .and_then(|s| s.to_str())
        .is_none_or(|s| !s.eq_ignore_ascii_case("json"))
    {
        return Err("请选择 .json 诊断文件".into());
    }
    if target.exists() {
        return Err("目标文件已存在，请使用新的文件名".into());
    }
    let parent = target.parent().ok_or("请选择完整保存位置")?;
    if !parent.is_dir() {
        return Err("保存目录不存在".into());
    }
    let temp = parent.join(format!(".avlibrary-diagnostic-{}.tmp", id()));
    let bytes = serde_json::to_vec_pretty(report).map_err(plain)?;
    let result = (|| {
        let mut f = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp)
            .map_err(plain)?;
        f.write_all(&bytes).map_err(plain)?;
        f.flush().map_err(plain)?;
        drop(f);
        move_no_replace(&temp, target)
    })();
    let _ = fs::remove_file(temp);
    result
}
#[tauri::command]
pub async fn export_diagnostics(path: String, app: tauri::AppHandle) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        write_report(&snapshot(&app.state::<AppState>()), Path::new(&path))
    })
    .await
    .map_err(plain)?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn folder() -> PathBuf {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join(".qa")
            .join(format!("diagnostics-{}", id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }
    #[test]
    fn raw_paths_urls_and_user_text_never_enter_logs() {
        let dir = folder();
        let logger = Logger::open(&dir).unwrap();
        let secret = r"D:\PrivateUser\非常私密片名.mp4 https://private.example/search?token=SECRET_TOKEN 我的私人笔记 os error 5 0x80070005";
        let event = logger.event(
            EventKind::CommandError,
            Some("launch"),
            Some(secret),
            Some(9),
            Some(("src/main.rs", 42)),
        );
        logger.append(&event).unwrap();
        logger.latest(true);
        for file in ["diagnostic.jsonl", "latest-diagnostic.json"] {
            let text = fs::read_to_string(dir.join("logs").join(file)).unwrap();
            for private in [
                "PrivateUser",
                "非常私密片名",
                "private.example",
                "SECRET_TOKEN",
                "私人笔记",
            ] {
                assert!(!text.contains(private));
            }
            assert!(text.contains("0X80070005"));
        }
        assert!(matches!(
            classify("HTTP status client error (403 Forbidden) for private URL").category,
            Category::Network
        ));
        assert!(classify("HTTP status client error (403 Forbidden)")
            .codes
            .contains(&"HTTP_403".to_string()));
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn rotated_logs_are_bounded_and_keep_unrelated_files() {
        let dir = folder();
        let mut logger = Logger::open(&dir).unwrap();
        logger.max_bytes = 512;
        fs::write(dir.join("logs/keep.txt"), b"untouched").unwrap();
        for _ in 0..100 {
            logger
                .append(&logger.event(
                    EventKind::CommandSuccess,
                    Some("save_item"),
                    None,
                    Some(1),
                    None,
                ))
                .unwrap();
        }
        for name in [
            "diagnostic.jsonl",
            "diagnostic.1.jsonl",
            "diagnostic.2.jsonl",
        ] {
            assert!(fs::metadata(dir.join("logs").join(name)).unwrap().len() <= 512);
        }
        assert_eq!(fs::read(dir.join("logs/keep.txt")).unwrap(), b"untouched");
        assert!(logger.retained().len() < 100);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn corrupted_or_tampered_log_fields_are_sanitized_again_on_export() {
        let dir = folder();
        let logger = Logger::open(&dir).unwrap();
        let mut value = serde_json::to_value(logger.event(
            EventKind::CommandError,
            Some("launch"),
            Some("os error 2"),
            None,
            None,
        ))
        .unwrap();
        value["command"] = json!("D:/PRIVATE_TITLE/video.mp4");
        value["source"] = json!("https://SECRET_URL/private");
        value["appVersion"] = json!("PRIVATE_USERNAME");
        value["note"] = json!("SECRET_NOTE");
        value["error"]["codes"] = json!(["https://SECRET_TOKEN", "os error 2"]);
        fs::write(
            dir.join("logs/diagnostic.jsonl"),
            format!("not json\n{}\n", value),
        )
        .unwrap();
        let safe = serde_json::to_string(&logger.retained()).unwrap();
        for word in [
            "PRIVATE_TITLE",
            "SECRET_URL",
            "PRIVATE_USERNAME",
            "SECRET_NOTE",
            "SECRET_TOKEN",
        ] {
            assert!(!safe.contains(word));
        }
        assert!(safe.contains("OS ERROR 2"));
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn diagnostic_export_is_one_json_and_never_overwrites_existing_file() {
        let dir = folder();
        let report = base_report(&environment(), vec![], "manual");
        let target = dir.join("support.json");
        write_report(&report, &target).unwrap();
        let before = fs::read(&target).unwrap();
        assert!(write_report(&report, &target).is_err());
        assert_eq!(before, fs::read(&target).unwrap());
        assert!(write_report(&report, &dir.join("wrong.txt")).is_err());
        let saved: Value = serde_json::from_slice(&before).unwrap();
        assert_eq!(saved["privacy"]["containsDatabase"], false);
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn report_contains_environment_and_counts_but_no_library_content() {
        let (dir, s, folder) = crate::integration::fixture();
        fs::write(
            Path::new(&folder).join("PRIVATE_VIDEO_TITLE.mp4"),
            b"fixture",
        )
        .unwrap();
        crate::scanner::scan_root(&s, "root").unwrap();
        db(&s)
            .unwrap()
            .execute("UPDATE items SET note='PRIVATE_NOTE'", [])
            .unwrap();
        let mut settings = Settings::default();
        settings.player = r"D:\PRIVATE_PATH\PotPlayer.exe".into();
        settings.player_kind = "potplayer".into();
        db(&s)
            .unwrap()
            .execute(
                "INSERT INTO settings VALUES(1,?1)",
                [serde_json::to_string(&settings).unwrap()],
            )
            .unwrap();
        let report = snapshot(&s);
        let text = report.to_string();
        for word in ["PRIVATE_VIDEO_TITLE", "PRIVATE_NOTE", "PRIVATE_PATH"] {
            assert!(!text.contains(word));
        }
        assert_eq!(report["libraryStatus"]["integrity"], "ok");
        assert_eq!(report["libraryStatus"]["itemCount"], 1);
        assert_eq!(report["libraryStatus"]["playerKind"], "potplayer");
        assert!(report["environment"]["operatingSystem"]
            .as_str()
            .unwrap()
            .contains("Windows"));
        drop(s);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn latest_report_is_replaced_with_complete_valid_json() {
        let dir = folder();
        let logger = Logger::open(&dir).unwrap();
        logger
            .append(&logger.event(EventKind::AppStart, None, None, None, None))
            .unwrap();
        logger.latest(true);
        logger
            .append(&logger.event(
                EventKind::StartupFailure,
                None,
                Some("missing SECRET_FILENAME os error 2"),
                None,
                None,
            ))
            .unwrap();
        logger.latest(true);
        let report: Value =
            serde_json::from_slice(&fs::read(dir.join("logs/latest-diagnostic.json")).unwrap())
                .unwrap();
        assert_eq!(report["events"].as_array().unwrap().len(), 2);
        assert!(!report.to_string().contains("SECRET_FILENAME"));
        assert!(!report["environment"]["operatingSystem"]
            .as_str()
            .unwrap()
            .contains("unavailable"));
        fs::remove_dir_all(dir).unwrap();
    }
}

#[cfg(test)]
mod extra_tests {
    use super::*;
    #[test]
    fn retention_removes_only_old_managed_log_files() {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join(".qa")
            .join(format!("diagnostic-retention-{}", id()));
        fs::create_dir_all(dir.join("logs")).unwrap();
        let file = dir.join("logs/diagnostic.1.jsonl");
        fs::write(&file, b"old").unwrap();
        fs::File::options()
            .write(true)
            .open(&file)
            .unwrap()
            .set_times(
                fs::FileTimes::new().set_modified(
                    SystemTime::now() - std::time::Duration::from_secs(8 * 24 * 60 * 60),
                ),
            )
            .unwrap();
        fs::write(dir.join("logs/other.log"), b"keep").unwrap();
        let _logger = Logger::open(&dir).unwrap();
        assert!(!file.exists());
        assert!(dir.join("logs/other.log").exists());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn frontend_error_positions_do_not_include_raw_stacks_or_names() {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join(".qa")
            .join(format!("diagnostic-frames-{}", id()));
        let logger = Logger::open(&dir).unwrap();
        let mut e = logger.event(
            EventKind::FrontendError,
            None,
            Some("PRIVATE_MESSAGE SQLITE_PRIVATE_PERSONAL_TITLE"),
            None,
            None,
        );
        e.exception_kind = safe_exception(Some("PRIVATE_EXCEPTION_NAME".into()));
        e.frames = safe_frames(vec![
            CodeFrame {
                line: 12,
                column: 34,
            },
            CodeFrame { line: 0, column: 1 },
            CodeFrame {
                line: u32::MAX,
                column: 1,
            },
        ]);
        logger.append(&e).unwrap();
        let value = serde_json::to_value(logger.retained()).unwrap();
        assert_eq!(value[0]["frames"].as_array().unwrap().len(), 1);
        assert!(!value.to_string().contains("PRIVATE"));
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn automatic_report_keeps_a_small_recent_checkpoint() {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join(".qa")
            .join(format!("diagnostic-checkpoint-{}", id()));
        let logger = Logger::open(&dir).unwrap();
        for _ in 0..160 {
            logger
                .append(&logger.event(EventKind::CommandStart, Some("scan"), None, None, None))
                .unwrap();
        }
        logger.latest(true);
        let report: Value =
            serde_json::from_slice(&fs::read(dir.join("logs/latest-diagnostic.json")).unwrap())
                .unwrap();
        assert_eq!(report["events"].as_array().unwrap().len(), 128);
        assert_eq!(report["events"][127]["command"], "scan");
        fs::remove_dir_all(dir).unwrap();
    }
}
