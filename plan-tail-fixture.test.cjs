'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const {createInputs} = require('./plan-tail-fixture.cjs');
const {preflight} = require('./core/script-preflight.cjs');
const {buildScriptProject} = require('./core/script-project-builder.cjs');
const {validateProject} = require('./core/model.cjs');

function ownedRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p2-plan-tail-fixture-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return root;
}
function fixture(t) { return createInputs({root: ownedRoot(t)}); }
// Deliberately mocked managed/probed media and pagination, NOT DOM or export evidence.
function mockBuildInputs(f) {
  const media = f.catalog.assets.map(a => ({id: a.id, kind: a.kind,
    path: 'assets/' + a.id + (a.kind === 'audio' ? '.wav' : '.png'),
    ...(a.kind === 'audio' ? {sampleRate: 48000, channels: 1, bitsPerSample: 16, durationSamples: f.audioFrames[a.relativePath] * 1600}
      : a.category === 'background' ? {width: 960, height: 540} : {width: 180, height: 300})}));
  const paginationPlan = f.report.nodes.filter(n => n.type === 'dialogue').map(n => ({nodeId: n.id,
    pages: Array.from({length: Math.ceil(n.text.length / 28)}, (_, i) => ({start: i * 28, end: Math.min(n.text.length, (i + 1) * 28), text: n.text.slice(i * 28, (i + 1) * 28)}))}));
  return {report: f.report, config: f.config, media, paginationPlan, schemaVersion: 4};
}

test('real input files and complete actual preflight; no generation/export claims', t => {
  const f = fixture(t);
  assert.equal(f.report.ok, true);
  assert.equal(f.scriptFile, f.paths.script); assert.equal(f.configFile, f.paths.config);
  assert.equal(f.correctionsFile, f.paths.corrections); assert.equal(f.reportFile, f.paths.report);
  assert.deepEqual(f.intendedElements, f.summary.intendedElements);
  assert.equal(f.report.stage, 'A-preflight-only');
  assert.equal(f.report.mediaValidated, false);
  assert.equal(f.report.canGenerate, false);
  assert.deepEqual(preflight(f.snapshot), f.report);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.paths.report, 'utf8')), f.report);
  assert.equal(fs.readFileSync(f.paths.script, 'utf8'), f.text);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.paths.config, 'utf8')), f.config);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.paths.corrections, 'utf8')), f.corrections);
  assert.deepEqual(f.report.bindings.map(b => b.status), ['manual', 'manual', 'unvoiced']);
  assert.equal(new Set(f.report.bindings.slice(0, 2).map(b => b.resourceId)).size, 2);
  assert.deepEqual(f.corrections.overrides[f.report.bindings[2].nodeId], {status: 'unvoiced'});
  assert.equal(f.catalog.assets.length, 12);
  assert.deepEqual(fs.readdirSync(f.outputParent), []);
  for (const key of ['mediaValidated', 'domPaginationExecuted', 'guiGenerationExecuted', 'mp4ExportExecuted']) assert.equal(f.summary[key], false);
  assert.equal(f.summary.intendedElements.expressionsPerCharacter, 2);
  assert.throws(() => createInputs({root: f.root}), /empty/);
});

test('generated PNG scanlines and WAV headers contain real synthetic payloads', t => {
  const f = fixture(t), images = [];
  for (const a of f.catalog.assets) {
    const b = fs.readFileSync(path.join(f.assetsRoot, a.relativePath));
    if (a.kind === 'audio') {
      assert.equal(b.toString('ascii', 0, 4), 'RIFF'); assert.equal(b.toString('ascii', 8, 16), 'WAVEfmt ');
      assert.equal(b.readUInt32LE(4), b.length - 8); assert.equal(b.readUInt16LE(20), 1);
      assert.equal(b.readUInt32LE(24), 48000); assert.equal(b.readUInt16LE(22), 1); assert.equal(b.readUInt16LE(34), 16);
      assert.equal(b.readUInt32LE(40), f.audioFrames[a.relativePath] * 3200);
      assert.equal(b.length, 44 + b.readUInt32LE(40)); assert(b.subarray(44).some(v => v !== 0));
    } else {
      assert.equal(b.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      const width = b.readUInt32BE(16), height = b.readUInt32BE(20), compressed = [];
      for (let at = 8; at < b.length;) {
        const length = b.readUInt32BE(at), type = b.toString('ascii', at + 4, at + 8);
        if (type === 'IDAT') compressed.push(b.subarray(at + 8, at + 8 + length));
        at += 12 + length;
      }
      const rows = zlib.inflateSync(Buffer.concat(compressed));
      assert.equal(rows.length, height * (width * 4 + 1));
      for (let y = 0; y < height; y++) assert.equal(rows[y * (width * 4 + 1)], 0);
      assert.deepEqual([width, height], a.category === 'background' ? [960, 540] : [180, 300]);
      images.push(b.toString('base64'));
    }
  }
  assert.equal(new Set(images).size, 8, 'backgrounds and expression images are distinct');
});

test('pure builder: same project, exact pages, times, two real expression mappings per role, voice/silence and BGM/SFX', t => {
  const f = fixture(t), input = mockBuildInputs(f), before = structuredClone(input);
  const built = buildScriptProject(input);
  assert(built.project, JSON.stringify(built.diagnostics)); assert.deepEqual(input, before);
  const p = built.project, s = p.scene, [first, second, silent] = s.dialogues;
  assert.deepEqual(validateProject(p), []); assert.equal(p.schemaVersion, 4);
  assert.equal(s.characters.length, 2); assert.equal(p.characterDefinitions.length, 2);
  assert.equal(s.backgroundEvents.length, 2); assert.equal(s.videoClips?.length || 0, 0);
  assert.equal(p.resources.length, 12);
  for (const definition of p.characterDefinitions) {
    assert.deepEqual(definition.expressions.map(e => e.name), ['微笑', '惊讶']);
    assert.equal(new Set(definition.expressions.map(e => e.resourceId)).size, 2);
    for (const expression of definition.expressions) assert(p.resources.some(r => r.id === expression.resourceId && r.kind === 'image'));
    const instance = s.characters.find(c => c.definitionId === definition.id);
    assert.equal(new Set(instance.expressionEvents.map(e => e.expressionId)).size, 2);
    assert.equal(instance.visibleFrom, 0); assert.equal(instance.visibleTo, s.durationFrames);
  }
  for (let i = 0; i < 3; i++) {
    const d = s.dialogues[i], node = f.report.nodes.find(n => n.id === input.paginationPlan[i].nodeId);
    assert(d.pages.length >= 2); assert.equal(d.pages.map(pg => pg.text['zh-CN']).join(''), node.text);
    assert.equal(d.fullText['zh-CN'], node.text); assert.equal(d.pages[0].startFrame, d.startFrame);
    assert.equal(d.pages.at(-1).endFrame, d.endFrame);
    d.pages.forEach((pg, j) => {
      if (j) assert.equal(pg.startFrame, d.pages[j - 1].endFrame);
      assert(pg.endFrame > pg.startFrame); assert(pg.revealFrames >= 1 && pg.revealFrames <= pg.endFrame - pg.startFrame);
    });
    assert.equal(d.voiceClips.length, i === 2 ? 0 : 1);
  }
  assert.equal(first.startFrame, 0); assert.equal(first.endFrame, 180);
  assert.equal(first.voiceClips[0].durationSamples, 180 * 1600);
  assert.equal(first.displayUntilFrame, 195); assert.equal(second.startFrame, 195);
  assert.equal(second.endFrame, 405); assert.equal(second.voiceClips[0].durationSamples, 210 * 1600);
  assert.equal(s.backgroundEvents[1].frame, 195);
  assert.equal(silent.startFrame, second.endFrame);
  assert.equal(silent.endFrame - silent.startFrame, silent.pages.length * 60);
  assert.equal(silent.displayUntilFrame, silent.endFrame, 'non-retained pause clears subtitle');
  assert.equal(s.durationFrames, silent.endFrame + 23 + 15);
  const bgm = s.audioTracks.filter(a => a.kind === 'bgm'), sfx = s.audioTracks.filter(a => a.kind === 'sfx');
  assert.equal(bgm.length, 1); assert.equal(bgm[0].startFrame, 0);
  assert.equal(bgm[0].durationSamples, s.durationFrames * 1600); assert.equal(bgm[0].fadeOutSamples, 12000);
  assert.deepEqual(sfx.map(a => a.startFrame), [180, silent.endFrame + 23]);
  assert(sfx.every(a => a.durationSamples === 12 * 1600));
  assert.equal(sfx.length, 2);
});

test('builder refuses missing pagination/media rather than claiming GUI success', t => {
  const f = fixture(t), input = mockBuildInputs(f);
  const missingPages = buildScriptProject({...input, paginationPlan: []});
  assert.equal(missingPages.project, null); assert(missingPages.diagnostics.some(d => d.code === 'PAGINATION_PLAN_REQUIRED'));
  const missingMedia = buildScriptProject({...input, media: []});
  assert.equal(missingMedia.project, null); assert(missingMedia.diagnostics.some(d => d.code === 'RESOURCE_UNAVAILABLE'));
});

test('nonempty roots and relative paths rejected without changing caller files', t => {
  const root = ownedRoot(t), sentinel = path.join(root, 'do-not-touch.txt');
  fs.writeFileSync(sentinel, 'owned sentinel');
  assert.throws(() => createInputs({root}), /empty/);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'owned sentinel');
  assert.deepEqual(fs.readdirSync(root), ['do-not-touch.txt']);
  assert.throws(() => createInputs({root: '.'}), /absolute/);
});
