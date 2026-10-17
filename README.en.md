# ReplayForge

[![license](https://img.shields.io/badge/license-MIT-brightgreen)](LICENSE) [![version](https://img.shields.io/badge/version-v0.1.0-blue)](https://github.com/youran0faust/ReplayForge/releases/tag/v0.1.0) [![Electron](https://img.shields.io/badge/Electron-44.4.5-47848F)](https://www.electronjs.org/) [![platform](https://img.shields.io/badge/platform-Windows-0078D6)](.) [![tests](https://img.shields.io/badge/tests-184%20logic%20cases-3FB950)](.)

> **[简体中文](README.md) · English · MIT**

> **Move to another machine and your render is suddenly locked away?**

ReplayForge turns natural-language scripts (TXT/MD) plus loose media assets into **frame-accurate, editable, reusable, portable** video projects and exports them deterministically to MP4. The engine was built with an AI-agent-driven pipeline and ships with a `node:test` automatic regression (example below).

## What problem it solves

Turning a script into shippable video traditionally means a relay race across screenwriting, storyboarding, editing, audio and subtitle tools: humans line up frames by eye and sync lips syllable by syllable. So—

> **a one-frame mistake means re-syncing, a single edit means re-exporting, and a different machine cannot open the project; generic AIGC video is a black box — not frame-accurate, not editable, not reusable, not auditable.**

ReplayForge's answer is "the project is the authority":

| Pain point | How the engine solves it |
|---|---|
| Eye-balling frames | Everything is defined in `durationFrames` / `visibleFrom` / `visibleTo`, position keyframes, expression events and dialogue `revealFrames`; exports are verifiable frame by frame (455/563 frames PNG-exact before/after codec, AAC audio windows independently checked) |
| Dialogue laid out by hand | Real dialogue pagination (not word-by-word alignment), reading time, voice continuity and subtitle hold time |
| Editing a character touches every instance | Definition/instance layering: one template edit applies to all referencing instances; copy-on-write keeps shared changes from affecting other characters |
| Media formats will not come in | Compressed audio OGG/Opus/MP3 → 48 kHz PCM16; limited video interludes (`@视频 文件.mp4`) |
| Projects die with the machine | Portable project = manifest + managed assets, reopenable on another machine |
| A broken export dirties everything | Locked concurrent worker, ENOSPC fails early with zero dirty writes, cancel/retry, old-render protection |

## Installation & runtime

ReplayForge is not a standalone installer: it needs Node.js and an **adjacent runtime layout** (Electron 44.4.5 + ffmpeg/ffprobe, e.g. a sibling `p0/`); `npm install` will not install those.

- **A. Run directly**: once you have the project directory, `node run-electron.cjs`, or double-click `启动P2编辑器.bat` (Windows).
- **B. Run from the repo**: `git clone https://github.com/youran0faust/ReplayForge`, place a `p0/`-style runtime (Electron + ffmpeg) next to it, then do A.

## Commands

| Command | What it does |
|---|---|
| `node run-electron.cjs` / `启动P2编辑器.bat` | Launch the editor |
| `npm run script:preflight` | Pre-flight the script + assets (report format/gaps before editing) |
| `npm test` | Full automatic regression (multi-stage `node:test` + standalone scripts) |

## Example output

A **real run** excerpt (pure-logic stage of `npm test`: 8 `core/` files with `node --test --test-isolation=none`):

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

The full `npm test` further runs real-asset / export / audio-window stages that require the runtime layout (`p0/`).

## Repository layout

| Path | What is inside |
|---|---|
| `core/` | Sessions (ProjectSession), model evaluation (validateProject / evaluate), schema migration, components, edit commands |
| `renderer/` | Editor UI and canvas rendering |
| `examples/` `fixtures/` `component-packs/` | Sample projects, test fixtures, reusable component packs |
| `docs/` | Delivery guide and acceptance criteria |

## Reliability and a retireable architecture

- **Regression**: a `node:test` suite (the logic stage above runs 184/184) executed in stages by `npm test`; development keeps four baselines (production / original / new baseline / working tree) to guard against drift, validated segment by segment.
- **Deterministic migration**: schemas are explicitly versioned s1→s2→s3→s4 with pure, deterministic, testable migration functions; legacy compatibility layers can be retired wholesale without weakening new guarantees.
- **Quality evidence**: real exports verified 455 frames across three views, 18 encode-boundary PNGs exact, 48 AAC audio windows independently passed.

## Data & sessions (privacy)

- **Everything happens locally**: a project is a manifest + managed assets (media frames, dialogue text); editing, pre-flight and export all call local ffmpeg.
- **No upload, no telemetry**: no network reporting, no analytics; a failed export only writes a local `*.log` (gitignored).
- **The export IS the artifact**: the only "outbound" is the author's own `git push`.

## Limitations (honest)

- **Not a standalone installer**: needs an adjacent `p0/`-style runtime layout (Electron + ffmpeg); `npm install` will not install those.
- **Not a fully automatic creation tool**: legacy-schema features cannot be assumed open under the new default v4.
- **Machine checks ≠ human acceptance**: frame and audio-path checks are machine-verified; clean-system, human listening and long / budget-critical scenarios still need manual confirmation.
- **Full regression needs the runtime**: the export / real-asset stages of `npm test` require the `p0/` layout; with the repo alone only the pure-logic stages run.
- Limited video interludes do not support trimming / looping / speed / overlap; export budgets cap at 256 MiB input and 512 MiB normalized output.

## Development

- **One change, one replay**: `node --test --test-isolation=none core/<module>.test.cjs` for quick smoke tests.
- **Change discipline**: snapshot / rollback before a change; pilot → full; keep reports and raw artifacts separately.

## Uninstall

Delete the project directory to remove it entirely. No registry writes, no services, no lingering processes.

## Docs

- [Delivery guide (中文)](docs/交付使用指南.md)
- [Acceptance criteria (中文)](docs/最终交付清单与验收门槛.md)
- [CHANGELOG.md](CHANGELOG.md): version history

## License

[MIT](LICENSE)

