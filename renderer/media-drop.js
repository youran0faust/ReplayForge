'use strict';

// Browser load order: timeline-drop.js, media-drop.js, preview.js.
function mediaDropTarget(sourceKind, targetKind, x, rect, extent, duration) {
  if (sourceKind === 'image' ? !['background','image'].includes(targetKind) :
      sourceKind !== 'audio' || !['bgm', 'sfx'].includes(targetKind)) return null;
  const geometry = typeof expressionDropFrame === 'function' ? expressionDropFrame :
    (typeof require === 'function' ? require('./timeline-drop.js').expressionDropFrame : null);
  if (!geometry) throw Error('请先加载 timeline-drop.js。');
  const atFrame = geometry(x, rect, extent, duration);
  return atFrame === null ? null : {kind: targetKind, atFrame};
}

// Half-open rectangles keep adjacent lanes and clipped viewport edges unambiguous.
function mediaDropContainsPoint(rect, x, y) {
  return !!rect && [rect.left, rect.top, rect.right, rect.bottom, x, y].every(Number.isFinite) &&
    x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
}

// Intent only: no project mutation, import, voice binding or inspector ownership.
function createMediaDrop(options) {
  const root = options.root, doc = root.ownerDocument, win = doc.defaultView;
  let operation = null, ghost = null;
  const status = text => options.status?.(text);
  const same = (op, p) => !!p && p.documentId === op.documentId && p.revision === op.expectedRevision;
  const current = op => operation === op && same(op, options.packet());
  function clearDrag(op) {
    ghost?.remove(); ghost = null;
    const element = op?.element;
    if (!element) return;
    op.element = null;
    try { if (element.hasPointerCapture(op.pointerId)) element.releasePointerCapture(op.pointerId); } catch (_) { /* Detached source. */ }
  }
  function cancel(text = '已取消拖入；未提交命令。') {
    const op = operation;
    // A command already handed to the parent cannot be recalled.
    if (!op || op.phase === 'commit') return;
    operation = null;
    if (op.moved) options.suppressClick?.();
    clearDrag(op);
    status(typeof text === 'string' ? text : '已取消拖入；未提交命令。');
  }
  function invalidate(packet) {
    if (operation && !same(operation, packet)) cancel('工程或版本已改变，请重新拖入。');
  }
  function targetAt(op, x, y) {
    const hit = doc.elementFromPoint(x, y);
    let node = hit?.closest('[data-media-drop-kind]');
    // Only the known playhead may be bypassed; dialogs and other overlays still block.
    const playhead = hit?.closest('#timeline-playhead');
    if (playhead && root.contains(playhead) &&
        mediaDropContainsPoint(root.getBoundingClientRect(), x, y) &&
        mediaDropContainsPoint({left: 0, top: 0, right: win.innerWidth, bottom: win.innerHeight}, x, y)) {
      node = Array.from(root.querySelectorAll('[data-media-drop-kind]')).find(lane =>
        mediaDropContainsPoint(lane.getBoundingClientRect(), x, y));
    }
    const packet = options.packet();
    if (!node || !root.contains(node) || !same(op, packet)) return null;
    const target = mediaDropTarget(op.source.kind, node.dataset.mediaDropKind, x,
      node.getBoundingClientRect(), Number(root.dataset.extent), packet.project?.scene?.durationFrames);
    return target ? {...target, node} : null;
  }
  function show(op, x, y) {
    ghost?.remove(); ghost = null;
    const target = targetAt(op, x, y);
    if (!target) {
      status(op.source.kind === 'image' ? '图片只能拖到背景或图片行的有效帧；其他位置不提交。' : '音频只能拖到音乐或音效行的有效帧；不会转投配音或其他轨。');
      return null;
    }
    const purpose = {background: '背景切换', image: '独立图片片段', bgm: '音乐', sfx: '音效'}[target.kind];
    ghost = doc.createElement('span'); ghost.className = 'media-drop-ghost';
    ghost.textContent = `第 ${target.atFrame} 帧 · ${purpose}`;
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.left = `${Math.max(8, Math.min(x + 12, win.innerWidth - 250))}px`;
    ghost.style.top = `${Math.max(8, Math.min(y + 16, win.innerHeight - 48))}px`;
    doc.body.appendChild(ghost); status(`松开：第 ${target.atFrame} 帧 · ${purpose}`);
    return target;
  }
  async function finish(op, target) {
    op.phase = 'prepare';
    try {
      if (!current(op)) { cancel('工程或版本已改变，请重新拖入。'); return; }
      // The explicit destination determines purpose; never ask or guess.
      const kind = target.kind;
      if (options.prepare && await options.prepare() === false) { if (operation === op) cancel(); return; }
      if (!current(op)) { if (operation === op) cancel('等待期间工程已改变，已取消。'); return; }
      op.phase = 'commit';
      await options.commit({documentId: op.documentId, expectedRevision: op.expectedRevision,
        source: {...op.source}, target: {kind}, atFrame: target.atFrame});
    } catch (error) {
      if (operation === op) status('未提交：' + (error?.message || String(error)));
    } finally {
      if (operation === op) { operation = null; clearDrag(op); }
    }
  }
  function begin(source, event) {
    if (operation || event.button !== 0 || event.isPrimary === false) return false;
    if (!source || !['audio', 'image'].includes(source.kind) || typeof source.resourceId !== 'string' || !source.resourceId) return false;
    const packet = options.packet(), element = event.currentTarget;
    if (!packet?.project || !Number.isFinite(event.pointerId) || !element?.setPointerCapture) return false;
    const op = {source: {resourceId: source.resourceId, kind: source.kind}, documentId: packet.documentId,
      expectedRevision: packet.revision, element, pointerId: event.pointerId,
      x: event.clientX, y: event.clientY, moved: false, phase: 'drag'};
    operation = op;
    try { element.setPointerCapture(event.pointerId); }
    catch (_) { cancel('无法捕获拖动指针，请重新拖入。'); return false; }
    return true;
  }
  doc.addEventListener('pointermove', event => {
    const op = operation;
    if (op?.phase !== 'drag' || op.pointerId !== event.pointerId) return;
    if (!current(op)) { cancel('工程或版本已改变，请重新拖入。'); return; }
    if (!op.moved && Math.hypot(event.clientX - op.x, event.clientY - op.y) < 4) return;
    op.moved = true; event.preventDefault(); show(op, event.clientX, event.clientY);
  });
  doc.addEventListener('pointerup', event => {
    const op = operation;
    if (op?.phase !== 'drag' || op.pointerId !== event.pointerId) return;
    const target = op.moved ? show(op, event.clientX, event.clientY) : null;
    // Intentional release must not trigger lostpointercapture cancellation.
    op.phase = 'prepare'; clearDrag(op);
    if (op.moved) options.suppressClick?.();
    if (!target) { operation = null; return; }
    void finish(op, target);
  });
  for (const type of ['pointercancel', 'lostpointercapture']) doc.addEventListener(type, event => {
    if (operation?.phase === 'drag' && operation.pointerId === event.pointerId) cancel();
  }, true);
  win.addEventListener('blur', () => cancel());
  doc.addEventListener('keydown', event => {
    if (event.key === 'Escape' && operation && operation.phase !== 'commit') {
      event.preventDefault(); event.stopPropagation(); cancel();
    }
  });
  // No native HTML drop handler: external paths are never consumed.
  return {begin, cancel, invalidate, get busy() { return !!operation; }};
}

if (typeof module !== 'undefined') module.exports = {createMediaDrop, mediaDropTarget, mediaDropContainsPoint};
