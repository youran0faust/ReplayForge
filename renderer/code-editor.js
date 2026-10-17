(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.createCodeEditorController = factory().createCodeEditorController;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function projectText(project) { return JSON.stringify(project, null, 2); }
  function projectId(project) { return project && project.id != null ? String(project.id) : ''; }
  function createCodeEditorController() {
    let text = '', baseRevision = null, baseline = null, baselineProjectId = '', dirty = false, stale = false, latest = null;
    function snapshot() { return {text, baseRevision, dirty, stale}; }
    function sync(packet) {
      if (!packet || !packet.project) return snapshot();
      const incomingText = projectText(packet.project), incomingId = projectId(packet.project);
      if (!dirty) { text = incomingText; baseRevision = packet.revision; baseline = incomingText; baselineProjectId = incomingId; dirty = false; stale = false; }
      else stale = stale || packet.revision !== baseRevision || incomingId !== baselineProjectId || incomingText !== baseline;
      latest = {project: packet.project, revision: packet.revision}; return snapshot();
    }
    function edit(value) { if (typeof value !== 'string') throw new TypeError('text must be a string'); text = value; dirty = text !== baseline; return snapshot(); }
    function resetToLatest() { if (!latest) return snapshot(); text = projectText(latest.project); baseRevision = latest.revision; baseline = text; baselineProjectId = projectId(latest.project); dirty = false; stale = false; return snapshot(); }
    // Restoring is deliberately not parsing or applying: even malformed JSON is valuable work.
    function restoreDraft(draft, packet) {
      if (!packet || !packet.project) throw new TypeError('recovery requires a project packet');
      latest = {project: packet.project, revision: packet.revision};
      resetToLatest();
      if (!draft || draft.dirty === false || typeof draft.text !== 'string') return snapshot();
      text = draft.text;
      baseRevision = draft.baseRevision;
      dirty = true;
      stale = !!draft.stale || !!draft.resourceRebased || !!packet.resourceRebased ||
        draft.compatible === false || packet.recoveryCompatible === false ||
        baseRevision == null || baseRevision !== packet.revision;
      return snapshot();
    }
    function submission() { return {text, expectedRevision: baseRevision}; }
    function markApplied(packet) { if (packet) latest = packet; return resetToLatest(); }
    return {sync, edit, resetToLatest, restoreDraft, submission, markApplied, get state() { return snapshot(); }};
  }
  return {createCodeEditorController};
});
