const fs = require('fs');
const path = require('path');
const {randomUUID} = require('crypto');

// Initial contract: RIFF PCM16, 48 kHz, mono/stereo only.
function parseVoiceWav(bytes) {
  if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw Error('语音必须是 RIFF/WAVE PCM16 文件');
  const end = bytes.readUInt32LE(4) + 8;
  if (end !== bytes.length) throw Error('WAV RIFF 长度与文件不符');
  let offset = 12, format, dataBytes;
  while (offset < end) {
    if (offset + 8 > end) throw Error('WAV chunk 头部不完整');
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8, next = start + size + (size % 2);
    if (next > end) throw Error('WAV chunk 数据超出文件边界');
    if (id === 'fmt ') {
      if (format || (size !== 16 && size !== 18)) throw Error('WAV fmt chunk 无效');
      const encoding = bytes.readUInt16LE(start);
      const channels = bytes.readUInt16LE(start + 2);
      const sampleRate = bytes.readUInt32LE(start + 4);
      const byteRate = bytes.readUInt32LE(start + 8);
      const blockAlign = bytes.readUInt16LE(start + 12);
      const bitsPerSample = bytes.readUInt16LE(start + 14);
      if (encoding !== 1 || bitsPerSample !== 16 || sampleRate !== 48000 || ![1, 2].includes(channels)) throw Error('仅支持 48 kHz、单声道或双声道 PCM16 WAV');
      if (blockAlign !== channels * 2 || byteRate !== sampleRate * blockAlign || (size === 18 && bytes.readUInt16LE(start + 16) !== 0)) throw Error('WAV PCM 格式参数不一致');
      format = {sampleRate, channels, bitsPerSample, blockAlign};
    } else if (id === 'data') {
      if (dataBytes !== undefined) throw Error('WAV 包含多个 data chunk');
      dataBytes = size;
    }
    offset = next;
  }
  if (!format || !dataBytes || dataBytes % format.blockAlign !== 0) throw Error('WAV 音频数据缺失或采样帧不完整');
  return {...format, dataBytes, durationSamples: dataBytes / format.blockAlign};
}

function requireDialogue(project, id) {
  if (typeof id !== 'string' || !id) throw Error('对白 ID 无效');
  const dialogue = project.scene.dialogues.find(d => d.id === id);
  if (!dialogue) throw Error('对白不存在');
  return dialogue;
}

function importVoice(session, dialogueId, sourceFile, projectRoot) {
  const snapshot = session.snapshot();
  if (![1, 2, 3, 4].includes(snapshot.schemaVersion)) throw Error('Unsupported schemaVersion for voice import');
  const dialogue = requireDialogue(snapshot, dialogueId);
  // Validate and copy identical bytes, even if the source changes afterwards.
  const bytes = fs.readFileSync(sourceFile);
  const info = parseVoiceWav(bytes);
  if (info.durationSamples * snapshot.design.fps > (snapshot.scene.durationFrames - dialogue.startFrame) * 48000) throw Error('语音超出场景末尾，请缩短音频或调整对白开始帧');
  const root = fs.realpathSync(projectRoot);
  const directory = path.join(root, 'assets', 'imported');
  for (const part of [path.join(root, 'assets'), directory]) {
    if (fs.existsSync(part)) {
      const stat = fs.lstatSync(part);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('导入资源目录必须是工程内的普通目录');
    } else fs.mkdirSync(part);
  }
  const uuid = randomUUID();
  const resourceId = 'voice_' + uuid;
  const relative = 'assets/imported/' + uuid + '.wav';
  const target = path.join(root, relative);
  let created = false;
  try {
    const fd = fs.openSync(target, 'wx'); // Never overwrite, even on UUID collisions.
    created = true;
    try { fs.writeFileSync(fd, bytes); } finally { fs.closeSync(fd); }
    session.apply(project => {
      const selected = requireDialogue(project, dialogueId);
      if ((project.resources || []).some(r => r.id === resourceId)) throw Error('语音资源 ID 冲突');
      (project.resources ||= []).push({id: resourceId, kind: 'audio', mime: 'audio/wav', path: relative,
        sampleRate: info.sampleRate, channels: info.channels, bitsPerSample: info.bitsPerSample, durationSamples: info.durationSamples});
      if ([2, 3, 4].includes(project.schemaVersion)) {
        delete selected.voice;
        selected.voiceClips = [{id:'clip_'+uuid,resourceId,sampleRate:48000,sourceOffsetSamples:0,durationSamples:info.durationSamples,binding:{dialogueId,mode:'follow',followOffsetFrames:0}}];
      } else selected.voice = {resourceId, durationSamples: info.durationSamples};
    }, 'import and bind voice');
  } catch (error) {
    if (created) fs.unlinkSync(target);
    throw error;
  }
  // Undo removes registration + assignment together but deliberately keeps the
  // imported file for redo, saved snapshots and in-flight exports.
  return {revision: session.revision, resourceId, durationSamples: info.durationSamples};
}

function unbindVoice(session, dialogueId) {
  const dialogue = requireDialogue(session.snapshot(), dialogueId);
  if (dialogue.voiceClips !== undefined) throw Error('voiceClips requires deleteVoiceClip; cannot silently remove all clips');
  if (!dialogue.voice) return {revision: session.revision};
  session.apply(project => { delete requireDialogue(project, dialogueId).voice; }, 'unbind voice');
  // Keep resources/files: other dialogues and snapshots may reference them.
  return {revision: session.revision};
}

module.exports = {importVoice, unbindVoice, parseVoiceWav};
