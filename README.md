# ReplayForge

[![license](https://img.shields.io/badge/license-MIT-brightgreen)](LICENSE) [![version](https://img.shields.io/badge/version-v0.1.0-blue)](https://github.com/youran0faust/ReplayForge/releases/tag/v0.1.0) [![Electron](https://img.shields.io/badge/Electron-44.4.5-47848F)](https://www.electronjs.org/) [![platform](https://img.shields.io/badge/platform-Windows-0078D6)](.) [![tests](https://img.shields.io/badge/tests-184%20logic%20cases-3FB950)](.)

> **换个电脑，你的片子就打不开了？**

ReplayForge 把「自然语言剧本 + 散装媒体素材」变成**精确到帧、可编辑、可复用、可便携**的成片工程，并由确定性渲染管线导出 MP4。整套引擎由 AI Agent 驱动的多阶段工程流水线构建，配套一套 `node:test` 自动回归（示例见下）。

> 中文 | [English](README.en.md) · MIT

## 它解决什么问题

把「TXT/MD 剧本 + 散装素材」做成一版能交付的视频，传统上要串起编剧、分镜、剪辑、调音、字幕多套工具的接力：人工在时间轴上一帧帧对、一句句对手型对尾音。于是——

> **错一帧就要重对，改一次就要重导，换个机器就打不开；通用 AIGC 生成视频又是黑盒——不可精确到帧、不可编辑、不可复用、不可审计。**

ReplayForge 的答案是「工程为权威」：

| 痛点 | 引擎的做法 |
|---|---|
| 对帧靠眼睛 | 底层全部用 `durationFrames` / `visibleFrom` / `visibleTo` / 位置关键帧 / 表情事件 / 对白 `revealFrames` 定义；导出可逐帧校验（455/563 帧编解码前 PNG 严格一致、AAC 音频窗口独立核验） |
| 对白全靠排 | 对话框**真实分页**（非逐词对齐），阅读时长、语音连续性、字幕保持时间可控 |
| 改角色要动所有实例 | 定义（definition）/ 实例（instance）分层，改一次模板全部引用实例生效；**写时复制**保障共享改动不影响其他角色 |
| 素材格式进不来 | 压缩音频 OGG/Opus/MP3 → 48 kHz PCM16 接入；受限视频插播 `@视频 文件.mp4` |
| 工程离不开原机器 | **便携工程** = manifest + 托管资源，可跨机重开 |
| 导出一断就脏 | 带锁并发 worker、ENOSPC 早失败零脏写、取消/回收重试、旧成片保护 |

## 安装与运行（运行时依赖）

ReplayForge 不是独立安装包：需要 Node.js，以及**相邻的运行时布局**（Electron 44.4.5 + ffmpeg/ffprobe，例如项目旁的 `p0/`）；`npm install` 不会安装它们。

- **A. 直接运行**：拿到工程目录后，`node run-electron.cjs` 启动，或双击 `启动P2编辑器.bat`（Windows）。
- **B. 从仓库运行**：`git clone https://github.com/youran0faust/ReplayForge`，把 `p0/`-式运行时（Electron + ffmpeg）放到相邻位置，再走 A。

## 命令

| 命令 | 作用 |
|---|---|
| `node run-electron.cjs` / `启动P2编辑器.bat` | 启动编辑器 |
| `npm run script:preflight` | 素材 + 文稿预检（先报格式/缺失，再进编辑） |
| `npm test` | 完整自动回归（多段 `node:test` + 独立脚本） |

## 示例输出

以下是**真实运行**摘录（`npm test` 的纯逻辑段：`core/` 8 个文件，`node --test --test-isolation=none`）：

```
✔ sample-local triangular envelope includes boundary and clamps; zero is identity (3.1425ms)
✔ fade field is strictly schema4 BGM only including explicit zero (0.7739ms)
✔ changes only selected page reveal frames, retains voice/text/times/schema and one undo/redo (20.8349ms)
✔ strict bounded seconds and nonzero title total (0.4831ms)
✔ interval endpoints, finite opacity, instance references and base range (0.3535ms)
✔ pure seek-independent projection, last started holds to and unordered tracks (1.6573ms)
✔ TS mirror validators and evaluator match CJS performance projection (6.2792ms)
✔ without performance legacy output is exact and finalizer returns identity (0.3213ms)
✔ weighted unicode text includes punctuation and ignores whitespace without mutation (1.4474ms)
✔ slow reveal capped and one-frame reveal protected (0.3882ms)
✔ ordered numeric not inventory order (0.8471ms)
✔ strict JSON whitelist rejects CSS, prototypes, symbols, accessors and invalid values (0.3489ms)
✔ browser UMD exposes identical API (1.0258ms)
ℹ tests 184
ℹ suites 0
ℹ pass 184
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 154.8429
```

完整回归（`npm test`）还会跑真实素材 / 导出 / 音频窗口等依赖运行时布局的段，须在具备 `p0/` 布局的机器上跑。

## 工程结构

| 目录 | 内容 |
|---|---|
| `core/` | 会话（ProjectSession）、模型评估（validateProject / evaluate）、schema 迁移、部件、编辑命令 |
| `renderer/` | 编辑界面与画布渲染 |
| `examples/` `fixtures/` `component-packs/` | 示例工程、测试夹具、可复用部件 |
| `docs/` | 交付使用指南与验收门槛 |

## 可靠性与可退役架构

- **回归**：一套 `node:test` 套件（上述逻辑段 184/184），由 `npm test` 分多段执行；开发维护四条基线（生产 / 原始 / 新基线 / 工作树）防回归，改动需逐段验证。
- **确定性迁移**：schema 显式版本化 s1→s2→s3→s4，迁移纯函数化、确定性、可测；旧兼容层可整体退役而不削弱新版保证。
- **质量证据**：真实导出 455 帧三方画面一致、18 个编码边界 PNG 严格一致、48 个 AAC 音频窗口独立通过。

## 数据与会话（隐私）

- **一切发生在本地**：工程 = manifest + 托管资源（媒体帧、对白文本），编辑、预检、导出均在本机调用本地 ffmpeg。
- **不上传、不遥测**：没有网络上报、没有分析埋点；导出失败仅在本地写 `*.log`（已被 .gitignore 忽略）。
- **导出即产物**：唯一"出站"是作者自己 `git push` 这个仓库。

## 局限（诚实说明）

- **不是独立安装包**：必须保持相邻 `p0/` 运行时布局（Electron + ffmpeg），`npm install` 不会安装它们。
- **不是完整自动创作工具**：旧 schema 功能不能按新默认 v4 推定全部开放。
- **机器核验 ≠ 人工验收**：帧对照与音频信号路径由机器核验；干净系统、真人听感、长篇 / 预算临界场景仍需人工确认。
- **完整回归依赖运行时**：`npm test` 的导出 / 真实素材段需要 `p0/` 布局；仅靠仓库本身只能跑纯逻辑段。
- 受限视频插播暂不支持裁剪 / 循环 / 倍速 / 重叠；导出预算按单输入 256 MiB、规范输出 512 MiB 设限。

## 开发

- **改一处，回放一处**：`node --test --test-isolation=none core/<模块>.test.cjs` 单文件冒烟。
- **改动纪律**：改动前先落快照 / 可回滚备份；试点 → 全量；报告与原始产物分层留存。

## 卸载

删除工程目录即完全移除。不写注册表、不注册系统服务、不留后台进程。

## 文档

- [交付使用指南](docs/交付使用指南.md)
- [最终交付清单与验收门槛](docs/最终交付清单与验收门槛.md)

## License

[MIT](LICENSE)