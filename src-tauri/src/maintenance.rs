use super::*;
fn folder_bytes(p:&Path)->u64{fs::read_dir(p).into_iter().flatten().filter_map(|e|e.ok()).map(|e|{if e.file_type().is_ok_and(|t|t.is_symlink()){0}else if e.file_type().is_ok_and(|t|t.is_dir()){folder_bytes(&e.path())}else{e.metadata().map(|m|m.len()).unwrap_or(0)}}).sum()}
pub fn effective_interval(saved:Option<u64>,data:&Path)->u64{
 saved.filter(|v|(10..=1440).contains(v)).or_else(||fs::read_to_string(data.join("scan-interval.txt")).ok().and_then(|s|s.trim().parse::<u64>().ok()).filter(|v|(10..=1440).contains(v))).unwrap_or(30)
}
pub fn interval(s:&AppState)->u64{
 let saved=db(s).ok().and_then(|c|c.query_row("SELECT value FROM settings WHERE id=1",[],|r|r.get::<_,String>(0)).ok()).and_then(|j|serde_json::from_str::<Settings>(&j).ok()).and_then(|v|v.scan_minutes);
 effective_interval(saved,&s.data)
}
#[tauri::command]
pub async fn system_status(app:tauri::AppHandle)->Result<serde_json::Value>{tauri::async_runtime::spawn_blocking(move||status_impl(app.state::<AppState>())).await.map_err(err)?}
fn status_impl(s:State<AppState>)->Result<serde_json::Value>{
 let settings=get_settings(s.clone())?;let mut detected=vec![];
 for (kind,path) in [("potplayer","C:/Program Files/DAUM/PotPlayer/PotPlayerMini64.exe"),("potplayer","C:/Program Files (x86)/DAUM/PotPlayer/PotPlayerMini.exe"),("vlc","C:/Program Files/VideoLAN/VLC/vlc.exe"),("vlc","C:/Program Files (x86)/VideoLAN/VLC/vlc.exe"),("mpv","C:/Program Files/mpv/mpv.exe")]{if Path::new(path).is_file(){detected.push(serde_json::json!({"kind":kind,"path":path}));}}
 let backups=fs::read_dir(&s.data).map_err(err)?.filter_map(|e|e.ok()).filter(|e|e.file_type().is_ok_and(|t|t.is_dir())&&e.file_name().to_string_lossy().starts_with("before-")).map(|e|serde_json::json!({"name":e.file_name().to_string_lossy(),"bytes":folder_bytes(&e.path())})).collect::<Vec<_>>();
 Ok(serde_json::json!({"version":env!("CARGO_PKG_VERSION"),"dataPath":s.data,"playerAvailable":settings.player.is_empty()||Path::new(&settings.player).is_file(),"player":settings.player,"detected":detected,"scanMinutes":settings.scan_minutes,"previewBytes":folder_bytes(&s.data.join("thumbnails")),"coverBytes":folder_bytes(&s.data.join("covers")),"backups":backups}))
}
#[tauri::command]
pub fn reveal_data(s:State<AppState>)->Result<()>{Command::new("explorer.exe").arg(&s.data).spawn().map_err(err)?;Ok(())}
#[tauri::command]
pub fn test_player(settings:Settings,s:State<AppState>)->Result<String>{
 if settings.player.is_empty(){return Err("请先选择播放器程序，以测试指定字幕加载".into());}
 if !Path::new(&settings.player).is_file(){return Err("播放器程序不存在，请重新选择".into());}
 if !["potplayer","mpv","vlc"].contains(&settings.player_kind.as_str()){return Err("请选择支持的播放器类型".into());}
 let dir=s.data.join("player-test");fs::create_dir_all(&dir).map_err(err)?;let video=dir.join("test.mp4");let subtitle=dir.join("test.srt");fs::write(&video,include_bytes!("../../tests/fixtures/system-thumbnail.mp4")).map_err(err)?;fs::write(&subtitle,"1\n00:00:00,000 --> 00:00:02,000\nAV Library subtitle test\n").map_err(err)?;
 let mut cmd=Command::new(&settings.player);cmd.arg(&video).arg(format!("{}{}",if settings.player_kind=="potplayer"{"/sub="}else{"--sub-file="},subtitle.to_string_lossy()));cmd.spawn().map_err(err)?;Ok("已发出测试播放请求，请确认彩色画面和 AV Library subtitle test 字幕均可见".into())
}
