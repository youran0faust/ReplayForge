'use strict';
const {SAMPLE_RATE} = require('./audio-timeline.cjs');

// One committed drag is one transaction; previews never enter history.
function applyTimelineEdit(session, patch) {
  const fields = ['kind', 'id', 'startFrame', 'endFrame'];
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(patch)) ||
      Reflect.ownKeys(patch).some(key => ![...fields, 'pageId'].includes(key)) ||
      !fields.every(key => Object.hasOwn(patch, key))) throw Error('时间轴编辑参数无效');
  const {kind, id, startFrame, endFrame} = patch, internal = Object.hasOwn(patch, 'pageId');
  if (!['dialogues', 'characters'].includes(kind)) throw Error('时间轴轨道无效');
  if (typeof id !== 'string' || !id.trim()) throw Error('时间轴对象 ID 无效');
  if (internal && (kind !== 'dialogues' || typeof patch.pageId !== 'string' || !patch.pageId.trim())) throw Error('页边界目标无效');
  const project = session.snapshot();
  if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame) ||
      startFrame < 0 || endFrame <= startFrame || endFrame > project.scene.durationFrames) {
    throw Error('时间轴范围必须为场景内的有效整数帧');
  }
  const item = project.scene[kind].find(entry => entry.id === id);
  if (!item) throw Error('时间轴对象不存在');
  let mode = 'plain', pageIndex = -1;
  if (kind === 'dialogues') {
    if (internal) {
      pageIndex = item.pages?.findIndex(page => page.id === patch.pageId) ?? -1;
      const page = item.pages?.[pageIndex], next = item.pages?.[pageIndex + 1];
      if (!page || !next || startFrame !== page.startFrame || endFrame >= next.endFrame) throw Error('内部页边界必须保留两页至少一帧，且不能改变前页起点');
      mode = 'boundary';
    } else if (item.pages) {
      const ds = startFrame - item.startFrame, de = endFrame - item.endFrame;
      if (ds === de) mode = 'move';
      else if (de === 0) {
        if (startFrame >= item.pages[0].endFrame) throw Error('第一页至少保留一帧');
        mode = 'start';
      } else if (ds === 0) {
        if (endFrame <= item.pages[item.pages.length - 1].startFrame) throw Error('最后一页至少保留一帧');
        mode = 'end';
      } else throw Error('不能同时以不同偏移改变对白组两端');
    } else if (endFrame - startFrame < item.revealFrames) throw Error('对白区间不能短于文字揭示时长');
    for (const voice of item.voiceClips || (item.voice ? [item.voice] : [])) {
      const {durationSamples, sampleRate} = voice;
      if (!Number.isSafeInteger(durationSamples) || durationSamples <= 0 ||
          (sampleRate != null && sampleRate !== SAMPLE_RATE)) throw Error('对白语音采样信息无效');
      // An internal boundary never changes the parent's audio start or duration.
      const parentStart = internal ? item.startFrame : startFrame;
      const voiceStart = voice.binding?.mode === 'independent' ? voice.startFrame : parentStart + (voice.binding?.followOffsetFrames ?? 0);
      const startSamples = voiceStart * SAMPLE_RATE / project.design.fps;
      const sceneSamples = project.scene.durationFrames * SAMPLE_RATE / project.design.fps;
      if (!Number.isSafeInteger(startSamples) || startSamples < 0 || !Number.isSafeInteger(sceneSamples) ||
          !Number.isSafeInteger(startSamples + durationSamples)) throw Error('对白语音采样边界无效');
      if (startSamples + durationSamples > sceneSamples) throw Error('语音超出场景末尾');
    }
  }
  // Keep a schema4 subtitle's post-dialogue hold duration when its outer range changes.
  // Internal page boundaries do not affect the parent interval or hold.
  let displayUntilFrame;
  if (kind === 'dialogues' && project.schemaVersion === 4 && !internal) {
    displayUntilFrame = endFrame + (item.displayUntilFrame - item.endFrame);
    if (!Number.isSafeInteger(displayUntilFrame) || displayUntilFrame < endFrame || displayUntilFrame > project.scene.durationFrames) throw Error('字幕保持终点超出场景；不会自动截短保持时间');
  }
  const startKey = kind === 'dialogues' ? 'startFrame' : 'visibleFrom';
  const endKey = kind === 'dialogues' ? 'endFrame' : 'visibleTo';
  const compared = internal ? item.pages[pageIndex] : item;
  if (compared[startKey] === startFrame && compared[endKey] === endFrame) return {revision: session.revision, changed: false};
  session.apply(next => {
    const selected = next.scene[kind].find(entry => entry.id === id);
    if (kind === 'characters') require('./performance-character-edit.cjs').editCharacterOpacity(next, selected, startFrame, endFrame);
    const clamp = page => { page.revealFrames = Math.min(page.revealFrames, page.endFrame - page.startFrame); };
    if (mode === 'boundary') {
      const left = selected.pages[pageIndex], right = selected.pages[pageIndex + 1];
      left.endFrame = right.startFrame = endFrame;
      clamp(left); clamp(right);
    } else {
      if (mode === 'move') {
        const delta = startFrame - selected.startFrame;
        for (const page of selected.pages) { page.startFrame += delta; page.endFrame += delta; }
      } else if (mode === 'start') { selected.pages[0].startFrame = startFrame; clamp(selected.pages[0]); }
      else if (mode === 'end') { const last = selected.pages[selected.pages.length - 1]; last.endFrame = endFrame; clamp(last); }
      selected[startKey] = startFrame;
      selected[endKey] = endFrame;
      if (displayUntilFrame !== undefined) selected.displayUntilFrame = displayUntilFrame;
    }
    if (selected.pages) clamp(selected);
  }, 'edit timeline');
  return {revision: session.revision, changed: true};
}
module.exports = {applyTimelineEdit};
