'use strict';
// Mutate only a transaction candidate; source provenance stays historical evidence.
function editCharacterOpacity(project, character, startFrame, endFrame) {
  if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame) || startFrame < 0 || endFrame <= startFrame || endFrame > project.scene.durationFrames) throw Error('角色范围必须为场景内的有效整数帧');
  const all = project.scene.performance?.characterOpacity;
  if (!all || (startFrame === character.visibleFrom && endFrame === character.visibleTo)) return;
  const entries = all.filter(e => e.characterId === character.id);
  if (!entries.length) return;
  const delta = startFrame - character.visibleFrom;
  let replacements;
  if (endFrame - character.visibleTo === delta) {
    replacements = entries.map(e => {
      const start = e.startFrame + delta, end = e.endFrame + delta;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < startFrame || end > endFrame) throw Error('透明度演出移动超出角色范围');
      return {...e, startFrame: start, endFrame: end};
    });
  } else {
    replacements = [];
    const ordered = [...entries].sort((a,b) => a.startFrame - b.startFrame);
    for (const e of ordered) {
      const start = Math.max(startFrame, e.startFrame), end = Math.min(endFrame, e.endFrame);
      if (start >= end) continue;
      const value = f => f === e.startFrame ? e.from : f === e.endFrame ? e.to : e.from + (e.to - e.from) * ((f - e.startFrame) / (e.endFrame - e.startFrame));
      replacements.push({...e, startFrame: start, endFrame: end, from: value(start), to: value(end)});
    }
    // Completed predecessors control gaps and the tail; reuse their removed identity.
    const predecessor = ordered.filter(e => e.startFrame <= startFrame).at(-1);
    if (predecessor && predecessor.endFrame <= startFrame && predecessor.to !== 1) {
      const end = Math.min(endFrame, replacements[0]?.startFrame ?? endFrame);
      if (end > startFrame) replacements.unshift({...predecessor, startFrame, endFrame: end, from: predecessor.to, to: predecessor.to});
    }
  }
  const byId = new Map(replacements.map(e => [e.id, e]));
  project.scene.performance.characterOpacity = all.flatMap(e => e.characterId !== character.id ? [e] : byId.has(e.id) ? [byId.get(e.id)] : []);
}
module.exports = {editCharacterOpacity};
