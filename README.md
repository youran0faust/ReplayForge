# ReplayForge — 帧精确 · AI 共创的确定性叙事视频引擎

ReplayForge 把「自然语言剧本 + 散装媒体素材」变成**精确到帧、可编辑、可复用、可便携**的成片工程，并经由确定性渲染管线导出 MP4。引擎由 AI Agent 驱动的多阶段工程流水线构建，配套约 1900 用例的全量回归与四条基线校验。

## 核心能力

- **帧精确模型**：底层以 `durationFrames` / `visibleFrom` / `visibleTo`、位置关键帧、表情事件、对白 `revealFrames` 定义演出；导出可逐帧校验（455/563 帧编解码前 PNG 严格一致、AAC 音频窗口独立核验）。
- **对话真实分页**：对话框按页分页（非逐词对齐），阅读时长、语音连续性、字幕保持时间可控。
- **角色模板复用**：定义（definition）/实例（instance）分层，改一次模板全部引用实例生效；写时复制保障共享部件的修改不影响其他角色。
- **媒体管线**：压缩音频 OGG/Opus/MP3 → 48 kHz PCM16 接入；受限视频插播 `@视频 文件.mp4`；便携工程 = manifest + 托管资源，可跨机重开。
- **容错导出**：带锁并发 worker、ENOSPC 早失败零脏写、取消/回收重试、旧成片保护。
- **可退役架构**：schema 显式版本化 s1→s2→s3→s4，迁移纯函数化、确定性、可测；旧兼容层可整体退役而不削弱新版保证。

## 技术栈

Electron 44.4.5 · Node.js · 无重型前端框架 · `node:test` 全量回归（69 段 / ~1900 用例 / 11 条独立脚本）

## 快速开始

运行时依赖：Node.js、Electron 44.4.5（或保持与 `p0/` 相邻的 Electron 运行时布局）、ffmpeg / ffprobe。

```powershell
node run-electron.cjs        # Node 入口
# 或双击 启动P2编辑器.bat   # Windows 直接启动
```

运行全量回归：

```powershell
npm test
```

## 工程结构

- `core/` — 会话（ProjectSession）、模型评估（validateProject / evaluate）、schema 迁移、部件、编辑命令
- `renderer/` — 编辑界面与画布渲染
- `examples/` `fixtures/` `component-packs/` — 示例工程、测试夹具、可复用部件
- `docs/` — 交付使用指南与验收门槛

## 许可

[MIT](LICENSE)
