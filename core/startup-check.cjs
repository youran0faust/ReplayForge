'use strict';
// Read-only preflight; never load Electron/main or create runtime directories.
const fs = require('node:fs');
const path = require('node:path');
const REQUIRED = Object.freeze([
  'main.cjs', 'renderer/index.html', 'renderer/preload.cjs', 'renderer/preview.js',
  'renderer/scene-renderer.js', 'renderer/scene.css', 'core/model.cjs', 'core/session.cjs',
  'examples/rain-corridor-v4.json',
  'assets/rain-corridor.svg', 'assets/alice.svg', 'assets/alice-voice.wav'
]);
function checkStartup({appRoot = path.resolve(__dirname, '..'), env = process.env} = {}) {
  // Absolute test injection only, never a CLI/environment app-root override.
  if (!path.isAbsolute(appRoot)) throw new TypeError('appRoot must be an absolute path');
  appRoot = path.resolve(appRoot);
  const paths = {
    appRoot, electron: path.resolve(appRoot, '../p0/node_modules/electron/dist/electron.exe'),
    main: path.join(appRoot, 'main.cjs'), renderer: path.join(appRoot, 'renderer/index.html'),
    defaultProject: path.join(appRoot, 'examples/rain-corridor-v4.json'),
    ffmpeg: path.resolve(appRoot, '../p0/tools/ffmpeg.exe'),
    ffprobe: path.resolve(appRoot, '../p0/tools/ffprobe.exe'),
    // Relative recovery overrides resolve against appRoot in BOTH launchers.
    recovery: path.resolve(appRoot, env.REPLAY_RECOVERY_DIR || 'runtime-output/recovery'),
    required: REQUIRED.map(file => path.resolve(appRoot, file)), assets: []
  };
  const errors = [], warnings = [];
  function fileCheck(file, target, label) {
    try {
      if (!fs.statSync(file).isFile()) throw new Error('not a regular file');
      fs.accessSync(file, fs.constants.R_OK);
      return true;
    } catch (error) {
      target.push(`${label}: ${file} (${error.code || error.message})`);
      return false;
    }
  }
  fileCheck(paths.electron, errors, 'Missing/unreadable Electron runtime');
  for (const file of paths.required) fileCheck(file, errors, 'Missing/unreadable editor file');
  if (!errors.some(error => error.includes(paths.defaultProject))) {
    try {
      const project = JSON.parse(fs.readFileSync(paths.defaultProject, 'utf8'));
      if (project.schemaVersion !== 4 || !Array.isArray(project.resources)) throw new Error('expected schemaVersion 4 and resources array');
      for (const resource of project.resources) {
        if (typeof resource.path !== 'string' || !resource.path) throw new Error('invalid resource path');
        const file = path.resolve(appRoot, resource.path);
        paths.assets.push(file);
        if (!paths.required.includes(file)) fileCheck(file, errors, 'Missing/unreadable default asset');
      }
    } catch (error) { errors.push(`Invalid default project: ${paths.defaultProject} (${error.message})`); }
  }
  fileCheck(paths.ffmpeg, warnings, 'FFmpeg unavailable; export/video features may fail; editing remains available');
  fileCheck(paths.ffprobe, warnings, 'ffprobe unavailable; video import/probing may fail; editing remains available');
  if (Object.keys(env).some(key => key.toUpperCase() === 'ELECTRON_RUN_AS_NODE')) warnings.push('ELECTRON_RUN_AS_NODE is set; it will be removed only from the editor child environment.');
  return {ok: errors.length === 0, errors, warnings, paths};
}
module.exports = {checkStartup, REQUIRED};
