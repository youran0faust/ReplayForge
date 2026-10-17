# ReplayForge

[![license](https://img.shields.io/badge/license-MIT-brightgreen)](LICENSE) [![version](https://img.shields.io/badge/version-v0.1.0-blue)](https://github.com/youran0faust/ReplayForge/releases/tag/v0.1.0) [![Electron](https://img.shields.io/badge/Electron-44.4.5-47848F)](https://www.electronjs.org/) [![platform](https://img.shields.io/badge/platform-Windows-0078D6)](.) [![tests](https://img.shields.io/badge/tests-%7E1900%20cases-3FB950)](.)

> **一条自然语言剧本，进——一帧一帧对得上的成片，出。**

ReplayForge 把「自然语言剧本 + 散装媒体素材」变成**精确到帧、可编辑、可复用、可便携**的成片工程，并由确定性渲染管线导出 MP4。整套引擎由 AI Agent 驱动的多阶段工程流水线构建，配套约 1900 用例的全量回归与四条基线校验。

> 中文 | [English](README.en.md) · MIT

## 它解决什么问题

把「TXT/MD 剧本 + 散装素材」做成一版能交付的视频，传统上要串起编剧、分镜、剪辑、调音、字幕多套工具的接力：人工在时间轴上一帧帧对、一句句对手型对尾音——**错一帧就要重对，改一次就要重导，换个机器就打不开**。

ReplayForge 的答案是「工程为权威」：

| 痛点 | 引擎的做法 |
|---|---|
| 对帧靠眼睛 | 底层全部用 `durationFrames` / `visibleFrom` / `visibleTo` / 位置关键帧 / 表情事件 / 对白 `revealFrames` 定义；导出可逐帧校验（455/563 帧编解码前 PNG 严格一致、AAC 音频窗口独立核验） |
| 对白全靠排 | 对话框**真实分页**（非逐词对齐），阅读时长、语音连续性、字幕保持时间可控 |
| 改角色要动所有实例 | 定义（definition）/ 实例（instance）分层，改一次模板全部引用实例生效；**写时复制**保障共享改动不影响其他角色 |
| 素材格式进不来 | 压缩音频 OGG/Opus/MP3 → 48 kHz PCM16 接入；受限视频插播 `@视频 文件.mp4` |
| 工程离不开原机器 | **便携工程** = manifest + 托管资源，可跨机重开 |
| 导出一断就脏 | 带锁并发 worker、ENOSPC 早失败零脏写、取消/回收重试、旧成片保护 |

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

| 目录 | 内容 |
|---|---|
| `core/` | 会话（ProjectSession）、模型评估（validateProject / evaluate）、schema 迁移、部件、编辑命令 |
| `renderer/` | 编辑界面与画布渲染 |
| `examples/` `fixtures/` `component-packs/` | 示例工程、测试夹具、可复用部件 |
| `docs/` | 交付使用指南与验收门槛 |

## 可靠性与可退役架构

- **回归**：`node:test` 全量回归，约 1900 用例 / 11 条独立脚本；开发维护四条基线（生产 / 原始 / 新基线 / 工作树）防回归，改动需逐段验证。
- **确定性迁移**：schema 显式版本化 s1→s2→s3→s4，迁移纯函数化、确定性、可测；旧兼容层可整体退役而不削弱新版保证。

## 局限（诚实说明）

- **不是独立安装包**：必须保持相邻 `p0/` 运行时布局（Electron + ffmpeg），`npm install` 不会安装它们。
- **不是完整自动创作工具**：旧 schema 功能不能按新默认 v4 推定全部开放。
- **机器核验 ≠ 人工验收**：帧对照与音频信号路径由机器核验；干净系统、真人听感、长篇/预算临界场景仍需人工确认。
- 受限视频插播暂不支持裁剪 / 循环 / 倍速 / 重叠；导出预算按单输入 256 MiB、规范输出 512 MiB 设限。

## 文档

- [交付使用指南](docs/交付使用指南.md)
- [最终交付清单与验收门槛](docs/最终交付清单与验收门槛.md)

## License

[MIT](LICENSE)
