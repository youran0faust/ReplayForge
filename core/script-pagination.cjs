'use strict';
const clone=v=>structuredClone(v);
function apply(project,{paginate}={}) {
  if(!project||typeof project!=='object') throw Error('工程必须是对象');
  if(project.schemaVersion!==4) throw Error('仅支持 schemaVersion 4');
  if(typeof paginate!=='function') throw Error('缺少 paginate 函数');
  const out=clone(project), locale=out.locale||'zh-CN';
  const dialogues=out.scene?.dialogues;
  if(!Array.isArray(dialogues)) throw Error('工程对白数组无效');
  try {
    for(const d of dialogues){
      if(!d||typeof d!=='object'||!Number.isSafeInteger(d.startFrame)||!Number.isSafeInteger(d.endFrame)||d.endFrame<=d.startFrame) throw Error(`对白帧范围无效: ${d?.id||'unknown'}`);
      const sourceText = d.fullText;
      const textMap = {};
      if (sourceText && typeof sourceText === 'object' && !Array.isArray(sourceText)) Object.assign(textMap, sourceText);
      else if (typeof sourceText === 'string') textMap[locale] = sourceText;
      if (!Object.keys(textMap).length && d.pages?.length) {
        for (const key of Object.keys(d.pages[0]?.text || {})) textMap[key] = d.pages.map(p => typeof p.text === 'string' ? (key === locale ? p.text : '') : (p.text?.[key] || '')).join('');
      }
      if (!Object.keys(textMap).length) Object.assign(textMap, d.text || {});
      const fullText = typeof textMap[locale] === 'string' ? textMap[locale] : (typeof textMap['zh-CN'] === 'string' ? textMap['zh-CN'] : '');
      if(typeof fullText!=='string') throw Error(`对白文本无效: ${d.id||'unknown'}`);
      textMap[locale] = fullText;
      const result=paginate({text:fullText,locale});
      if(!Array.isArray(result)||!result.length) throw Error(`分页结果为空: ${d.id||'unknown'}`);
      const oldPages=d.pages; const frameCount=d.endFrame-d.startFrame;
      if(result.length>frameCount) throw Error(`分页页数超过对白帧数: ${d.id||'unknown'}`);
      let cursor=d.startFrame; const pages=[];
      for(let i=0;i<result.length;i++){
        const p=result[i]; if(!p||!Number.isSafeInteger(p.start)||!Number.isSafeInteger(p.end)||p.start<0||p.end<p.start||typeof p.text!=='string') throw Error(`分页结果无效: ${d.id||'unknown'}`);
        const next=i===result.length-1?d.endFrame:d.startFrame+Math.floor(frameCount*(i+1)/result.length);
        const end=Math.max(cursor+1,next); if(end>d.endFrame) throw Error(`分页帧范围无效: ${d.id||'unknown'}`);
        const pageText = {}; for (const key of Object.keys(textMap)) { const value = key === locale ? p.text : textMap[key].slice(p.start, p.end); pageText[key] = value; }
        pages.push({id:oldPages?.[i]?.id||`page_${d.id||'dialogue'}_${i+1}`,text:pageText,startFrame:cursor,endFrame:end,revealFrames:Math.min(Math.max(1,end-cursor),Math.max(1,p.end-p.start))}); cursor=end;
      }
      if(cursor!==d.endFrame||pages.map(p=>p.text[locale]).join('')!==fullText) throw Error(`分页文本未保持原文: ${d.id||'unknown'}`);
      d.fullText=textMap; d.pages=pages; d.text={...textMap, [locale]: pages[0].text[locale]}; d.revealFrames=pages[0].revealFrames;
    }
    return out;
  } catch(e) { const err=Error(`分页失败: ${e.message||e}`); err.code='PAGINATION_FAILED'; throw err; }
}
module.exports={apply};