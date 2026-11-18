use super::*;
pub fn create_tool_job() -> Result<usize> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::JobObjects::*;
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of_val(&info) as u32,
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error().to_string());
        }
        return Ok(handle as usize);
    }
    #[cfg(not(windows))]
    Ok(0)
}
pub fn validate_image(bytes: &[u8]) -> Result<image::DynamicImage> {
    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(err)?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(12000);
    limits.max_image_height = Some(12000);
    limits.max_alloc = Some(160 * 1024 * 1024);
    reader.limits(limits);
    reader.decode().map_err(err)
}

pub(super) fn source_version(path: &Path) -> Result<String> {
    let meta = fs::metadata(path).map_err(err)?;
    let file_id = identity(path).ok_or("无法核验源视频身份")?;
    let modified = meta
        .modified()
        .map_err(err)?
        .duration_since(UNIX_EPOCH)
        .map_err(err)?
        .as_nanos();
    Ok(format!("v1:{}:{}:{}", file_id, meta.len(), modified))
}
pub(super) fn persist_cover(
    s: &AppState,
    item: &str,
    bytes: &[u8],
    extension: &str,
    source: &str,
    expected_revision: i64,
    network: bool,
) -> Result<String> {
    validate_image(bytes)?;
    let name = format!("{}.{}", id(), extension);
    let dest = s.data.join("covers").join(&name);
    let temp = dest.with_extension(format!("{}.partial", extension));
    let result = (|| {
        let mut c = db(s)?;
        let tx = c.transaction().map_err(err)?;
        let eligible: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM items WHERE id=?1 AND revision=?2 AND removed=0 AND (?3=0 OR media_type!='personal'))",params![item,expected_revision,network],|r|r.get(0)).map_err(err)?;
        if !eligible {
            return Err("资料已变化、作品已移出或禁止联网，请重新选择封面".into());
        }
        fs::write(&temp, bytes).map_err(err)?;
        fs::rename(&temp, &dest).map_err(err)?;
        tx.execute(
            "INSERT INTO cover_assets(path,item_id,source_type,manual) VALUES(?1,?2,?3,1)",
            params![name, item, source],
        )
        .map_err(err)?;
        tx.execute(
            "UPDATE items SET cover=?1,cover_manual=1,revision=revision+1 WHERE id=?2",
            params![name, item],
        )
        .map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(name.clone())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
        let _ = fs::remove_file(dest);
    }
    result
}
pub fn output(mut command: Command, s: &AppState, job: Option<&str>) -> Result<Vec<u8>> {
    let temp = s.data.join(format!("tool-{}.tmp", id()));
    let file = fs::File::create(&temp).map_err(err)?;
    command
        .stdout(std::process::Stdio::from(file))
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            let _ = fs::remove_file(&temp);
            return Err(err(error));
        }
    };
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        if s.tool_job != 0
            && unsafe {
                windows_sys::Win32::System::JobObjects::AssignProcessToJobObject(
                    s.tool_job as _,
                    child.as_raw_handle(),
                )
            } == 0
        {
            let _ = child.kill();
            let _ = child.wait();
            let _ = fs::remove_file(&temp);
            return Err("无法隔离媒体子进程".into());
        }
    }
    let start = std::time::Instant::now();
    let result = loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                break if status.success() {
                    if fs::metadata(&temp).map_err(err)?.len() > 8 * 1024 * 1024 {
                        Err("媒体任务输出超限".into())
                    } else {
                        fs::read(&temp).map_err(err)
                    }
                } else {
                    Err("Windows 媒体读取失败；可保留影片并手动选择封面".into())
                }
            }
            Err(e) => break Err(err(e)),
            Ok(None) => {
                let cancelled = job.is_some_and(|key| {
                    db(s)
                        .and_then(|c| {
                            c.query_row(
                                "SELECT state='running' FROM jobs WHERE id=?1",
                                [key],
                                |r| r.get::<_, bool>(0),
                            )
                            .map_err(err)
                        })
                        .map(|active| !active)
                        .unwrap_or(true)
                });
                if cancelled
                    || s.shutdown.load(Ordering::SeqCst)
                    || start.elapsed() > std::time::Duration::from_secs(20)
                    || fs::metadata(&temp)
                        .map(|m| m.len() > 8 * 1024 * 1024)
                        .unwrap_or(false)
                {
                    let _ = child.kill();
                    let _ = child.wait();
                    break Err("媒体任务取消、超时或输出超限".into());
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        }
    };
    let _ = fs::remove_file(temp);
    result
}
pub(super) fn enqueue(c: &Connection, ids: &[String], automatic: bool) -> Result<usize> {
    let mut count = 0;
    for item in ids {
        let row: Option<(String, i64)> = c
            .query_row(
                "SELECT path,revision FROM items WHERE id=?1 AND removed=0 AND available=1",
                [item],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(err)?;
        let Some((path, revision)) = row else {
            continue;
        };
        let Ok(version) = source_version(Path::new(&path)) else {
            continue;
        };
        if automatic {
            let done:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM jobs WHERE item_id=?1 AND kind='local' AND query=?2 AND state IN('saved','failed','cancelled'))",params![item,version],|r|r.get(0)).map_err(err)?;
            if done {
                continue;
            }
        }
        count+=c.execute("INSERT OR IGNORE INTO jobs(id,item_id,kind,state,query,revision,created_at,updated_at) VALUES(?1,?2,'local','queued',?3,?4,?5,?5)",params![id(),item,version,revision,stamp()]).map_err(err)?;
    }
    Ok(count)
}
pub(super) fn commit_native(
    s: &AppState,
    item: &str,
    path: &str,
    version: &str,
    info: &crate::native_media::NativeMedia,
    job: Option<&str>,
) -> Result<()> {
    if source_version(Path::new(path))? != version {
        return Err("源视频已变化，请重新读取缩略图".into());
    }
    let mut c = db(s)?;
    let tx = c.transaction().map_err(err)?;
    let eligible:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM items WHERE id=?1 AND path=?2 AND removed=0 AND (?3 IS NULL OR EXISTS(SELECT 1 FROM jobs WHERE id=?3 AND state='running')))",params![item,path,job],|r|r.get(0)).map_err(err)?;
    if !eligible {
        return Err("任务已取消或影片已变化".into());
    }
    let duration = info.duration.filter(|v| v.is_finite() && *v > 0.);
    tx.execute(
        "UPDATE items SET duration=?1,width=?2,height=?3,embedded_subtitles=NULL WHERE id=?4",
        params![
            duration,
            info.width.filter(|v| *v > 0),
            info.height.filter(|v| *v > 0),
            item
        ],
    )
    .map_err(err)?;
    let protected: bool = tx
        .query_row(
            "SELECT cover IS NOT NULL AND cover_manual=1 FROM items WHERE id=?1",
            [item],
            |r| r.get(0),
        )
        .map_err(err)?;
    let mut staged: Option<PathBuf> = None;
    let result = (|| {
        if !protected {
            if let Some(bytes) = &info.thumbnail {
                validate_image(bytes)?;
                let name = format!("{}.jpg", id());
                let dest = s.data.join("covers").join(&name);
                let temp = dest.with_extension("partial");
                staged = Some(temp.clone());
                fs::write(&temp, bytes).map_err(err)?;
                fs::rename(&temp, &dest).map_err(err)?;
                staged = Some(dest);
                tx.execute("INSERT INTO cover_assets(path,item_id,source_type,source_identity,manual) VALUES(?1,?2,'windows',?3,0)",params![name,item,version]).map_err(err)?;
                tx.execute(
                    "UPDATE items SET cover=?1,cover_manual=0 WHERE id=?2",
                    params![name, item],
                )
                .map_err(err)?;
            } else {
                tx.execute("UPDATE items SET cover=NULL WHERE id=?1 AND NOT EXISTS(SELECT 1 FROM cover_assets a WHERE a.path=items.cover AND a.source_identity=?2)",params![item,version]).map_err(err)?;
            }
        }
        tx.commit().map_err(err)
    })();
    if result.is_err() {
        if let Some(file) = staged {
            let _ = fs::remove_file(file);
        }
    }
    result
}
pub(super) fn read_native(s: &AppState, item: &str, job: Option<&str>) -> Result<String> {
    read_native_using(s, item, job, &std::env::current_exe().map_err(err)?)
}
pub(super) fn read_native_using(
    s: &AppState,
    item: &str,
    job: Option<&str>,
    executable: &Path,
) -> Result<String> {
    let _guard = s.decoder.lock().map_err(err)?;
    let (path,expected):(String,Option<String>)=db(s)?.query_row("SELECT i.path,m.identity FROM items i LEFT JOIN media_files m ON m.item_id=i.id AND m.is_primary=1 WHERE i.id=?1 AND i.removed=0",[item],|r|Ok((r.get(0)?,r.get(1)?))).map_err(err)?;
    if expected.is_some() && identity(Path::new(&path)) != expected {
        return Err("源视频已被替换，请先重新关联".into());
    }
    let version = source_version(Path::new(&path))?;
    if let Some(key) = job {
        db(s)?
            .execute(
                "UPDATE jobs SET query=?1 WHERE id=?2 AND state='running'",
                params![version, key],
            )
            .map_err(err)?;
    }
    let mut cmd = Command::new(executable);
    cmd.arg("--avlibrary-media-worker").arg(&path);
    let bytes = output(cmd, s, job)?;
    let info: crate::native_media::NativeMedia = serde_json::from_slice(&bytes).map_err(err)?;
    commit_native(s, item, &path, &version, &info, job)?;
    Ok(info.note)
}
#[tauri::command]
pub async fn inspect_media(app: tauri::AppHandle, item_id: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        read_native(&app.state::<AppState>(), &item_id, None).map(|_| ())
    })
    .await
    .map_err(err)?
}
#[tauri::command]
pub fn queue_local(ids: Vec<String>, s: State<AppState>) -> Result<usize> {
    enqueue(&*db(&s)?, &ids, false)
}
pub fn worker(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        let s = app.state::<AppState>();
        if s.shutdown.load(Ordering::SeqCst) {
            break;
        }
        let task = {
            let c = match db(&s) {
                Ok(c) => c,
                Err(_) => break,
            };
            c.query_row("SELECT id,item_id FROM jobs WHERE kind='local' AND state='queued' ORDER BY created_at LIMIT 1",[],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).optional().ok().flatten()
        };
        if let Some((key, item)) = task {
            let result = (|| {
                let claimed=db(&s)?.execute("UPDATE jobs SET state='running',updated_at=?1 WHERE id=?2 AND state='queued'",params![stamp(),key]).map_err(err)?;
                if claimed != 1 {
                    return Err("任务已取消".into());
                }
                read_native(&s, &item, Some(&key))
            })();
            if let Ok(c) = db(&s) {
                let (state, note) = match result {
                    Ok(note) => {
                        diagnostics::notice(diagnostics::EventKind::MediaSuccess);
                        ("saved", note)
                    }
                    Err(error) => {
                        diagnostics::error(diagnostics::EventKind::MediaError, &error);
                        ("failed", error)
                    }
                };
                let _=c.execute("UPDATE jobs SET state=?1,error=?2,updated_at=?3 WHERE id=?4 AND state='running'",params![state,note,stamp(),key]);
            }
            use tauri::Emitter;
            let _ = app.emit("library-changed", ());
            let _ = app.emit("jobs-changed", ());
        } else {
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
    });
}
#[tauri::command]
pub fn trim_cache(s: State<AppState>) -> Result<u64> {trim_cache_impl(&s)}
pub(super) fn trim_cache_impl(s:&AppState)->Result<u64>{
    let c = db(s)?;
    let used = {
        let mut q=c.prepare("SELECT cover FROM items WHERE cover IS NOT NULL UNION SELECT path FROM cover_assets WHERE manual=1").map_err(err)?;
        let rows = q
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(err)?
            .collect::<std::result::Result<std::collections::HashSet<_>, _>>()
            .map_err(err)?;
        rows
    };
    let mut bytes = 0;
    let now = std::time::SystemTime::now();
    for entry in fs::read_dir(s.data.join("covers")).map_err(err)? {
        let entry = entry.map_err(err)?;
        let meta = entry.metadata().map_err(err)?;
        if meta.is_file()
            && !used.contains(&entry.file_name().to_string_lossy().to_string())
            && now
                .duration_since(meta.modified().map_err(err)?)
                .unwrap_or_default()
                > std::time::Duration::from_secs(86400)
        {
            bytes += meta.len();
            fs::remove_file(entry.path()).map_err(err)?;
            c.execute(
                "DELETE FROM cover_assets WHERE path=?1 AND manual=0",
                [entry.file_name().to_string_lossy()],
            )
            .map_err(err)?;
        }
    }
    let previews=s.data.join("thumbnails");if previews.is_dir(){for entry in fs::read_dir(&previews).map_err(err)?{let entry=entry.map_err(err)?;if !entry.file_type().map_err(err)?.is_file(){continue;}let name=entry.file_name().to_string_lossy().to_string();let retained=name.strip_suffix(".jpg").is_some_and(|cover|used.contains(cover));if !retained{bytes+=entry.metadata().map_err(err)?.len();fs::remove_file(entry.path()).map_err(err)?;}}}
    Ok(bytes)
}

#[tauri::command]
pub fn reset_auto_cover(item_id:String,s:State<AppState>)->Result<()>{let mut c=db(&s)?;let tx=c.transaction().map_err(err)?;tx.execute("UPDATE items SET cover=NULL,cover_manual=0,revision=revision+1 WHERE id=?1",[&item_id]).map_err(err)?;enqueue(&tx,&[item_id],false)?;tx.commit().map_err(err)}
