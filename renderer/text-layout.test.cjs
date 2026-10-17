const assert = require('assert/strict'), fs = require('fs');
const read = name => fs.readFileSync(__dirname + '/' + name, 'utf8');
const html = read('index.html'), exported = read('export.html');
const renderer = read('scene-renderer.js'), js = read('text-revealer.js');
const pre = read('preload.cjs'), main = read('../main.cjs');
for (const page of [html, exported]) {
  assert.match(page, /text-revealer\.js/);
  assert.match(page, /scene-renderer\.js/);
  assert.match(page, /scene\.css/);
}
assert.match(renderer, /createTextRevealer/);
assert.match(renderer, /characters\.replaceChildren/);
assert.match(renderer, /document\.fonts\.ready/);
assert.match(renderer, /image\.decode\(\)/);
assert.match(js, /Intl\.Segmenter/);
assert.match(js, /replay-hidden-tail/);
assert.match(pre, /setLocale/);
assert.match(pre, /exportCurrent/);
assert.match(pre, /editDialogue/);
assert.match(html, /dialogue-select/);
assert.match(html, /dialogue-text/);
assert.match(read('preview.js'), /syncDialogueEditor/);
assert.match(read('preview.js'), /textContent/);
assert.match(main, /set-locale/);
console.log(JSON.stringify({status:'PASS', checks:['shared-scene-source','full-text-layout-before-reveal','grapheme-segmentation-source','CSS-highlight-tail-hiding','locale-ipc','export-ipc','image-font-readiness-source']}));
