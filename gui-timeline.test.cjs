'use strict';
// Execute with real Electron, never node. No native dialogs are used.
const {app, dialog} = require('electron');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
for (const name of ['showOpenDialog', 'showSaveDialog', 'showMessageBox', 'showErrorBox', 'showOpenDialogSync', 'showSaveDialogSync', 'showMessageBoxSync']) {
  dialog[name] = () => { throw Error('Unexpected native dialog: ' + name); };
}
const timeout = setTimeout(() => { console.error('Timeline test timed out'); app.exit(1); }, 60000);
timeout.unref();
app.once('browser-window-created', (_, win) => win.webContents.once('did-finish-load', async () => {
  try {
    const result = await win.webContents.executeJavaScript(`(${rendererTest.toString()})()`, true);
    assert.equal(result.status, 'PASS');
    fs.mkdirSync(path.join(__dirname, 'test-output'), {recursive: true});
    fs.writeFileSync(path.join(__dirname, 'test-output/gui-timeline.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result)); clearTimeout(timeout); app.exit(0);
  } catch (error) { console.error(error); clearTimeout(timeout); app.exit(1); }
}));
async function rendererTest() {
  const $ = s => document.querySelector(s), all = s => [...document.querySelectorAll(s)];
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const eq = (actual, expected, message) => check(actual === expected, message + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  for (let n = 0; n < 200 && (!$('#dialogue-select')?.value || !$('.timeline-item')); n++) await new Promise(r => setTimeout(r, 25));
  check(window.timelineTest && $('.timeline-item'), 'Initial timeline did not load');
  const initial = await replay.project();
  const modelFor = packet => timelineTest.buildTimelineModel(packet.project, packet.resourceUrls);
  const item = (kind, id) => all('.timeline-item').find(n => n.dataset.kind === kind && n.dataset.id === id);
  function matchesDOM(model) {
    eq(all('.timeline-lane').length, 3, 'Three lanes');
    eq(all('.timeline-item').length, model.tracks.reduce((n, t) => n + t.items.length, 0), 'Total item count');
    for (const track of model.tracks) for (const entry of track.items) {
      const node = item(track.kind, entry.id);
      check(node, 'DOM item exists: ' + entry.id);
      eq(node.textContent, entry.label, 'Item label');
      check(node.title.includes(formatTimelineNumber(entry.startFrame) + '–' + formatTimelineNumber(entry.endFrame)), 'Item interval title matches model');
    }
  }
  const base = modelFor(initial); matchesDOM(base);
  for (const kind of ['characters', 'dialogues', 'audio']) eq(base.tracks.find(t => t.kind === kind).items.length, 1, 'Initial ' + kind + ' count');
  eq(base.tracks.find(t => t.kind === 'audio').items[0].endFrame, 300, 'Independent voice duration');
  const ticks = all('#timeline-ruler span').map(n => n.textContent);
  eq(ticks.length, 10, 'Ruler ticks'); eq(ticks[0], '0', 'First tick'); eq(ticks.at(-1), '438', 'Last tick');
  eq($('#timeline-warnings').textContent, '', 'No initial warning');

  await $('#dialogue-add').onclick();
  const addedDialogue = $('#dialogue-select').value;
  let packet = await replay.project();
  eq(packet.project.scene.dialogues.length, 2, 'Add dialogue updates project');
  check(item('dialogues', addedDialogue), 'Add dialogue refreshes DOM');
  $('#dialogue-text').value = 'Timeline edited dialogue';
  $('#dialogue-start').value = 75; $('#dialogue-end').value = 195; $('#dialogue-reveal').value = 45;
  await $('#dialogue-apply').onclick(); packet = await replay.project();
  const edited = packet.project.scene.dialogues.find(d => d.id === addedDialogue);
  eq(edited.startFrame, 75, 'Dialogue start edited'); eq(edited.endFrame, 195, 'Dialogue end edited');
  matchesDOM(modelFor(packet)); eq(item('dialogues', addedDialogue).textContent, 'Timeline edited dialogue', 'Edited dialogue label');
  await $('#character-add').onclick();
  const addedCharacter = $('#character-select').value;
  packet = await replay.project(); eq(packet.project.scene.characters.length, 2, 'Add character updates project');
  check(item('characters', addedCharacter), 'Add character refreshes DOM');
  $('#character-name').value = 'Timeline character'; $('#character-from').value = 60; $('#character-to').value = 240;
  await $('#character-apply').onclick(); packet = await replay.project();
  eq(packet.project.scene.characters.find(c => c.id === addedCharacter).visibleTo, 240, 'Character range edited'); matchesDOM(modelFor(packet));

  // Await the production delegated onclick with real MouseEvents. Deliberately
  // start with newly added selections to verify that item clicks change them.
  const ruler = $('#timeline-ruler'), originalRect = ruler.getBoundingClientRect;
  ruler.getBoundingClientRect = () => ({left: 100, right: 538, width: 438, top: 0, bottom: 20, height: 20});
  async function click120(kind, id) {
    const target = item(kind, id); check(target, 'Clickable item exists');
    const event = new MouseEvent('click', {bubbles: true, clientX: 220.5});
    Object.defineProperty(event, 'target', {value: target});
    await $('#timeline').onclick(event);
    eq(Number($('#frame').value), 120, 'Click seeks frame 120');
    eq(Number($('#scrub').value), 120, 'Scrubber synchronized'); eq($('#timeline-frame').textContent, '120', 'Timeline frame synchronized');
  }
  try {
    await click120('dialogues', initial.project.scene.dialogues[0].id);
    eq($('#dialogue-select').value, initial.project.scene.dialogues[0].id, 'Click selects dialogue');
    await click120('characters', initial.project.scene.characters[0].id);
    eq($('#character-select').value, initial.project.scene.characters[0].id, 'Click selects character');
    $('#dialogue-select').value = addedDialogue; $('#dialogue-select').dispatchEvent(new Event('change'));
    await click120('audio', initial.project.scene.dialogues[0].id);
    eq($('#dialogue-select').value, initial.project.scene.dialogues[0].id, 'Audio selects owning dialogue');
  } finally { ruler.getBoundingClientRect = originalRect; }
  eq(JSON.stringify((await replay.project()).project), JSON.stringify(packet.project), 'Click does not mutate project');

  // Invalid resources are not authorable through validated IPC. Exercise warning
  // rendering using a clone, and restore the real project via ordinary refresh.
  const synthetic = structuredClone(packet.project), voiced = synthetic.scene.dialogues.find(d => d.voice);
  synthetic.resources = synthetic.resources.filter(r => r.id !== voiced.voice.resourceId);
  voiced.voice.durationSamples = 48000 * 30;
  const warned = timelineTest.render(synthetic, {});
  check(warned.warnings.some(w => /missing voice resource/.test(w)), 'Missing resource model warning');
  check(warned.warnings.some(w => /audio overflow/.test(w)), 'Overflow model warning');
  check(/missing voice resource/.test($('#timeline-warnings').textContent), 'Missing resource warning displayed');
  check(/audio overflow/.test($('#timeline-warnings').textContent), 'Overflow warning displayed');
  check(item('audio', voiced.id).classList.contains('warning'), 'Warning styling');
  eq(all('#timeline-ruler span').at(-1).textContent, '930', 'Overflow expands ruler');
  await $('#apply').onclick(); matchesDOM(modelFor(packet));
  eq($('#timeline-warnings').textContent, '', 'Refresh clears synthetic warnings');
  eq(JSON.stringify((await replay.project()).project), JSON.stringify(packet.project), 'Synthetic render does not mutate project');
  return {status: 'PASS', checks: ['real Electron three lanes, items, ruler', 'dialogue and character add/edit refresh model and DOM', 'actual click handler seeks frame120 and changes selections', 'missing voice and overflow warning DOM', 'synthetic rendering preserves live project'], measurements: {base, ticks, addedDialogue, addedCharacter, frame: Number($('#frame').value), warnings: warned.warnings}};
}
require('./main.cjs');
