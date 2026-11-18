use super::*;
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NativeMedia {
    pub duration: Option<f64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub thumbnail: Option<Vec<u8>>,
    pub note: String,
}

// A headless mode of this same EXE isolates third-party Windows thumbnail handlers.
// It creates no Tauri window and is bounded/terminated by the parent process.
pub fn worker_entry() -> bool {
    let args: Vec<_> = std::env::args_os().collect();
    if args.get(1).is_none_or(|a| a != "--avlibrary-media-worker") {
        return false;
    }
    let result = if args.len() == 3 {
        extract(Path::new(&args[2]))
    } else {
        Err("无效媒体任务参数".into())
    };
    match result {
        Ok(info) => {
            if serde_json::to_writer(std::io::stdout(), &info).is_err() {
                std::process::exit(2)
            }
        }
        Err(_) => std::process::exit(1),
    }
    true
}
#[cfg(windows)]
pub(super) fn extract(path: &Path) -> Result<NativeMedia> {
    use windows::core::{Interface, PCWSTR};
    use windows::Win32::{
        Foundation::{PROPERTYKEY, SIZE},
        Graphics::Gdi::*,
        System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED},
        UI::Shell::{
            IShellItem2, IShellItemImageFactory, PropertiesSystem::PSGetPropertyKeyFromName,
            SHCreateItemFromParsingName, SIIGBF_THUMBNAILONLY,
        },
    };
    if !path.is_file() || !is_video(path) {
        return Err("视频不可用".into());
    }
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(err)?;
    }
    struct Com;
    impl Drop for Com {
        fn drop(&mut self) {
            unsafe {
                CoUninitialize();
            }
        }
    }
    let _com = Com;
    let local = external_player_path(&path.to_string_lossy());
    let wide: Vec<u16> = local.encode_utf16().chain(Some(0)).collect();
    let item: IShellItem2 =
        unsafe { SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None).map_err(err)? };
    fn key(name: &str) -> Option<PROPERTYKEY> {
        let wide: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
        let mut key = PROPERTYKEY::default();
        unsafe {
            PSGetPropertyKeyFromName(PCWSTR(wide.as_ptr()), &mut key).ok()?;
        }
        Some(key)
    }
    let duration = key("System.Media.Duration")
        .and_then(|key| unsafe { item.GetUInt64(&key).ok() })
        .filter(|v| *v > 0)
        .map(|v| v as f64 / 10_000_000.0);
    let width = key("System.Video.FrameWidth")
        .and_then(|key| unsafe { item.GetUInt32(&key).ok() })
        .filter(|v| *v > 0)
        .map(i64::from);
    let height = key("System.Video.FrameHeight")
        .and_then(|key| unsafe { item.GetUInt32(&key).ok() })
        .filter(|v| *v > 0)
        .map(i64::from);
    let thumbnail = (|| -> Result<Vec<u8>> {
        let factory: IShellItemImageFactory = item.cast().map_err(err)?;
        let bitmap = unsafe {
            factory
                .GetImage(SIZE { cx: 640, cy: 640 }, SIIGBF_THUMBNAILONLY)
                .map_err(err)?
        };
        struct Bitmap(HBITMAP);
        impl Drop for Bitmap {
            fn drop(&mut self) {
                unsafe {
                    let _ = DeleteObject(HGDIOBJ(self.0 .0));
                }
            }
        }
        let bitmap = Bitmap(bitmap);
        let mut details = BITMAP::default();
        if unsafe {
            GetObjectW(
                HGDIOBJ(bitmap.0 .0),
                std::mem::size_of::<BITMAP>() as i32,
                Some(&mut details as *mut _ as _),
            )
        } == 0
        {
            return Err("无法读取系统缩略图".into());
        }
        let width = details.bmWidth;
        let height = details.bmHeight.checked_abs().ok_or("系统缩略图尺寸无效")?;
        if width <= 0 || height <= 0 || width > 2048 || height > 2048 {
            return Err("系统缩略图尺寸无效".into());
        }
        let dc = unsafe { CreateCompatibleDC(None) };
        if dc.0.is_null() {
            return Err("无法创建缩略图上下文".into());
        }
        struct Dc(HDC);
        impl Drop for Dc {
            fn drop(&mut self) {
                unsafe {
                    let _ = DeleteDC(self.0);
                }
            }
        }
        let dc = Dc(dc);
        let mut info = BITMAPINFO::default();
        info.bmiHeader = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        };
        let mut pixels = vec![0u8; width as usize * height as usize * 4];
        if unsafe {
            GetDIBits(
                dc.0,
                bitmap.0,
                0,
                height as u32,
                Some(pixels.as_mut_ptr() as _),
                &mut info,
                DIB_RGB_COLORS,
            )
        } != height
        {
            return Err("无法转换系统缩略图".into());
        }
        let mut rgb = Vec::with_capacity(width as usize * height as usize * 3);
        for pixel in pixels.chunks_exact(4) {
            rgb.extend_from_slice(&[pixel[2], pixel[1], pixel[0]]);
        }
        let image =
            image::RgbImage::from_raw(width as u32, height as u32, rgb).ok_or("缩略图格式无效")?;
        let mut jpeg = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(image)
            .write_to(&mut jpeg, image::ImageFormat::Jpeg)
            .map_err(err)?;
        Ok(jpeg.into_inner())
    })()
    .ok();
    let note = if thumbnail.is_none() {
        "Windows 未提供视频缩略图，可导入本地封面图片"
    } else {
        ""
    }
    .into();
    Ok(NativeMedia {
        duration,
        width,
        height,
        thumbnail,
        note,
    })
}
#[cfg(not(windows))]
pub(super) fn extract(_path: &Path) -> Result<NativeMedia> {
    Err("系统缩略图仅支持 Windows".into())
}
