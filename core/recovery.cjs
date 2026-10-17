'use strict';
const fs = require('fs'), path = require('path');
const {randomUUID} = require('crypto');
const {savePortable, openPortable} = require('./project-storage.cjs');
const GENERATION = /^gen-[0-9a-f]{8}-[0-9a-f-]{27}$/;
function normalizeDraft(draft) {
  if (draft == null) return null;
  if (typeof draft !== 'object' || typeof draft.text !== 'string' || !Number.isSafeInteger(draft.baseRevision) || draft.baseRevision < 0 || typeof draft.dirty !== 'boolean' || typeof draft.stale !== 'boolean') throw Error('Invalid code draft');
  return {text:draft.text, baseRevision:draft.baseRevision, dirty:draft.dirty, stale:draft.stale};
}
class RecoveryStore {
  constructor(root) { this.root = path.resolve(root); this.pointer = path.join(this.root, 'latest.json'); }
  ensureRoot() {
    fs.mkdirSync(this.root, {recursive:true});
    if (fs.lstatSync(this.root).isSymbolicLink() || !fs.statSync(this.root).isDirectory()) throw Error('Recovery root must be an ordinary directory');
  }
  atomic(file, data) {
    const tmp = file + '.' + randomUUID() + '.tmp';
    try {
      const fd = fs.openSync(tmp, 'wx');
      try { fs.writeFileSync(fd, JSON.stringify(data, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, file);
    } finally { try { fs.unlinkSync(tmp); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  }
  inspect() {
    if (!fs.existsSync(this.pointer)) return null;
    this.ensureRoot();
    const record = JSON.parse(fs.readFileSync(this.pointer, 'utf8'));
    if (record.format !== 'replay-recovery' || !GENERATION.test(record.generation)) throw Error('Invalid recovery pointer');
    const root = path.join(this.root, record.generation);
    if (fs.lstatSync(root).isSymbolicLink() || !fs.statSync(root).isDirectory()) throw Error('Invalid recovery generation');
    const meta = JSON.parse(fs.readFileSync(path.join(root, 'record.json'), 'utf8'));
    return {root, file:path.join(root, 'project.json'), draft:normalizeDraft(meta.draft), timestamp:meta.timestamp, originalFile:meta.originalFile};
  }
  open() { const record = this.inspect(); return record ? {...openPortable(record.file), draft:record.draft, timestamp:record.timestamp} : null; }
  write({project, revision, root, draft, originalFile = null}) {
    this.ensureRoot();
    const generation = 'gen-' + randomUUID(), dir = path.join(this.root, generation), timestamp = Date.now();
    fs.mkdirSync(dir);
    try {
      savePortable(project, revision, root, path.join(dir, 'project.json'));
      this.atomic(path.join(dir, 'record.json'), {draft:normalizeDraft(draft), originalFile, timestamp});
      this.atomic(this.pointer, {format:'replay-recovery', generation});
    } catch (error) { fs.rmSync(dir, {recursive:true, force:true}); throw error; }
    try { this.cleanup(generation, root); } catch (_) {}
    return timestamp;
  }
  cleanup(current, sourceRoot) {
    const old = fs.readdirSync(this.root, {withFileTypes:true}).filter(e => e.isDirectory() && !e.isSymbolicLink() && GENERATION.test(e.name) && e.name !== current && path.resolve(this.root, e.name) !== path.resolve(sourceRoot))
      .map(e => ({name:e.name, time:fs.statSync(path.join(this.root, e.name)).mtimeMs})).sort((a,b)=>b.time-a.time);
    // Last two plus, if distinct, the active restored source generation.
    for (const entry of old.slice(1)) { try { fs.rmSync(path.join(this.root, entry.name), {recursive:true, force:true}); } catch (_) {} }
  }
  clear() { this.ensureRoot(); try { fs.unlinkSync(this.pointer); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
}
module.exports = {RecoveryStore, normalizeDraft};
