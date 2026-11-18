use super::*;
pub(super) fn fixture() -> (PathBuf, AppState, String) {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join(".qa")
        .join(format!("integration-{}", id()));
    let data = dir.join("app-data");
    let video = dir.join("媒体 & 目录");
    fs::create_dir_all(data.join("covers")).unwrap();
    fs::create_dir_all(&video).unwrap();
    let c = initialize(&data.join("library.db")).unwrap();
    c.execute(
        "INSERT INTO roots VALUES('root',?1,'jav',1)",
        [video.to_string_lossy()],
    )
    .unwrap();
    c.execute("INSERT INTO root_meta(root_id) VALUES('root')", [])
        .unwrap();
    (
        dir,
        AppState {
            db: Mutex::new(c),
            data,
            cancel: AtomicBool::new(false),
            scanning: AtomicBool::new(false),
            shutdown: AtomicBool::new(false),
            decoder: Mutex::new(()),
            tool_job: media::create_tool_job().unwrap(),
        },
        video.to_string_lossy().into_owned(),
    )
}
fn first(s: &AppState) -> Item {
    catalog::list(&*db(s).unwrap(), "", "", false, 0, 1, &Default::default())
        .unwrap()
        .items
        .remove(0)
}
#[test]
fn complete_local_file_lifecycle() {
    let (dir, s, folder) = fixture();
    let video = Path::new(&folder).join("www.site@JUFE-626_restored.mp4");
    let sub = Path::new(&folder).join("JUFE-626.srt");
    fs::write(&video, b"fixture").unwrap();
    fs::write(&sub, b"subtitle").unwrap();
    assert_eq!(scanner::scan_root(&s, "root").unwrap(), 1);
    let mut item = first(&s);
    assert_eq!(item.code, "JUFE-626");
    assert_eq!(item.subtitle_confirmation, "auto_matched");
    scanner::bind(&mut *db(&s).unwrap(), &item.id, &sub.to_string_lossy()).unwrap();
    let moved_sub = Path::new(&folder).join("人工 选择.ass");
    fs::rename(sub, &moved_sub).unwrap();
    scanner::scan_root(&s, "root").unwrap();
    item = first(&s);
    assert_eq!(
        fs::canonicalize(item.subtitle.as_ref().unwrap()).unwrap(),
        fs::canonicalize(&moved_sub).unwrap()
    );
    item.rating = Some(5);
    item.details.performers = vec!["Test Actor".into()];
    catalog::save(&mut *db(&s).unwrap(), &item).unwrap();
    rename_impl(&item.id, "中文 & new name", &s).unwrap();
    item = first(&s);
    assert!(item.path.ends_with("中文 & new name.mp4"));
    assert_eq!(item.rating, Some(5));
    assert!(rename_impl(&item.id, "CON", &s).is_err());
    let externally_moved = Path::new(&folder).join("outside.mp4");
    fs::rename(&item.path, &externally_moved).unwrap();
    scanner::scan_root(&s, "root").unwrap();
    assert_eq!(first(&s).id, item.id);
    rename_impl(&item.id, "OUTSIDE", &s).unwrap();
    assert!(first(&s).path.ends_with("OUTSIDE.mp4"));
    rename_impl(&item.id, "outside", &s).unwrap();
    assert!(first(&s).path.ends_with("outside.mp4"));
    db(&s)
        .unwrap()
        .execute("UPDATE items SET removed=1", [])
        .unwrap();
    scanner::scan_root(&s, "root").unwrap();
    assert_eq!(
        catalog::list(&*db(&s).unwrap(), "", "", false, 0, 60, &Default::default())
            .unwrap()
            .total,
        0
    );
    drop(s);
    fs::remove_dir_all(dir).unwrap();
}
#[test]
fn offline_scan_preserves_personal_data() {
    let (dir, s, folder) = fixture();
    fs::write(Path::new(&folder).join("A.mp4"), b"fixture").unwrap();
    scanner::scan_root(&s, "root").unwrap();
    let item = first(&s);
    fs::rename(&folder, dir.join("offline")).unwrap();
    assert!(scanner::scan_root(&s, "root").is_err());
    assert_eq!(first(&s).id, item.id);
    assert_eq!(first(&s).title, item.title);
    drop(s);
    fs::remove_dir_all(dir).unwrap();
}
#[test]
fn backup_restore_rejects_tampering_before_replacing_data() {
    let (dir, s, folder) = fixture();
    fs::write(Path::new(&folder).join("a.mp4"), b"x").unwrap();
    scanner::scan_root(&s, "root").unwrap();
    let dest = dir.join("backup");
    export_backup(&*db(&s).unwrap(), &s.data, &dest).unwrap();
    db(&s)
        .unwrap()
        .execute("UPDATE items SET note='after backup'", [])
        .unwrap();
    restore_impl(dest.to_str().unwrap(), &s).unwrap();
    assert_eq!(first(&s).note, "");
    fs::write(dest.join("library.db"), b"tampered").unwrap();
    assert!(restore_impl(dest.to_str().unwrap(), &s).is_err());
    assert_eq!(first(&s).note, "");
    drop(s);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn restore_conflict_leaves_database_and_other_assets_untouched() {
    let (dir, s, folder) = fixture();
    fs::write(Path::new(&folder).join("sample.mp4"), b"video").unwrap();
    scanner::scan_root(&s, "root").unwrap();
    let covers = s.data.join("covers");
    fs::write(covers.join("missing.jpg"), b"from backup").unwrap();
    fs::write(covers.join("conflict.jpg"), b"original backup cover").unwrap();
    let dest = dir.join("backup");
    export_backup(&*db(&s).unwrap(), &s.data, &dest).unwrap();
    let manifest_path = dest.join("manifest.json");
    let mut manifest: serde_json::Value = serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
    manifest["covers"].as_array_mut().unwrap().sort_by_key(|entry| entry["name"] != "missing.jpg");
    fs::write(manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    fs::remove_file(covers.join("missing.jpg")).unwrap();
    fs::write(covers.join("conflict.jpg"), b"current cover").unwrap();
    db(&s).unwrap().execute("UPDATE items SET note='current note'", []).unwrap();
    let error = restore_impl(dest.to_str().unwrap(), &s).unwrap_err();
    assert!(error.contains("资源名称冲突"));
    assert_eq!(first(&s).note, "current note");
    assert_eq!(fs::read(covers.join("conflict.jpg")).unwrap(), b"current cover");
    assert!(!covers.join("missing.jpg").exists());
    assert!(fs::read_dir(&s.data).unwrap().all(|entry| !entry.unwrap().file_name().to_string_lossy().starts_with("restore-")));
    drop(s);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn subtitle_index_keeps_exact_local_and_ambiguous_priorities() {
    let (dir, s, folder) = fixture();
    let folder = Path::new(&folder);
    let alternate = folder.join("字幕");
    fs::create_dir(&alternate).unwrap();
    fs::write(folder.join("TEST-123 cut.mp4"), b"video").unwrap();
    fs::write(folder.join("TEST-123.zh.srt"), b"local code match").unwrap();
    let remote = alternate.join("TEST-123 cut.srt");
    fs::write(&remote, b"remote exact match").unwrap();
    scanner::scan_root(&s, "root").unwrap();
    assert_eq!(fs::canonicalize(first(&s).subtitle.unwrap()).unwrap(), fs::canonicalize(&remote).unwrap());

    let local = folder.join("TEST-123 cut.srt");
    fs::write(&local, b"local exact match").unwrap();
    scanner::scan_root(&s, "root").unwrap();
    assert_eq!(fs::canonicalize(first(&s).subtitle.unwrap()).unwrap(), fs::canonicalize(local).unwrap());

    fs::write(folder.join("TEST-123 cut.ass"), b"second local exact match").unwrap();
    scanner::scan_root(&s, "root").unwrap();
    let item = first(&s);
    assert_eq!(item.subtitle_confirmation, "needs_review");
    scanner::bind(&mut *db(&s).unwrap(), &item.id, remote.to_str().unwrap()).unwrap();
    scanner::scan_root(&s, "root").unwrap();
    let item = first(&s);
    assert_eq!(item.subtitle_confirmation, "manual_confirmed");
    assert_eq!(fs::canonicalize(item.subtitle.unwrap()).unwrap(), fs::canonicalize(remote).unwrap());
    drop(s);
    fs::remove_dir_all(dir).unwrap();
}
#[test]
fn stale_cancelled_and_personal_metadata_cannot_commit() {
    let (dir, s, folder) = fixture();
    fs::write(Path::new(&folder).join("a.mp4"), b"x").unwrap();
    scanner::scan_root(&s, "root").unwrap();
    let item = first(&s);
    let mut c = db(&s).unwrap();
    c.execute("INSERT INTO jobs(id,item_id,kind,state,revision,created_at,updated_at) VALUES('j',?1,'metadata','review',0,1,1)",[&item.id]).unwrap();
    let p = metadata::Proposal {
        title: "New title".into(),
        ..Default::default()
    };
    c.execute("UPDATE items SET revision=1", []).unwrap();
    assert!(metadata::commit(&mut c, "j", &p).is_err());
    c.execute("UPDATE jobs SET revision=1,state='cancelled'", [])
        .unwrap();
    assert!(metadata::commit(&mut c, "j", &p).is_err());
    c.execute("UPDATE jobs SET state='running'", []).unwrap();
    c.execute("UPDATE items SET media_type='personal'", [])
        .unwrap();
    assert!(metadata::ensure_job(&c, "j").is_err());
    drop(c);
    drop(s);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
#[ignore = "performance baseline; run explicitly"]
fn library_scale_baseline() {
    let mut rows = vec![];
    for (count, with_subtitles) in [(100usize, false), (1000, false), (5000, false), (1000, true)] {
        let (dir, s, folder) = fixture();
        for n in 0..count {
            fs::write(Path::new(&folder).join(format!("TEST-{:06}.mp4", n)), [0]).unwrap();
            if with_subtitles {
                fs::write(Path::new(&folder).join(format!("TEST-{:06}.zh.srt", n)), [0]).unwrap();
            }
        }
        let start = std::time::Instant::now();
        scanner::scan_root(&s, "root").unwrap();
        let scan_ms = start.elapsed().as_secs_f64() * 1000.;
        let mut timings = vec![];
        for _ in 0..12 {
            let start = std::time::Instant::now();
            let result = catalog::list(
                &*db(&s).unwrap(),
                "test",
                "",
                false,
                0,
                60,
                &Default::default(),
            )
            .unwrap();
            assert_eq!(result.total, count as i64);
            if with_subtitles {
                assert!(result.items.iter().all(|item| item.subtitle_confirmation == "auto_matched"));
            }
            timings.push(start.elapsed().as_secs_f64() * 1000.)
        }
        timings.sort_by(f64::total_cmp);
        rows.push(serde_json::json!({"items":count,"subtitles":if with_subtitles {count} else {0},"scanMs":scan_ms,"queryP50Ms":timings[6],"queryP95Ms":timings[11],"returnedItems":60.min(count)}));
        drop(s);
        fs::remove_dir_all(dir).unwrap();
    }
    let target = std::env::var_os("AVLIBRARY_BENCHMARK_REPORT").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("docs/PERFORMANCE_BASELINE.json"));
    fs::write(target,serde_json::to_string_pretty(&serde_json::json!({"scope":"filesystem enumeration, subtitle matching and SQLite query; synthetic one-byte fixtures, no decoding or UI FPS","sqliteVersion":rusqlite::version(),"scenarios":rows})).unwrap()).unwrap();
}

#[test]
fn provider_priority_and_manual_locks_win() {
    let (dir, s, folder) = fixture();
    fs::write(Path::new(&folder).join("a.mp4"), b"x").unwrap();
    scanner::scan_root(&s, "root").unwrap();
    let item = first(&s);
    let mut c = db(&s).unwrap();
    let mut settings = Settings::default();
    settings
        .priorities
        .insert("title".into(), vec!["high".into(), "low".into()]);
    c.execute(
        "INSERT INTO settings VALUES(1,?1)",
        [serde_json::to_string(&settings).unwrap()],
    )
    .unwrap();
    c.execute("INSERT INTO jobs(id,item_id,kind,state,provider,revision,created_at,updated_at) VALUES('high',?1,'metadata','review','high',0,1,1)",[&item.id]).unwrap();
    metadata::commit(
        &mut c,
        "high",
        &metadata::Proposal {
            title: "High priority title".into(),
            source_url: "https://example.com/high".into(),
            ..Default::default()
        },
    )
    .unwrap();
    c.execute("INSERT INTO jobs(id,item_id,kind,state,provider,revision,created_at,updated_at) VALUES('low',?1,'metadata','review','low',1,2,2)",[&item.id]).unwrap();
    metadata::commit(
        &mut c,
        "low",
        &metadata::Proposal {
            title: "Low priority title".into(),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        c.query_row("SELECT title FROM items WHERE id=?1", [&item.id], |r| {
            r.get::<_, String>(0)
        })
        .unwrap(),
        "High priority title"
    );
    drop(c);
    drop(s);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn duplicate_main_selection_can_be_undone_without_deleting_files() {
    let (dir, s, folder) = fixture();
    for name in ["JUFE-626-a.mp4", "JUFE-626-b.mp4"] {
        fs::write(Path::new(&folder).join(name), b"fixture").unwrap();
    }
    scanner::scan_root(&s, "root").unwrap();
    let items = catalog::list(&*db(&s).unwrap(), "", "", false, 0, 60, &Default::default())
        .unwrap()
        .items;
    let a = &items[0];
    let b = &items[1];
    let c = db(&s).unwrap();
    c.execute("UPDATE items SET rating=5 WHERE id=?1", [&a.id])
        .unwrap();
    c.execute("UPDATE items SET rating=4 WHERE id=?1", [&b.id])
        .unwrap();
    let file_a: String = c
        .query_row(
            "SELECT id FROM media_files WHERE item_id=?1",
            [&a.id],
            |r| r.get(0),
        )
        .unwrap();
    let file_b: String = c
        .query_row(
            "SELECT id FROM media_files WHERE item_id=?1",
            [&b.id],
            |r| r.get(0),
        )
        .unwrap();
    drop(c);
    scanner::primary_impl(&s, &a.id, &file_b).unwrap();
    assert_eq!(
        catalog::list(&*db(&s).unwrap(), "", "", false, 0, 60, &Default::default())
            .unwrap()
            .total,
        1
    );
    assert_eq!(first(&s).id, a.id);
    assert_eq!(first(&s).rating, Some(5));
    scanner::primary_impl(&s, &a.id, &file_a).unwrap();
    scanner::separate_impl(&s, &file_b).unwrap();
    let result =
        catalog::list(&*db(&s).unwrap(), "", "", false, 0, 60, &Default::default()).unwrap();
    assert_eq!(result.total, 2);
    assert_eq!(
        result.items.iter().find(|i| i.id == b.id).unwrap().rating,
        Some(4)
    );
    assert!(Path::new(&a.path).exists() && Path::new(&b.path).exists());
    drop(s);
    fs::remove_dir_all(dir).unwrap();
}
#[test]
fn migration_keeps_legacy_tag_links() {
    let dir = std::env::temp_dir().join(format!("avlib-migrate-{}", id()));
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("library.db");
    {
        let c = Connection::open(&path).unwrap();
        let re = regex::Regex::new(r#"(?s)c\.execute_batch\("(.*?)"\)"#).unwrap();
        let source = include_str!("main.rs");
        let schema = re.captures(source).unwrap()[1].to_string();
        c.execute_batch(&schema).unwrap();
        c.execute_batch("PRAGMA user_version=1;INSERT INTO roots VALUES('r','x','jav',1);INSERT INTO items(id,root_id,path,title,media_type,size,added_at,rating) VALUES('i','r','x.mp4','old','jav',1,1,5);INSERT INTO tags VALUES('t','legacy');INSERT INTO item_tags VALUES('i','t');").unwrap();
    }
    let c = initialize(&path).unwrap();
    assert_eq!(
        c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        3
    );
    assert_eq!(
        c.query_row(
            "SELECT count(*) FROM item_tags WHERE item_id='i' AND tag_id='t'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    assert_eq!(
        c.query_row("SELECT rating FROM items WHERE id='i'", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        5
    );
    drop(c);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn native_picker_and_scanner_path_alias_share_subtitle_identity() {
    let (dir, s, folder) = fixture();
    let video = Path::new(&folder).join("JUFE-626.mp4");
    let sub = Path::new(&folder).join("JUFE-626.srt");
    fs::write(&video, b"fixture").unwrap();
    fs::write(&sub, b"subtitle").unwrap();
    db(&s)
        .unwrap()
        .execute(
            "UPDATE roots SET path=?1 WHERE id='root'",
            [fs::canonicalize(&folder).unwrap().to_string_lossy()],
        )
        .unwrap();
    scanner::scan_root(&s, "root").unwrap();
    let item = first(&s);
    scanner::bind(&mut *db(&s).unwrap(), &item.id, &sub.to_string_lossy()).unwrap();
    assert_eq!(
        db(&s)
            .unwrap()
            .query_row("SELECT count(*) FROM subtitles", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    let moved = Path::new(&folder).join("人工 选择.srt");
    fs::rename(&sub, &moved).unwrap();
    scanner::scan_root(&s, "root").unwrap();
    let updated = first(&s);
    assert!(updated.subtitle.unwrap().ends_with("人工 选择.srt"));
    assert_eq!(updated.subtitle_confirmation, "manual_confirmed");
    drop(s);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn player_paths_are_compatible_with_native_players() {
    assert_eq!(
        external_player_path(r"\\?\D:\中文 & folder\video.mp4"),
        r"D:\中文 & folder\video.mp4"
    );
    assert_eq!(
        external_player_path(r"\\?\UNC\server\share\video.mp4"),
        r"\\server\share\video.mp4"
    );
    assert_eq!(external_player_path(r"D:\video.mp4"), r"D:\video.mp4");
}

#[test]
fn backup_rejects_missing_manual_asset() {
    let (dir, s, folder) = fixture();
    fs::write(Path::new(&folder).join("a.mp4"), b"fixture").unwrap();
    scanner::scan_root(&s, "root").unwrap();
    let item = first(&s);
    db(&s)
        .unwrap()
        .execute(
            "INSERT INTO cover_assets VALUES('lost.jpg',?1,'manual',NULL,NULL,1)",
            [&item.id],
        )
        .unwrap();
    assert!(export_backup(&*db(&s).unwrap(), &s.data, &dir.join("incomplete")).is_err());
    assert!(!dir.join("incomplete").exists());
    drop(s);
    fs::remove_dir_all(dir).unwrap();
}
#[test]
fn restore_rejects_incompatible_incomplete_and_broken_relations() {
    let (dir, s, folder) = fixture();
    fs::write(Path::new(&folder).join("a.mp4"), b"fixture").unwrap();
    scanner::scan_root(&s, "root").unwrap();
    let backup = dir.join("backup");
    export_backup(&*db(&s).unwrap(), &s.data, &backup).unwrap();
    db(&s)
        .unwrap()
        .execute("UPDATE items SET note='keep current'", [])
        .unwrap();
    for sql in [
        "PRAGMA user_version=99",
        "PRAGMA user_version=3;UPDATE items SET cover='absent.jpg'",
        "PRAGMA foreign_keys=OFF;UPDATE items SET cover=NULL,root_id='absent-root'",
    ] {
        let input = Connection::open(backup.join("library.db")).unwrap();
        input.execute_batch(sql).unwrap();
        drop(input);
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(backup.join("manifest.json")).unwrap()).unwrap();
        manifest["databaseSha256"] = digest(&backup.join("library.db")).unwrap().into();
        fs::write(
            backup.join("manifest.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        assert!(restore_impl(backup.to_str().unwrap(), &s).is_err());
        assert_eq!(first(&s).note, "keep current");
        assert!(!s.scanning.load(Ordering::SeqCst));
    }
    drop(s);
    fs::remove_dir_all(dir).unwrap();
}
#[test]
fn restore_interrupts_old_background_tasks() {
    let (dir, s, folder) = fixture();
    fs::write(Path::new(&folder).join("a.mp4"), b"fixture").unwrap();
    scanner::scan_root(&s, "root").unwrap();
    let item = first(&s);
    db(&s).unwrap().execute("INSERT INTO jobs(id,item_id,kind,state,revision,created_at,updated_at) VALUES('old-network',?1,'metadata','running',0,1,1)", [&item.id]).unwrap();
    let backup = dir.join("backup");
    export_backup(&*db(&s).unwrap(), &s.data, &backup).unwrap();
    restore_impl(backup.to_str().unwrap(), &s).unwrap();
    let mut c = db(&s).unwrap();
    assert_eq!(
        c.query_row("SELECT state FROM jobs WHERE id='old-network'", [], |r| {
            r.get::<_, String>(0)
        })
        .unwrap(),
        "interrupted"
    );
    assert!(metadata::ensure_job(&c, "old-network").is_err());
    assert!(metadata::commit(&mut *c, "old-network", &metadata::Proposal::default()).is_err());
    drop(c);
    drop(s);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn replaced_subtitle_needs_explicit_confirmation_for_each_binding() {
    let (dir, s, folder) = fixture();
    let sub = Path::new(&folder).join("chosen.srt");
    fs::write(Path::new(&folder).join("a.mp4"), b"video").unwrap();
    fs::write(Path::new(&folder).join("b.mp4"), b"video").unwrap();
    fs::write(&sub, b"original subtitle").unwrap();
    scanner::scan_root(&s, "root").unwrap();
    let items = catalog::list(&*db(&s).unwrap(), "", "", false, 0, 60, &Default::default())
        .unwrap()
        .items;
    for item in &items {
        scanner::bind(&mut *db(&s).unwrap(), &item.id, &sub.to_string_lossy()).unwrap();
    }
    let original = identity(&sub);
    fs::rename(&sub, dir.join("original.srt")).unwrap();
    fs::write(&sub, b"unrelated replacement").unwrap();
    assert_ne!(identity(&sub), original);
    assert!(subtitle_for_launch(&*db(&s).unwrap(), &items[0].id, false).is_err());
    assert_eq!(
        catalog::details(&*db(&s).unwrap(), &items[0].id)
            .unwrap()
            .subtitle_state,
        "invalid"
    );
    scanner::scan_root(&s, "root").unwrap();
    let updated = catalog::list(&*db(&s).unwrap(), "", "", false, 0, 60, &Default::default())
        .unwrap()
        .items;
    assert!(updated
        .iter()
        .all(|i| i.subtitle_confirmation == "needs_review"));
    assert_eq!(
        subtitle_for_launch(&*db(&s).unwrap(), &items[0].id, true).unwrap(),
        None
    );
    scanner::bind(&mut *db(&s).unwrap(), &items[0].id, &sub.to_string_lossy()).unwrap();
    assert!(subtitle_for_launch(&*db(&s).unwrap(), &items[0].id, false)
        .unwrap()
        .is_some());
    assert!(subtitle_for_launch(&*db(&s).unwrap(), &items[1].id, false).is_err());
    assert!(dir.join("original.srt").is_file());
    drop(s);
    fs::remove_dir_all(dir).unwrap();
}
#[test]
fn stale_download_cannot_replace_new_manual_cover() {
    let (dir, s, folder) = fixture();
    fs::write(Path::new(&folder).join("a.mp4"), b"video").unwrap();
    scanner::scan_root(&s, "root").unwrap();
    let item = first(&s);
    let image = include_bytes!("../icons/128x128.png");
    let manual = media::persist_cover(
        &s,
        &item.id,
        image,
        "png",
        "imported",
        item.details.revision,
        false,
    )
    .unwrap();
    assert!(media::persist_cover(
        &s,
        &item.id,
        image,
        "png",
        "official",
        item.details.revision,
        true
    )
    .is_err());
    assert_eq!(first(&s).cover, Some(manual));
    assert_eq!(fs::read_dir(s.data.join("covers")).unwrap().count(), 1);
    assert_eq!(
        db(&s)
            .unwrap()
            .query_row("SELECT count(*) FROM cover_assets", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(first(&s).details.revision, item.details.revision + 1);
    drop(s);
    fs::remove_dir_all(dir).unwrap();
}
#[test]
fn personal_and_removed_items_reject_downloaded_cover_commit() {
    let (dir, s, folder) = fixture();
    fs::write(Path::new(&folder).join("a.mp4"), b"video").unwrap();
    scanner::scan_root(&s, "root").unwrap();
    let mut item = first(&s);
    item.media_type = "personal".into();
    catalog::save(&mut *db(&s).unwrap(), &item).unwrap();
    let item = first(&s);
    let image = include_bytes!("../icons/128x128.png");
    assert!(media::persist_cover(
        &s,
        &item.id,
        image,
        "png",
        "official",
        item.details.revision,
        true
    )
    .is_err());
    media::persist_cover(
        &s,
        &item.id,
        image,
        "png",
        "imported",
        item.details.revision,
        false,
    )
    .unwrap();
    let item = first(&s);
    db(&s)
        .unwrap()
        .execute("UPDATE items SET removed=1 WHERE id=?1", [&item.id])
        .unwrap();
    assert!(media::persist_cover(
        &s,
        &item.id,
        image,
        "png",
        "imported",
        item.details.revision,
        false
    )
    .is_err());
    assert_eq!(fs::read_dir(s.data.join("covers")).unwrap().count(), 1);
    drop(s);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
#[cfg(windows)]
fn windows_reads_thumbnail_and_properties_without_external_tools() {
    let (dir, s, folder) = fixture();
    let video = Path::new(&folder).join("首帧 信息 & test.mp4");
    fs::copy(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("tests/fixtures/system-thumbnail.mp4"),
        &video,
    )
    .unwrap();
    let info = native_media::extract(&video).unwrap();
    assert!(info.duration.is_some_and(|v| v > 1.8 && v < 2.2));
    assert_eq!(info.width, Some(320));
    assert_eq!(info.height, Some(180));
    let image =
        media::validate_image(info.thumbnail.as_ref().expect("Windows H.264 thumbnail")).unwrap();
    assert!(image.width() > 0 && image.width() <= 640 && image.height() <= 640);
    drop(s);
    fs::remove_dir_all(dir).unwrap();
}
#[test]
fn automatic_native_jobs_require_no_settings_and_do_not_loop() {
    let (dir, s, folder) = fixture();
    let video = Path::new(&folder).join("unsupported.mp4");
    fs::write(&video, b"synthetic unsupported").unwrap();
    scanner::scan_root(&s, "root").unwrap();
    let count = || {
        db(&s)
            .unwrap()
            .query_row("SELECT count(*) FROM jobs WHERE kind='local'", [], |r| {
                r.get::<_, i64>(0)
            })
            .unwrap()
    };
    assert_eq!(count(), 1);
    db(&s)
        .unwrap()
        .execute("UPDATE jobs SET state='saved'", [])
        .unwrap();
    scanner::scan_root(&s, "root").unwrap();
    assert_eq!(count(), 1);
    fs::write(&video, b"changed synthetic unsupported file").unwrap();
    scanner::scan_root(&s, "root").unwrap();
    assert_eq!(count(), 2);
    assert_eq!(
        db(&s)
            .unwrap()
            .query_row("SELECT count(*) FROM settings", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        0
    );
    drop(s);
    fs::remove_dir_all(dir).unwrap();
}
#[test]
fn native_results_keep_manual_cover_and_reject_changed_video() {
    let (dir, s, folder) = fixture();
    let video = Path::new(&folder).join("a.mp4");
    fs::write(&video, b"video").unwrap();
    scanner::scan_root(&s, "root").unwrap();
    let item = first(&s);
    let cover = media::persist_cover(
        &s,
        &item.id,
        include_bytes!("../icons/128x128.png"),
        "png",
        "imported",
        item.details.revision,
        false,
    )
    .unwrap();
    let version = media::source_version(Path::new(&item.path)).unwrap();
    let info = native_media::NativeMedia {
        duration: Some(2.),
        width: Some(320),
        height: Some(180),
        thumbnail: Some(include_bytes!("../icons/128x128.png").to_vec()),
        note: String::new(),
    };
    media::commit_native(&s, &item.id, &item.path, &version, &info, None).unwrap();
    assert_eq!(first(&s).cover, Some(cover.clone()));
    assert_eq!(first(&s).duration, Some(2.));
    fs::write(&video, b"replacement content").unwrap();
    assert!(media::commit_native(&s, &item.id, &item.path, &version, &info, None).is_err());
    assert_eq!(first(&s).cover, Some(cover));
    drop(s);
    fs::remove_dir_all(dir).unwrap();
}
#[test]
fn cancelled_native_job_does_not_write_results() {
    let (dir, s, folder) = fixture();
    fs::write(Path::new(&folder).join("a.mp4"), b"video").unwrap();
    scanner::scan_root(&s, "root").unwrap();
    let item = first(&s);
    let version = media::source_version(Path::new(&item.path)).unwrap();
    let key: String = db(&s)
        .unwrap()
        .query_row("SELECT id FROM jobs WHERE item_id=?1", [&item.id], |r| {
            r.get(0)
        })
        .unwrap();
    db(&s)
        .unwrap()
        .execute("UPDATE jobs SET state='cancelled' WHERE id=?1", [&key])
        .unwrap();
    let info = native_media::NativeMedia {
        duration: Some(2.),
        ..Default::default()
    };
    assert!(media::commit_native(&s, &item.id, &item.path, &version, &info, Some(&key)).is_err());
    assert_eq!(first(&s).duration, None);
    drop(s);
    fs::remove_dir_all(dir).unwrap();
}
#[test]
fn missing_system_thumbnail_keeps_unknowns_and_retires_stale_auto_cover() {
    let (dir, s, folder) = fixture();
    fs::write(Path::new(&folder).join("a.mp4"), b"video").unwrap();
    scanner::scan_root(&s, "root").unwrap();
    let item = first(&s);
    let version = media::source_version(Path::new(&item.path)).unwrap();
    fs::write(s.data.join("covers/old.jpg"), b"old automatic cover").unwrap();
    db(&s)
        .unwrap()
        .execute(
            "INSERT INTO cover_assets VALUES('old.jpg',?1,'windows',NULL,'old-version',0)",
            [&item.id],
        )
        .unwrap();
    db(&s)
        .unwrap()
        .execute(
            "UPDATE items SET cover='old.jpg',embedded_subtitles=0 WHERE id=?1",
            [&item.id],
        )
        .unwrap();
    media::commit_native(
        &s,
        &item.id,
        &item.path,
        &version,
        &native_media::NativeMedia::default(),
        None,
    )
    .unwrap();
    let updated = first(&s);
    assert_eq!(updated.cover, None);
    assert_eq!(updated.duration, None);
    assert_eq!(updated.details.embedded_subtitles, None);
    assert_eq!(updated.details.subtitle_state, "unknown");
    assert!(s.data.join("covers/old.jpg").is_file());
    drop(s);
    fs::remove_dir_all(dir).unwrap();
}
#[test]
fn malformed_native_image_rolls_back_media_properties() {
    let (dir, s, folder) = fixture();
    fs::write(Path::new(&folder).join("a.mp4"), b"video").unwrap();
    scanner::scan_root(&s, "root").unwrap();
    let item = first(&s);
    let version = media::source_version(Path::new(&item.path)).unwrap();
    let info = native_media::NativeMedia {
        duration: Some(9.),
        thumbnail: Some(b"not an image".to_vec()),
        ..Default::default()
    };
    assert!(media::commit_native(&s, &item.id, &item.path, &version, &info, None).is_err());
    assert_eq!(first(&s).duration, None);
    assert_eq!(first(&s).cover, None);
    drop(s);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn old_tool_paths_are_ignored_when_loading_settings() {
    let settings:Settings=serde_json::from_str(r#"{"player":"player.exe","playerKind":"potplayer","ffmpeg":"obsolete.exe","ffprobe":"obsolete.exe","providers":[]}"#).unwrap();
    assert_eq!(settings.player, "player.exe");
    let saved = serde_json::to_value(settings).unwrap();
    assert!(saved.get("ffmpeg").is_none());
    assert!(saved.get("ffprobe").is_none());
}

#[test]
#[ignore = "requires built release EXE with native worker; run after build-native"]
fn release_exe_native_worker_commits_through_isolated_job() {
    let (dir, s, folder) = fixture();
    let project = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    let video = Path::new(&folder).join("中文 & worker.mp4");
    fs::copy(project.join("tests/fixtures/system-thumbnail.mp4"), &video).unwrap();
    scanner::scan_root(&s, "root").unwrap();
    let item = first(&s);
    let key: String = db(&s)
        .unwrap()
        .query_row("SELECT id FROM jobs WHERE item_id=?1", [&item.id], |r| {
            r.get(0)
        })
        .unwrap();
    db(&s)
        .unwrap()
        .execute("UPDATE jobs SET state='running' WHERE id=?1", [&key])
        .unwrap();
    media::read_native_using(
        &s,
        &item.id,
        Some(&key),
        &project.join("src-tauri/target/release/av-library-manager.exe"),
    )
    .unwrap();
    let updated = first(&s);
    assert_eq!(updated.duration, Some(2.));
    assert_eq!(updated.details.width, Some(320));
    assert!(updated.cover.is_some());
    assert_eq!(updated.details.embedded_subtitles, None);
    let bytes = fs::read(s.data.join("covers").join(updated.cover.unwrap())).unwrap();
    assert!(media::validate_image(&bytes).unwrap().width() <= 640);
    drop(s);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn disabling_root_cancels_automatic_media_tasks() {
    let (dir, s, folder) = fixture();
    fs::write(Path::new(&folder).join("a.mp4"), b"video").unwrap();
    scanner::scan_root(&s, "root").unwrap();
    let item = first(&s);
    set_root_enabled(&mut *db(&s).unwrap(), "root", false).unwrap();
    assert!(scanner::scan_root(&s, "root").is_err());
    assert_eq!(first(&s).id, item.id);
    assert_eq!(
        db(&s)
            .unwrap()
            .query_row(
                "SELECT count(*) FROM jobs WHERE state='cancelled'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
    drop(s);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn relink_to_other_root_survives_both_scans(){
 let(dir,s,folder)=fixture();let old=Path::new(&folder).join("original.mp4");fs::write(&old,b"synthetic").unwrap();scanner::scan_root(&s,"root").unwrap();let item=first(&s);let target=dir.join("new-media");fs::create_dir_all(&target).unwrap();let new=target.join("moved.mp4");fs::rename(&old,&new).unwrap();let new=fs::canonicalize(new).unwrap();
 assert!(scanner::relink_impl(&mut db(&s).unwrap(),&item.id,&new).is_err());
 db(&s).unwrap().execute("INSERT INTO roots VALUES('new',?1,'jav',1)",[fs::canonicalize(&target).unwrap().to_string_lossy()]).unwrap();
 scanner::relink_impl(&mut db(&s).unwrap(),&item.id,&new).unwrap();scanner::scan_root(&s,"root").unwrap();scanner::scan_root(&s,"new").unwrap();let updated=first(&s);assert_eq!(updated.id,item.id);assert!(updated.available);assert_eq!(updated.root_id,"new");drop(s);fs::remove_dir_all(dir).unwrap();
}
#[test]
fn in_place_subtitle_changes_require_confirmation(){
 let(dir,s,folder)=fixture();fs::write(Path::new(&folder).join("TEST-123.mp4"),b"video").unwrap();let sub=Path::new(&folder).join("TEST-123.srt");fs::write(&sub,b"original").unwrap();scanner::scan_root(&s,"root").unwrap();let item=first(&s);scanner::bind(&mut db(&s).unwrap(),&item.id,sub.to_str().unwrap()).unwrap();let old_id=identity(&sub);fs::write(&sub,b"different subtitle contents").unwrap();assert_eq!(identity(&sub),old_id);assert!(subtitle_for_launch(&db(&s).unwrap(),&item.id,false).is_err());scanner::scan_root(&s,"root").unwrap();assert_eq!(first(&s).subtitle_confirmation,"needs_review");scanner::bind(&mut db(&s).unwrap(),&item.id,sub.to_str().unwrap()).unwrap();assert!(subtitle_for_launch(&db(&s).unwrap(),&item.id,false).is_ok());drop(s);fs::remove_dir_all(dir).unwrap();
}
#[test]
fn disabled_subtitle_matching_survives_scan(){let(dir,s,folder)=fixture();fs::write(Path::new(&folder).join("TEST-123.mp4"),b"v").unwrap();fs::write(Path::new(&folder).join("TEST-123.srt"),b"s").unwrap();scanner::scan_root(&s,"root").unwrap();db(&s).unwrap().execute("UPDATE items SET subtitle=NULL,selected_subtitle_id=NULL,subtitle_confirmation='disabled'",[]).unwrap();scanner::scan_root(&s,"root").unwrap();let item=first(&s);assert_eq!(item.subtitle_confirmation,"disabled");assert!(item.subtitle.is_none());drop(s);fs::remove_dir_all(dir).unwrap();}

#[test]
fn older_failed_tasks_remain_visible_beyond_recent_history(){let c=initialize(Path::new(":memory:")).unwrap();for n in 0..250{c.execute("INSERT INTO jobs(id,item_id,kind,state,revision,created_at,updated_at) VALUES(?1,'none','local',?2,0,?3,?3)",params![n.to_string(),if n==0{"failed"}else{"saved"},n]).unwrap();}let failed=metadata::jobs_page(&c,"failed",0).unwrap();assert_eq!(failed.as_array().unwrap().len(),1);assert_eq!(failed[0]["id"],"0");assert_eq!(metadata::jobs_page(&c,"history",100).unwrap().as_array().unwrap().len(),100);}
#[test]
fn cache_cleanup_removes_orphan_preview_and_preserves_manual_asset(){let(dir,s,_)=fixture();fs::create_dir_all(s.data.join("thumbnails")).unwrap();fs::write(s.data.join("covers/manual.jpg"),b"manual").unwrap();fs::write(s.data.join("thumbnails/manual.jpg.jpg"),b"keep").unwrap();fs::write(s.data.join("thumbnails/orphan.jpg.jpg"),b"orphan").unwrap();db(&s).unwrap().execute("INSERT INTO cover_assets(path,source_type,manual) VALUES('manual.jpg','imported',1)",[]).unwrap();assert_eq!(media::trim_cache_impl(&s).unwrap(),6);assert!(s.data.join("covers/manual.jpg").is_file());assert!(s.data.join("thumbnails/manual.jpg.jpg").is_file());assert!(!s.data.join("thumbnails/orphan.jpg.jpg").exists());drop(s);fs::remove_dir_all(dir).unwrap();}

#[test]
#[ignore="valid MP4 workload, run explicitly after release build"]
fn valid_mp4_workload_scan_and_decode(){
 let(dir,s,folder)=fixture();let fixture=Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().join("tests/fixtures/system-thumbnail.mp4");for n in 0..1000{fs::copy(&fixture,Path::new(&folder).join(format!("sample-{n}.mp4"))).unwrap();}
 let start=std::time::Instant::now();assert_eq!(scanner::scan_root(&s,"root").unwrap(),1000);let scan_ms=start.elapsed().as_millis();let start=std::time::Instant::now();let items=catalog::list(&db(&s).unwrap(),"","",false,0,60,&Default::default()).unwrap();let query_ms=start.elapsed().as_millis();assert_eq!(items.total,1000);assert_eq!(items.items.len(),60);
 let exe=Path::new(env!("CARGO_MANIFEST_DIR")).join("target/release/av-library-manager.exe");let start=std::time::Instant::now();for item in items.items.iter().take(10){let out=Command::new(&exe).args(["--avlibrary-media-worker",&item.path]).output().unwrap();assert!(out.status.success());let v:serde_json::Value=serde_json::from_slice(&out.stdout).unwrap();assert_eq!(v["width"],320);}
 let result=serde_json::json!({"version":env!("CARGO_PKG_VERSION"),"scope":"1000 copies of a valid 2-second synthetic MP4; 10 actual release worker decodes, not diverse user files or UI memory/FPS","scanMs":scan_ms,"firstPageQueryMs":query_ms,"tenDecodeMs":start.elapsed().as_millis()});fs::write(Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().join("docs/VALID_MEDIA_WORKLOAD.json"),serde_json::to_vec_pretty(&result).unwrap()).unwrap();drop(s);fs::remove_dir_all(dir).unwrap();
}

#[test]
fn relink_adds_unmanaged_root_atomically(){
 let(dir,s,folder)=fixture();let old=Path::new(&folder).join("original.mp4");fs::write(&old,b"video").unwrap();scanner::scan_root(&s,"root").unwrap();let item=first(&s);let target=dir.join("unmanaged");fs::create_dir_all(&target).unwrap();let new=target.join("moved.mp4");fs::rename(&old,&new).unwrap();let new=fs::canonicalize(new).unwrap();
 assert!(scanner::relink_with_root(&mut db(&s).unwrap(),"missing-item",&new,true).is_err());assert_eq!(db(&s).unwrap().query_row("SELECT count(*) FROM roots",[],|r|r.get::<_,i64>(0)).unwrap(),1);
 scanner::relink_with_root(&mut db(&s).unwrap(),&item.id,&new,true).unwrap();let updated=first(&s);assert_ne!(updated.root_id,"root");scanner::scan_root(&s,"root").unwrap();scanner::scan_root(&s,&updated.root_id).unwrap();assert_eq!(first(&s).id,item.id);assert!(first(&s).available);drop(s);fs::remove_dir_all(dir).unwrap();
}

#[test]
fn settings_interval_save_is_atomic_and_legacy_compatible(){
 let(dir,s,_)=fixture();fs::write(s.data.join("scan-interval.txt"),"120").unwrap();assert_eq!(maintenance::interval(&s),120);
 let mut settings=Settings{player:"original.exe".into(),player_kind:"vlc".into(),scan_minutes:Some(60),..Default::default()};
 save_settings_impl(&*db(&s).unwrap(),&settings).unwrap();assert_eq!(maintenance::interval(&s),60);
 settings.player="unsaved.exe".into();settings.scan_minutes=Some(1);assert!(save_settings_impl(&*db(&s).unwrap(),&settings).is_err());
 let json:String=db(&s).unwrap().query_row("SELECT value FROM settings WHERE id=1",[],|r|r.get(0)).unwrap();let saved:Settings=serde_json::from_str(&json).unwrap();assert_eq!(saved.player,"original.exe");assert_eq!(saved.scan_minutes,Some(60));
 assert_eq!(maintenance::effective_interval(None,&s.data),120);drop(s);fs::remove_dir_all(dir).unwrap();
}
#[test]
fn selection_pages_include_removed_and_ignore_duplicate_missing_ids(){
 let(dir,s,folder)=fixture();for n in 0..61{fs::write(Path::new(&folder).join(format!("film-{n:03}.mp4")),b"video").unwrap();}scanner::scan_root(&s,"root").unwrap();
 let ids:Vec<String>={let c=db(&s).unwrap();let mut q=c.prepare("SELECT id FROM items ORDER BY title").unwrap();let rows=q.query_map([],|r|r.get(0)).unwrap().collect::<std::result::Result<Vec<_>,_>>().unwrap();rows};
 db(&s).unwrap().execute("UPDATE items SET removed=1,available=0 WHERE id=?1",[&ids[0]]).unwrap();let mut selected=ids.clone();selected.push(ids[0].clone());selected.push("missing".into());
 let first=catalog::selected_page(&*db(&s).unwrap(),&selected,0).unwrap();assert_eq!(first["total"],61);assert_eq!(first["items"].as_array().unwrap().len(),50);assert_eq!(first["items"][0]["removed"],true);assert_eq!(first["items"][0]["available"],false);
 let last=catalog::selected_page(&*db(&s).unwrap(),&selected,50).unwrap();assert_eq!(last["items"].as_array().unwrap().len(),11);assert_eq!(catalog::selected_page(&*db(&s).unwrap(),&[],0).unwrap()["total"],0);drop(s);fs::remove_dir_all(dir).unwrap();
}
#[test]
fn relocation_rejects_overlapping_roots_in_preview_and_commit(){
 let(dir,s,folder)=fixture();let other=dir.join("other");let child=other.join("child");fs::create_dir_all(&child).unwrap();let registered=fs::canonicalize(&other).unwrap();db(&s).unwrap().execute("INSERT INTO roots VALUES('other',?1,'jav',0)",[registered.to_string_lossy()]).unwrap();
 for target in [&other,&child,&dir]{for confirm in [false,true]{let error=scanner::relocate_impl(&s,"root",target.to_str().unwrap(),confirm).unwrap_err();assert!(error.contains("重叠"));}}
 let old:String=db(&s).unwrap().query_row("SELECT path FROM roots WHERE id='root'",[],|r|r.get(0)).unwrap();assert_eq!(old,folder);drop(s);fs::remove_dir_all(dir).unwrap();
}
#[test]
fn relocation_preserves_notes_and_rejects_stale_editor(){
 let(dir,s,folder)=fixture();fs::write(Path::new(&folder).join("sample.mp4"),b"video").unwrap();scanner::scan_root(&s,"root").unwrap();let mut item=first(&s);item.note="keep note".into();catalog::save(&mut db(&s).unwrap(),&item).unwrap();let before=first(&s);
 let target=dir.join("moved");fs::rename(&folder,&target).unwrap();let preview=scanner::relocate_impl(&s,"root",target.to_str().unwrap(),false).unwrap();assert_eq!(preview["missing"],0);scanner::relocate_impl(&s,"root",target.to_str().unwrap(),true).unwrap();let after=first(&s);assert_eq!(after.note,"keep note");assert_eq!(after.id,before.id);assert!(after.available);assert!(after.path.contains("moved"));assert!(catalog::save(&mut db(&s).unwrap(),&before).is_err());scanner::scan_root(&s,"root").unwrap();assert_eq!(first(&s).id,before.id);drop(s);fs::remove_dir_all(dir).unwrap();
}
