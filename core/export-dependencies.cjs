const fs = require('fs');
const path = require('path');

// appRoot is trusted application code, never a project or renderer path.
// Pure file inspection: no executable probes, downloads or project writes.
function checkExportDependencies({appRoot = path.resolve(__dirname, '..')} = {}) {
  const ffmpegPath = path.resolve(appRoot, '../p0/tools/ffmpeg.exe');
  let isFile = false;
  try { isFile = fs.statSync(ffmpegPath).isFile(); } catch (_) { /* Missing or unreadable. */ }
  if (!isFile) throw Error(`无法导出：缺少FFmpeg运行文件（或不是普通文件）：${ffmpegPath}。请修复相邻p0/tools，不修改工程。`);
  // Video frames use this same FFmpeg; ffprobe is only needed by import.
  return {ffmpegPath};
}

module.exports = {checkExportDependencies};
