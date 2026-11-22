use super::*;

pub const SCHEMA_VERSION: i64 = 4;

pub fn migrate(c: &mut Connection, version: i64) -> Result<()> {
    if version >= SCHEMA_VERSION {
        return Ok(());
    }
    let tx = c.transaction().map_err(err)?;
    tx.execute_batch(
        "CREATE TABLE categories(id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE);
         CREATE TABLE root_categories(root_id TEXT PRIMARY KEY REFERENCES roots(id), category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE);
         CREATE TABLE item_categories(item_id TEXT PRIMARY KEY REFERENCES items(id), category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE);
         CREATE INDEX items_by_category ON item_categories(category_id);
         ALTER TABLE tag_meta ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;",
    ).map_err(err)?;
    if version > 0 {
        tx.execute_batch(
            "WITH legacy(id,name) AS (VALUES ('jav','日本影片'),('western','欧美影片'),('personal','个人片段'))
             INSERT INTO categories SELECT id,name FROM legacy WHERE EXISTS (
               SELECT 1 FROM roots r LEFT JOIN root_meta m ON m.root_id=r.id
               WHERE r.media_type=legacy.id AND coalesce(m.kind,'video')='video'
             ) OR EXISTS (SELECT 1 FROM items WHERE media_type=legacy.id);
             INSERT INTO root_categories SELECT r.id,r.media_type FROM roots r
               JOIN categories c ON c.id=r.media_type LEFT JOIN root_meta m ON m.root_id=r.id
               WHERE coalesce(m.kind,'video')='video';
             INSERT INTO item_categories SELECT i.id,i.media_type FROM items i JOIN categories c ON c.id=i.media_type;",
        ).map_err(err)?;
    }
    tx.pragma_update(None, "user_version", SCHEMA_VERSION).map_err(err)?;
    tx.commit().map_err(err)
}

pub fn save(c: &Connection, key: &str, name: &str) -> Result<()> {
    let name = name.trim();
    if key.is_empty() || name.is_empty() || name.chars().count() > 80 {
        return Err("分类名称须为 1 到 80 个字符".into());
    }
    if c.query_row(
        "SELECT EXISTS(SELECT 1 FROM categories WHERE name=?1 AND id!=?2)",
        params![name, key],
        |r| r.get::<_, bool>(0),
    ).map_err(err)? {
        return Err("已有同名分类".into());
    }
    c.execute(
        "INSERT INTO categories(id,name) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET name=excluded.name",
        params![key, name],
    ).map_err(err)?;
    Ok(())
}

pub fn assign(c: &Connection, item: &str, category: &str) -> Result<()> {
    if category.is_empty() {
        c.execute("DELETE FROM item_categories WHERE item_id=?1", [item]).map_err(err)?;
    } else {
        c.execute(
            "INSERT INTO item_categories(item_id,category_id) VALUES(?1,?2)
             ON CONFLICT(item_id) DO UPDATE SET category_id=excluded.category_id",
            params![item, category],
        ).map_err(err)?;
    }
    Ok(())
}

#[tauri::command]
pub fn save_category(key: String, name: String, s: State<AppState>) -> Result<()> {
    save(&*db(&s)?, &key, &name)
}

#[tauri::command]
pub fn delete_category(key: String, s: State<AppState>) -> Result<()> {
    let mut c = db(&s)?;
    let tx = c.transaction().map_err(err)?;
    tx.execute(
        "UPDATE items SET revision=revision+1 WHERE id IN(SELECT item_id FROM item_categories WHERE category_id=?1)",
        [&key],
    ).map_err(err)?;
    tx.execute("DELETE FROM categories WHERE id=?1", [&key]).map_err(err)?;
    tx.commit().map_err(err)
}

#[tauri::command]
pub fn set_root_category(root_id: String, category_id: Option<String>, s: State<AppState>) -> Result<()> {
    let c = db(&s)?;
    if let Some(category) = category_id {
        let updated = c.execute(
            "INSERT INTO root_categories(root_id,category_id)
             SELECT r.id,?2 FROM roots r LEFT JOIN root_meta m ON m.root_id=r.id
             WHERE r.id=?1 AND coalesce(m.kind,'video')='video'
             ON CONFLICT(root_id) DO UPDATE SET category_id=excluded.category_id",
            params![root_id, category],
        ).map_err(err)?;
        if updated == 0 {
            return Err("影片目录已不存在".into());
        }
    } else {
        c.execute("DELETE FROM root_categories WHERE root_id=?1", [&root_id]).map_err(err)?;
    }
    Ok(())
}
