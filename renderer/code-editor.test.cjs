const assert = require('assert');
const {createCodeEditorController} = require('./code-editor.js');
const p = {id: 'a', title: 'x'};
const packet = {project: p, revision: 1};
const c = createCodeEditorController();
c.sync(packet);
assert.equal(c.state.dirty, false);
c.edit('{bad');
assert.equal(c.state.dirty, true);
c.sync({project: {id: 'a', title: 'y'}, revision: 1});
assert.equal(c.state.stale, true);
assert.equal(c.state.text, '{bad');
assert.equal(c.submission().expectedRevision, 1);
c.resetToLatest();
assert.equal(c.state.dirty, false);
assert.equal(c.state.text, JSON.stringify({id: 'a', title: 'y'}, null, 2));
c.edit('{bad');
c.markApplied({project: p, revision: 2});
assert.equal(c.state.dirty, false);

// Recovery must never parse, normalize, discard, or automatically apply invalid text.
const invalid = '  { invalid JSON\n';
c.restoreDraft({text: invalid, baseRevision: 1, dirty: true, stale: false}, packet);
assert.deepEqual(c.state, {text: invalid, baseRevision: 1, dirty: true, stale: false});
assert.deepEqual(p, {id: 'a', title: 'x'});
c.sync(packet);
assert.equal(c.state.text, invalid);
assert.equal(c.state.stale, false, 'restored baseline is the actual project, not draft text');
c.edit(JSON.stringify(p, null, 2));
assert.equal(c.state.dirty, false, 'editing back to baseline clears dirty');

for (const [draft, incoming] of [
  [{stale: true}, packet],
  [{baseRevision: 0}, packet],
  [{baseRevision: null}, packet],
  [{resourceRebased: true}, packet],
  [{compatible: false}, packet],
  [{}, {...packet, resourceRebased: true}],
  [{}, {...packet, recoveryCompatible: false}]
]) {
  c.restoreDraft({text: invalid, baseRevision: 1, dirty: true, ...draft}, incoming);
  assert.equal(c.state.stale, true);
  assert.equal(c.state.text, invalid);
  c.sync(packet);
  assert.equal(c.state.stale, true, 'stale recovery cannot be silently rehabilitated');
  c.resetToLatest();
  assert.deepEqual(c.state, {text: JSON.stringify(p, null, 2), baseRevision: 1, dirty: false, stale: false});
}
c.restoreDraft({text: invalid, baseRevision: 1, dirty: true}, packet);
c.sync({project: {id: 'other', title: 'x'}, revision: 1});
assert.equal(c.state.stale, true);
assert.equal(c.state.text, invalid);
c.restoreDraft(null, {project: p, revision: 7});
assert.equal(c.state.text, JSON.stringify(p, null, 2));
assert.equal(c.state.dirty, false);
assert.equal(c.state.stale, false);
assert.equal(c.state.baseRevision, 7);
c.restoreDraft({text: invalid, dirty: false}, packet);
assert.equal(c.state.text, JSON.stringify(p, null, 2));
c.restoreDraft({text: invalid, baseRevision: 1, dirty: true}, packet);
c.markApplied({project: {id: 'a', title: 'applied'}, revision: 2});
assert.equal(c.state.dirty, false);
assert.equal(c.state.baseRevision, 2);
console.log('code editor tests passed');
