const plain = (v, keys) => !!v && typeof v === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(v)) && Reflect.ownKeys(v).every(k => keys.includes(k));
const size = v => Number.isFinite(v) && v > 0 && v <= 8192;
function validCanvas(v) { return plain(v, ['width', 'height']) && Number.isInteger(v.width) && Number.isInteger(v.height) && size(v.width) && size(v.height); }
function expressionErrors(ex, c, resources, withId = true) {
  const errors = [], keys = ['name', 'mode', 'resourceId', 'layers'];
  if (withId) keys.push('id');
  if (!plain(ex, keys)) return ['invalid expression properties'];
  if (typeof ex.name !== 'string' || !ex.name.trim()) errors.push('expression name invalid');
  const image = id => typeof id === 'string' && resources.some(r => r.id === id && r.kind === 'image');
  if (ex.mode === 'overlay') {
    if (Object.hasOwn(ex, 'resourceId')) errors.push('overlay cannot have resourceId');
    if (!validCanvas(c.portraitCanvas)) errors.push('overlay requires portraitCanvas');
    if (!image(c.resourceId)) errors.push('overlay requires base image resource');
    if (!Array.isArray(ex.layers)) errors.push('overlay layers must be an array');
    const ids = new Set();
    for (const l of Array.isArray(ex.layers) ? ex.layers : []) {
      if (!plain(l, ['id', 'resourceId', 'x', 'y', 'width', 'height'])) { errors.push('invalid overlay layer properties'); continue; }
      if (typeof l.id !== 'string' || !l.id.trim() || ids.has(l.id)) errors.push('layer id invalid or duplicate');
      ids.add(l.id);
      if (!image(l.resourceId)) errors.push('layer image resource missing');
      if (![l.x, l.y].every(n => Number.isFinite(n) && n >= 0) || !size(l.width) || !size(l.height) || !validCanvas(c.portraitCanvas) || l.x + l.width > c.portraitCanvas.width || l.y + l.height > c.portraitCanvas.height) errors.push('layer bounds invalid');
    }
  } else {
    if (Object.hasOwn(ex, 'mode') && ex.mode !== 'replace') errors.push('expression mode invalid');
    if (Object.hasOwn(ex, 'layers')) errors.push('replace cannot have layers');
    if (!image(ex.resourceId)) errors.push('expression image resource missing');
  }
  return errors;
}
module.exports = {plain, validCanvas, expressionErrors};
