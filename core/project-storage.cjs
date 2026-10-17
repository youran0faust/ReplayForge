const fs = require('fs');
const path = require('path');
const {randomUUID, createHash} = require('crypto');
const {clone, validateProject} = require('./model.cjs');

// The model owns schema validation (including schema4). Storage must neither
// upgrade schemas implicitly nor translate persisted speaker/display fields.
function validate(project) { if (!project || typeof project !== 'object' || Array.isArray(project)) throw Error('Invalid project'); const errors = validateProject(project); if (errors.length) throw Error(errors.join('; ')); }
function contained(root, file) { const relative = path.relative(root, file); return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); }
function directory(root) { const real = fs.realpathSync(root); if (!fs.statSync(real).isDirectory()) throw Error('Project root must be a directory'); return real; }
function resourceFile(root, resource) { const name = resource.path; if (typeof name !== 'string' || !name || name.includes('\0') || path.isAbsolute(name) || path.win32.isAbsolute(name)) throw Error('Resource path must be relative to the project root'); const resolved = path.resolve(root, name); if (!contained(root, resolved)) throw Error('Resource path escapes project root: ' + name); const real = fs.realpathSync(resolved); if (!contained(root, real)) throw Error('Resource symlink escapes project root: ' + name); if (!fs.statSync(real).isFile()) throw Error('Resource must be a file: ' + name); return real; }
function hashFile(file) { const h = createHash('sha256'); h.update(fs.readFileSync(file)); return h.digest('hex'); }
function ensureAssets(root) { const assets = path.join(root, 'assets'); if (!fs.existsSync(assets)) fs.mkdirSync(assets); if (fs.lstatSync(assets).isSymbolicLink() || !fs.statSync(assets).isDirectory() || !contained(root, fs.realpathSync(assets))) throw Error('Managed assets must be an ordinary directory inside the project root'); return assets; }

function saveSessionPortable(session, sourceRoot, targetFile) {
  if (!session || typeof session.snapshot !== 'function') throw Error('Invalid session');
  if (!Number.isSafeInteger(session.revision) || session.revision < 0) throw Error('Invalid project revision');
  const source = directory(sourceRoot), current = session.snapshot(); validate(current);
  const snapshots = [{kind:'current', project:current}, ...(session.history || []).map(h => ({kind:'history', project:h.before, label:h.label})), ...(session.future || []).map(f => ({kind:'future', project:f.project}))];
  snapshots.forEach(s => validate(s.project));
  const file = path.resolve(targetFile), root = path.dirname(file);
  const allFiles = new Map();
  for (const snap of snapshots) for (const resource of snap.project.resources || []) { const sourceFile = resourceFile(source, resource); allFiles.set(sourceFile, resource); }
  if (fs.existsSync(file) && [...allFiles.keys()].includes(fs.realpathSync(file))) throw Error('Manifest target cannot replace a source resource');
  fs.mkdirSync(root, {recursive:true}); const realRoot = directory(root), assets = ensureAssets(root);
  let temporary; const created = [];
  try {
    const rebased = new Map();
    for (const [sourceFile, resource] of allFiles) {
      // A save in the same root can retain already-portable paths (including old history assets).
      const sourceRelative = path.relative(realRoot, sourceFile);
      if (source === realRoot && sourceRelative.startsWith('assets' + path.sep)) {
        rebased.set(sourceFile, sourceRelative.split(path.sep).join('/'));
        continue;
      }
      const hash = hashFile(sourceFile), ext = path.extname(resource.path), basename = hash + ext;
      let destination = path.join(assets, basename), relative = path.relative(root, destination).split(path.sep).join('/');
      if (fs.existsSync(destination)) { if (fs.lstatSync(destination).isSymbolicLink() || !fs.statSync(destination).isFile() || !contained(realRoot, fs.realpathSync(destination)) || hashFile(destination) !== hash) throw Error('Managed asset content mismatch: ' + basename); }
      else { fs.copyFileSync(sourceFile, destination, fs.constants.COPYFILE_EXCL); created.push(destination); }
      rebased.set(sourceFile, relative);
    }
    const outputs = snapshots.map(s => { const p = clone(s.project); for (const r of p.resources || []) r.path = rebased.get(resourceFile(source, r)); return p; });
    const candidateTemp = path.join(root, '.' + path.basename(file) + '.' + randomUUID() + '.tmp'); const fd = fs.openSync(candidateTemp, 'wx'); temporary = candidateTemp;
    try { fs.writeFileSync(fd, JSON.stringify({format:'replay-project', revision:session.revision, project:outputs[0]}, null, 2), 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, file); temporary = undefined;
    const historyCount = (session.history || []).length;
    return {project: outputs[0], root, file, revision:session.revision,
      history: outputs.slice(1, 1 + historyCount).map((project, i) => ({label: session.history[i].label, before: project})),
      future: outputs.slice(1 + historyCount).map(project => ({project}))};
  } catch (error) { if (temporary) try { fs.unlinkSync(temporary); } catch (_) {} for (const createdFile of created) try { fs.unlinkSync(createdFile); } catch (_) {} throw error; }
}
function savePortable(project, revision, sourceRoot, targetFile) { const fake = {revision, snapshot:()=>project, history:[], future:[]}; return saveSessionPortable(fake, sourceRoot, targetFile); }
function openPortable(filename, rawRoot) { const file = path.resolve(filename); const data = JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')); const envelope = data && typeof data === 'object' && Object.hasOwn(data,'project'); if (envelope && data.format !== 'replay-project') throw Error('Unsupported project format'); const project = envelope ? data.project : data, revision = envelope ? data.revision : 0; if (!Number.isSafeInteger(revision) || revision < 0) throw Error('Invalid project revision'); validate(project); const root = envelope || rawRoot === undefined ? path.dirname(file) : path.resolve(rawRoot); const realRoot = directory(root); for (const resource of project.resources || []) resourceFile(realRoot, resource); return {project, root, file, revision}; }
module.exports = {savePortable, saveSessionPortable, openPortable};
