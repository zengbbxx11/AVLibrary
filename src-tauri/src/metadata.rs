use super::*;
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    io::Read,
    net::{IpAddr, ToSocketAddrs},
};
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub media_types: Vec<String>,
    pub search_url: String,
    pub allowed_hosts: Vec<String>,
    pub enabled: bool,
}
pub fn defaults() -> Vec<Provider> {
    vec![
        Provider {
            id: "javlibrary".into(),
            name: "JAVLibrary · 候选核查".into(),
            media_types: vec!["jav".into()],
            search_url: "https://www.javlibrary.com/en/vl_searchbyid.php?keyword={query}".into(),
            allowed_hosts: vec!["www.javlibrary.com".into(), "javlibrary.com".into()],
            enabled: true,
        },
        Provider {
            id: "iafd".into(),
            name: "IAFD · 候选核查".into(),
            media_types: vec!["western".into()],
            search_url:
                "https://www.iafd.com/results.asp?searchtype=comprehensive&searchstring={query}"
                    .into(),
            allowed_hosts: vec!["www.iafd.com".into(), "iafd.com".into()],
            enabled: true,
        },
    ]
}
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Proposal {
    pub title: String,
    pub code: String,
    pub studio: String,
    pub performers: Vec<String>,
    pub description: String,
    pub release_date: String,
    pub cover_url: String,
    pub source_url: String,
}
fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => {
            !v.is_private()
                && !v.is_loopback()
                && !v.is_link_local()
                && !v.is_unspecified()
                && !v.is_multicast()
                && !(v.octets()[0] == 100 && (64..=127).contains(&v.octets()[1]))
                && v.octets()[0] != 0
                && v.octets()[0] < 224
        }
        IpAddr::V6(v) => {
            if let Some(v) = v.to_ipv4_mapped() {
                return public_ip(v.into());
            }
            let s = v.segments();
            !v.is_loopback()
                && !v.is_unspecified()
                && !v.is_multicast()
                && (s[0] & 0xfe00) != 0xfc00
                && (s[0] & 0xffc0) != 0xfe80
        }
    }
}
fn permitted(url: &reqwest::Url, p: &Provider) -> Result<Vec<std::net::SocketAddr>> {
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some_and(|n| n != 443)
    {
        return Err("仅允许无账号信息的 HTTPS 来源".into());
    }
    let host = url.host_str().ok_or("缺少域名")?.to_lowercase();
    if !p.allowed_hosts.iter().any(|a| a.to_lowercase() == host) {
        return Err(format!(
            "来源域名未授权：{}，如属合法图片 CDN 请在来源设置显式添加",
            host
        ));
    }
    let addrs = (host.as_str(), 443)
        .to_socket_addrs()
        .map_err(err)?
        .collect::<Vec<_>>();
    if addrs.is_empty() || addrs.iter().any(|a| !public_ip(a.ip())) {
        return Err("拒绝本地、私网或无效来源地址".into());
    }
    Ok(addrs)
}
fn download(url: &str, p: &Provider, max: u64) -> Result<(Vec<u8>, String)> {
    let mut url = reqwest::Url::parse(url).map_err(err)?;
    for _ in 0..5 {
        let addresses = permitted(&url, p)?;
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::none())
            .resolve_to_addrs(url.host_str().unwrap(), &addresses)
            .user_agent("AVLibraryManager/0.2 (personal metadata client)")
            .build()
            .map_err(err)?;
        let response = client.get(url.clone()).send().map_err(err)?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or("重定向无目标")?;
            url = url.join(location).map_err(err)?;
            continue;
        }
        if !response.status().is_success() {
            return Err(format!("来源返回 HTTP {}", response.status()));
        }
        if response.content_length().is_some_and(|n| n > max) {
            return Err("来源响应超过大小限制".into());
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        let mut bytes = vec![];
        response
            .take(max + 1)
            .read_to_end(&mut bytes)
            .map_err(err)?;
        if bytes.len() as u64 > max {
            return Err("来源响应超过大小限制".into());
        }
        return Ok((bytes, content_type));
    }
    Err("来源重定向次数过多".into())
}
fn text(doc: &scraper::Html, selector: &str) -> String {
    scraper::Selector::parse(selector)
        .ok()
        .and_then(|s| {
            doc.select(&s).next().map(|e| {
                e.text()
                    .collect::<Vec<_>>()
                    .join(" ")
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ")
            })
        })
        .unwrap_or_default()
}
fn attr(doc: &scraper::Html, selector: &str, key: &str) -> String {
    scraper::Selector::parse(selector)
        .ok()
        .and_then(|s| {
            doc.select(&s)
                .next()
                .and_then(|e| e.value().attr(key).map(str::to_string))
        })
        .unwrap_or_default()
}
fn names(value: &Value) -> Vec<String> {
    match value {
        Value::Array(a) => a.iter().flat_map(names).collect(),
        Value::String(s) => vec![s.clone()],
        Value::Object(o) => o
            .get("name")
            .and_then(Value::as_str)
            .map(|s| vec![s.into()])
            .unwrap_or_default(),
        _ => vec![],
    }
}
fn find_video(v: &Value) -> Option<&Value> {
    match v {
        Value::Array(a) => a.iter().find_map(find_video),
        Value::Object(o) => {
            let ty = o.get("@type").map(|v| v.to_string()).unwrap_or_default();
            if ["Movie", "VideoObject", "Episode", "CreativeWork"]
                .iter()
                .any(|t| ty.contains(t))
            {
                Some(v)
            } else {
                o.get("@graph").and_then(find_video)
            }
        }
        _ => None,
    }
}
pub fn parse(html: &str, url: &str) -> Result<Proposal> {
    let doc = scraper::Html::parse_document(html);
    let mut p = Proposal {
        source_url: url.into(),
        ..Proposal::default()
    };
    let selector = scraper::Selector::parse("script[type='application/ld+json']").unwrap();
    for script in doc.select(&selector) {
        if let Ok(json) = serde_json::from_str::<Value>(&script.text().collect::<String>()) {
            if let Some(v) = find_video(&json) {
                p.title = v["name"].as_str().unwrap_or("").into();
                p.description = v["description"].as_str().unwrap_or("").into();
                p.release_date = v["datePublished"]
                    .as_str()
                    .unwrap_or("")
                    .chars()
                    .take(10)
                    .collect();
                p.performers = names(&v["actor"]);
                p.studio = names(&v["productionCompany"])
                    .first()
                    .cloned()
                    .unwrap_or_else(|| names(&v["publisher"]).first().cloned().unwrap_or_default());
                p.cover_url = names(&v["image"])
                    .first()
                    .cloned()
                    .unwrap_or_else(|| v["thumbnailUrl"].as_str().unwrap_or("").into());
                if p.cover_url.is_empty() {
                    p.cover_url = v["image"]["url"].as_str().unwrap_or("").into();
                }
                break;
            }
        }
    }
    if p.title.is_empty() {
        p.title = text(&doc, "#video_title a");
    }
    if p.title.is_empty() {
        p.title = attr(&doc, "meta[property='og:title']", "content")
    }
    if p.description.is_empty() {
        p.description = attr(
            &doc,
            "meta[property='og:description'],meta[name='description']",
            "content",
        )
    }
    p.code = text(&doc, "#video_id .text");
    if p.studio.is_empty() {
        p.studio = text(&doc, "#video_maker .text a")
    }
    if p.release_date.is_empty() {
        p.release_date = text(&doc, "#video_date .text")
    }
    if p.performers.is_empty() {
        let selector = scraper::Selector::parse("#video_cast .text a").unwrap();
        p.performers = doc.select(&selector).map(|e| e.text().collect()).collect();
    }
    if p.cover_url.is_empty() {
        p.cover_url = attr(&doc, "#video_jacket_img", "src");
    }
    if p.cover_url.is_empty() {
        p.cover_url = attr(&doc, "meta[property='og:image']", "content")
    }
    if !p.cover_url.is_empty() {
        p.cover_url = reqwest::Url::parse(url)
            .map_err(err)?
            .join(&p.cover_url)
            .map_err(err)?
            .into();
    }
    p.description = scraper::Html::parse_fragment(&p.description)
        .root_element()
        .text()
        .collect::<Vec<_>>()
        .join(" ");
    if p.title.trim().is_empty() {
        return Err("来源未提供可识别作品资料，请选择其他 URL 或手动填写".into());
    }
    Ok(p)
}
pub(super) fn ensure_job(c: &Connection, key: &str) -> Result<(String, String, i64)> {
    c.query_row("SELECT i.id,i.media_type,i.revision FROM jobs j JOIN items i ON i.id=j.item_id WHERE j.id=?1 AND j.state='running' AND i.removed=0 AND i.media_type!='personal' AND i.revision=j.revision",[key],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(|_|"任务已取消、作品已移出或禁止联网".into())
}
fn execute_network(s: &AppState, key: &str, p: &Provider, query: &str) -> Result<Value> {
    ensure_job(&*db(s)?, key)?;
    let url = if query.starts_with("https://") {
        query.to_string()
    } else {
        p.search_url.replace(
            "{query}",
            &query
                .chars()
                .flat_map(|c| {
                    if c.is_ascii_alphanumeric() || c == '-' {
                        c.to_string()
                    } else {
                        c.to_string()
                            .as_bytes()
                            .iter()
                            .map(|b| format!("%{:02X}", b))
                            .collect()
                    }
                    .chars()
                    .collect::<Vec<_>>()
                })
                .collect::<String>(),
        )
    };
    let (bytes, _) = download(&url, p, 3 * 1024 * 1024)?;
    ensure_job(&*db(s)?, key)?;
    let html = String::from_utf8_lossy(&bytes).to_string();
    if query.starts_with("https://") {
        return Ok(json!({"proposal":parse(&html,&url)?}));
    }
    let doc = scraper::Html::parse_document(&html);
    let selector = scraper::Selector::parse("a[href]").unwrap();
    let base = reqwest::Url::parse(&url).map_err(err)?;
    let normalized = query.to_uppercase().replace(['-', '_', ' '], "");
    let mut candidates = vec![];
    let mut seen = HashSet::new();
    for anchor in doc.select(&selector) {
        let href = anchor.value().attr("href").unwrap_or("");
        let title = anchor
            .value()
            .attr("title")
            .map(str::to_string)
            .unwrap_or_else(|| anchor.text().collect::<Vec<_>>().join(" "));
        let normalized_title = title.to_uppercase().replace(['-', '_', ' '], "");
        if (normalized_title.contains(&normalized)
            || href.contains("?v=")
            || href.contains("/title.rme/"))
            && !title.trim().is_empty()
        {
            if let Ok(target) = base.join(href) {
                if permitted(&target, p).is_ok() && seen.insert(target.to_string()) {
                    candidates.push(json!({"title":title,"url":target.as_str()}));
                    if candidates.len() >= 20 {
                        break;
                    }
                }
            }
        }
    }
    if candidates.is_empty() {
        let proposal = parse(&html, &url)?;
        if !proposal.code.is_empty() && normalize_code(&proposal.code) == normalize_code(query) {
            return Ok(json!({"proposal":proposal}));
        }
        return Err("未找到可信候选；可粘贴该来源的作品 URL，或使用手动编辑".into());
    }
    Ok(json!({"candidates":candidates}))
}
fn execute(s: &AppState, key: &str, p: &Provider, query: &str) -> Result<Value> {
    use sha2::{Digest, Sha256};
    ensure_job(&*db(s)?, key)?;
    let directory = s.data.join("caches/metadata");
    fs::create_dir_all(&directory).map_err(err)?;
    let filename = directory.join(format!(
        "{:x}.json",
        Sha256::digest(format!("{}:{}:{}", p.id, p.search_url, query).as_bytes())
    ));
    if let Ok(file) = fs::read(&filename) {
        if let Ok(value) = serde_json::from_slice::<Value>(&file) {
            if stamp() - value["at"].as_i64().unwrap_or(0) < 600000 {
                return Ok(value["payload"].clone());
            }
        }
    }
    let result = execute_network(s, key, p, query)?;
    fs::write(filename, json!({"at":stamp(),"payload":result}).to_string()).map_err(err)?;
    Ok(result)
}
#[tauri::command]
pub fn queue_metadata(
    ids: Vec<String>,
    provider_id: String,
    query: Option<String>,
    s: State<AppState>,
) -> Result<Value> {
    let settings = get_settings(s.clone())?;
    let provider = settings
        .providers
        .iter()
        .find(|p| p.id == provider_id && p.enabled)
        .ok_or("来源未启用")?;
    let mut c = db(&s)?;
    let tx = c.transaction().map_err(err)?;
    let mut queued = 0;
    let mut skipped = 0;
    for item in ids {
        let (kind, code, title, revision): (String, String, String, i64) = tx
            .query_row(
                "SELECT media_type,code,title,revision FROM items WHERE id=?1 AND removed=0",
                [&item],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .map_err(err)?;
        if kind == "personal" || !provider.media_types.contains(&kind) {
            skipped += 1;
            continue;
        }
        let term = query
            .clone()
            .unwrap_or_else(|| if code.is_empty() { title } else { code });
        let now = stamp();
        queued+=tx.execute("INSERT OR IGNORE INTO jobs(id,item_id,kind,state,query,provider,revision,created_at,updated_at) VALUES(?1,?2,'metadata','queued',?3,?4,?5,?6,?6)",params![id(),item,term,provider_id,revision,now]).map_err(err)?;
    }
    tx.commit().map_err(err)?;
    Ok(json!({"queued":queued,"skipped":skipped}))
}
#[tauri::command]
pub fn jobs(scope:Option<String>,offset:Option<i64>,s: State<AppState>) -> Result<Value> {
    jobs_page(&*db(&s)?,scope.as_deref().unwrap_or("active"),offset.unwrap_or(0))
}
pub(super) fn jobs_page(c:&Connection,scope:&str,offset:i64)->Result<Value>{
    let scope=scope.to_string();
    let condition=match scope.as_str(){"review"=>"j.state='review'","failed"=>"j.state IN('failed','interrupted')","history"=>"j.state IN('saved','cancelled')",_=>"j.state IN('queued','running','paused')"};
    let mut q=c.prepare(&format!("SELECT j.id,j.item_id,i.title,j.state,j.query,j.provider,j.payload,j.error,j.created_at FROM jobs j LEFT JOIN items i ON i.id=j.item_id WHERE {} ORDER BY j.created_at DESC,j.id LIMIT 100 OFFSET ?1",condition)).map_err(err)?;
    let rows=q.query_map([offset.max(0)],|r|Ok(json!({"id":r.get::<_,String>(0)?,"itemId":r.get::<_,String>(1)?,"title":r.get::<_,Option<String>>(2)?,"state":r.get::<_,String>(3)?,"query":r.get::<_,String>(4)?,"provider":r.get::<_,String>(5)?,"payload":serde_json::from_str::<Value>(&r.get::<_,String>(6)?).unwrap_or_default(),"error":r.get::<_,String>(7)?,"createdAt":r.get::<_,i64>(8)?}))).map_err(err)?.collect::<std::result::Result<Vec<_>,_>>().map_err(err)?;
    Ok(json!(rows))
}
#[tauri::command]
pub fn job_action(key: String, action: String, s: State<AppState>) -> Result<()> {
    let c = db(&s)?;
    match action.as_str() {
        "cancel" => {
            c.execute("UPDATE jobs SET state='cancelled',updated_at=?1 WHERE id=?2 AND state NOT IN('saved','cancelled')",params![stamp(),key]).map_err(err)?;
        }
        "pause" => {
            c.execute(
                "UPDATE jobs SET state='paused' WHERE id=?1 AND state='queued'",
                [key],
            )
            .map_err(err)?;
        }
        "resume" | "retry" => {
            c.execute("UPDATE jobs SET state='queued',error='',payload='' WHERE id=?1 AND state IN('paused','failed','interrupted') AND EXISTS(SELECT 1 FROM items WHERE id=jobs.item_id AND removed=0 AND (jobs.kind='local' OR media_type!='personal'))",[key]).map_err(err)?;
        }
        _ => return Err("无效任务操作".into()),
    }
    Ok(())
}
#[tauri::command]
pub fn candidate(key: String, url: String, s: State<AppState>) -> Result<()> {
    let c = db(&s)?;
    c.execute("UPDATE jobs SET query=?1,state='queued',payload='',revision=(SELECT revision FROM items WHERE id=jobs.item_id) WHERE id=?2 AND state='review'",params![url,key]).map_err(err)?;
    Ok(())
}
#[tauri::command]
pub fn apply_metadata(key: String, proposal: Proposal, s: State<AppState>) -> Result<()> {
    commit(&mut *db(&s)?, &key, &proposal)
}
pub(super) fn commit(c: &mut Connection, key: &str, proposal: &Proposal) -> Result<()> {
    let tx = c.transaction().map_err(err)?;
    let(item,revision,expected,kind,removed):(String,i64,i64,String,bool)=tx.query_row("SELECT i.id,i.revision,j.revision,i.media_type,i.removed FROM jobs j JOIN items i ON i.id=j.item_id WHERE j.id=?1 AND j.state='review'",[&key],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).map_err(err)?;
    if revision != expected || kind == "personal" || removed {
        return Err("资料已变化或不允许联网，请重新获取候选".into());
    }
    let current = catalog::details(&tx, &item)?;
    let provider: String = tx
        .query_row("SELECT provider FROM jobs WHERE id=?1", [key], |r| r.get(0))
        .map_err(err)?;
    let settings: Settings = tx
        .query_row("SELECT value FROM settings WHERE id=1", [], |r| {
            r.get::<_, String>(0)
        })
        .optional()
        .map_err(err)?
        .and_then(|v| serde_json::from_str(&v).ok())
        .unwrap_or_default();
    let mut decisions = std::collections::HashMap::new();
    for field in [
        "title",
        "description",
        "releaseDate",
        "studio",
        "performers",
    ] {
        let previous: Option<String> = tx
            .query_row(
                "SELECT source_id FROM field_sources WHERE item_id=?1 AND field=?2",
                params![item, field],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        let order = settings
            .priorities
            .get(field)
            .cloned()
            .unwrap_or_else(|| settings.providers.iter().map(|p| p.id.clone()).collect());
        let rank = |id: &str| order.iter().position(|p| p == id).unwrap_or(usize::MAX);
        let allowed = !current.locks.contains(&field.into())
            && previous
                .map(|old| old.is_empty() || rank(&provider) <= rank(&old))
                .unwrap_or(true);
        decisions.insert(field, allowed);
    }
    let allowed = |field: &str| decisions.get(field).copied().unwrap_or(false);
    for (field, value, column) in [
        ("title", &proposal.title, "title"),
        ("description", &proposal.description, "description"),
        ("releaseDate", &proposal.release_date, "release_date"),
    ] {
        if allowed(field) && !value.is_empty() {
            tx.execute(
                &format!("UPDATE items SET {}=?1 WHERE id=?2", column),
                params![value, item],
            )
            .map_err(err)?;
            tx.execute("INSERT INTO field_sources(item_id,field,source,updated_at,source_id) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(item_id,field) DO UPDATE SET source=excluded.source,updated_at=excluded.updated_at,source_id=excluded.source_id",params![item,field,proposal.source_url,stamp(),provider]).map_err(err)?;
        }
    }
    if allowed("studio") && !proposal.studio.is_empty() {
        let studio = catalog::entity(&tx, "studios", &proposal.studio)?;
        tx.execute(
            "UPDATE items SET studio_id=?1 WHERE id=?2",
            params![studio, item],
        )
        .map_err(err)?;
    }
    if allowed("performers") && !proposal.performers.is_empty() {
        tx.execute("DELETE FROM item_performers WHERE item_id=?1", [&item])
            .map_err(err)?;
        for name in &proposal.performers {
            if let Some(performer) = catalog::entity(&tx, "performers", name)? {
                tx.execute(
                    "INSERT OR IGNORE INTO item_performers VALUES(?1,?2)",
                    params![item, performer],
                )
                .map_err(err)?;
            }
        }
    }
    for (field, present) in [
        ("studio", !proposal.studio.is_empty()),
        ("performers", !proposal.performers.is_empty()),
    ] {
        if present && allowed(field) {
            tx.execute("INSERT INTO field_sources(item_id,field,source,updated_at,source_id) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(item_id,field) DO UPDATE SET source=excluded.source,updated_at=excluded.updated_at,source_id=excluded.source_id",params![item,field,proposal.source_url,stamp(),provider]).map_err(err)?;
        }
    }
    tx.execute("UPDATE items SET revision=revision+1 WHERE id=?1", [&item])
        .map_err(err)?;
    tx.execute(
        "UPDATE jobs SET state='saved',updated_at=?1 WHERE id=?2",
        params![stamp(), key],
    )
    .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(())
}
#[tauri::command]
pub async fn fetch_cover(
    app: tauri::AppHandle,
    item_id: String,
    provider_id: String,
    url: String,
) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let s = app.state::<AppState>();
        let settings = get_settings(s.clone())?;
        let provider = settings
            .providers
            .iter()
            .find(|p| p.id == provider_id && p.enabled)
            .ok_or("来源未启用")?;
        let revision: i64 = db(&s)?
            .query_row(
                "SELECT revision FROM items WHERE id=?1 AND media_type!='personal' AND removed=0",
                [&item_id],
                |r| r.get(0),
            )
            .map_err(err)?;
        let (bytes, content_type) = download(&url, provider, 12 * 1024 * 1024)?;
        if !content_type.starts_with("image/") {
            return Err("来源不是图片".into());
        }
        let image = media::validate_image(&bytes)?;
        if image.width() as u64 * image.height() as u64 > 40_000_000 {
            return Err("图片像素过大".into());
        }
        let mut encoded = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(image.thumbnail(1600, 1600).to_rgb8())
            .write_to(&mut encoded, image::ImageFormat::Jpeg)
            .map_err(err)?;
        media::persist_cover(
            &s,
            &item_id,
            encoded.get_ref(),
            "jpg",
            "official",
            revision,
            true,
        )?;
        Ok(())
    })
    .await
    .map_err(err)?
}
pub fn worker(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        let s = app.state::<AppState>();
        if s.shutdown.load(Ordering::SeqCst) {
            break;
        }
        let job = {
            let c = match db(&s) {
                Ok(c) => c,
                Err(_) => break,
            };
            c.query_row("SELECT id,provider,query FROM jobs WHERE kind='metadata' AND state='queued' ORDER BY created_at LIMIT 1",[],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?))).optional().ok().flatten()
        };
        if let Some((key, provider, query)) = job {
            let result = (|| {
                db(&s)?.execute("UPDATE jobs SET state='running',updated_at=?1 WHERE id=?2 AND state='queued'",params![stamp(),key]).map_err(err)?;
                let settings = get_settings(s.clone())?;
                let provider = settings
                    .providers
                    .iter()
                    .find(|p| p.id == provider && p.enabled)
                    .ok_or("来源未启用")?;
                execute(&s, &key, provider, &query)
            })();
            if let Ok(c) = db(&s) {
                match result {
                    Ok(payload) => {
                        diagnostics::notice(diagnostics::EventKind::MetadataSuccess);
                        let _=c.execute("UPDATE jobs SET state='review',payload=?1,updated_at=?2 WHERE id=?3 AND state='running'",params![payload.to_string(),stamp(),key]);
                    }
                    Err(error) => {
                        diagnostics::error(diagnostics::EventKind::MetadataError, &error);
                        let _=c.execute("UPDATE jobs SET state='failed',error=?1,updated_at=?2 WHERE id=?3 AND state='running'",params![error,stamp(),key]);
                    }
                }
            }
            use tauri::Emitter;
            let _ = app.emit("jobs-changed", ());
            std::thread::sleep(std::time::Duration::from_secs(2));
        } else {
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
    });
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn structured_metadata() {
        let p=parse(r#"<script type="application/ld+json">{"@type":"Movie","name":"Fixture","actor":[{"name":"Test Person"}],"description":"<b>plain</b>"}</script>"#,"https://example.com/work").unwrap();
        assert_eq!(p.title, "Fixture");
        assert_eq!(p.performers, vec!["Test Person"]);
        assert_eq!(p.description, "plain");
    }
    #[test]
    fn rejects_private() {
        for s in [
            "127.0.0.1",
            "10.0.0.1",
            "192.168.1.1",
            "::1",
            "::ffff:127.0.0.1",
        ] {
            assert!(!public_ip(s.parse().unwrap()))
        }
    }
}
