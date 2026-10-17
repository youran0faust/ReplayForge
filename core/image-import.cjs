const fs = require('fs');
const path = require('path');
const {randomUUID} = require('crypto');
const MAX_BYTES = 32 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function dimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > 8192 || height > 8192 || width * height > 50000000) throw Error('图片尺寸无效：边长最多 8192，像素最多 50MP');
  return {width, height};
}
function parsePng(bytes) {
  let offset = 8, image, data = false, endedData = false;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw Error('PNG chunk 头部不完整');
    const size = bytes.readUInt32BE(offset), start = offset + 8, next = start + size + 4;
    if (next > bytes.length) throw Error('PNG chunk 超出文件边界');
    const type = bytes.toString('ascii', offset + 4, start);
    if (!/^[A-Za-z]{4}$/.test(type)) throw Error('PNG chunk 类型无效');
    if (!image && type !== 'IHDR') throw Error('PNG 缺少首个 IHDR');
    if (type === 'IHDR') {
      if (image || size !== 13) throw Error('PNG IHDR 无效');
      image = dimensions(bytes.readUInt32BE(start), bytes.readUInt32BE(start + 4));
      const depths = {0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16]};
      if (!depths[bytes[start + 9]]?.includes(bytes[start + 8]) || bytes[start + 10] !== 0 || bytes[start + 11] !== 0 || bytes[start + 12] > 1) throw Error('PNG IHDR 格式无效');
    } else if (type === 'IDAT') {
      if (endedData) throw Error('PNG IDAT 必须连续');
      data ||= size > 0;
    } else {
      if (data) endedData = true;
      if (type === 'IEND') {
        if (size !== 0 || !data || next !== bytes.length) throw Error('PNG IEND 或图像数据无效');
        return {...image, mime: 'image/png', extension: '.png'};
      }
    }
    offset = next;
  }
  throw Error('PNG 缺少 IEND');
}
function parseJpeg(bytes) {
  let offset = 2, image, scan = false, inScan = false;
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (offset < bytes.length) {
    if (inScan) {
      while (offset < bytes.length && bytes[offset] !== 0xff) offset++;
      if (offset >= bytes.length) break;
    }
    if (bytes[offset++] !== 0xff) throw Error('JPEG marker 无效');
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) break;
    const marker = bytes[offset++];
    if (inScan && (marker === 0 || (marker >= 0xd0 && marker <= 0xd7))) continue;
    inScan = false;
    if (marker === 0xd9) {
      if (!image || !scan || offset !== bytes.length) throw Error('JPEG 图像数据或结束标记无效');
      return {...image, mime: 'image/jpeg', extension: '.jpg'};
    }
    if (marker === 0 || marker === 0xd8 || marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) throw Error('JPEG marker 顺序无效');
    if (offset + 2 > bytes.length) throw Error('JPEG segment 头部不完整');
    const size = bytes.readUInt16BE(offset), start = offset + 2, next = offset + size;
    if (size < 2 || next > bytes.length) throw Error('JPEG segment 超出文件边界');
    if (sof.has(marker)) {
      if (image || size < 11) throw Error('JPEG SOF 无效');
      const components = bytes[start + 5];
      if (!components || size !== 8 + 3 * components || bytes[start] !== 8) throw Error('JPEG SOF 格式无效');
      image = dimensions(bytes.readUInt16BE(start + 3), bytes.readUInt16BE(start + 1));
    } else if (marker === 0xda) {
      if (!image || size < 8 || !bytes[start] || size !== 6 + 2 * bytes[start]) throw Error('JPEG SOS 无效');
      scan = true;
      inScan = true;
    }
    offset = next;
  }
  throw Error('JPEG 缺少结束标记');
}
// Metadata parsing is structural; main verifies decoding on the identical bytes.
function parseImage(bytes, extension) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_BYTES) throw Error('图片必须是最多 32MB 的 PNG/JPEG 文件');
  let ext;
  if (extension !== undefined) {
    if (typeof extension !== 'string') throw Error('图片扩展名无效');
    ext = extension.toLowerCase().replace(/^\./, '');
    if (!['png', 'jpg', 'jpeg'].includes(ext)) throw Error('仅支持 PNG/JPEG 图片');
  }
  let info;
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) info = parsePng(bytes);
  else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) info = parseJpeg(bytes);
  else throw Error('图片不是有效的 PNG/JPEG');
  if (ext && (ext === 'png') !== (info.mime === 'image/png')) throw Error('图片内容与扩展名不符');
  return info;
}
function requireImageTarget(project, target) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) throw Error('图片绑定目标无效');
  if (target.kind === 'background') {
    if (target.id !== undefined || !project.scene.background || typeof project.scene.background !== 'object') throw Error('背景绑定目标无效');
    return project.scene.background;
  }
  if (target.kind === 'character' && typeof target.id === 'string' && target.id) {
    if([3,4].includes(project.schemaVersion))throw Error('在角色模板页编辑，影响全部引用实例');
    const character = project.scene.characters.find(c => c.id === target.id);
    if (character) return character;
    throw Error('角色不存在');
  }
  throw Error('图片绑定目标无效');
}
function importImage(session, target, sourceFile, projectRoot, options = {}) {
  requireImageTarget(session.snapshot(), target);
  return importManagedImage(session, target, sourceFile, projectRoot, options);
}
function importExpressionImage(session, sourceFile, projectRoot, options = {}) {
  return importManagedImage(session, null, sourceFile, projectRoot, options);
}
function importManagedImage(session, target, sourceFile, projectRoot, options) {
  if (fs.statSync(sourceFile).size > MAX_BYTES) throw Error('图片文件不能超过 32MB');
  const bytes = fs.readFileSync(sourceFile), info = parseImage(bytes, path.extname(sourceFile));
  if (options.decodeImage) {
    const decoded = options.decodeImage(bytes);
    if (!decoded || decoded.width !== info.width || decoded.height !== info.height) throw Error('图片无法完整解码或尺寸不一致');
  }
  const root = fs.realpathSync(projectRoot), directory = path.join(root, 'assets', 'imported');
  for (const part of [path.join(root, 'assets'), directory]) {
    if (fs.existsSync(part)) {
      const stat = fs.lstatSync(part);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('导入资源目录必须是工程内的普通目录');
    } else fs.mkdirSync(part);
  }
  const uuid = randomUUID(), resourceId = 'image_' + uuid;
  const relative = 'assets/imported/' + uuid + info.extension, destination = path.join(root, relative);
  let created = false;
  try {
    const fd = fs.openSync(destination, 'wx');
    created = true;
    try { fs.writeFileSync(fd, bytes); } finally { fs.closeSync(fd); }
    session.apply(project => {
      const selected = target === null ? null : requireImageTarget(project, target);
      if ((project.resources || []).some(r => r.id === resourceId)) throw Error('图片资源 ID 冲突');
      (project.resources ||= []).push({id: resourceId, kind: 'image', mime: info.mime, path: relative, width: info.width, height: info.height});
      if (selected) selected.resourceId = resourceId;
    }, target === null ? 'import expression image' : 'import and bind image');
  } catch (error) {
    if (created) fs.unlinkSync(destination);
    throw error;
  }
  // Retain previous resources and successful copies for undo/redo and snapshots.
  return {revision: session.revision, resourceId, width: info.width, height: info.height};
}
function unbindImage(session, target) {
  if (requireImageTarget(session.snapshot(), target).resourceId === undefined) return {revision: session.revision};
  session.apply(project => { delete requireImageTarget(project, target).resourceId; }, 'unbind image');
  return {revision: session.revision};
}
module.exports = {importExpressionImage, importImage, unbindImage, parseImage, requireImageTarget};
