# 映库 · AV Library Manager 0.13.0

Windows 本地影片资料管理器。三类媒体统一管理，卡片调用外部播放器；资料保存在程序旁 app-data。

0.6.0 按用户确认的 [免配置方案](docs/REQUIREMENTS_UPDATE_0.6.md) 调整：**删除逐帧选图和 FFmpeg/FFprobe 配置，自动读取 Windows 视频缩略图、时长和分辨率**。无法读取的字段显示未知，封面使用占位图；可手动选择本地图片或官方封面。已有人工封面与人工截图保留。

0.6.1 新增 [诊断日志与一键导出](docs/DIAGNOSTICS_GUIDE.md)，便于另一台电脑出现问题后反馈。自动本地记录并限制容量，不上传私人内容。

0.7.0 完成 [主要 UI 交互调整](docs/UI_USABILITY_0.7.md)：修复自定义标签和分类保存，编辑时创建并选中标签；明确排序/卡片大小，筛选应用/取消、未保存提醒、批量确认、应用内表单和错误反馈。

0.8.0 完成 [可用性与可靠性改进](docs/RELIABILITY_0.8.md)：详情浏览、退出未保存保护、跨目录关联、字幕解绑与原地变更检测、任务分页、播放器自测、搜索和目录扫描优化。

0.8.1 完成 [设置、批量选择与目录迁移改进](docs/USABILITY_0.8.1.md)：扫描间隔统一保存/取消，已选列表数据库分页，目录重叠检查和过期编辑保护。

0.9.0 更新为 [深色磨砂界面](docs/UI_GLASS_0.9.md)，侧边栏、顶部工具栏、卡片与弹窗视觉统一，申请深色原生标题栏。

0.10.0 [精简顶部区域并分离管理入口](docs/UI_REFINEMENT_0.10.md)，采用统一标题栏并保留未保存退出提醒。

0.11.0 [精简浏览与分组筛选](docs/UI_FILTER_0.11.md)：排序菜单、搜索焦点和筛选面板更新，标签下方集中演员与厂商入口。

0.12.0 依用户提供的设计规范改为 [浅色柔光新拟态](docs/UI_SOFT_0.12.md)，全面替换原深色毛玻璃样式。

0.13.0 沿用浅色柔光新拟态。搜索、影片列表和后台任务独立刷新，字幕扫描按文件名和编号匹配，备份恢复先校验数据库和封面资源。变更记录见 [CHANGELOG.md](docs/CHANGELOG.md)。

## 运行

`release/AVLibrary-0.13.0-Windows-x64.zip` 解压后只有 `AVLibrary.exe`。将它放在本机可写目录运行，首次启动会生成 `app-data`。Windows 需要 WebView2。**无需安装或配置 FFmpeg/FFprobe**。

添加媒体文件夹并扫描即可建立卡片，缩略图在后台出现。Windows 无法提供缩略图的格式仍可入库和播放，允许手动导入图片。系统缩略图不保证严格为第一帧。

说明、验收和依赖材料见 `release/AVLibrary-0.13.0-Documentation.zip` 与项目 `docs`。

## 已运行验证

- 功能优化阶段通过 63 项 Rust 测试、5 项 SQLite 约束测试和 39 项浏览器界面测试。
- 恢复新拟态后重新通过 4 项界面检查，覆盖不同窗口宽度、键盘菜单、分组筛选、对比度与凹凸阴影。
- 媒体处理测试覆盖中文、空格及 `&` 路径下的有效 MP4，以及不支持文件的回退。见 [媒体验证记录](docs/NATIVE_MEDIA_RESULTS.json)。
- 本次便携发布验证包括 TypeScript/Vite、Windows x64 构建、解压和文件哈希核对。

播放器实际字幕画面、真实来源匹配质量及 Win11/移动盘等验收仍待完成，见 [实现与验收记录](docs/IMPLEMENTATION_STATUS.md)。

## 升级与备份

数据库 schema 仍为 3。升级前备份并退出旧版，替换 EXE 时保留原 app-data。旧 FFmpeg/FFprobe 路径会被忽略。既有人工图片、人工截图、字幕绑定、评分和标签保留。

## 开发

Node.js、Rust stable、MSVC/Windows SDK 与 WebView2。依赖由 package-lock.json 和 src-tauri/Cargo.lock 锁定。

- npm ci
- npm run dev：只读浏览器预览。
- npm run build：前端检查/构建。
- npm test：SQLite 约束测试。
- npm run test:ui：浏览器 UI 测试。
- cargo test --locked --manifest-path src-tauri/Cargo.toml：普通后端测试。
- npm run desktop:build：正式桌面构建。
- npm run package:portable：生成单 EXE ZIP 和独立文档 ZIP，并解压核对哈希。

本机可用 scripts/rust-check.cmd / scripts/build-native.cmd 配置 .toolchain 下的编译工具。显式集成测试和复现见 [TESTING.md](docs/TESTING.md)。
