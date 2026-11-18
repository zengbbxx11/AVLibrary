# 0.12.0 测试与复现（2026-11-16）

## 当前结果

- 60 项 Rust 后端测试通过，0 失败、0 忽略（显式 include-ignored）。普通测试包含 Windows 实际缩略图/属性读取，另有 5,000 项规模基线和已构建 Release EXE 的隔离子进程到数据库链路及 1,000 份有效 MP4 扫描/10 次解码共三项显式测试。
- 5 项 SQLite 约束与 36 项 UI 自动化通过。UI 使用 Tauri 命令替身，验证自动缩略图入口及无工具设置，不代表实际播放器画面。
- 正式 Release EXE 隐藏媒体模式：有效 H.264 MP4 和不支持文件 2 场景通过，见 NATIVE_MEDIA_RESULTS.json；无 FFmpeg/FFprobe 执行。
- TypeScript/Vite 与 Windows MSVC Release 构建通过。发布包单 EXE、文档独立，解压核对哈希。
- NATIVE_API_RESULTS.json 是早期 0.5.0 的 10 组 Tauri 接口历史记录，不作为 0.6.0 全量原生界面验收。

## 本机环境与命令

Windows 10.0.19042 x64，i5-12400、12 逻辑核、16 GiB；Node 24.18、Rust 1.100、MSVC 17.14、WebView2 157、SQLite 3.54.1。锁文件记录准确依赖。

1. npm run build
2. scripts/build-native.cmd（或标准 Rust/MSVC 环境 npm run desktop:build）
3. scripts/rust-check.cmd -- --include-ignored --test-threads=1
4. npm test
5. npm run test:ui
6. node scripts/native-media-check.mjs
7. npm run package:portable

scripts/rust-check.cmd 使用本机 .toolchain。普通 cargo test 不运行需已构建 EXE 的显式测试；该测试从 src-tauri/target/release 取得本项目 EXE。先正常构建，不使用 e2e feature。

媒体样本 tests/fixtures/system-thumbnail.mp4 是已生成的 2 秒、320×180、25 FPS、无人物的彩色测试图案。测试只读取它或复制到 .qa 的中文/空格/& 路径。**运行测试与软件不需要 FFmpeg/FFprobe**。原逐帧/VFR 功能及其 3 项旧测试随用户确认的需求调整退役，由 Windows 读取、未知回退、进程隔离与资料保护测试替代。

Playwright 使用 PLAYWRIGHT_CHROME_PATH 或默认已安装 Chrome；找不到时需安装 Playwright Chromium。测试不操作用户真实媒体库。

## 原生接口及播放器

scripts/build-e2e.cmd 为 opt-in 的隔离 UI 测试构建，在 localhost:19222 开测试接口；只用于合成数据，不分发，也不用真实媒体库。

- node scripts/native-e2e.mjs --prepare：复制内置合成测试样本到新的 .qa/native-时间戳，不配置外部媒体工具。
- 在交互桌面启动所输出 AVLibraryE2E.exe，配置播放器后运行 native-api-check.mjs。已有运行器与桌面工具曾出现程序启动授权等待超时、截图超时及坐标不可用，当前没有完整播放器画面证据。
- native-player-check.mjs 只发请求，不能证明载入。必须观察指定视频和字幕的画面、已运行播放器复用、不同编码/ASS 等。
- close-approved-test.mjs 只按隔离配置的准确 EXE 路径关闭测试进程。
- 分发前必须正常 build-native，打包器拒绝带 e2e 调试标记的 EXE。

## 数据保护与边界

自动任务按文件 ID、大小和修改时间去重，同版本的失败/不支持结果不会每次扫描重跑。手动刷新允许重试。源变化、取消和移出后的提交拒绝；已有人工/官方选图优先。根目录停用/移除取消待处理任务。旧工具路径反序列化后被忽略。

Windows 缩略图由系统媒体组件提供，不保证所有格式或严格第一帧。未知时不显示虚假 0 或“已确定无内嵌字幕”。原有人工截图作为用户资产继续备份保留。

## 尚需实机回归

播放器实际字幕显示/复用；Win11、缺 WebView2、不同系统编码组件、物理移动盘/跨卷、写满磁盘与完整便携残留；真实来源样本匹配质量。PERFORMANCE_BASELINE.json 是 100/1,000/5,000 个一字节合成文件；VALID_MEDIA_WORKLOAD.json 另测 1,000 份有效 MP4 扫描与 10 次正式 EXE 解码。两者均不代表多编码私人库、UI 帧率或进程树内存结果。

## 诊断测试

新增 9 项后端回归：私人路径/URL/笔记过滤、轮换容量、损坏/篡改记录重校验、导出不覆盖、数据库内容不入报告、自动报告完整替换、7 天清理仅操作自身日志、前端代码坐标安全。新增 UI 测试验证预览、保存 JSON、取消和不收集原始调用栈。详见 DIAGNOSTICS_GUIDE.md。

## 0.7.0 可用性回归

新增 11 项主要 UI 流程，包含禁用浏览器原生 prompt/confirm 的环境、标签创建关联与分类、失败输入保留、未保存提醒、筛选应用/取消、偏好持久化、焦点循环与恢复、批量分类与移出、目录用途、取消文件选择、管理操作先保存、命名/来源校验、扫描取消。新增标签事务/关联保持和分页前排序两项 Rust 测试。详见 UI_USABILITY_0.7.md。

## 0.8.0 回归

新增 7 项后端与 8 项 UI 测试。字幕原地变更和目录关联使用真实隔离文件系统与 SQLite；原生关闭事件通过浏览器命令替身模拟，仍需桌面端实际确认。完整范围见 RELIABILITY_0.8.md。

## 0.8.0 历史系统缩略图测试波动

并行全套中 windows_reads_thumbnail_and_properties_without_external_tools 一次未取得 Windows 缩略图（55 通过、1 失败）；单独执行通过，随后串行全套 56 通过。原始日志保留在 verification/parallel-rust-attempt.log 与 thumbnail-isolated.log。并发系统组件竞争是可能原因，尚未证实；不宣称所有并行执行均稳定。发布程序仍通过独立媒体子进程读取，缺图时回退占位并可手动重试。

## 0.8.1 回归

新增 4 项后端、4 项 UI 回归，覆盖设置取消/保存失败/旧间隔兼容，批量选择分页/失败重试/末页回退，真实目录迁移保持资料及拒绝重叠、过期编辑。见 USABILITY_0.8.1.md。React 开发模式重复 effect 使用同一读取 Promise，避免已选列表重复查询；关闭弹窗后的迟到结果不会更新已卸载组件。

## 0.9.0 视觉回归

28 项现有 UI 流程通过；浏览器模拟资料的主界面、编辑抽屉及设置截图见 docs/screenshots/0.9-*。深色标题栏为原生主题配置；隔离 EXE 可启动，桌面截图两次超时，尚未获得原生外观证据。60 项 Rust、5 项 SQLite 和两个正式 EXE 隐藏媒体场景通过。

## 0.10.0 回归

新增标签和演员厂商管理分离、标题栏控制与草稿保护两项浏览器测试。另使用仅在隔离目录运行的 E2E 构建，连接真实 Tauri WebView/后端验证窗口按钮及标签保存，测试构建未发布。结果见 verification/native-window-0.10.log。

## 0.11.0 筛选回归

浏览器测试覆盖分组筛选、应用与取消、草稿冲突、大量标签搜索、演员和厂商摘要、下拉菜单方向键/回车/Esc、搜索焦点和旧有流程。独立测试构建因桌面工具运行授权超时未能启动，未完成真实桌面筛选验收；见 verification/native-filter-0.11.log。

## 0.12.0 浅色外观验证

新增浅色背景、主要区域关闭背景模糊与文字对比的回归；人工检查浏览器预览中的影片库、筛选、排序、设置和编辑抽屉，960 宽窗口无横向溢出。真实桌面隔离测试见 verification/native-soft-0.12.log。
