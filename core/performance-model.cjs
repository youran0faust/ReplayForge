'use strict';
// Independent of model/source validation and audio.
const {validateTitleStyle} = require('./title-style.cjs');
const TITLE_TEXT_LIMIT = 4096;
const FIELDS = {
  characterOpacity: ['id', 'characterId', 'startFrame', 'endFrame', 'from', 'to'],
  screenFades: ['id', 'startFrame', 'endFrame', 'from', 'to'],
  dialogueVisibility: ['id', 'frame', 'visible'],
  dialogueClears: ['id', 'frame'],
  titles: ['id', 'startFrame', 'endFrame', 'fadeInFrames', 'fadeOutFrames', 'text', 'style']
};
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const frame = v => Number.isSafeInteger(v) && v >= 0;
const opacity = v => Number.isFinite(v) && v >= 0 && v <= 1;
function performanceErrors(project) {
  const perf = project?.scene?.performance;
  if (perf === undefined) return [];
  const errors = [];
  if (project.schemaVersion !== 4) errors.push('performance requires schema4');
  if (!object(perf)) return [...errors, 'performance must be an object'];
  if (perf.version !== 1) errors.push('performance version must be 1');
  if (Reflect.ownKeys(perf).some(k => k !== 'version' && !Object.hasOwn(FIELDS, k))) errors.push('performance unknown field');
  const duration = project.scene.durationFrames, ids = new Set();
  const characters = new Map((Array.isArray(project.scene.characters) ? project.scene.characters : []).filter(object).map(c => [c.id, c]));
  for (const [name, fields] of Object.entries(FIELDS)) {
    if (perf[name] === undefined) continue;
    if (!Array.isArray(perf[name])) { errors.push(`performance ${name} must be an array`); continue; }
    const groups = new Map();
    for (const entry of perf[name]) {
      const label = `performance ${name}`;
      if (!object(entry)) { errors.push(`${label} entry invalid`); continue; }
      if (Reflect.ownKeys(entry).some(k => !fields.includes(k))) errors.push(`${label} unknown field`);
      if (typeof entry.id !== 'string' || !entry.id.trim() || ids.has(entry.id)) errors.push(`${label} id invalid or duplicate`);
      ids.add(entry.id);
      const interval = fields.includes('startFrame');
      const valid = interval
        ? frame(entry.startFrame) && frame(entry.endFrame) && entry.startFrame < entry.endFrame && entry.endFrame <= duration
        : frame(entry.frame) && entry.frame < duration;
      if (!valid) errors.push(`${label} range invalid`);
      if (fields.includes('from') && (!opacity(entry.from) || !opacity(entry.to))) errors.push(`${label} opacity must be finite 0..1`);
      if (name === 'characterOpacity') {
        const character = characters.get(entry.characterId);
        if (typeof entry.characterId !== 'string' || !character) errors.push(`${label} character instance missing`);
        else if (entry.startFrame < character.visibleFrom || entry.endFrame > character.visibleTo) errors.push(`${label} outside character visibility range`);
      }
      if (name === 'dialogueVisibility' && typeof entry.visible !== 'boolean') errors.push(`${label} visible must be boolean`);
      if (name === 'titles') {
        errors.push(...validateTitleStyle(entry.style).map(error => `${label} ${error}`));
        if (!frame(entry.fadeInFrames) || !frame(entry.fadeOutFrames) || entry.fadeInFrames + entry.fadeOutFrames > entry.endFrame - entry.startFrame) errors.push(`${label} fade range invalid`);
        if (typeof entry.text !== 'string' || !entry.text.trim() || entry.text.length > TITLE_TEXT_LIMIT) errors.push(`${label} text must be nonempty and at most ${TITLE_TEXT_LIMIT} characters`);
      }
      if (valid) {
        const key = name === 'characterOpacity' ? entry.characterId : name;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(entry);
      }
    }
    for (const entries of groups.values()) {
      const interval = fields.includes('startFrame');
      entries.sort((a, b) => interval ? a.startFrame - b.startFrame : a.frame - b.frame);
      for (let i = 1; i < entries.length; i++) {
        if (interval ? entries[i].startFrame < entries[i - 1].endFrame : entries[i].frame === entries[i - 1].frame) errors.push(`performance ${name} overlapping property`);
      }
    }
  }
  return errors;
}
function latest(entries, f, key) {
  let result = null;
  for (const entry of entries || []) if (entry[key] <= f && (!result || entry[key] > result[key])) result = entry;
  return result;
}
function trackValue(entry, f, fallback) {
  if (!entry) return fallback;
  if (f >= entry.endFrame) return entry.to;
  return entry.from + (entry.to - entry.from) * ((f - entry.startFrame) / (entry.endFrame - entry.startFrame));
}
// Validated project in, fresh projection out; seek order has no effect.
function evaluatePerformance(project, f) {
  const perf = project.scene?.performance, characterOpacity = {};
  for (const character of project.scene?.characters || []) {
    const entry = latest((perf?.characterOpacity || []).filter(e => e.characterId === character.id), f, 'startFrame');
    Object.defineProperty(characterOpacity, character.id, {value: trackValue(entry, f, 1), enumerable: true, configurable: true, writable: true});
  }
  const activeTitle = latest(perf?.titles, f, 'startFrame');
  let title = null;
  if (activeTitle && f < activeTitle.endFrame) {
    const fadeIn = activeTitle.fadeInFrames ? Math.min(1, (f - activeTitle.startFrame) / activeTitle.fadeInFrames) : 1;
    const fadeOut = activeTitle.fadeOutFrames ? Math.min(1, (activeTitle.endFrame - f) / activeTitle.fadeOutFrames) : 1;
    title = {text: activeTitle.text, opacity: Math.min(fadeIn, fadeOut)};
    if (activeTitle.style !== undefined) title.style = {...activeTitle.style};
  }
  return {
    characterOpacity,
    screenOpacity: trackValue(latest(perf?.screenFades, f, 'startFrame'), f, 0),
    dialogueVisible: latest(perf?.dialogueVisibility, f, 'frame')?.visible ?? true,
    clearFrame: latest(perf?.dialogueClears, f, 'frame')?.frame ?? null,
    title
  };
}
function finalizePerformance(state, project, f) {
  if (project.scene.performance === undefined) return state;
  const projection = evaluatePerformance(project, f);
  return {...state,
    characters: state.characters.map(c => ({...c, opacity: projection.characterOpacity[c.id] ?? 1})),
    dialogues: state.dialogues.filter(d => projection.dialogueVisible && (projection.clearFrame === null || d.startFrame >= projection.clearFrame)),
    performance: {screenOpacity: projection.screenOpacity, title: projection.title, dialogueVisible: projection.dialogueVisible}
  };
}
module.exports = {TITLE_TEXT_LIMIT, performanceErrors, evaluatePerformance, finalizePerformance};
