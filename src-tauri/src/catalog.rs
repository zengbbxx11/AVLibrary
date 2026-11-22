use super::*;
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Details {
    pub studio: String,
    pub performers: Vec<String>,
    pub description: String,
    pub release_date: String,
    pub locks: Vec<String>,
    pub revision: i64,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub embedded_subtitles: Option<i64>,
    pub subtitle_state: String,
}
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Filters {
    pub favorite: bool,
    pub tags: Vec<String>,
    pub all_tags: bool,
    pub performers: Vec<String>,
    pub all_performers: bool,
    pub studios: Vec<String>,
    pub subtitle: String,
    pub rating_min: Option<i64>,
    pub rating_max: Option<i64>,
    pub duration_min: Option<f64>,
    pub duration_max: Option<f64>,
    pub unrated: bool,
    pub target_id: String,
    pub category_id: String,
    pub sort: String,
}
pub fn migrate(c: &mut Connection, version: i64) -> Result<()> {
    if version >= 2 {
        return migrate3(c);
    }
    let tx = c.transaction().map_err(err)?;
    tx.execute_batch("ALTER TABLE items ADD COLUMN studio_id TEXT;ALTER TABLE items ADD COLUMN description TEXT NOT NULL DEFAULT '';ALTER TABLE items ADD COLUMN release_date TEXT NOT NULL DEFAULT '';ALTER TABLE items ADD COLUMN locks TEXT NOT NULL DEFAULT '[]';ALTER TABLE items ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;ALTER TABLE items ADD COLUMN width INTEGER;ALTER TABLE items ADD COLUMN height INTEGER;ALTER TABLE items ADD COLUMN embedded_subtitles INTEGER;ALTER TABLE items ADD COLUMN selected_subtitle_id TEXT;ALTER TABLE items ADD COLUMN cover_manual INTEGER NOT NULL DEFAULT 0;ALTER TABLE items ADD COLUMN merged_into TEXT;
CREATE TABLE cover_assets(path TEXT PRIMARY KEY,item_id TEXT,source_type TEXT NOT NULL,capture_seconds REAL,source_identity TEXT,manual INTEGER NOT NULL DEFAULT 0);
CREATE TABLE root_meta(root_id TEXT PRIMARY KEY REFERENCES roots(id),kind TEXT NOT NULL DEFAULT 'video',detached INTEGER NOT NULL DEFAULT 0);
CREATE TABLE tag_groups(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE);CREATE TABLE tag_meta(tag_id TEXT PRIMARY KEY REFERENCES tags(id),group_id TEXT REFERENCES tag_groups(id));
CREATE TABLE studios(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,aliases TEXT NOT NULL DEFAULT '[]');CREATE TABLE performers(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,aliases TEXT NOT NULL DEFAULT '[]');CREATE TABLE item_performers(item_id TEXT REFERENCES items(id),performer_id TEXT REFERENCES performers(id),PRIMARY KEY(item_id,performer_id));
CREATE TABLE subtitles(id TEXT PRIMARY KEY,path TEXT NOT NULL UNIQUE,root_id TEXT,identity TEXT,available INTEGER NOT NULL DEFAULT 1);
CREATE INDEX sub_identity ON subtitles(identity);
CREATE TABLE file_origins(file_id TEXT PRIMARY KEY,original_item_id TEXT NOT NULL);
CREATE TABLE media_files(id TEXT PRIMARY KEY,item_id TEXT REFERENCES items(id),root_id TEXT NOT NULL,path TEXT NOT NULL UNIQUE,identity TEXT,size INTEGER NOT NULL,available INTEGER NOT NULL DEFAULT 1,is_primary INTEGER NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX one_primary ON media_files(item_id) WHERE is_primary=1;CREATE INDEX file_identity ON media_files(identity);
CREATE TABLE scan_runs(id TEXT PRIMARY KEY,root_id TEXT NOT NULL,state TEXT NOT NULL,count INTEGER NOT NULL DEFAULT 0,error TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL);
CREATE TABLE saved_filters(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,value TEXT NOT NULL);
CREATE TABLE jobs(id TEXT PRIMARY KEY,item_id TEXT NOT NULL,kind TEXT NOT NULL,state TEXT NOT NULL,query TEXT NOT NULL DEFAULT '',provider TEXT NOT NULL DEFAULT '',payload TEXT NOT NULL DEFAULT '',error TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE UNIQUE INDEX active_job ON jobs(item_id,kind) WHERE state IN('queued','running','paused');
CREATE TABLE field_sources(item_id TEXT NOT NULL,field TEXT NOT NULL,source TEXT NOT NULL,updated_at INTEGER NOT NULL,source_id TEXT NOT NULL DEFAULT '',PRIMARY KEY(item_id,field));
INSERT INTO root_meta(root_id) SELECT id FROM roots;
INSERT INTO media_files(id,item_id,root_id,path,identity,size,available,is_primary) SELECT id,id,root_id,path,identity,size,available,1 FROM items;
PRAGMA user_version=2;").map_err(err)?;
    tx.commit().map_err(err)?;
    migrate3(c)
}
fn string_list(c: &Connection, sql: &str, key: &str) -> Result<Vec<String>> {
    let mut q = c.prepare(sql).map_err(err)?;
    let r = q
        .query_map([key], |r| r.get(0))
        .map_err(err)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(r)
}
const DETAIL_COLUMNS: &str = "coalesce(st.name,''),i.description,i.release_date,i.locks,i.revision,i.width,i.height,i.embedded_subtitles,i.selected_subtitle_id";
const DETAIL_JOINS: &str = "LEFT JOIN studios st ON st.id=i.studio_id LEFT JOIN subtitles sub ON sub.id=i.selected_subtitle_id";

fn row_details(r: &rusqlite::Row, offset: usize) -> rusqlite::Result<Details> {
    let selected: Option<String> = r.get(offset + 8)?;
    Ok(Details {
        studio: r.get(offset)?,
        description: r.get(offset + 1)?,
        release_date: r.get(offset + 2)?,
        locks: serde_json::from_str(&r.get::<_, String>(offset + 3)?).unwrap_or_default(),
        revision: r.get(offset + 4)?,
        width: r.get(offset + 5)?,
        height: r.get(offset + 6)?,
        embedded_subtitles: r.get(offset + 7)?,
        subtitle_state: if selected.is_some() { "selected" } else { "unselected" }.into(),
        ..Details::default()
    })
}

fn subtitle_state(d: &mut Details, path: Option<&str>, expected: Option<String>) {
    if let Some(path) = path {
        if !Path::new(path).is_file() {
            d.subtitle_state = "missing".into()
        } else if expected.is_some() && identity(Path::new(path)) != expected {
            d.subtitle_state = "invalid".into()
        } else {
            d.subtitle_state = "selected".into()
        }
    } else if d.embedded_subtitles.unwrap_or(0) > 0 {
        d.subtitle_state = "embedded".into()
    } else if d.embedded_subtitles.is_none() {
        d.subtitle_state = "unknown".into()
    }
}

pub fn details(c: &Connection, item_id: &str) -> Result<Details> {
    let (mut details, path, expected) = c
        .query_row(
            &format!("SELECT {DETAIL_COLUMNS},coalesce(sub.path,i.subtitle),sub.identity FROM items i {DETAIL_JOINS} WHERE i.id=?1"),
            [item_id],
            |r| Ok((row_details(r, 0)?, r.get::<_, Option<String>>(9)?, r.get(10)?)),
        )
        .map_err(err)?;
    details.performers = string_list(c, "SELECT p.name FROM performers p JOIN item_performers ip ON p.id=ip.performer_id WHERE ip.item_id=?1", item_id)?;
    subtitle_state(&mut details, path.as_deref(), expected);
    Ok(details)
}

fn row_item(r: &rusqlite::Row) -> rusqlite::Result<Item> {
    Ok(Item {
        id: r.get(0)?,
        root_id: r.get(1)?,
        path: r.get(2)?,
        title: r.get(3)?,
        code: r.get(4)?,
        media_type: r.get(5)?,
        category_id: r.get(28)?,
        size: r.get(6)?,
        duration: r.get(7)?,
        rating: r.get(8)?,
        favorite: r.get(9)?,
        subtitle: r.get(10)?,
        subtitle_confirmation: r.get(11)?,
        cover: r.get(12)?,
        available: r.get(13)?,
        removed: r.get(14)?,
        added_at: r.get(15)?,
        last_launched_at: r.get(16)?,
        note: r.get(17)?,
        tags: vec![],
        details: row_details(r, 18)?,
    })
}
const ITEM_COLUMNS: &str = "i.id,i.root_id,i.path,i.title,i.code,i.media_type,i.size,i.duration,i.rating,i.favorite,coalesce(sub.path,i.subtitle),i.subtitle_confirmation,i.cover,i.available,i.removed,i.added_at,i.last_launched_at,i.note";

fn page_relations(c: &Connection, items: &mut [Item]) -> Result<()> {
    if items.is_empty() {
        return Ok(());
    }
    let positions: HashMap<_, _> = items.iter().enumerate()
        .map(|(position, item)| (item.id.clone(), position)).collect();
    let ids = serde_json::to_string(&positions.keys().collect::<Vec<_>>()).map_err(err)?;
    let mut query = c.prepare_cached(
        "WITH page_ids AS (SELECT value FROM json_each(?1))
         SELECT 0,it.item_id,it.tag_id,it.tag_id FROM page_ids JOIN item_tags it ON it.item_id=value
         UNION ALL
         SELECT 1,ip.item_id,p.name,ip.performer_id FROM page_ids JOIN item_performers ip ON ip.item_id=value
         JOIN performers p ON p.id=ip.performer_id
         ORDER BY 1,2,4",
    ).map_err(err)?;
    let rows = query.query_map([ids], |r| Ok((r.get::<_, bool>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))).map_err(err)?;
    for row in rows {
        let (performer, item_id, value) = row.map_err(err)?;
        let item = &mut items[positions[&item_id]];
        if performer {
            item.details.performers.push(value);
        } else {
            item.tags.push(value);
        }
    }
    Ok(())
}
fn like(value: &str) -> String {
    format!(
        "%{}%",
        value
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    )
}
pub fn ensure_performance_indexes(c: &Connection) -> Result<()> {
    c.execute_batch(
        "CREATE INDEX IF NOT EXISTS library_by_activity
            ON items(removed,max(added_at,coalesce(last_launched_at,0)) DESC,id)
            WHERE merged_into IS NULL;
         CREATE INDEX IF NOT EXISTS items_by_root ON items(root_id);
         CREATE INDEX IF NOT EXISTS media_files_by_root ON media_files(root_id);
         CREATE INDEX IF NOT EXISTS subtitles_by_root ON subtitles(root_id);
         CREATE INDEX IF NOT EXISTS local_job_history_by_version ON jobs(item_id,query)
            WHERE kind='local' AND state IN('saved','failed','cancelled');",
    ).map_err(err)
}
const ACTIVE_ITEMS: &str = "i.merged_into IS NULL AND i.removed=?";
const ACTIVITY_ORDER: &str = "max(i.added_at,coalesce(i.last_launched_at,0)) DESC,i.id";
const SEARCH_RELEVANCE: &str = "CASE WHEN replace(i.code,'-','')=? THEN 0 WHEN i.title=? THEN 0 WHEN i.title LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END,";

fn add_search(
    sql: &mut String,
    values: &mut Vec<rusqlite::types::Value>,
    query: &str,
    code: &str,
) {
    sql.push_str(" AND (i.title LIKE ? ESCAPE '\\' OR replace(i.code,'-','') LIKE ? ESCAPE '\\'
      OR i.note LIKE ? ESCAPE '\\'
      OR EXISTS(SELECT 1 FROM item_tags it JOIN tags t ON t.id=it.tag_id WHERE it.item_id=i.id AND t.name LIKE ? ESCAPE '\\')
      OR EXISTS(SELECT 1 FROM item_performers ip JOIN performers p ON p.id=ip.performer_id WHERE ip.item_id=i.id AND (p.name LIKE ? ESCAPE '\\' OR p.aliases LIKE ? ESCAPE '\\'))
      OR EXISTS(SELECT 1 FROM studios s WHERE s.id=i.studio_id AND (s.name LIKE ? ESCAPE '\\' OR s.aliases LIKE ? ESCAPE '\\')))");
    let needle = like(query);
    values.extend([needle.clone().into(), like(code).into()]);
    values.extend((0..6).map(|_| needle.clone().into()));
}

fn search_code(query: &str) -> String {
    query.to_uppercase().replace(['-', '_', ' '], "")
}

fn relevance_parameters(values: &mut Vec<rusqlite::types::Value>, query: &str, code: String) {
    values.extend([
        code.into(),
        query.to_string().into(),
        format!("{}%", query.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")).into(),
    ]);
}

#[derive(Serialize)]
pub struct SearchSuggestion {
    id: String,
    title: String,
    code: String,
}

pub fn suggestions(c: &Connection, query: &str) -> Result<Vec<SearchSuggestion>> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    let code = search_code(query);
    let mut where_clause = ACTIVE_ITEMS.to_string();
    let mut values = vec![0_i64.into()];
    add_search(&mut where_clause, &mut values, query, &code);
    relevance_parameters(&mut values, query, code);
    let mut statement = c.prepare_cached(&format!(
        "SELECT i.id,i.title,i.code FROM items i WHERE {where_clause}
         ORDER BY {SEARCH_RELEVANCE}{ACTIVITY_ORDER} LIMIT 8"
    )).map_err(err)?;
    let rows = statement.query_map(rusqlite::params_from_iter(values.iter()), |row| {
        Ok(SearchSuggestion { id: row.get(0)?, title: row.get(1)?, code: row.get(2)? })
    }).map_err(err)?;
    rows.collect::<std::result::Result<Vec<_>, _>>().map_err(err)
}

pub struct LibraryPage {
    items: Vec<Item>,
    subtitle_identities: Vec<Option<String>>,
    total: i64,
}

impl LibraryPage {
    pub fn into_page(self) -> Page {
        let mut items = self.items;
        for (item, expected) in items.iter_mut().zip(self.subtitle_identities) {
            subtitle_state(&mut item.details, item.subtitle.as_deref(), expected);
        }
        Page { items, total: self.total }
    }
}

#[cfg(test)]
pub fn list(
    c: &Connection,
    query: &str,
    media_type: &str,
    removed: bool,
    offset: i64,
    limit: i64,
    f: &Filters,
) -> Result<Page> {
    Ok(read_page(c, query, media_type, removed, offset, limit, f)?.into_page())
}

pub fn read_page(
    c: &Connection,
    query: &str,
    media_type: &str,
    removed: bool,
    offset: i64,
    limit: i64,
    f: &Filters,
) -> Result<LibraryPage> {
    let code = search_code(query);
    let mut sql = ACTIVE_ITEMS.to_string();
    let mut v = vec![(removed as i64).into()];
    if !media_type.is_empty() {
        sql.push_str(" AND i.media_type=?");
        v.push(media_type.to_string().into());
    }
    if !query.is_empty() {
        add_search(&mut sql, &mut v, query, &code);
    }
    if f.favorite {
        sql.push_str(" AND i.favorite=1")
    }
    if f.unrated {
        sql.push_str(" AND i.rating IS NULL")
    }
    for (field, value) in [
        ("rating >=", f.rating_min.map(|v| v as f64)),
        ("rating <=", f.rating_max.map(|v| v as f64)),
        ("duration >=", f.duration_min.map(|v| v * 60.)),
        ("duration <=", f.duration_max.map(|v| v * 60.)),
    ] {
        if let Some(n) = value {
            sql.push_str(&format!(" AND i.{} ?", field));
            v.push(n.into())
        }
    }
    for (values, table, column, all) in [
        (&f.tags, "item_tags", "tag_id", f.all_tags),
        (
            &f.performers,
            "item_performers",
            "performer_id",
            f.all_performers,
        ),
    ] {
        if !values.is_empty() {
            let marks = vec!["?"; values.len()].join(",");
            sql.push_str(&format!(" AND (SELECT count(DISTINCT {column}) FROM {table} WHERE item_id=i.id AND {column} IN({marks})) {} ?",if all{"="}else{">="}));
            for value in values {
                v.push(value.clone().into())
            }
            v.push((if all { values.len() as i64 } else { 1 }).into())
        }
    }
    if !f.studios.is_empty() {
        sql.push_str(&format!(
            " AND i.studio_id IN({})",
            vec!["?"; f.studios.len()].join(",")
        ));
        for s in &f.studios {
            v.push(s.clone().into())
        }
    }
    match f.subtitle.as_str() {
        "external" => {
            sql.push_str(" AND (i.selected_subtitle_id IS NOT NULL OR i.subtitle IS NOT NULL)")
        }
        "embedded" => sql.push_str(" AND i.embedded_subtitles>0"),
        "none" => sql.push_str(
            " AND i.selected_subtitle_id IS NULL AND i.subtitle IS NULL AND i.embedded_subtitles=0",
        ),
        "review" => sql.push_str(" AND i.subtitle_confirmation='needs_review'"),
        "unknown" => sql.push_str(" AND i.embedded_subtitles IS NULL AND i.subtitle IS NULL"),
        _ => {}
    }
    if !f.target_id.is_empty() {
        sql.push_str(" AND i.id=?");
        v.push(f.target_id.clone().into());
    }
    if !f.category_id.is_empty() {
        sql.push_str(" AND EXISTS(SELECT 1 FROM item_categories ic WHERE ic.item_id=i.id AND ic.category_id=?)");
        v.push(f.category_id.clone().into());
    }
    let total = c
        .prepare_cached(&format!("SELECT count(*) FROM items i WHERE {}", sql))
        .map_err(err)?
        .query_row(
            rusqlite::params_from_iter(v.iter()),
            |r| r.get(0),
        )
        .map_err(err)?;
    // Static SQL fragments only; sorting happens before LIMIT/OFFSET.
    let ordering=match f.sort.as_str(){
      "added"=>"i.added_at DESC,i.id",
      "title"=>"i.title COLLATE NOCASE ASC,i.id",
      "rating"=>"i.rating IS NULL,i.rating DESC,i.added_at DESC,i.id",
      "duration"=>"i.duration IS NULL,i.duration DESC,i.added_at DESC,i.id",
      _=>ACTIVITY_ORDER
    };
    let relevance=if !query.is_empty() && (f.sort.is_empty()||f.sort=="activity"){
        relevance_parameters(&mut v, query, code);
        SEARCH_RELEVANCE
    }else{""};
    sql = format!("SELECT {ITEM_COLUMNS},{DETAIL_COLUMNS},sub.identity,(SELECT category_id FROM item_categories WHERE item_id=i.id) FROM items i {DETAIL_JOINS} WHERE {sql} ORDER BY {relevance}{ordering} LIMIT ? OFFSET ?");
    v.extend([limit.clamp(1,200).into(),offset.max(0).into()]);
    let mut q = c.prepare_cached(&sql).map_err(err)?;
    let rows = q.query_map(rusqlite::params_from_iter(v.iter()), |r| {
        Ok((row_item(r)?, r.get::<_, Option<String>>(27)?))
    }).map_err(err)?;
    let mut items = Vec::new();
    let mut subtitle_identities = Vec::new();
    for row in rows {
        let (item, expected) = row.map_err(err)?;
        items.push(item);
        subtitle_identities.push(expected);
    }
    page_relations(c, &mut items)?;
    Ok(LibraryPage { items, subtitle_identities, total })
}
pub(super) fn entity(c: &Connection, table: &str, name: &str) -> Result<Option<String>> {
    let name = name.trim();
    if name.is_empty() {
        return Ok(None);
    }
    let existing = c
        .query_row(
            &format!("SELECT id FROM {} WHERE name=?1 COLLATE NOCASE", table),
            [name],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .map_err(err)?;
    if existing.is_some() {
        return Ok(existing);
    }
    let matches = {
        let mut q=c.prepare(&format!("SELECT id FROM {} WHERE EXISTS(SELECT 1 FROM json_each(aliases) WHERE value=?1 COLLATE NOCASE)",table)).map_err(err)?;
        let rows = q
            .query_map([name], |r| r.get::<_, String>(0))
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        rows
    };
    if matches.len() > 1 {
        return Err("演员或厂商别名存在歧义，请先核查实体资料".into());
    }
    if let Some(key) = matches.first() {
        return Ok(Some(key.clone()));
    }
    let key = id();
    c.execute(
        &format!("INSERT INTO {}(id,name) VALUES(?1,?2)", table),
        params![key, name],
    )
    .map_err(err)?;
    Ok(Some(key))
}
pub fn save(c: &mut Connection, item: &Item) -> Result<()> {
    kind_ok(&item.media_type)?;
    if item.rating.is_some_and(|r| !(1..=5).contains(&r)) {
        return Err("评分无效".into());
    }
    let tx = c.transaction().map_err(err)?;
    let current = details(&tx, &item.id)?;
    if current.revision != item.details.revision {
        return Err("资料已被其他任务修改，请重新打开编辑后保存".into());
    }
    let old_title: String = tx
        .query_row("SELECT title FROM items WHERE id=?1", [&item.id], |r| {
            r.get(0)
        })
        .map_err(err)?;
    let mut locks = item.details.locks.clone();
    for (field, changed) in [
        ("title", old_title != item.title),
        ("studio", current.studio != item.details.studio),
        ("performers", current.performers != item.details.performers),
        (
            "description",
            current.description != item.details.description,
        ),
        (
            "releaseDate",
            current.release_date != item.details.release_date,
        ),
    ] {
        if changed && !locks.contains(&field.into()) {
            locks.push(field.into())
        }
    }
    let studio = entity(&tx, "studios", &item.details.studio)?;
    tx.execute("UPDATE items SET title=?1,code=?2,media_type=?3,rating=?4,favorite=?5,note=?6,studio_id=?7,description=?8,release_date=?9,locks=?10,revision=revision+1 WHERE id=?11",params![item.title,item.code,item.media_type,item.rating,item.favorite,item.note,studio,item.details.description,item.details.release_date,serde_json::to_string(&locks).map_err(err)?,item.id]).map_err(err)?;
    if let Some(category) = &item.category_id {
        categories::assign(&tx, &item.id, category)?;
    }
    tx.execute("DELETE FROM item_tags WHERE item_id=?1", [&item.id])
        .map_err(err)?;
    for tag in &item.tags {
        tx.execute(
            "INSERT OR IGNORE INTO item_tags VALUES(?1,?2)",
            params![item.id, tag],
        )
        .map_err(err)?;
    }
    tx.execute("DELETE FROM item_performers WHERE item_id=?1", [&item.id])
        .map_err(err)?;
    for performer in &item.details.performers {
        if let Some(p) = entity(&tx, "performers", performer)? {
            tx.execute(
                "INSERT OR IGNORE INTO item_performers VALUES(?1,?2)",
                params![item.id, p],
            )
            .map_err(err)?;
        }
    }
    if item.media_type == "personal" {
        tx.execute("UPDATE jobs SET state='cancelled',updated_at=?1 WHERE item_id=?2 AND state IN('queued','running','paused','review')",params![stamp(),item.id]).map_err(err)?;
    }
    tx.commit().map_err(err)?;
    Ok(())
}
#[tauri::command]
pub async fn catalog(app: tauri::AppHandle) -> Result<serde_json::Value> {
    tauri::async_runtime::spawn_blocking(move || read_catalog(&*db(&app.state::<AppState>())?))
        .await
        .map_err(err)?
}

fn read_catalog(c: &Connection) -> Result<serde_json::Value> {
    let mut output = serde_json::Map::new();
    for table in ["performers", "studios", "tag_groups", "saved_filters", "categories"] {
        let sql = if table == "categories" {
            "SELECT c.id,c.name,
                (SELECT COUNT(*) FROM item_categories a WHERE a.category_id=c.id),
                (SELECT COUNT(*) FROM root_categories r WHERE r.category_id=c.id)
             FROM categories c ORDER BY c.name".to_string()
        } else {
            format!("SELECT * FROM {} ORDER BY name", table)
        };
        let mut q = c.prepare_cached(&sql).map_err(err)?;
        let rows = q
            .query_map([], |r| {
                let mut v =
                    serde_json::json!({"id":r.get::<_,String>(0)?,"name":r.get::<_,String>(1)?});
                if table == "saved_filters" {
                    v["value"] = serde_json::from_str(&r.get::<_, String>(2)?).unwrap_or_default();
                } else if matches!(table, "performers" | "studios") {
                    v["aliases"] =
                        serde_json::from_str(&r.get::<_, String>(2)?).unwrap_or_default();
                } else if table == "categories" {
                    v["itemCount"] = serde_json::json!(r.get::<_, i64>(2)?);
                    v["rootCount"] = serde_json::json!(r.get::<_, i64>(3)?);
                }
                Ok(v)
            })
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        output.insert(table.into(), serde_json::json!(rows));
    }
    Ok(output.into())
}
#[tauri::command]
pub fn save_entity(
    table: String,
    key: String,
    name: String,
    aliases: Vec<String>,
    s: State<AppState>,
) -> Result<()> {
    if !["performers", "studios", "tag_groups"].contains(&table.as_str()) || name.trim().is_empty()
    {
        return Err("无效实体".into());
    }
    let c = db(&s)?;
    if table == "tag_groups" {
        c.execute("INSERT INTO tag_groups(id,name) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET name=excluded.name",params![key,name.trim()]).map_err(err)?;
    } else {
        c.execute(&format!("INSERT INTO {table}(id,name,aliases) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET name=excluded.name,aliases=excluded.aliases"),params![key,name.trim(),serde_json::to_string(&aliases).map_err(err)?]).map_err(err)?;
    }
    Ok(())
}
#[tauri::command]
pub fn merge_entity(
    table: String,
    source: String,
    target: String,
    s: State<AppState>,
) -> Result<()> {
    if source == target || !["tags", "performers", "studios"].contains(&table.as_str()) {
        return Err("无效合并".into());
    }
    let mut c = db(&s)?;
    export_backup(
        &c,
        &s.data,
        &s.data.join(format!("before-merge-{}", stamp())),
    )?;
    let tx = c.transaction().map_err(err)?;
    let target_exists: bool = tx
        .query_row(
            &format!("SELECT EXISTS(SELECT 1 FROM {} WHERE id=?1)", table),
            [&target],
            |r| r.get(0),
        )
        .map_err(err)?;
    if !target_exists {
        return Err("目标不存在".into());
    }
    match table.as_str() {
        "tags" => {
            tx.execute(
                "INSERT OR IGNORE INTO item_tags SELECT item_id,?1 FROM item_tags WHERE tag_id=?2",
                params![target, source],
            )
            .map_err(err)?;
            tx.execute("DELETE FROM item_tags WHERE tag_id=?1", [&source])
                .map_err(err)?;
            tx.execute(
                "INSERT INTO tag_meta(tag_id,pinned) SELECT ?1,1 FROM tag_meta WHERE tag_id=?2 AND pinned=1
                 ON CONFLICT(tag_id) DO UPDATE SET pinned=1",
                params![target,source],
            ).map_err(err)?;
            tx.execute("DELETE FROM tag_meta WHERE tag_id=?1", [&source])
                .map_err(err)?;
        }
        "performers" => {
            tx.execute("INSERT OR IGNORE INTO item_performers SELECT item_id,?1 FROM item_performers WHERE performer_id=?2",params![target,source]).map_err(err)?;
            tx.execute(
                "DELETE FROM item_performers WHERE performer_id=?1",
                [&source],
            )
            .map_err(err)?;
        }
        _ => {
            tx.execute(
                "UPDATE items SET studio_id=?1 WHERE studio_id=?2",
                params![target, source],
            )
            .map_err(err)?;
        }
    }
    if table != "tags" {
        let (name, aliases): (String, String) = tx
            .query_row(
                &format!("SELECT name,aliases FROM {} WHERE id=?1", table),
                [&source],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(err)?;
        let existing: String = tx
            .query_row(
                &format!("SELECT aliases FROM {} WHERE id=?1", table),
                [&target],
                |r| r.get(0),
            )
            .map_err(err)?;
        let mut combined: Vec<String> = serde_json::from_str(&existing).unwrap_or_default();
        combined.push(name);
        combined.extend(serde_json::from_str::<Vec<String>>(&aliases).unwrap_or_default());
        combined.sort();
        combined.dedup();
        tx.execute(
            &format!("UPDATE {} SET aliases=?1 WHERE id=?2", table),
            params![serde_json::to_string(&combined).map_err(err)?, target],
        )
        .map_err(err)?;
    }
    tx.execute(&format!("DELETE FROM {} WHERE id=?1", table), [source])
        .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(())
}
#[tauri::command]
pub fn save_filter(key: String, name: String, value: Filters, s: State<AppState>) -> Result<()> {
    if name.trim().is_empty() {
        return Err("名称不能为空".into());
    }
    db(&s)?.execute("INSERT INTO saved_filters VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET name=excluded.name,value=excluded.value",params![key,name,serde_json::to_string(&value).map_err(err)?]).map_err(err)?;
    Ok(())
}
#[tauri::command]
pub fn delete_filter(key: String, s: State<AppState>) -> Result<()> {
    db(&s)?
        .execute("DELETE FROM saved_filters WHERE id=?1", [key])
        .map_err(err)?;
    Ok(())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Batch {
    pub ids: Vec<String>,
    pub add_tags: Vec<String>,
    pub remove_tags: Vec<String>,
    pub media_type: Option<String>,
    pub category_id: Option<String>,
    pub favorite: Option<bool>,
}
#[tauri::command]
pub fn batch_edit(change: Batch, s: State<AppState>) -> Result<()> {
    if let Some(t) = &change.media_type {
        kind_ok(t)?;
    }
    let mut c = db(&s)?;
    let tx = c.transaction().map_err(err)?;
    for item in change.ids {
        for tag in &change.add_tags {
            tx.execute(
                "INSERT OR IGNORE INTO item_tags VALUES(?1,?2)",
                params![item, tag],
            )
            .map_err(err)?;
        }
        for tag in &change.remove_tags {
            tx.execute(
                "DELETE FROM item_tags WHERE item_id=?1 AND tag_id=?2",
                params![item, tag],
            )
            .map_err(err)?;
        }
        tx.execute("UPDATE items SET media_type=coalesce(?1,media_type),favorite=coalesce(?2,favorite),revision=revision+1 WHERE id=?3",params![change.media_type,change.favorite,item]).map_err(err)?;
        if let Some(category) = &change.category_id {
            categories::assign(&tx, &item, category)?;
        }
        if change.media_type.as_deref() == Some("personal") {
            tx.execute("UPDATE jobs SET state='cancelled' WHERE item_id=?1 AND state IN('queued','running','paused','review')",[&item]).map_err(err)?;
        }
    }
    tx.commit().map_err(err)?;
    Ok(())
}
#[tauri::command]
pub fn set_tag_group(tag_id: String, group_id: Option<String>, s: State<AppState>) -> Result<()> {
    assign_tag_group(&*db(&s)?, &tag_id, group_id.as_deref())
}

pub fn assign_tag_group(c: &Connection, tag: &str, group: Option<&str>) -> Result<()> {
    c.execute("INSERT INTO tag_meta(tag_id,group_id) VALUES(?1,?2) ON CONFLICT(tag_id) DO UPDATE SET group_id=excluded.group_id",params![tag,group]).map_err(err)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Connection {
        let c = initialize(Path::new(":memory:")).unwrap();
        c.execute("INSERT INTO roots VALUES('r','x','personal',1)", [])
            .unwrap();
        for n in 0..150 {
            c.execute("INSERT INTO items(id,root_id,path,title,media_type,size,added_at,rating,duration) VALUES(?1,'r',?2,?3,'personal',100,?4,?5,?6)",params![format!("i{n}"),format!("x{n}.mp4"),format!("片段 {n}"),n,n%5+1,n as f64*60.]).unwrap();
        }
        c
    }
    #[test]
    fn sort_is_global_stable_and_unknown_values_are_safe(){
      let c=fixture();c.execute("UPDATE items SET last_launched_at=9999 WHERE id='i1'",[]).unwrap();
      let first=|sort:&str,offset:i64|list(&c,"","",false,offset,1,&Filters{sort:sort.into(),..Default::default()}).unwrap().items.remove(0);
      assert_eq!(first("activity",0).id,"i1");assert_eq!(first("added",0).id,"i149");
      assert_eq!(first("duration",0).id,"i149");assert_eq!(first("duration",1).id,"i148");
      assert_eq!(first("title",0).id,"i0");assert_eq!(first("rating",0).rating,Some(5));
      assert_eq!(first("title; DROP TABLE items",0).id,"i1");
      c.execute("UPDATE items SET rating=NULL,duration=NULL WHERE id='i149'",[]).unwrap();
      assert_eq!(first("duration",0).id,"i148");
      assert_eq!(list(&c,"","",false,149,1,&Filters{sort:"rating".into(),..Default::default()}).unwrap().items[0].id,"i149");
    }
    #[test]
    fn global_filters_before_pagination() {
        let c = fixture();
        c.execute("UPDATE items SET favorite=1 WHERE id='i1'", [])
            .unwrap();
        let p = list(
            &c,
            "",
            "",
            false,
            0,
            60,
            &Filters {
                favorite: true,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(p.total, 1);
        assert_eq!(p.items[0].id, "i1");
        let p = list(
            &c,
            "",
            "",
            false,
            0,
            60,
            &Filters {
                duration_min: Some(140.),
                duration_max: Some(145.),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(p.total, 6);
    }
    #[test]
    fn manual_clear_stays_locked_and_stale_editor_rejected() {
        let mut c = fixture();
        let mut item = list(
            &c,
            "",
            "",
            false,
            0,
            1,
            &Filters {
                target_id: "i1".into(),
                ..Default::default()
            },
        )
        .unwrap()
        .items
        .remove(0);
        item.title.clear();
        save(&mut c, &item).unwrap();
        let updated = details(&c, "i1").unwrap();
        assert!(updated.locks.contains(&"title".into()));
        assert!(save(&mut c, &item).is_err());
    }
    #[test]
    fn tag_all_and_any_have_distinct_semantics() {
        let c = fixture();
        c.execute_batch("INSERT INTO tags VALUES('a','A');INSERT INTO tags VALUES('b','B');INSERT INTO item_tags VALUES('i1','a');INSERT INTO item_tags VALUES('i1','b');INSERT INTO item_tags VALUES('i2','a');").unwrap();
        let f = Filters {
            tags: vec!["a".into(), "b".into()],
            ..Default::default()
        };
        assert_eq!(list(&c, "", "", false, 0, 60, &f).unwrap().total, 2);
        assert_eq!(
            list(
                &c,
                "",
                "",
                false,
                0,
                60,
                &Filters {
                    all_tags: true,
                    ..f
                }
            )
            .unwrap()
            .total,
            1
        );
    }
}

#[tauri::command]
pub fn delete_entity(table: String, key: String, s: State<AppState>) -> Result<()> {
    if !["tag_groups", "performers", "studios"].contains(&table.as_str()) {
        return Err("无效实体".into());
    }
    let mut c = db(&s)?;
    export_backup(
        &c,
        &s.data,
        &s.data.join(format!("before-delete-{}", stamp())),
    )?;
    let tx = c.transaction().map_err(err)?;
    match table.as_str() {
        "tag_groups" => {
            tx.execute(
                "UPDATE tag_meta SET group_id=NULL WHERE group_id=?1",
                [&key],
            )
            .map_err(err)?;
        }
        "performers" => {
            tx.execute("DELETE FROM item_performers WHERE performer_id=?1", [&key])
                .map_err(err)?;
        }
        _ => {
            tx.execute(
                "UPDATE items SET studio_id=NULL,revision=revision+1 WHERE studio_id=?1",
                [&key],
            )
            .map_err(err)?;
        }
    }
    tx.execute(&format!("DELETE FROM {} WHERE id=?1", table), [key])
        .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(())
}

fn migrate3(c: &mut Connection) -> Result<()> {
    let current: i64 = c
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(err)?;
    if current >= 3 {
        return Ok(());
    }
    let schema: String = c
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='items'",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;
    let revised = schema
        .replacen("CREATE TABLE items", "CREATE TABLE items_v3", 1)
        .replace("path TEXT NOT NULL UNIQUE", "path TEXT NOT NULL");
    if !revised.contains("CREATE TABLE items_v3") {
        return Err("无法识别数据库表结构，迁移已停止".into());
    }
    c.pragma_update(None, "foreign_keys", false).map_err(err)?;
    let result = (|| {
        let tx = c.transaction().map_err(err)?;
        tx.execute_batch(&revised).map_err(err)?;
        tx.execute_batch("INSERT INTO items_v3 SELECT * FROM items;DROP TABLE items;ALTER TABLE items_v3 RENAME TO items;CREATE INDEX item_identity ON items(identity);CREATE INDEX item_code ON items(code);").map_err(err)?;
        let fields = {
            let mut q = tx
                .prepare("PRAGMA table_info(field_sources)")
                .map_err(err)?;
            let rows = q
                .query_map([], |r| r.get::<_, String>(1))
                .map_err(err)?
                .collect::<std::result::Result<Vec<_>, _>>()
                .map_err(err)?;
            rows
        };
        if !fields.iter().any(|v| v == "source_id") {
            tx.execute_batch(
                "ALTER TABLE field_sources ADD COLUMN source_id TEXT NOT NULL DEFAULT '';",
            )
            .map_err(err)?;
        }
        tx.execute_batch("CREATE TABLE IF NOT EXISTS cover_assets(path TEXT PRIMARY KEY,item_id TEXT,source_type TEXT NOT NULL,capture_seconds REAL,source_identity TEXT,manual INTEGER NOT NULL DEFAULT 0);CREATE TABLE IF NOT EXISTS file_origins(file_id TEXT PRIMARY KEY,original_item_id TEXT NOT NULL);PRAGMA user_version=3;").map_err(err)?;
        let bad = {
            let mut check = tx.prepare("PRAGMA foreign_key_check").map_err(err)?;
            let mut rows = check.query([]).map_err(err)?;
            rows.next().map_err(err)?.is_some()
        };
        if bad {
            return Err("迁移后外键校验失败，已回滚".into());
        }
        tx.commit().map_err(err)?;
        Ok(())
    })();
    c.pragma_update(None, "foreign_keys", true).map_err(err)?;
    result
}

#[tauri::command]
pub fn selected_items(ids: Vec<String>, offset:i64, s:State<AppState>) -> Result<serde_json::Value> {
    selected_page(&*db(&s)?, &ids, offset)
}
pub(super) fn selected_page(c:&Connection, ids:&[String], offset:i64) -> Result<serde_json::Value> {
    let json=serde_json::to_string(ids).map_err(err)?;
    let total:i64=c.query_row("SELECT count(*) FROM items WHERE merged_into IS NULL AND id IN(SELECT value FROM json_each(?1))",[&json],|r|r.get(0)).map_err(err)?;
    let mut q=c.prepare("SELECT id,title,removed,available FROM items WHERE merged_into IS NULL AND id IN(SELECT value FROM json_each(?1)) ORDER BY title COLLATE NOCASE,id LIMIT 50 OFFSET ?2").map_err(err)?;
    let rows=q.query_map(params![json,offset.max(0)],|r|Ok(serde_json::json!({"id":r.get::<_,String>(0)?,"title":r.get::<_,String>(1)?,"removed":r.get::<_,bool>(2)?,"available":r.get::<_,bool>(3)?}))).map_err(err)?.collect::<std::result::Result<Vec<_>,_>>().map_err(err)?;
    Ok(serde_json::json!({"items":rows,"total":total}))
}
