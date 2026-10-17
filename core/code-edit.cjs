'use strict';
const {isDeepStrictEqual} = require('node:util');
const {validateProject} = require('./model.cjs');
const {SAMPLE_RATE} = require('./audio-timeline.cjs');
const MAX_CODE_BYTES = 2 * 1024 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Unknown project fields retain the existing model validator's permissive behavior.
// This is not a complete JSON schema validator or a WAV content diagnosis.
function validateVoiceRanges(project) {
  for (const dialogue of project.scene.dialogues) {
    if (dialogue.voice == null) continue;
    const voice = dialogue.voice;
    const resource = project.resources?.find(r => r.id === voice.resourceId);
    if (!object(voice) || !resource || resource.kind !== 'audio' ||
        !Number.isSafeInteger(voice.durationSamples) || voice.durationSamples <= 0 ||
        (voice.sampleRate != null && voice.sampleRate !== SAMPLE_RATE) ||
        (resource.sampleRate != null && resource.sampleRate !== SAMPLE_RATE) ||
        (!voice.binding && resource.durationSamples != null && resource.durationSamples !== voice.durationSamples)) throw Error('Invalid voice metadata or audio resource');
    const effectiveStart = voice.binding?.mode === 'independent' ? voice.startFrame : dialogue.startFrame + (voice.binding?.followOffsetFrames ?? 0);
    const start = effectiveStart * SAMPLE_RATE / project.design.fps;
    const end = project.scene.durationFrames * SAMPLE_RATE / project.design.fps;
    if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(end) || end <= 0 ||
        !Number.isSafeInteger(start + voice.durationSamples) || start + voice.durationSamples > end) throw Error('Voice extends beyond scene or has unsafe/non-integral sample boundaries');
  }
}

function applyProjectCode(session, payload) {
  if (!object(payload) || ![Object.prototype, null].includes(Object.getPrototypeOf(payload)) ||
      Reflect.ownKeys(payload).length !== 2 || !Object.hasOwn(payload, 'text') || !Object.hasOwn(payload, 'expectedRevision')) throw Error('Expected {text, expectedRevision}');
  if (typeof payload.text !== 'string' || Buffer.byteLength(payload.text, 'utf8') > MAX_CODE_BYTES) throw Error('Project JSON text must be a string of at most 2 MiB');
  if (!Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0) throw Error('expectedRevision must be a non-negative safe integer');
  if (payload.expectedRevision !== session.revision) throw Error('Stale project revision; refresh the draft before applying');
  let next;
  try { next = JSON.parse(payload.text); }
  catch (error) { throw Error('Invalid project JSON: ' + error.message); }
  if (!object(next) || Object.hasOwn(next, 'project')) throw Error('Expected a plain project, not a saved envelope');
  const current = session.snapshot();
  if (next.id !== current.id) throw Error('Project id must remain unchanged');
  if (next.schemaVersion !== current.schemaVersion) throw Error('Schema version cannot be edited directly; use an explicit upgrade operation');
  if (!isDeepStrictEqual(next.resources, current.resources)) throw Error('Resource registry cannot be edited in project JSON; use resource import');
  if (!object(next.scene) || !Array.isArray(next.scene.dialogues) || next.scene.dialogues.some(d => !object(d))) throw Error('Invalid scene/dialogues');
  const errors = validateProject(next);
  if (errors.length) throw Error(errors.join('; '));
  for (const dialogue of next.scene.dialogues) {
    if (!object(dialogue.text) || Object.values(dialogue.text).some(text => typeof text !== 'string')) throw Error('Dialogue text must contain locale strings');
  }
  for (const binding of [next.scene.background, ...([3,4].includes(next.schemaVersion)?next.characterDefinitions:next.scene.characters)]) {
    if (binding?.resourceId && !next.resources?.some(r => r.id === binding.resourceId && r.kind === 'image')) throw Error('Image binding requires an image resource');
  }
  validateVoiceRanges(next);
  if (isDeepStrictEqual(next, current)) return {revision: session.revision, changed: false};
  session.apply(project => {
    for (const key of Object.keys(project)) delete project[key];
    for (const key of Object.keys(next)) Object.defineProperty(project, key, {value: next[key], enumerable: true, writable: true, configurable: true});
  }, 'apply project code');
  return {revision: session.revision, changed: true};
}
module.exports = {applyProjectCode, MAX_CODE_BYTES};
