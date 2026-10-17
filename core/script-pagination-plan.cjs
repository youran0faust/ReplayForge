'use strict';
const {textHash} = require('./script-preflight.cjs');
const LAYOUT = Object.freeze({id:'default-960x540-v1',width:822,maxLines:3});
const MAX_BYTES = 1024 * 1024, MAX_PAGES = 1000;
function fail(code = 'PAGINATION_INVALID') {
 throw Object.assign(new Error(code === 'PAGINATION_REQUIRED' ? '生成需要完整分页计划。' : '分页计划无效或已过期，请重新测量分页。'), {code,publicError:true});
}
function record(value, keys) {
 if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) fail();
 const own = Reflect.ownKeys(value);
 if (own.length !== keys.length || own.some(k => !keys.includes(k)) || keys.some(k => !Object.hasOwn(value,k))) fail();
 for (const k of keys) if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value,k),'value')) fail();
}
function array(value, max) {
 if (!Array.isArray(value) || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) fail();
 for (let i=0;i<value.length;i++) if (!Object.hasOwn(value,i) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value,String(i)),'value')) fail();
}
/** Integrity validation cannot prove renderer font measurement. UTF-16 offsets, end exclusive. */
function validatePaginationPlan(plan, report, sourceText, config = {}) {
 // Only the trusted snapshot config defines limits; report.summary is display data.
 const cap=config?.dialoguePageMaxCharacters;
 if(cap!==undefined&&(!Number.isInteger(cap)||cap<1||cap>1000))fail();
 if (plan === undefined || plan === null) fail('PAGINATION_REQUIRED');
 record(plan,['version','sourceHash','layout','dialogues']);
 record(plan.layout,['id','width','maxLines']);
 if (plan.version !== 1 || Object.keys(LAYOUT).some(k => plan.layout[k] !== LAYOUT[k]) || typeof plan.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(plan.sourceHash)) fail();
 const hashes = [report?.sourceHash,report?.textHash].filter(h => h !== undefined);
 if (!hashes.length || hashes.some(h => h !== plan.sourceHash) || (sourceText !== undefined && (typeof sourceText !== 'string' || textHash(sourceText) !== plan.sourceHash))) fail();
 if (!Array.isArray(report?.nodes)) fail();
 const nodes = new Map();
 for (const node of report.nodes) if (node.type === 'dialogue') {
  if (typeof node.id !== 'string' || !node.id || typeof node.text !== 'string' || nodes.has(node.id)) fail();
  nodes.set(node.id,node);
 }
 array(plan.dialogues,nodes.size);
 if (plan.dialogues.length !== nodes.size) fail();
 const seen = new Set(), segmenter = new Intl.Segmenter('und',{granularity:'grapheme'});
 let bytes = 0;
 for (const dialogue of plan.dialogues) {
  record(dialogue,['nodeId','pages']);
  const node = nodes.get(dialogue.nodeId);
  if (!node || seen.has(dialogue.nodeId)) fail();
  seen.add(dialogue.nodeId);
  array(dialogue.pages,MAX_PAGES);
  if (!dialogue.pages.length || Buffer.byteLength(node.text,'utf8') > MAX_BYTES) fail();
  const boundaries = new Set([node.text.length]),graphemeIndex=new Map();
  let count=0;for (const part of segmenter.segment(node.text)){boundaries.add(part.index);graphemeIndex.set(part.index,count++);}
  graphemeIndex.set(node.text.length,count);
  let cursor = 0;
  for (const page of dialogue.pages) {
   record(page,['start','end','text']);
   if (!Number.isSafeInteger(page.start) || !Number.isSafeInteger(page.end) || page.start !== cursor || page.end <= page.start || page.end > node.text.length || typeof page.text !== 'string' || !page.text.trim() || !boundaries.has(page.start) || !boundaries.has(page.end) || page.text !== node.text.slice(page.start,page.end)) fail();
   if(cap!==undefined&&graphemeIndex.get(page.end)-graphemeIndex.get(page.start)>cap)fail();
   bytes += Buffer.byteLength(page.text,'utf8'); if (bytes > MAX_BYTES) fail();
   cursor = page.end;
  }
  if (cursor !== node.text.length) fail();
 }
 if (Buffer.byteLength(JSON.stringify(plan),'utf8') > MAX_BYTES) fail();
 return structuredClone(plan);
}
module.exports = {validatePaginationPlan,LAYOUT,MAX_BYTES,MAX_PAGES};
