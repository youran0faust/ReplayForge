'use strict';
const {randomUUID}=require('node:crypto');
const copy=v=>JSON.parse(JSON.stringify(v));
const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
function fullTextErrors(d,locale){
 const e=[],full=d.fullText,pages=Array.isArray(d.pages)?d.pages:undefined;
 if(full===undefined&&!pages)return e;
 if(!plain(full)||!Object.keys(full).length||Object.entries(full).some(([k,v])=>!k.trim()||typeof v!=='string'||!v.trim())||typeof full?.[locale]!=='string')return ['dialogue fullText locale text invalid'];
 const parts=pages||[d],locales=new Set([...Object.keys(full),...parts.flatMap(p=>plain(p?.text)?Object.keys(p.text):[]),...Object.keys(plain(d.text)?d.text:{})]);
 for(const key of locales){
  if(typeof full[key]!=='string'||parts.some(p=>typeof p?.text?.[key]!=='string')||parts.map(p=>p?.text?.[key]).join('')!==full[key])e.push(`dialogue pages join must equal fullText ${key}`);
  if(pages&&d.text?.[key]!==pages[0]?.text?.[key])e.push(`dialogue parent text must equal first page ${key}`);
 }
 return e;
}
function pagesErrors(d,locale,schemaVersion){
 const e=schemaVersion===4?fullTextErrors(d,locale):[];
 if(d.pages===undefined)return e;
 if(!Array.isArray(d.pages)||!d.pages.length)return [...e,'dialogue pages must be a nonempty array'];
 let start=d.startFrame;const ids=new Set();
 for(const p of d.pages){
  if(!plain(p)||Reflect.ownKeys(p).some(k=>!['id','text','startFrame','endFrame','revealFrames'].includes(k))){e.push('invalid dialogue page properties');continue;}
  if(typeof p.id!=='string'||!p.id.trim()||ids.has(p.id))e.push('page id invalid or duplicate');ids.add(p.id);
  if(!plain(p.text)||!Object.keys(p.text).length||Object.entries(p.text).some(([k,v])=>!k.trim()||typeof v!=='string'||!v.trim())||typeof p.text?.[locale]!=='string'||!p.text[locale].trim())e.push('page locale text invalid');
  if(!Number.isSafeInteger(p.startFrame)||!Number.isSafeInteger(p.endFrame)||p.startFrame!==start||p.endFrame<=p.startFrame||p.endFrame>d.endFrame||!Number.isSafeInteger(p.revealFrames)||p.revealFrames<1||p.revealFrames>p.endFrame-p.startFrame)e.push('page range invalid or not contiguous');start=p.endFrame;
 }
 if(start!==d.endFrame)e.push('pages must cover entire dialogue');return e;
}
function pageAt(d,frame,schemaVersion){if(schemaVersion===4&&frame>=d.endFrame&&frame<d.displayUntilFrame&&d.pages?.length)return d.pages[d.pages.length-1];return d.pages?.find(p=>frame>=p.startFrame&&frame<p.endFrame)||d;}
function fields(p,allowed){if(!plain(p)||Reflect.ownKeys(p).some(k=>!allowed.includes(k)))throw Error('分页参数无效');}
function dialogue(p,id){const d=p.scene.dialogues.find(x=>x.id===id);if(!d)throw Error('对白不存在');return d;}
function implicit(d){return{id:'page_'+randomUUID(),text:copy(d.text),startFrame:d.startFrame,endFrame:d.endFrame,revealFrames:d.revealFrames};}
// Trusted commands rebuild derived metadata; validators never repair loaded JSON.
function sync(d,p){
 if(p.schemaVersion!==4){d.text=copy(d.pages[0].text);return;}
 const errors=pagesErrors(d,p.locale,3);if(errors.length)throw Error(errors.join('; '));
 const locales=[...new Set(d.pages.flatMap(page=>Object.keys(page.text)))];
 if(d.pages.some(page=>locales.some(locale=>typeof page.text[locale]!=='string')))throw Error('所有分页必须包含相同语言');
 d.text=copy(d.pages[0].text);
 d.fullText=Object.fromEntries(locales.map(locale=>[locale,d.pages.map(page=>page.text[locale]).join('')]));
 const derivedErrors=pagesErrors(d,p.locale,4);if(derivedErrors.length)throw Error(derivedErrors.join('; '));
}
function collapse(d,p){
 if(!d.pages)return;
 if(p.schemaVersion===4){sync(d,p);d.text=copy(d.fullText);}else d.text=copy(d.pages[0].text);
 d.revealFrames=d.pages[0].revealFrames;delete d.pages;
}
function setDialoguePages(s,id,pages){if(pages!==null&&!Array.isArray(pages))throw Error('分页数组无效');s.apply(p=>{const d=dialogue(p,id);if(pages===null){collapse(d,p);}else{const errors=pagesErrors({...d,pages},p.locale,p.schemaVersion===4?3:p.schemaVersion);if(errors.length)throw Error(errors.join('; '));d.pages=copy(pages);sync(d,p);}},'set dialogue pages');return{revision:s.revision};}
function addDialoguePage(s,id,options={}){fields(options,['afterPageId','splitFrame']);if(Object.hasOwn(options,'afterPageId')&&(typeof options.afterPageId!=='string'||!options.afterPageId.trim()))throw Error('页面ID无效');if(Object.hasOwn(options,'splitFrame')&&!Number.isSafeInteger(options.splitFrame))throw Error('分页帧无效');let pageId;s.apply(p=>{const d=dialogue(p,id);if(!d.pages)d.pages=[implicit(d)];const i=options.afterPageId===undefined?d.pages.length-1:d.pages.findIndex(x=>x.id===options.afterPageId);if(i<0)throw Error('页面不存在');const left=d.pages[i],frame=options.splitFrame??Math.floor((left.startFrame+left.endFrame)/2);if(!Number.isSafeInteger(frame)||frame<=left.startFrame||frame>=left.endFrame)throw Error('页面太短或分页帧必须位于所选页内部');pageId='page_'+randomUUID();const right={...copy(left),id:pageId,startFrame:frame,revealFrames:Math.min(left.revealFrames,left.endFrame-frame)};left.endFrame=frame;left.revealFrames=Math.min(left.revealFrames,frame-left.startFrame);d.pages.splice(i+1,0,right);sync(d,p);},'split dialogue page');return{pageId,revision:s.revision};}
function editDialoguePage(s,id,pid,patch){fields(patch,['text','endFrame','revealFrames']);for(const key of ['endFrame','revealFrames'])if(Object.hasOwn(patch,key)&&!Number.isSafeInteger(patch[key]))throw Error('页面帧参数无效');s.apply(p=>{const d=dialogue(p,id),i=d.pages?.findIndex(x=>x.id===pid)??-1;if(i<0)throw Error('页面不存在');const page=d.pages[i],next=d.pages[i+1],end=patch.endFrame??page.endFrame;if(!Number.isSafeInteger(end)||end<=page.startFrame||(!next&&end!==d.endFrame)||(next&&end>=next.endFrame))throw Error('页面边界无效，末页必须保留父对白终点');if(Object.hasOwn(patch,'text')){if(typeof patch.text!=='string'||!patch.text.trim())throw Error('页面文本不能为空');page.text[p.locale]=patch.text;}page.endFrame=end;page.revealFrames=Object.hasOwn(patch,'revealFrames')?patch.revealFrames:Math.min(page.revealFrames,end-page.startFrame);if(next){next.startFrame=end;next.revealFrames=Math.min(next.revealFrames,next.endFrame-end);}sync(d,p);},'edit dialogue page');return{revision:s.revision};}
function deleteDialoguePage(s,id,pid){s.apply(p=>{const d=dialogue(p,id),i=d.pages?.findIndex(x=>x.id===pid)??-1;if(i<0)throw Error('页面不存在');if(d.pages.length===1){collapse(d,p);return;}const page=d.pages[i];if(i>0)d.pages[i-1].endFrame=page.endFrame;else d.pages[1].startFrame=page.startFrame;d.pages.splice(i,1);sync(d,p);},'delete dialogue page');return{revision:s.revision};}
module.exports={pagesErrors,pageAt,setDialoguePages,addDialoguePage,editDialoguePage,deleteDialoguePage};
