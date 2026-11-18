# 0.6 需求调整（2026-11-15）

用户已明确选择“按免配置方案修改”：删除时间轴/逐帧选图和 FFmpeg/FFprobe 配置，使用 Windows 视频缩略图和系统可用媒体属性。不支持的格式显示占位图；保留手动图片及官方封面。系统缩略图不保证为严格第一帧，内嵌字幕轨数未知时显示未检测。

本调整覆盖 V0.5 中 D06、3.5 和 T07/T34 关于人工指定帧/逐帧选择的要求，后续按本文件验收；其余本地优先、Personal 禁网、资料保护和外部播放器约定保持。

## 当前行为

- 不读取、不执行旧 FFmpeg/FFprobe 路径；旧设置载入时忽略这些字段，保存时移除。
- 扫描入库不等待媒体提取。后台使用 Windows Shell 缩略图与媒体属性接口，程序自身 EXE 的隐藏子进程负责读取，低并发、有超时和进程回收。
- 保留已有人工图片/人工截图，自动缩略图不覆盖人工或用户选定官方封面。
- 同一源文件版本只自动尝试一次；不支持或失败时允许用户手动重试/导入图片，避免每次扫描重复解码。
- 源文件 ID、大小和修改时间用于提交校验，取消、移出或源文件变化时不提交旧结果。停用/移除根目录会取消其待处理任务。
- 时长、分辨率能读到就显示；读不到使用未知状态，不写成 0。不检测内嵌字幕轨数量；外挂字幕管理不变。
- 默认发布 ZIP 只含 AVLibrary.exe，说明/验收/依赖材料在单独的文档包与项目 docs 中。运行后仍创建 app-data。

## 已验证

- Windows 实际提取中文、空格及 & 路径下的合成 H.264 MP4：2 秒、320×180，返回正常 JPEG；无 FFmpeg/FFprobe 执行。
- 正式 EXE 隐藏媒体模式、子进程隔离、数据库提交、人工封面保护、源变化/任务取消保护、未知回退、旧工具配置兼容、自动任务去重及目录停用取消。
- 界面中不再有逐帧/时间轴/媒体工具路径配置，仍可手动刷新系统缩略图及选择图片。

## 兼容性边界

系统缩略图依赖 Windows 已安装的媒体处理组件，不承诺所有容器/编码有图，也不保证严格第一帧。Windows 可能使用系统缩略图缓存，其位置与清理由 Windows 管理。应用自身资料仍位于 EXE 旁 app-data。播放器、网络来源及其他机器验收的历史限制见 IMPLEMENTATION_STATUS.md。

## 官方接口依据

- [IShellItemImageFactory::GetImage](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-ishellitemimagefactory-getimage)：获取系统缩略图，非所有项目均提供，后台读取。
- [System.Media.Duration](https://learn.microsoft.com/en-us/windows/win32/properties/props-system-media-duration)：时长单位为 100ns。
