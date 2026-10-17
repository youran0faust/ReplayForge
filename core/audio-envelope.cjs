/* Pure sample-local BGM envelope shared by Node and browser playback. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AudioEnvelope = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function trackFadeErrors(track, project) {
    if (!track || !Object.prototype.hasOwnProperty.call(track, 'fadeOutSamples')) return [];
    const errors = [], label = `audioTrack ${track.id || '?'} fadeOutSamples`;
    if (project?.schemaVersion !== 4) errors.push(`${label} requires schema4`);
    if (track.kind !== 'bgm') errors.push(`${label} is only supported for bgm`);
    if (!Number.isSafeInteger(track.fadeOutSamples) || track.fadeOutSamples < 0 ||
        !Number.isSafeInteger(track.durationSamples) || track.durationSamples <= 0 || track.fadeOutSamples > track.durationSamples)
      errors.push(`${label} must be a nonnegative safe integer <= durationSamples`);
    return errors;
  }
  function audioEnvelopeErrors(project) {
    const tracks = project?.scene?.audioTracks;
    return Array.isArray(tracks) ? tracks.flatMap(track => trackFadeErrors(track, project)) : [];
  }
  function envelopeAtSample(durationSamples, fadeOutSamples = 0, elapsedSamples = 0) {
    if (!Number.isSafeInteger(durationSamples) || durationSamples <= 0 || !Number.isSafeInteger(fadeOutSamples) ||
        fadeOutSamples < 0 || fadeOutSamples > durationSamples || !Number.isFinite(elapsedSamples)) throw Error('Invalid audio envelope samples');
    if (!fadeOutSamples || elapsedSamples < durationSamples - fadeOutSamples) return 1;
    return Math.min(1, Math.max(0, (durationSamples - elapsedSamples) / fadeOutSamples));
  }
  return {trackFadeErrors, audioEnvelopeErrors, envelopeAtSample};
});
