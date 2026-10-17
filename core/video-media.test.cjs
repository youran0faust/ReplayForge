'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { normalizeVideo, assertSelfContainedMp4 } = require('./video-media.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'video-media-unit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceFile = path.join(root, 'source.mp4'), outputDirectory = path.join(root, 'out');
  fs.writeFileSync(sourceFile, '0000ftypisom00000'); fs.mkdirSync(outputDirectory);
  return { sourceFile, outputDirectory, ffmpegPath: process.execPath, ffprobePath: process.execPath };
}
function atom(tag, payload) { const b = Buffer.alloc(8); b.writeUInt32BE(8 + payload.length); b.write(tag, 4); return Buffer.concat([b, payload]); }
function mp4(reference = null) {
  const ftyp = atom('ftyp', Buffer.from('isom0000'));
  const entry = atom('url ', reference === null ? Buffer.from([0, 0, 0, 1]) : Buffer.concat([Buffer.alloc(4), Buffer.from(reference + '\0')]));
  const dref = atom('dref', Buffer.concat([Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]), entry]));
  return Buffer.concat([ftyp, ['dinf', 'minf', 'mdia', 'trak', 'moov'].reduce((b, tag) => atom(tag, b), dref)]);
}
test('shared synchronous MP4 gate rejects HLS/concat and local external dref', t => {
  const f = fixture(t);
  for (const bytes of ['#EXTM3U\nhttps://example.invalid/a.ts', "ffconcat version 1.0\nfile 'private.mp4'"]) {
    fs.writeFileSync(f.sourceFile, bytes); assert.throws(() => assertSelfContainedMp4(f.sourceFile), /MP4 container/);
  }
  fs.writeFileSync(f.sourceFile, mp4('file:///C:/private.mp4')); assert.throws(() => assertSelfContainedMp4(f.sourceFile), /external MP4/);
  fs.writeFileSync(f.sourceFile, mp4()); assert.equal(assertSelfContainedMp4(f.sourceFile), undefined);
});
for (const replace of ['directory', 'file']) test(`cleanup preserves foreign replacement ${replace}`, async t => {
  const f = fixture(t); fs.writeFileSync(f.sourceFile, mp4());
  let victim, replaced = false;
  const originalLstat = fs.promises.lstat;
  if (replace === 'directory') {
    fs.promises.lstat = async function (file, ...args) {
      if (!replaced && file === f.outputDirectory && fs.readdirSync(f.outputDirectory).length) {
        try {
          const name = fs.readdirSync(f.outputDirectory)[0];
          fs.renameSync(f.outputDirectory, f.outputDirectory + '-original'); fs.mkdirSync(f.outputDirectory);
          victim = path.join(f.outputDirectory, name); fs.writeFileSync(victim, 'FOREIGN'); replaced = true;
        } catch (e) { if (!['EPERM', 'EACCES'].includes(e.code)) throw e; }
      }
      return originalLstat.call(this, file, ...args);
    };
    t.after(() => { fs.promises.lstat = originalLstat; });
  }
  await assert.rejects(normalizeVideo({ ...f, check: () => {
    if (replaced) return;
    const files = fs.readdirSync(f.outputDirectory);
    if (!files.length) return;
    const name = files[0];
    if (replace === 'directory') {
      // Windows denies renaming a directory containing an open log FD. Close-time
      // failure cleanup is tested by replacing after its lstat await instead below.
      try { fs.renameSync(f.outputDirectory, f.outputDirectory + '-original'); } catch (e) { if (e.code === 'EPERM' || e.code === 'EACCES') return; throw e; }
      fs.mkdirSync(f.outputDirectory);
    } else fs.renameSync(path.join(f.outputDirectory, name), path.join(f.outputDirectory, name + '-original'));
    victim = path.join(f.outputDirectory, name); fs.writeFileSync(victim, 'FOREIGN'); replaced = true;
    throw new Error('replacement cancellation');
  } }));
  assert(replaced); assert.equal(fs.readFileSync(victim, 'utf8'), 'FOREIGN');
});
test('public async function and ordinary absolute input paths', async t => {
  assert.equal(typeof normalizeVideo, 'function'); const f = fixture(t);
  await assert.rejects(normalizeVideo({ ...f, sourceFile: 'relative.mp4' }), /absolute/);
  assert.deepEqual(fs.readdirSync(f.outputDirectory), []);
});
test('existing output directory must be empty; never delete caller file', async t => {
  const f = fixture(t), sentinel = path.join(f.outputDirectory, 'keep'); fs.writeFileSync(sentinel, 'keep');
  await assert.rejects(normalizeVideo(f), /empty/); assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep');
});
test('async check rejection is preserved', async t => {
  const f = fixture(t), error = new Error('cancelled');
  await assert.rejects(normalizeVideo({ ...f, check: async () => { throw error; } }), e => e === error);
  assert.deepEqual(fs.readdirSync(f.outputDirectory), []);
});
test('container sniff rejects renamed playlist before subprocess', async t => {
  const f = fixture(t); fs.writeFileSync(f.sourceFile, '#EXTM3U\nhttps://example.invalid/media.ts');
  await assert.rejects(normalizeVideo(f), /MP4 container/);
});
test('source limit is checked before reading content', async t => {
  const f = fixture(t); fs.truncateSync(f.sourceFile, 256 * 1024 * 1024 + 1);
  await assert.rejects(normalizeVideo(f), /size budget/);
});
test('ancestor junction/symlink rejected', async t => {
  const f = fixture(t), link = path.join(path.dirname(f.sourceFile), 'linked');
  try { fs.symlinkSync(f.outputDirectory, link, process.platform === 'win32' ? 'junction' : 'dir'); } catch (e) { if (e.code === 'EPERM') { t.skip('OS does not permit symlink creation'); return; } throw e; }
  await assert.rejects(normalizeVideo({ ...f, outputDirectory: link }), /symlink/);
});
