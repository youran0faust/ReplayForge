'use strict';
// Standard synthetic inputs only. No Electron, GUI, export, or userData access.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const {scanAssets} = require('./core/script-asset-catalog.cjs');
const {preflight, textHash} = require('./core/script-preflight.cjs');

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const name = Buffer.from(type), result = Buffer.alloc(bytes.length + 12);
  result.writeUInt32BE(bytes.length); name.copy(result, 4); bytes.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, bytes])), bytes.length + 8);
  return result;
}
// Real RGBA PNG using Node builtins; nativeImage may be injected instead.
function png(width, height, color, character, nativeImage) {
  const bitmap = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4;
    const inside = !character || ((x - width / 2) / (width * .43)) ** 2 + ((y - height / 2) / (height * .48)) ** 2 <= 1;
    bitmap[at] = color[0]; bitmap[at + 1] = color[1]; bitmap[at + 2] = color[2]; bitmap[at + 3] = inside ? 255 : 0;
  }
  if (nativeImage) return nativeImage.createFromBitmap(bitmap, {width, height, scaleFactor: 1}).toPNG();
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) bitmap.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
function wav(frames, frequency) {
  const samples = frames * 1600, bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(48000, 24); bytes.writeUInt32LE(96000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(1800 * Math.min(1, i / 480, (samples - i) / 480) * Math.sin(2 * Math.PI * frequency * i / 48000)), 44 + i * 2);
  return bytes;
}
function spec() {
  return {
    text: [
      '## 同一工程标准合成样例（不是人工听看验收）',
      '@背景 room.png', '@音乐 music.wav', '@出场 甲 位置=双人左', '@出场 乙 位置=双人右',
      '甲[微笑]：这是第一段合成配音对白，两位角色在同一工程中出现。文字需要跨页展示，完整原文与配音样本保持一致，不用任何用户素材。',
      '@音效 pulse.wav', '@停顿 0.5秒 保留=true', '@背景 night.png',
      '乙[惊讶]：背景已经切换为夜色，这段使用另一份独立合成声音。分页只改变字幕页面，不拆分配音，也不能改变声音的实际持续时间。',
      '@表情 乙 微笑',
      '甲[惊讶]：这一段明确选择无配音，不能借用前面的声音。每页使用配置的阅读时长，最后还有一次不保留字幕的停顿。',
      '@停顿 0.75秒 保留=false', '@音效 pulse.wav', '@停顿 0.5秒',
      '@退场 甲', '@退场 乙', '@音乐 停止 时长=0.25秒'
    ].join('\n') + '\n',
    config: {
      version: 1, defaultLayout: '双人', dialoguePageMaxCharacters: 28,
      unvoicedTimingMode: 'fixed', unvoicedDurationSeconds: 2,
      dialogueRevealCharactersPerSecond: 35, dialoguePageHoldSeconds: .3,
      characters: ['甲', '乙'].map((name, i) => ({name, voiceCode: i ? 'B' : 'A', image: `${name}/base.png`,
        expressions: ['微笑', '惊讶'], defaultExpression: '微笑',
        expressionImages: {微笑: `${name}/smile.png`, 惊讶: `${name}/surprise.png`}}))
    },
    audioFrames: {'配音/A_001_synthetic.wav': 180, '配音/B_001_synthetic.wav': 210, '音乐/music.wav': 1800, '音效/pulse.wav': 12}
  };
}
/** root must be a caller-created, empty, non-symlink test-owned directory.
 * Inputs for later real DOM pagination + generatePortableScript, not fake export evidence.
 */
function createInputs({root, nativeImage} = {}) {
  assert(typeof root === 'string' && path.isAbsolute(root), 'root must be an absolute test-owned directory');
  root = path.resolve(root);
  for (let current = root;; current = path.dirname(current)) {
    assert(!fs.lstatSync(current).isSymbolicLink(), 'test-owned root must not traverse symlinks');
    if (path.dirname(current) === current) break;
  }
  assert(fs.statSync(root).isDirectory() && fs.readdirSync(root).length === 0, 'root must already exist and be empty');
  const s = spec(), assetsRoot = path.join(root, 'source'), outputParent = path.join(root, 'generated');
  fs.mkdirSync(assetsRoot); fs.mkdirSync(outputParent);
  const put = (relative, bytes) => {
    const file = path.join(assetsRoot, relative);
    fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, bytes, {flag: 'wx'});
  };
  put('背景/room.png', png(960, 540, [45, 100, 170], false, nativeImage));
  put('背景/night.png', png(960, 540, [30, 25, 65], false, nativeImage));
  for (const [i, name] of ['甲', '乙'].entries()) {
    for (const [j, expression] of ['base', 'smile', 'surprise'].entries()) {
      put(`角色/${name}/${expression}.png`, png(180, 300, i ? [200, 80 + j * 50, 30] : [30 + j * 50, 170, 220], true, nativeImage));
    }
  }
  Object.entries(s.audioFrames).forEach(([file, frames], i) => put(file, wav(frames, [220, 330, 110, 880][i])));
  const catalog = scanAssets(assetsRoot), initial = preflight({text: s.text, config: s.config, catalog});
  const dialogues = initial.nodes.filter(n => n.type === 'dialogue');
  assert.equal(dialogues.length, 3);
  const voiceFiles = ['配音/A_001_synthetic.wav', '配音/B_001_synthetic.wav'];
  const corrections = {version: 1, sourceHash: textHash(s.text), overrides: Object.fromEntries(dialogues.map((n, i) =>
    [n.id, i === 2 ? {status: 'unvoiced'} : {resourceId: catalog.assets.find(a => a.relativePath === voiceFiles[i]).id}]))};
  const snapshot = {text: s.text, config: s.config, catalog, corrections}, report = preflight(snapshot);
  assert.equal(report.ok, true, JSON.stringify(report.diagnostics));
  const paths = {script: path.join(root, 'script.txt'), config: path.join(root, 'config.json'), corrections: path.join(root, 'corrections.json'), report: path.join(root, 'preflight.json')};
  fs.writeFileSync(paths.script, s.text, {flag: 'wx'});
  for (const [key, value] of Object.entries({config: s.config, corrections, report})) fs.writeFileSync(paths[key], JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
  const intendedElements = {sameProject: true, characters: 2, expressionsPerCharacter: 2, backgrounds: 2,
    dialogues: 3, voicedDialogues: 2, explicitUnvoicedDialogues: 1, pauseFrames: [15, 23, 15],
    bgmTracks: 1, sfxEvents: 2, videoClips: 0, syntheticOnly: true};
  return {root, assetsRoot, outputParent, paths, scriptFile: paths.script, configFile: paths.config,
    correctionsFile: paths.corrections, reportFile: paths.report, intendedElements,
    ...snapshot, snapshot, report, audioFrames: s.audioFrames,
    summary: {intendedElements, preflightOk: report.ok, mediaValidated: false, domPaginationExecuted: false, guiGenerationExecuted: false, mp4ExportExecuted: false,
      limitations: ['Synthetic tones are not speech.', 'A-preflight does not validate media.', 'Real DOM pagination, GUI generation and MP4 export are pending parent execution.']}};
}
module.exports = {createInputs, spec};
