# ReplayForge

[![license](https://img.shields.io/badge/license-MIT-brightgreen)](LICENSE) [![version](https://img.shields.io/badge/version-v0.1.0-blue)](https://github.com/youran0faust/ReplayForge/releases/tag/v0.1.0) [![Electron](https://img.shields.io/badge/Electron-44.4.5-47848F)](https://www.electronjs.org/) [![platform](https://img.shields.io/badge/platform-Windows-0078D6)](.) [![tests](https://img.shields.io/badge/tests-%7E1900%20cases-3FB950)](.)

> **[简体中文](README.md) · English · MIT**

> **A natural-language script goes in — a frame-exact, editable, portable film comes out.**

ReplayForge turns natural-language scripts (TXT/MD) plus loose media assets into **frame-accurate, editable, reusable, portable** video projects, and exports them deterministically to MP4. The whole engine was built with an AI-agent-driven pipeline and ships with an ~1900-case regression suite and four baseline validations.

## What problem it solves

Turning a script into shippable video traditionally means a relay race across screenwriting, storyboarding, editing, audio and subtitle tools: humans line up frames by eye and sync lips syllable by syllable — a one-frame mistake means re-syncing, a single edit means re-exporting, and a different machine cannot open the project.

ReplayForge's answer is "the project is the authority":

| Pain point | How the engine solves it |
|---|---|
| Eye-balling frames | Everything is defined in `durationFrames` / `visibleFrom` / `visibleTo`, position keyframes, expression events and dialogue `revealFrames`; exports are verifiable frame by frame (455/563 frames PNG-exact before/after codec, AAC audio windows independently checked) |
| Dialogue laid out by hand | Real dialogue pagination (not word-by-word alignment), reading time, voice continuity and subtitle hold time |
| Editing a character touches every instance | Definition/instance layering: one template edit applies to all referencing instances; copy-on-write keeps shared changes from affecting other characters |
| Media formats will not come in | Compressed audio OGG/Opus/MP3 → 48 kHz PCM16; limited video interludes (`@视频 文件.mp4`) |
| Projects die with the machine | Portable project = manifest + managed assets, reopenable on another machine |
| A broken export dirties everything | Locked concurrent worker, ENOSPC fails early with zero dirty writes, cancel/retry, old-render protection |

## Quick start

Runtime dependencies: Node.js, Electron 44.4.5 (or a sibling `p0/` runtime layout), ffmpeg / ffprobe.

```powershell
node run-electron.cjs        # Node entry
# or double-click 启动P2编辑器.bat  # Windows launch
```

Run the full regression:

```powershell
npm test
```

## Repository layout

| Path | What is inside |
|---|---|
| `core/` | Sessions (ProjectSession), model evaluation (validateProject / evaluate), schema migration, components, edit commands |
| `renderer/` | Editor UI and canvas rendering |
| `examples/` `fixtures/` `component-packs/` | Sample projects, test fixtures, reusable component packs |
| `docs/` | Delivery guide and acceptance criteria |

## Reliability and a retireable architecture

- **Regression**: `node:test` full suite, ~1900 cases / 11 standalone scripts; four baselines (production / original / new baseline / working tree) guard against drift, validated segment by segment.
- **Deterministic migration**: schemas are explicitly versioned s1→s2→s3→s4 with pure, deterministic, testable migration functions; legacy compatibility layers can be retired wholesale without weakening new guarantees.

## Limitations (honest)

- **Not a standalone installer**: needs a sibling `p0/` runtime layout (Electron + ffmpeg); `npm install` will not install those.
- **Not a fully automatic creation tool**: legacy-schema features cannot be assumed open under the new default v4.
- **Machine checks ≠ human acceptance**: frame and audio-path checks are machine-verified; clean-system, human listening and long / budget-critical scenarios still need manual confirmation.
- Limited video interludes do not support trimming / looping / speed / overlap; export budgets cap at 256 MiB input and 512 MiB normalized output.

## Docs

- [Delivery guide (中文)](docs/交付使用指南.md)
- [Acceptance criteria (中文)](docs/最终交付清单与验收门槛.md)

## License

[MIT](LICENSE)
