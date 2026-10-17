const {app, BrowserWindow} = require('electron');
let videoProvider;
const fs = require('fs'), path = require('path'), {pathToFileURL} = require('url'), {spawn} = require('child_process');
const cancelled = () => !!process.env.REPLAY_EXPORT_CANCEL && fs.existsSync(process.env.REPLAY_EXPORT_CANCEL);
function checkCancelled() { if (cancelled()) throw Error('导出已取消'); }
const {ProjectSession} = require('./core/session.cjs');
const {diagnoseAudio} = require('./core/resource-index.cjs');
const {compileAudioTimeline, buildFfmpegArgs} = require('./core/audio-timeline.cjs');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.setPath('userData', process.env.REPLAY_EXPORT_OUTPUT ? path.join(process.env.REPLAY_EXPORT_OUTPUT, 'profile') : path.join(__dirname, 'user-data/export'));
app.setPath('sessionData', app.getPath('userData'));
app.whenReady().then(async () => {
  checkCancelled();
  const {ffmpegPath:ff} = require('./core/export-dependencies.cjs').checkExportDependencies({appRoot:__dirname});
  const input = JSON.parse(fs.readFileSync(process.env.REPLAY_EXPORT_INPUT || path.join(__dirname, 'examples/rain-corridor-v4.json'), 'utf8').replace(/^\uFEFF/, ''));
  const project = input.project || input;
  const projectRoot = process.env.REPLAY_PROJECT_ROOT || __dirname;
  const session = new ProjectSession(project), diag = diagnoseAudio(project, projectRoot);
  if (diag.hasErrors) throw Error(JSON.stringify(diag.diagnostics));
  const timeline = compileAudioTimeline(project, diag);
  const {width, height} = project.design, N = project.scene.durationFrames;
  const out = process.env.REPLAY_EXPORT_OUTPUT || path.join(__dirname, 'runtime-output');
  fs.mkdirSync(path.join(out, 'frames'), {recursive: true});
  fs.writeFileSync(path.join(out, 'export-snapshot.json'), JSON.stringify({project, revision: input.revision ?? session.revision, frames: N, timeline}, null, 2));
  const urls = Object.fromEntries(Object.entries(diag.resources).map(([id, r]) => [id, pathToFileURL(r.absolute).href]));
  const win = new BrowserWindow({width: Math.max(width, 5), height: height + 1, useContentSize: true, show: false, webPreferences: {offscreen: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false}});
  await win.loadFile(path.join(__dirname, 'renderer/export.html'));
  if (project.scene.videoClips?.length) {
    const cacheRoot = path.join(out, 'video-cache'); fs.mkdirSync(cacheRoot, {recursive:true});
    videoProvider = require('./core/video-frame-provider.cjs').createVideoFrameProvider({cacheRoot,ffmpegPath:ff,check:checkCancelled});
    await win.webContents.executeJavaScript('(()=>{globalThis.__exportVideoFrames = {}; globalThis.__requestVideoFrame = request => {const value=globalThis.__exportVideoFrames[request.resourceId+":"+request.localFrame];if(!value)throw Error("Export video frame is not prepared");return Promise.resolve(value);};return true;})()');
  }
  await win.webContents.executeJavaScript(`initialize(${JSON.stringify(project)},${JSON.stringify(urls)})`);
  for (let f = 0; f < N; f++) {
    checkCancelled();
    const state = session.evaluate(f);
    if (state.activeVideo) {
      const {resourceId,localFrame} = state.activeVideo;
      const videoFrame = await videoProvider.frame({project,projectRoot,resourceId,localFrame});
      checkCancelled();
      await win.webContents.executeJavaScript(`globalThis.__exportVideoFrames = {${JSON.stringify(resourceId+':'+localFrame)}:${JSON.stringify(videoFrame)}};`);
    }
    await win.webContents.executeJavaScript(`renderFrame(${JSON.stringify(state)})`);
    const image = await require('./core/export-capture.cjs').capturePaintedFrame(win.webContents, {width, height, token:f+1, checkCancelled});
    if (image.getSize().width !== width || image.getSize().height !== height) throw Error('Capture size mismatch');
    fs.writeFileSync(path.join(out, 'frames', `${String(f).padStart(4, '0')}.png`), image.toPNG());
  }
  const outputPath = path.join(out, 'p1-preview.mp4');
  const args = buildFfmpegArgs({project, timeline, resources: diag.resources, framesPattern: path.join(out, 'frames/%04d.png'), outputPath});
  const log = fs.openSync(path.join(out, 'encode.log'), 'w');
  try {
    checkCancelled();
    await new Promise((resolve, reject) => {
      const child = spawn(ff, args, {stdio:['ignore', log, log], windowsHide:true});
      let spawnError, requested = false;
      const timer = setInterval(() => {
        if (cancelled() && !requested) { requested = true; child.kill(); }
      }, 50);
      child.once('error', error => { spawnError = error; });
      child.once('close', code => {
        clearInterval(timer);
        if (cancelled()) reject(Error('导出已取消'));
        else if (spawnError) reject(spawnError);
        else if (code !== 0) reject(Error('FFmpeg failed; inspect encode.log'));
        else resolve();
      });
    });
    checkCancelled();
  } finally { fs.closeSync(log); }
  console.log(JSON.stringify({status: 'PASS', frames: N, timeline, output: outputPath}));
  await videoProvider?.dispose();
  win.destroy();
  app.quit();
}).catch(async e => { console.error(e); try { await videoProvider?.dispose(); } catch(cleanupError) { console.error(cleanupError); } app.exit(1); });
