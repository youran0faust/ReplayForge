'use strict';
// Pure filename matching: no I/O or format probe. Caller supplies node identity.
const normalize = text => String(text ?? '').replace(/[\s\p{P}]/gu, '');
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const group = (m, k, v) => m.set(k, [...(m.get(k) || []), v]);
function parseAsset(a) {
  if (!a || a.kind !== 'audio' || a.category !== 'voice' || typeof a.relativePath !== 'string') return null;
  const m = /^(.+)_([0-9]+)([A-Z]*)_(.+)\.(wav|mp3|ogg)$/i.exec(a.relativePath.split(/[\\/]/).pop());
  if (!m || (m[3] && !/^[A-Z]+$/.test(m[3]))) return null;
  const number = Number(m[2]);
  if (!Number.isSafeInteger(number) || number < 1) return null;
  return { asset: a, code: m[1], number, suffix: m[3], excerpt: m[4] };
}
/** Numeric queues start at 1, per speaker for the whole input.
 * Only explicit numeric overrides clear a blocked queue. Suffix and unvoiced
 * overrides consume no numeric slot. Baselines ignore whitespace/punctuation.
 * Previous nodeId + baseline is evidence, NOT a stable-ID guarantee across parses.
 * Changed old bindings retain resource and ORIGINAL baseline for review.
 */
function matchVoices(dialogues, assets, {characters = [], overrides = {}, previousBindings = []} = {}) {
  const bindings = [], diagnostics = [];
  const byId = new Map(), numeric = new Map(), chars = new Map(), previous = new Map();
  const counts = new Map(), states = new Map(), used = new Set(), reserved = new Map();
  for (const a of assets) {
    if (a && a.id != null) group(byId, a.id, a);
    const p = parseAsset(a);
    if (p && !p.suffix) {
      if (!numeric.has(p.code)) numeric.set(p.code, new Map());
      group(numeric.get(p.code), p.number, p);
    }
  }
  for (const c of characters) group(chars, c.name, c);
  for (const p of previousBindings) group(previous, p.nodeId, p);
  for (const d of dialogues) counts.set(d.id, (counts.get(d.id) || 0) + 1);
  // Reserve later explicit/saved bindings so inserted lines cannot steal them.
  for (const d of dialogues) {
    const o = own(overrides, d.id) ? overrides[d.id] : undefined;
    const ps = previous.get(d.id) || [];
    const id = o ? o.resourceId : ps.length === 1 ? ps[0].resourceId : undefined;
    if (id != null) group(reserved, id, d.id);
  }
  const report = (d, code, level, message, details = {}) => diagnostics.push({code, level,
    nodeId: d.id, line: d.line ?? null, column: d.column ?? null, message, ...details});
  for (const d of dialogues) {
    if (!states.has(d.speaker)) states.set(d.speaker, {next: 1, blocked: false, first: d});
    const state = states.get(d.speaker), b = {nodeId: d.id, status: 'unresolved'};
    bindings.push(b);
    const fail = (code, message, status = 'unresolved') => {
      b.status = status; state.blocked = true; report(d, code, 'error', message);
    };
    if (typeof d.id !== 'string' || !d.id || counts.get(d.id) !== 1) {
      fail('VOICE_NODE_ID_AMBIGUOUS', '对白身份缺失或重复。'); continue;
    }
    const hasOverride = own(overrides, d.id), o = hasOverride ? overrides[d.id] : undefined;
    if (hasOverride && (!o || typeof o !== 'object' ||
      !((o.status === 'unvoiced' && o.resourceId == null) ||
      (o.status == null && typeof o.resourceId === 'string' && o.resourceId)))) {
      fail('VOICE_OVERRIDE_INVALID', '覆盖必须是无配音或单个资源指定。'); continue;
    }
    if (o?.status === 'unvoiced') { Object.assign(b, {status: 'unvoiced', textBaseline: d.text}); continue; }
    const ps = previous.get(d.id) || [];
    if (!o && ps.length > 1) { fail('VOICE_PREVIOUS_AMBIGUOUS', '旧绑定不唯一。', 'reviewRequired'); continue; }
    const old = ps[0];
    // Source identity and saved unvoiced evidence do not require a voice code.
    // Explicit resource overrides still run the full voiced validation below.
    if (!o && old?.resourceId == null && ['unvoiced', 'reviewRequired'].includes(old?.status)) {
      const hasBaseline = typeof old.textBaseline === 'string';
      if (hasBaseline) b.textBaseline = old.textBaseline;
      if (old.status === 'reviewRequired' || !hasBaseline || normalize(old.textBaseline) !== normalize(d.text)) {
        b.status = 'reviewRequired'; state.blocked = true;
        report(d, old.status === 'reviewRequired' ? 'VOICE_IDENTITY_REVIEW' : !hasBaseline ? 'VOICE_PREVIOUS_BASELINE_MISSING' : 'VOICE_PREVIOUS_TEXT_REVIEW', 'warning', '旧无配音绑定或回接身份需要确认，请明确绑定素材或设为无配音。');
      } else b.status = 'unvoiced';
      continue;
    }
    const cs = chars.get(d.speaker) || [];
    if (cs.length !== 1 || typeof cs[0].voiceCode !== 'string' || !cs[0].voiceCode.trim()) {
      fail('VOICE_CHARACTER_CODE_MISSING', '角色代号缺失或配置有歧义。'); continue;
    }
    const code = cs[0].voiceCode;
    const claim = id => {
      if (used.has(id) || (reserved.get(id) || []).some(owner => owner !== d.id)) {
        fail('VOICE_RESOURCE_REUSE', '同一资源不能被多句复用。'); return false;
      }
      used.add(id); return true;
    };
    const validate = id => {
      const as = byId.get(id) || [];
      if (as.length !== 1) {
        fail(as.length ? 'VOICE_RESOURCE_ID_AMBIGUOUS' : 'VOICE_RESOURCE_MISSING', '资源缺失或身份不唯一。'); return null;
      }
      const p = parseAsset(as[0]);
      if (!p || p.code !== code) { fail('VOICE_RESOURCE_INVALID', '资源类别、命名或角色代号不符。'); return null; }
      return p;
    };
    if (o) {
      const p = validate(o.resourceId);
      if (!p || !claim(o.resourceId)) continue;
      Object.assign(b, {status: 'manual', resourceId: o.resourceId, textBaseline: d.text});
      if (!p.suffix) { state.next = p.number + 1; state.blocked = false; }
      if (normalize(p.excerpt) !== normalize(d.text)) report(d, 'VOICE_MANUAL_EXCERPT_MISMATCH', 'warning', '人工摘要不符，请核对。');
      continue;
    }
    if (old && (old.resourceId != null || old.status === 'unvoiced')) {
      let p;
      if (old.resourceId != null) {
        p = validate(old.resourceId);
        if (!p || !claim(old.resourceId)) continue;
        b.resourceId = old.resourceId;
      }
      const hasBaseline = typeof old.textBaseline === 'string';
      if (hasBaseline) b.textBaseline = old.textBaseline;
      if (!hasBaseline || normalize(old.textBaseline) !== normalize(d.text) || old.status === 'reviewRequired') {
        b.status = 'reviewRequired'; state.blocked = true;
        report(d, !hasBaseline ? 'VOICE_PREVIOUS_BASELINE_MISSING' : 'VOICE_PREVIOUS_TEXT_REVIEW', 'warning', '旧绑定身份或正文需核对，不自动换音频。'); continue;
      }
      if (p && old.status !== 'manual' && normalize(p.excerpt) !== normalize(d.text)) {
        b.status = 'reviewRequired'; state.blocked = true;
        report(d, 'VOICE_PREVIOUS_EXCERPT_MISMATCH', 'warning', '旧资源当前摘要不符。'); continue;
      }
      b.status = p ? (old.status === 'manual' ? 'manual' : 'matched') : 'unvoiced';
      if (p && !p.suffix) state.next = Math.max(state.next, p.number + 1);
      continue;
    }
    if (state.blocked) { report(d, 'VOICE_SEQUENCE_BLOCKED', 'error', '角色序列阻断，需人工数字锚点。'); continue; }
    const candidates = numeric.get(code)?.get(state.next) || [];
    if (candidates.length !== 1) {
      fail(candidates.length ? 'VOICE_NUMBER_DUPLICATE' : 'VOICE_NUMBER_MISSING', `角色 ${code} 编号 ${state.next} 重复或缺失。`); continue;
    }
    const p = candidates[0];
    if (normalize(p.excerpt) !== normalize(d.text)) {
      fail('VOICE_EXCERPT_MISMATCH', '编号摘要不符，不模糊检索。', 'reviewRequired'); continue;
    }
    if (!validate(p.asset.id) || !claim(p.asset.id)) continue;
    Object.assign(b, {status: 'matched', resourceId: p.asset.id, textBaseline: d.text}); state.next++;
  }
  const unused = assets.filter(a => parseAsset(a) && !used.has(a.id));
  for (const [speaker, state] of states) {
    const cs = chars.get(speaker) || [];
    if (cs.length !== 1) continue;
    const extra = unused.filter(a => { const p = parseAsset(a); return p.code === cs[0].voiceCode && !p.suffix; });
    if (extra.length) report(state.first, 'VOICE_UNUSED_NUMERIC_ASSETS', 'warning', '存在未绑定纯数字配音，请核对数量差异。', {resourceIds: extra.map(a => a.id)});
  }
  const summary = {total: bindings.length, matched: 0, manual: 0, unvoiced: 0, unresolved: 0, reviewRequired: 0,
    errors: 0, warnings: 0, unusedVoiceAssets: unused.length};
  for (const b of bindings) summary[b.status]++;
  for (const d of diagnostics) { if (d.level === 'error') summary.errors++; if (d.level === 'warning') summary.warnings++; }
  return {bindings, diagnostics, summary};
}
module.exports = {matchVoices};
