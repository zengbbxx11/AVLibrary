use super::*;
use std::collections::{HashMap, HashSet};
use std::ffi::OsStr;

const SCAN_BUSY: &str = "已有扫描运行中";

#[derive(PartialEq, Eq)]
struct ScanRoot {
    path: String,
    kind: String,
    media_type: String,
}

fn scan_target(c: &Connection, key: &str) -> Result<Option<ScanRoot>> {
    c.query_row(
        "SELECT r.path,coalesce(m.kind,'video'),r.media_type
         FROM roots r LEFT JOIN root_meta m ON r.id=m.root_id
         WHERE r.id=?1 AND r.enabled=1 AND coalesce(m.detached,0)=0",
        [key],
        |r| Ok(ScanRoot { path: r.get(0)?, kind: r.get(1)?, media_type: r.get(2)? }),
    ).optional().map_err(err)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChoice {
    pub id: String,
    pub path: String,
    pub item_id: String,
    pub is_primary: bool,
    pub available: bool,
    pub size: i64,
}
fn path_key(path: &str) -> String {
    let path = path.replace('/', "\\");
    if let Some(rest) = path.strip_prefix("\\\\?\\UNC\\") {
        format!("\\\\{}", rest).to_lowercase()
    } else {
        path.strip_prefix("\\\\?\\").unwrap_or(&path).to_lowercase()
    }
}
pub(super) fn subtitle_fingerprint(p:&Path)->Result<String>{let m=fs::metadata(p).map_err(err)?;Ok(format!("{}:{}",m.len(),m.modified().map_err(err)?.duration_since(UNIX_EPOCH).map_err(err)?.as_nanos()))}
fn upsert_sub(c: &Connection, p: &Path, root_id: Option<&str>, confirmed: bool) -> Result<String> {
    let canonical = fs::canonicalize(p).map_err(err)?;
    let path = canonical.to_string_lossy().to_string();
    let ident = identity(&canonical);
    let fingerprint=subtitle_fingerprint(&canonical)?;
    let at_path: Option<(String, Option<String>)> = c
        .query_row(
            "SELECT id,identity FROM subtitles WHERE path=?1",
            [&path],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(err)?;
    if let Some((key, old_identity)) = &at_path {
        let old_fingerprint:Option<String>=c.query_row("SELECT fingerprint FROM subtitle_versions WHERE subtitle_id=?1",[key],|r|r.get(0)).optional().map_err(err)?;
        if old_fingerprint.as_ref().is_some_and(|v|v!=&fingerprint){c.execute("UPDATE items SET subtitle_confirmation='needs_review',revision=revision+1 WHERE selected_subtitle_id=?1 AND subtitle_confirmation!='needs_review'",[key]).map_err(err)?;if !confirmed{return Ok(key.clone());}}
        if old_identity.is_some() && old_identity != &ident {
            c.execute("UPDATE subtitles SET available=0 WHERE id=?1", [key])
                .map_err(err)?;
            c.execute("UPDATE items SET subtitle_confirmation='needs_review',revision=revision+1 WHERE selected_subtitle_id=?1 AND subtitle_confirmation!='needs_review'", [key]).map_err(err)?;
            if !confirmed {
                return Ok(key.clone());
            }
        }
    }
    let mut existing = at_path.map(|(key, _)| key);
    if let Some(identity) = &ident {
        let matches = {
            let mut q = c
                .prepare("SELECT id,path FROM subtitles WHERE identity=?1 ORDER BY id")
                .map_err(err)?;
            let rows = q
                .query_map([identity], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                })
                .map_err(err)?
                .collect::<std::result::Result<Vec<_>, _>>()
                .map_err(err)?;
            rows
        };
        if matches.len() == 1
            && (path_key(&matches[0].1) == path_key(&path) || !Path::new(&matches[0].1).exists())
        {
            existing = Some(matches[0].0.clone());
        } else if matches.len() > 1
            && matches
                .iter()
                .all(|(_, p)| path_key(p) == path_key(&matches[0].1))
            && (path_key(&matches[0].1) == path_key(&path)
                || matches.iter().all(|(_, p)| !Path::new(p).exists()))
        {
            let chosen = matches[0].0.clone();
            for (old, _) in &matches {
                if old != &chosen {
                    c.execute(
                        "UPDATE items SET selected_subtitle_id=?1 WHERE selected_subtitle_id=?2",
                        params![chosen, old],
                    )
                    .map_err(err)?;
                    c.execute("DELETE FROM subtitles WHERE id=?1", [old])
                        .map_err(err)?;
                }
            }
            existing = Some(chosen);
        }
    }
    let key = existing.unwrap_or_else(id);
    c.execute("INSERT INTO subtitles(id,path,root_id,identity,available) VALUES(?1,?2,?3,?4,1) ON CONFLICT(id) DO UPDATE SET path=excluded.path,root_id=coalesce(excluded.root_id,subtitles.root_id),identity=excluded.identity,available=1",params![key,path,root_id,ident]).map_err(err)?;
    c.execute("INSERT INTO subtitle_versions(subtitle_id,fingerprint) VALUES(?1,?2) ON CONFLICT(subtitle_id) DO UPDATE SET fingerprint=excluded.fingerprint",params![key,fingerprint]).map_err(err)?;
    Ok(key)
}

pub fn bind(c: &mut Connection, item_id: &str, path: &str) -> Result<()> {
    let tx = c.transaction().map_err(err)?;
    let key = upsert_sub(&tx, Path::new(path), None, true)?;
    tx.execute("UPDATE items SET selected_subtitle_id=?1,subtitle=?2,subtitle_confirmation='manual_confirmed',revision=revision+1 WHERE id=?3",params![key,path,item_id]).map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(())
}
fn reconcile(
    c: &mut Connection,
    root_id: &str,
    paths: &[PathBuf],
    target: &ScanRoot,
    cancel: &AtomicBool,
) -> Result<usize> {
    if cancel.load(Ordering::SeqCst) {
        return Err("扫描已取消".into());
    }
    let tx = c.transaction().map_err(err)?;
    if scan_target(&tx, root_id)?.as_ref() != Some(target) {
        return Err("扫描期间目录配置已变化，已保留现有资料。请重新扫描。".into());
    }
    tx.execute(
        "UPDATE subtitles SET available=0 WHERE root_id=?1",
        [root_id],
    )
    .map_err(err)?;
    for p in paths.iter().filter(|p| is_sub(p)) {
        if cancel.load(Ordering::SeqCst) {
            return Err("扫描已取消".into());
        }
        upsert_sub(&tx, p, Some(root_id), false)?;
    }
    if target.kind == "subtitle" {
        if cancel.load(Ordering::SeqCst) {
            return Err("扫描已取消".into());
        }
        tx.commit().map_err(err)?;
        return Ok(paths.iter().filter(|p| is_sub(p)).count());
    }
    tx.execute(
        "UPDATE media_files SET available=0 WHERE root_id=?1",
        [root_id],
    )
    .map_err(err)?;
    let mut count = 0;
    for p in paths.iter().filter(|p| is_video(p)) {
        if cancel.load(Ordering::SeqCst) {
            return Err("扫描已取消".into());
        }
        let meta = fs::metadata(p).map_err(err)?;
        let path = p.to_string_lossy().to_string();
        let ident = identity(p);
        let at_path: Option<(String, String, Option<String>)> = tx
            .query_row(
                "SELECT id,item_id,identity FROM media_files WHERE path=?1",
                [&path],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(err)?;
        let mut matched = at_path
            .as_ref()
            .filter(|(_, _, old)| old == &ident || old.is_none())
            .map(|(key, item, _)| (key.clone(), item.clone()));
        if matched.is_none() {
            if let Some(i) = &ident {
                let mut q = tx
                    .prepare("SELECT id,item_id,path FROM media_files WHERE identity=?1")
                    .map_err(err)?;
                let rows = q
                    .query_map([i], |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, String>(1)?,
                            r.get::<_, String>(2)?,
                        ))
                    })
                    .map_err(err)?
                    .collect::<std::result::Result<Vec<_>, _>>()
                    .map_err(err)?;
                if rows.len() == 1 && !Path::new(&rows[0].2).exists() {
                    matched = Some((rows[0].0.clone(), rows[0].1.clone()));
                }
            }
        }
        if let Some((file, item)) = matched {
            tx.execute(
                "UPDATE media_files SET path=?1,identity=?2,size=?3,available=1 WHERE id=?4",
                params![path, ident, meta.len() as i64, file],
            )
            .map_err(err)?;
            tx.execute("UPDATE items SET path=?1,size=?2,available=1 WHERE id=?3 AND EXISTS(SELECT 1 FROM media_files WHERE id=?4 AND is_primary=1)",params![path,meta.len() as i64,item,file]).map_err(err)?;
        } else if at_path.is_none() {
            let item = id();
            let name = p
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            let code = if target.media_type == "jav" {
                normalize_code(&name)
            } else {
                String::new()
            };
            let release = if target.media_type == "western" {
                western_date(&name)
            } else {
                String::new()
            };
            tx.execute("INSERT INTO items(id,root_id,path,identity,title,code,media_type,size,added_at,release_date) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",params![item,root_id,path,ident,name,code,target.media_type,meta.len() as i64,stamp(),release]).map_err(err)?;
            tx.execute(
                "INSERT INTO media_files VALUES(?1,?2,?3,?4,?5,?6,1,1)",
                params![id(), item, root_id, path, ident, meta.len() as i64],
            )
            .map_err(err)?;
        } else {
            tx.execute(
                "INSERT INTO scan_runs VALUES(?1,?2,'needs_review',0,?3,?4)",
                params![
                    id(),
                    root_id,
                    format!("原路径出现不同文件：{}", path),
                    stamp()
                ],
            )
            .map_err(err)?;
        }
        count += 1;
    }
    tx.execute("UPDATE items SET available=coalesce((SELECT available FROM media_files WHERE item_id=items.id AND is_primary=1),0) WHERE root_id=?1",[root_id]).map_err(err)?;
    let subs = {
        let mut q = tx
            .prepare("SELECT id,path FROM subtitles WHERE available=1")
            .map_err(err)?;
        let rows = q
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        rows
    };
    let mut by_stem: HashMap<&OsStr, Vec<&(String, String)>> = HashMap::new();
    let mut by_code: HashMap<String, Vec<&(String, String)>> = HashMap::new();
    for subtitle in &subs {
        if cancel.load(Ordering::SeqCst) {
            return Err("扫描已取消".into());
        }
        if let Some(stem) = Path::new(&subtitle.1).file_stem() {
            by_stem.entry(stem).or_default().push(subtitle);
            let code = normalize_code(&stem.to_string_lossy());
            if !code.is_empty() {
                by_code.entry(code).or_default().push(subtitle);
            }
        }
    }
    let items = {
        let mut q=tx.prepare("SELECT id,path,code,subtitle,subtitle_confirmation,selected_subtitle_id FROM items WHERE root_id=?1 AND available=1").map_err(err)?;
        let rows = q
            .query_map([root_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, Option<String>>(5)?,
                ))
            })
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        rows
    };
    for (item, path, code, old, confirmation, selected) in items {
        if cancel.load(Ordering::SeqCst) {
            return Err("扫描已取消".into());
        }
        if confirmation == "disabled" || confirmation == "manual_confirmed"
            || (confirmation == "needs_review" && selected.is_some())
        {
            if let Some(old) = old {
                let selected: Option<String> = tx
                    .query_row("SELECT id FROM subtitles WHERE path=?1", [old], |r| {
                        r.get(0)
                    })
                    .optional()
                    .map_err(err)?;
                if let Some(selected) = selected {
                    tx.execute("UPDATE items SET selected_subtitle_id=coalesce(selected_subtitle_id,?1) WHERE id=?2",params![selected,item]).map_err(err)?;
                }
            }
            continue;
        }
        let p = Path::new(&path);
        let Some(candidates) = p.file_stem().and_then(|stem| by_stem.get(stem))
            .or_else(|| by_code.get(&code)) else {
            continue;
        };
        let parent = p.parent().map(|path| path_key(&path.to_string_lossy()));
        let mut local = candidates
            .iter()
            .copied()
            .filter(|(_, sub)| Path::new(sub).parent().map(|path| path_key(&path.to_string_lossy())) == parent);
        let (first, ambiguous) = match local.next() {
            Some(first) => (first, local.next().is_some()),
            None => (candidates[0], candidates.len() > 1),
        };
        if ambiguous {
            tx.execute(
                "UPDATE items SET subtitle_confirmation='needs_review' WHERE id=?1",
                [item],
            )
            .map_err(err)?;
        } else {
            tx.execute("UPDATE items SET selected_subtitle_id=?1,subtitle=?2,subtitle_confirmation='auto_matched' WHERE id=?3",params![first.0,first.1,item]).map_err(err)?;
        }
    }
    let candidates = {
        let mut q = tx
            .prepare("SELECT id FROM items WHERE root_id=?1 AND removed=0 AND available=1")
            .map_err(err)?;
        let rows = q
            .query_map([root_id], |r| r.get::<_, String>(0))
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        rows
    };
    media::enqueue(&tx, &candidates, true)?;
    if cancel.load(Ordering::SeqCst) {
        return Err("扫描已取消".into());
    }
    tx.commit().map_err(err)?;
    Ok(count)
}
fn western_date(name: &str) -> String {
    let re = regex::Regex::new(r"(?:^|[._ -])(\d{2}|20\d{2})[._-](\d{2})[._-](\d{2})(?:[._ -]|$)")
        .unwrap();
    if let Some(c) = re.captures(name) {
        let year = if c[1].len() == 2 {
            format!("20{}", &c[1])
        } else {
            c[1].into()
        };
        if c[2].parse::<i32>().unwrap_or(0) <= 12 && c[3].parse::<i32>().unwrap_or(0) <= 31 {
            return format!("{}-{}-{}", year, &c[2], &c[3]);
        }
    }
    String::new()
}
pub fn scan_root(s: &AppState, key: &str) -> Result<usize> {
    if s.scanning.swap(true, Ordering::SeqCst) {
        return Err(SCAN_BUSY.into());
    }
    struct Guard<'a>(&'a AtomicBool);
    impl Drop for Guard<'_> {
        fn drop(&mut self) {
            self.0.store(false, Ordering::SeqCst)
        }
    }
    let _guard = Guard(&s.scanning);
    s.cancel.store(false, Ordering::SeqCst);
    let target = scan_target(&*db(s)?, key)?.ok_or("目录已停用、移除或不存在")?;
    db(s)?.execute("DELETE FROM scan_runs WHERE state IN('completed','cancelled') AND id NOT IN(SELECT id FROM scan_runs ORDER BY created_at DESC LIMIT 500)",[]).map_err(err)?;
    diagnostics::notice(diagnostics::EventKind::ScanStart);
    let run = id();
    db(s)?
        .execute(
            "INSERT INTO scan_runs VALUES(?1,?2,'running',0,'',?3)",
            params![run, key, stamp()],
        )
        .map_err(err)?;
    let result = (|| {
        let mut paths = vec![];
        walk(Path::new(&target.path), &mut paths, &s.cancel)?;
        reconcile(&mut *db(s)?, key, &paths, &target, &s.cancel)
    })();
    match &result {
        Ok(count) => {
            diagnostics::notice(diagnostics::EventKind::ScanSuccess);
            db(s)?
                .execute(
                    "UPDATE scan_runs SET state='completed',count=?1 WHERE id=?2",
                    params![*count as i64, run],
                )
                .map_err(err)?;
        }
        Err(error) => {
            diagnostics::error(diagnostics::EventKind::ScanError, error);
            db(s)?
                .execute(
                    "UPDATE scan_runs SET state=?1,error=?2 WHERE id=?3",
                    params![
                        if s.cancel.load(Ordering::SeqCst) {
                            "cancelled"
                        } else {
                            "failed"
                        },
                        error,
                        run
                    ],
                )
                .map_err(err)?;
        }
    }
    result
}
#[tauri::command]
pub fn set_root_kind(root_id: String, kind: String, s: State<AppState>) -> Result<()> {
    if !["video", "subtitle"].contains(&kind.as_str()) {
        return Err("无效目录类型".into());
    }
    db(&s)?.execute("INSERT INTO root_meta(root_id,kind) VALUES(?1,?2) ON CONFLICT(root_id) DO UPDATE SET kind=excluded.kind",params![root_id,kind]).map_err(err)?;
    Ok(())
}
#[tauri::command]
pub fn detach_root(root_id: String, s: State<AppState>) -> Result<()> {
    let mut c = db(&s)?;
    let tx = c.transaction().map_err(err)?;
    tx.execute("UPDATE roots SET enabled=0 WHERE id=?1", [&root_id])
        .map_err(err)?;
    tx.execute("INSERT INTO root_meta(root_id,detached) VALUES(?1,1) ON CONFLICT(root_id) DO UPDATE SET detached=1",[&root_id]).map_err(err)?;
    tx.execute("UPDATE jobs SET state='cancelled',updated_at=?1 WHERE item_id IN(SELECT id FROM items WHERE root_id=?2) AND state IN('queued','running','paused','review')",params![stamp(),root_id]).map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(())
}
#[tauri::command]
pub fn relocate_root(
    root_id: String,
    path: String,
    confirm: bool,
    s: State<AppState>,
) -> Result<serde_json::Value> {
    relocate_impl(&s,&root_id,&path,confirm)
}
pub(super) fn relocate_impl(s:&AppState, root_id:&str, path:&str, confirm:bool)->Result<serde_json::Value> {
    let new = fs::canonicalize(path).map_err(err)?;
    if !new.is_dir() {
        return Err("请选择存在的目录".into());
    }
    let mut c = db(&s)?;
    let new_key=path_key(&new.to_string_lossy()).trim_end_matches('\\').to_owned();
    let others={let mut q=c.prepare("SELECT path FROM roots WHERE id!=?1").map_err(err)?;let rows=q.query_map([root_id],|r|r.get::<_,String>(0)).map_err(err)?.collect::<std::result::Result<Vec<_>,_>>().map_err(err)?;rows};
    for other in others {
        let key=path_key(&other).trim_end_matches('\\').to_owned();
        if key==new_key || key.starts_with(&(new_key.clone()+"\\")) || new_key.starts_with(&(key+"\\")) {
            return Err("新位置与另一个已登记目录重叠（包含停用或字幕目录），请先调整文件夹管理后重试".into());
        }
    }
    let old: String = c
        .query_row("SELECT path FROM roots WHERE id=?1", [&root_id], |r| {
            r.get(0)
        })
        .map_err(err)?;
    let files = {
        let mut q=c.prepare("SELECT id,path,identity FROM media_files WHERE root_id=?1 UNION ALL SELECT id,path,identity FROM subtitles WHERE root_id=?1").map_err(err)?;
        let rows = q
            .query_map([&root_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                ))
            })
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        rows
    };
    let mut missing = 0;
    let mut uncertain = 0;
    for (_, path, ident) in &files {
        let target = new.join(Path::new(path).strip_prefix(&old).map_err(err)?);
        if !target.is_file() {
            missing += 1
        } else if ident.is_none() || &identity(&target) != ident {
            uncertain += 1
        }
    }
    if !confirm {
        return Ok(
            serde_json::json!({"total":files.len(),"missing":missing,"uncertain":uncertain}),
        );
    }
    if s.scanning.load(Ordering::SeqCst) {
        return Err("请先结束扫描".into());
    }
    let tx = c.transaction().map_err(err)?;
    for (key, path, _) in files {
        let target = new.join(Path::new(&path).strip_prefix(&old).map_err(err)?);
        let present = target.is_file();
        let ident = identity(&target);
        tx.execute(
            "UPDATE media_files SET path=?1,identity=?2,available=?3 WHERE id=?4",
            params![target.to_string_lossy(), ident, present, key],
        )
        .map_err(err)?;
        tx.execute(
            "UPDATE subtitles SET path=?1,identity=?2,available=?3 WHERE id=?4",
            params![target.to_string_lossy(), ident, present, key],
        )
        .map_err(err)?;
    }
    tx.execute(
        "UPDATE roots SET path=?1,enabled=1 WHERE id=?2",
        params![new.to_string_lossy(), root_id],
    )
    .map_err(err)?;
    tx.execute(
        "UPDATE root_meta SET detached=0 WHERE root_id=?1",
        [&root_id],
    )
    .map_err(err)?;
    tx.execute("UPDATE items SET path=(SELECT path FROM media_files WHERE item_id=items.id AND is_primary=1),available=(SELECT available FROM media_files WHERE item_id=items.id AND is_primary=1),revision=revision+1 WHERE root_id=?1",[root_id]).map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(serde_json::json!({"relocated":true,"uncertainConfirmed":uncertain}))
}
#[tauri::command]
pub fn file_choices(item_id: String, s: State<AppState>) -> Result<Vec<FileChoice>> {
    let c = db(&s)?;
    let code: String = c
        .query_row("SELECT code FROM items WHERE id=?1", [&item_id], |r| {
            r.get(0)
        })
        .map_err(err)?;
    let mut q=c.prepare("SELECT f.id,f.path,f.item_id,f.is_primary,f.available,f.size FROM media_files f JOIN items i ON i.id=f.item_id WHERE f.item_id=?1 OR (?2!='' AND i.code=?2 AND i.merged_into IS NULL)").map_err(err)?;
    let rows = q
        .query_map(params![item_id, code], |r| {
            Ok(FileChoice {
                id: r.get(0)?,
                path: r.get(1)?,
                item_id: r.get(2)?,
                is_primary: r.get(3)?,
                available: r.get(4)?,
                size: r.get(5)?,
            })
        })
        .map_err(err)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(rows)
}
#[tauri::command]
pub fn choose_primary(item_id: String, file_id: String, s: State<AppState>) -> Result<()> {
    primary_impl(&s, &item_id, &file_id)
}
pub(super) fn primary_impl(s: &AppState, item_id: &str, file_id: &str) -> Result<()> {
    let mut c = db(&s)?;
    let tx = c.transaction().map_err(err)?;
    let (owner, path, size, root): (String, String, i64, String) = tx
        .query_row(
            "SELECT item_id,path,size,root_id FROM media_files WHERE id=?1",
            [&file_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(err)?;
    if owner != item_id {
        tx.execute("INSERT OR IGNORE INTO file_origins SELECT id,item_id FROM media_files WHERE item_id=?1",[&owner]).map_err(err)?;
        tx.execute(
            "UPDATE media_files SET is_primary=0 WHERE item_id=?1",
            [&owner],
        )
        .map_err(err)?;
        tx.execute(
            "UPDATE media_files SET item_id=?1 WHERE item_id=?2",
            params![item_id, owner],
        )
        .map_err(err)?;
        tx.execute(
            "UPDATE items SET merged_into=?1,removed=1 WHERE id=?2",
            params![item_id, owner],
        )
        .map_err(err)?;
    }
    tx.execute(
        "UPDATE media_files SET is_primary=0 WHERE item_id=?1",
        [&item_id],
    )
    .map_err(err)?;
    tx.execute("UPDATE media_files SET is_primary=1 WHERE id=?1", [file_id])
        .map_err(err)?;
    tx.execute("UPDATE items SET path=?1,size=?2,root_id=?3,subtitle_confirmation='needs_review',revision=revision+1 WHERE id=?4",params![path,size,root,item_id]).map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(())
}
#[tauri::command]
pub fn relink_file(item_id: String, path: String, add_root:Option<bool>,s: State<AppState>) -> Result<()> {
    let p = fs::canonicalize(path).map_err(err)?;
    if !is_video(&p) {
        return Err("请选择视频文件".into());
    }
    let mut c=db(&s)?;relink_with_root(&mut c,&item_id,&p,add_root.unwrap_or(false))
}
#[cfg(test)]
pub(super) fn relink_impl(c:&mut Connection,item_id:&str,p:&Path)->Result<()>{relink_with_root(c,item_id,p,false)}
pub(super) fn relink_with_root(c:&mut Connection,item_id:&str,p:&Path,add_root:bool)->Result<()>{
    if !p.is_file(){return Err("视频文件不存在".into());}
    let tx=c.transaction().map_err(err)?;
    let roots={let mut q=tx.prepare("SELECT r.id,r.path FROM roots r LEFT JOIN root_meta m ON r.id=m.root_id WHERE coalesce(m.kind,'video')='video' AND r.enabled=1 AND coalesce(m.detached,0)=0").map_err(err)?;let rows=q.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).map_err(err)?.collect::<std::result::Result<Vec<_>,_>>().map_err(err)?;rows};
    let key=path_key(&p.to_string_lossy());let owner=roots.iter().filter(|(_,r)|key.starts_with(&(path_key(r).trim_end_matches('\\').to_string()+"\\"))).max_by_key(|(_,r)|r.len()).map(|(id,_)|id.clone());
    let owner=if let Some(owner)=owner{owner}else{
      if !add_root{return Err("目标视频不在已启用的影片目录中，请确认添加目标目录后重新关联".into());}
      let parent=p.parent().ok_or("目标目录无效")?;let parent_key=path_key(&parent.to_string_lossy());let existing={let mut q=tx.prepare("SELECT path FROM roots").map_err(err)?;let rows=q.query_map([],|r|r.get::<_,String>(0)).map_err(err)?.collect::<std::result::Result<Vec<_>,_>>().map_err(err)?;rows};
      if existing.iter().any(|r|{let r=path_key(r);r==parent_key||r.starts_with(&(parent_key.clone()+"\\"))||parent_key.starts_with(&(r+"\\"))}){return Err("目标目录与已有停用或字幕目录重叠，请先在文件夹管理调整用途或启用".into());}
      let owner=id();let kind:String=tx.query_row("SELECT media_type FROM items WHERE id=?1",[item_id],|r|r.get(0)).map_err(err)?;tx.execute("INSERT INTO roots(id,path,media_type) VALUES(?1,?2,?3)",params![owner,parent.to_string_lossy(),kind]).map_err(err)?;tx.execute("INSERT INTO root_meta(root_id,kind) VALUES(?1,'video')",[&owner]).map_err(err)?;owner
    };
    let conflict:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM media_files WHERE path=?1 AND item_id!=?2)",params![p.to_string_lossy(),item_id],|r|r.get(0)).map_err(err)?;if conflict{return Err("该视频已属于另一条影片资料，请使用主视频与重复候选核查关联，避免覆盖个人资料".into());}
    let changed=tx.execute("UPDATE media_files SET path=?1,identity=?2,size=?3,available=1,root_id=?5 WHERE item_id=?4 AND is_primary=1",params![p.to_string_lossy(),identity(p),fs::metadata(p).map_err(err)?.len() as i64,item_id,owner]).map_err(err)?;
    if changed!=1{return Err("当前影片缺少主视频，请先核查主视频候选".into());}
    tx.execute("UPDATE items SET path=?1,size=?2,available=1,revision=revision+1,root_id=?4 WHERE id=?3",params![p.to_string_lossy(),fs::metadata(p).map_err(err)?.len() as i64,item_id,owner]).map_err(err)?;
    tx.commit().map_err(err)
}

#[tauri::command]
pub fn clear_subtitle(item_id:String,allow_auto:bool,s:State<AppState>)->Result<()>{
    db(&s)?.execute("UPDATE items SET subtitle=NULL,selected_subtitle_id=NULL,subtitle_confirmation=?1,revision=revision+1 WHERE id=?2",params![if allow_auto{"unselected"}else{"disabled"},item_id]).map_err(err)?;Ok(())
}
#[tauri::command]
pub fn subtitle_choices(item_id: String, s: State<AppState>) -> Result<serde_json::Value> {
    let c = db(&s)?;
    let code: String = c
        .query_row("SELECT code FROM items WHERE id=?1", [item_id], |r| {
            r.get(0)
        })
        .map_err(err)?;
    let mut q = c
        .prepare("SELECT id,path,available FROM subtitles ORDER BY path")
        .map_err(err)?;
    let rows=q.query_map([],|r|Ok(serde_json::json!({"id":r.get::<_,String>(0)?,"path":r.get::<_,String>(1)?,"available":r.get::<_,bool>(2)?}))).map_err(err)?.collect::<std::result::Result<Vec<_>,_>>().map_err(err)?;
    Ok(serde_json::json!({"code":code,"subtitles":rows}))
}
#[tauri::command]
pub fn review_items(s: State<AppState>) -> Result<serde_json::Value> {
    let c = db(&s)?;
    let mut q=c.prepare("SELECT id,title,code,path,available,subtitle_confirmation FROM items WHERE removed=0 AND merged_into IS NULL AND (available=0 OR subtitle_confirmation='needs_review' OR (code!='' AND code IN(SELECT code FROM items WHERE removed=0 GROUP BY code HAVING count(*)>1)))").map_err(err)?;
    let rows=q.query_map([],|r|Ok(serde_json::json!({"id":r.get::<_,String>(0)?,"title":r.get::<_,String>(1)?,"code":r.get::<_,String>(2)?,"path":r.get::<_,String>(3)?,"available":r.get::<_,bool>(4)?,"subtitleConfirmation":r.get::<_,String>(5)?}))).map_err(err)?.collect::<std::result::Result<Vec<_>,_>>().map_err(err)?;
    let mut q=c.prepare("SELECT id,state,error,created_at FROM scan_runs WHERE state IN('failed','needs_review','interrupted') ORDER BY created_at DESC LIMIT 50").map_err(err)?;
    let errors=q.query_map([],|r|Ok(serde_json::json!({"id":r.get::<_,String>(0)?,"state":r.get::<_,String>(1)?,"error":r.get::<_,String>(2)?,"createdAt":r.get::<_,i64>(3)?}))).map_err(err)?.collect::<std::result::Result<Vec<_>,_>>().map_err(err)?;
    Ok(serde_json::json!({"items":rows,"errors":errors}))
}
fn watch_targets(s: &AppState) -> Result<Vec<(String, String)>> {
    let c = db(s)?;
    let mut query = c.prepare(
        "SELECT r.id,r.path FROM roots r LEFT JOIN root_meta m ON r.id=m.root_id
         WHERE r.enabled=1 AND coalesce(m.detached,0)=0 ORDER BY r.id",
    ).map_err(err)?;
    let rows = query.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(err)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)
}

pub fn start_watch(app: tauri::AppHandle) {
    use notify::{RecursiveMode, Watcher};
    use std::time::{Duration, Instant};
    use tauri::Emitter;
    std::thread::spawn(move || {
        let (tx, rx) = std::sync::mpsc::channel();
        let events = tx.clone();
        let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
            let _ = events.send(event);
        }).ok();
        let mut watched = HashSet::<String>::new();
        let mut online = HashSet::<(String, String)>::new();
        let mut pending = HashSet::<String>::new();
        let mut periodic = Instant::now();

        let s = app.state::<AppState>();
        while !s.shutdown.load(Ordering::SeqCst) {
            let Ok(roots) = watch_targets(&s) else { break };
            pending.retain(|id| roots.iter().any(|(root, _)| root == id));
            let reachable: HashSet<_> = roots.iter().filter(|(_, path)| Path::new(path).is_dir())
                .cloned().collect();
            let roots_changed = reachable != online;
            pending.extend(reachable.difference(&online).map(|(id, _)| id.clone()));
            online = reachable;

            if let Some(watcher) = &mut watcher {
                watched.retain(|path| {
                    let reachable = online.iter().any(|(_, current)| current == path);
                    if !reachable {
                        let _ = watcher.unwatch(Path::new(path));
                    }
                    reachable
                });
                for (_, path) in &online {
                    if !watched.contains(path) && watcher.watch(Path::new(path), RecursiveMode::Recursive).is_ok() {
                        watched.insert(path.clone());
                    }
                }
            }
            if periodic.elapsed() >= Duration::from_secs(maintenance::interval(&s) * 60) {
                pending.extend(roots.iter().map(|(id, _)| id.clone()));
                periodic = Instant::now();
            }
            let mut scanned = false;
            for (id, path) in &roots {
                if !pending.contains(id) || !Path::new(path).is_dir() {
                    continue;
                }
                if s.scanning.load(Ordering::SeqCst) {
                    break;
                }
                if scan_root(&s, id).is_err_and(|error| error == SCAN_BUSY) {
                    break;
                }
                pending.remove(id);
                scanned = true;
            }
            if scanned {
                let _ = app.emit("library-changed", ());
                let _ = app.emit("jobs-changed", ());
            }
            if roots_changed {
                let _ = app.emit("roots-changed", ());
            }
            let received = rx.recv_timeout(Duration::from_secs(3)).ok().into_iter().chain(rx.try_iter());
            for event in received {
                match event {
                    Ok(event) if matches!(event.kind, notify::EventKind::Access(_)) => {}
                    Ok(event) => {
                        let affected: Vec<_> = event.paths.iter().map(|path| path_key(&path.to_string_lossy())).collect();
                        for (id, path) in &roots {
                            if affected.is_empty() || affected.iter().any(|p| Path::new(p).starts_with(path_key(path))) {
                                pending.insert(id.clone());
                            }
                        }
                    }
                    Err(_) => pending.extend(roots.iter().map(|(id, _)| id.clone())),
                }
            }
        }
        drop(tx);
    });
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn date_parse() {
        assert_eq!(western_date("vixen.17.12.25.title"), "2017-12-25");
    }
    #[test]
    fn cancelled_empty_subtitle_scan_keeps_availability() {
        let mut c = initialize(Path::new(":memory:")).unwrap();
        c.execute("INSERT INTO roots VALUES('r','x','personal',1)", [])
            .unwrap();
        c.execute(
            "INSERT INTO subtitles VALUES('s','chosen.srt','r','original',1)",
            [],
        )
        .unwrap();
        c.execute("INSERT INTO root_meta(root_id,kind) VALUES('r','subtitle')", []).unwrap();
        let target = scan_target(&c, "r").unwrap().unwrap();
        assert!(reconcile(
            &mut c,
            "r",
            &[],
            &target,
            &AtomicBool::new(true)
        )
        .is_err());
        assert_eq!(
            c.query_row("SELECT available FROM subtitles WHERE id='s'", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
    #[test]
    fn cancelled_scan_rolls_back() {
        let mut c = initialize(Path::new(":memory:")).unwrap();
        c.execute("INSERT INTO roots VALUES('r','x','personal',1)", [])
            .unwrap();
        let flag = AtomicBool::new(true);
        let target = scan_target(&c, "r").unwrap().unwrap();
        assert!(reconcile(
            &mut c,
            "r",
            &[PathBuf::from("x.mp4")],
            &target,
            &flag
        )
        .is_err());
        assert_eq!(
            c.query_row("SELECT count(*) FROM items", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn reconciliation_rejects_directory_changes_after_enumeration() {
        let mut c = initialize(Path::new(":memory:")).unwrap();
        c.execute_batch(
            "INSERT INTO roots VALUES('r','original','personal',1);
             INSERT INTO root_meta(root_id) VALUES('r');
             INSERT INTO items(id,root_id,path,title,media_type,size,added_at,note)
               VALUES('i','r','original/a.mp4','A','personal',1,0,'keep me');
             INSERT INTO media_files VALUES('f','i','r','original/a.mp4',NULL,1,1,1);",
        ).unwrap();
        let original = scan_target(&c, "r").unwrap().unwrap();
        let cancel = AtomicBool::new(false);
        for (change, undo) in [
            ("UPDATE roots SET path='relocated'", "UPDATE roots SET path='original'"),
            ("UPDATE roots SET media_type='jav'", "UPDATE roots SET media_type='personal'"),
            ("UPDATE root_meta SET kind='subtitle'", "UPDATE root_meta SET kind='video'"),
            ("UPDATE roots SET enabled=0", "UPDATE roots SET enabled=1"),
        ] {
            c.execute_batch(change).unwrap();
            assert!(reconcile(&mut c, "r", &[], &original, &cancel).unwrap_err().contains("目录配置已变化"));
            let item: (String, bool) = c.query_row("SELECT note,available FROM items WHERE id='i'", [],
                |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
            assert_eq!(item, ("keep me".into(), true));
            c.execute_batch(undo).unwrap();
        }
    }
}

#[tauri::command]
pub fn set_root_type(root_id: String, media_type: String, s: State<AppState>) -> Result<()> {
    kind_ok(&media_type)?;
    db(&s)?
        .execute(
            "UPDATE roots SET media_type=?1 WHERE id=?2",
            params![media_type, root_id],
        )
        .map_err(err)?;
    Ok(())
}
#[tauri::command]
pub fn separate_file(file_id: String, s: State<AppState>) -> Result<()> {
    separate_impl(&s, &file_id)
}
pub(super) fn separate_impl(s: &AppState, file_id: &str) -> Result<()> {
    let mut c = db(&s)?;
    let tx = c.transaction().map_err(err)?;
    let (owner, root, path, size, primary): (String, String, String, i64, bool) = tx
        .query_row(
            "SELECT item_id,root_id,path,size,is_primary FROM media_files WHERE id=?1",
            [&file_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .map_err(err)?;
    if primary {
        return Err("请先选择另一个主视频，再将此文件分开".into());
    }
    let original: Option<String> = tx
        .query_row(
            "SELECT original_item_id FROM file_origins WHERE file_id=?1",
            [&file_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    let item = original.filter(|id| id != &owner).unwrap_or_else(id);
    let exists: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM items WHERE id=?1)",
            [&item],
            |r| r.get(0),
        )
        .map_err(err)?;
    if !exists {
        let kind: String = tx
            .query_row("SELECT media_type FROM items WHERE id=?1", [&owner], |r| {
                r.get(0)
            })
            .map_err(err)?;
        let name = Path::new(&path)
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy();
        tx.execute("INSERT INTO items(id,root_id,path,title,media_type,size,code,added_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",params![item,root,path,name,kind,size,normalize_code(&name),stamp()]).map_err(err)?;
    }
    tx.execute(
        "UPDATE media_files SET is_primary=0 WHERE item_id=?1",
        [&item],
    )
    .map_err(err)?;
    tx.execute(
        "UPDATE media_files SET item_id=?1,is_primary=1 WHERE id=?2",
        params![item, file_id],
    )
    .map_err(err)?;
    tx.execute("UPDATE items SET merged_into=NULL,removed=0,path=?1,size=?2,root_id=?3,available=1 WHERE id=?4",params![path,size,root,item]).map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(())
}
