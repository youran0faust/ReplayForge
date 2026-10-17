(function(root,factory){
 'use strict';
 if(typeof module==='object'&&module.exports)module.exports=factory(root);else root.ScriptGenerationPagination=factory(root);
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
 'use strict';
 const LAYOUT=Object.freeze({id:'default-960x540-v1',width:822,maxLines:3});
 const MAX_BYTES=1024*1024,MAX_PAGES=1000;
 function aborted(signal){if(signal?.aborted)throw Object.assign(new Error('分页测量已中止'),{name:'AbortError'});}
 async function preparePagination({report,document:doc,signal}={}){
  aborted(signal);
  const view=doc?.defaultView,layout=view?.TextLayout||root.TextLayout;
  if(typeof layout?.prepareTextMetrics!=='function')throw Error('分页测量 API TextLayout.prepareTextMetrics 不可用');
  if(typeof root.Intl?.Segmenter!=='function')throw Error('分页测量需要 Intl.Segmenter，无降级实现');
  if(!doc?.body||typeof view?.getComputedStyle!=='function')throw Error('分页测量需要 connected DOM 和样式 API');
  if(!report||typeof report.sourceHash!=='string'||!report.sourceHash)throw Error('分页测量缺少 sourceHash');
  const rows=Array.isArray(report.nodes)?report.nodes.filter(n=>n.type==='dialogue'):report.dialogues;
  if(!Array.isArray(rows))throw Error('分页测量缺少对白列表');
  const retained=report.preservation?.canPreserve?report.preservation.preservedPages:null;
   const characterCap=retained?null:report.summary?.dialoguePageMaxCharacters;
   if(characterCap!=null&&(!Number.isInteger(characterCap)||characterCap<1||characterCap>1000))throw Error('dialoguePageMaxCharacters 必须为 1..1000 整数');
   const encoder=new TextEncoder();let bytes=0;
  for(const row of rows){if(typeof row.text!=='string'||typeof (row.nodeId??row.id)!=='string')throw Error('分页测量对白格式无效');if(row.text.length>MAX_BYTES)throw Error('分页源文本超过 1 MiB');bytes+=encoder.encode(row.text).byteLength;if(bytes>MAX_BYTES)throw Error('分页源文本超过 1 MiB');}
  if(rows.length>MAX_PAGES)throw Error('分页超过 1000 页上限');
  const stage=doc.createElement('div'),dialogue=doc.createElement('div'),body=doc.createElement('div');
  stage.className='stage';dialogue.className='dialogue';body.className='dialogue-body';stage.setAttribute('aria-hidden','true');
  for(const [key,value] of Object.entries({position:'fixed',left:'-10000px',top:'0',width:'960px',height:'540px',visibility:'hidden',opacity:'0','pointer-events':'none',transform:'none',translate:'none',rotate:'none',scale:'none',zoom:'1','content-visibility':'visible'}))stage.style.setProperty(key,value,'important');
  dialogue.appendChild(body);stage.appendChild(dialogue);doc.body.appendChild(stage);
  const result={version:1,sourceHash:report.sourceHash,layout:{...LAYOUT},dialogues:[]};let total=0;
  try{
   if(!body.isConnected)throw Error('分页测量节点未连接');
   const segmenter=new Intl.Segmenter('zh-CN',{granularity:'grapheme'});
   for(const row of rows){
    aborted(signal);
    // scene.css uses auto-height; measurement policy reserves exactly three default lines.
    body.style.setProperty('height','112.5px','important');
    const style=view.getComputedStyle(body),px=key=>parseFloat(style.getPropertyValue(key));
    const width=px('width')-(style.getPropertyValue('box-sizing')==='border-box'?px('padding-left')+px('padding-right')+px('border-left-width')+px('border-right-width'):0);
    if(!Number.isFinite(width)||Math.abs(width-LAYOUT.width)>0.01)throw Error('默认布局测量宽度必须为 822px（请检查 scene.css）：'+JSON.stringify({contentWidth:width,width:style.getPropertyValue('width'),boxSizing:style.getPropertyValue('box-sizing'),paddingLeft:style.getPropertyValue('padding-left'),paddingRight:style.getPropertyValue('padding-right'),borderLeft:style.getPropertyValue('border-left-width'),borderRight:style.getPropertyValue('border-right-width'),stageWidth:view.getComputedStyle(stage).getPropertyValue('width'),dialogueWidth:view.getComputedStyle(dialogue).getPropertyValue('width'),zoom:style.getPropertyValue('zoom'),devicePixelRatio:view.devicePixelRatio}));
    const metrics=await layout.prepareTextMetrics({element:body,text:row.text,locale:'zh-CN',signal,maxLines:LAYOUT.maxLines});
    try{
     aborted(signal);
     if(typeof metrics?.measureSlice!=='function'||typeof metrics.dispose!=='function')throw Error('分页测量 API 返回无效 metrics');
     const segments=Array.from(segmenter.segment(row.text),s=>s.segment),bounds=[0];for(const s of segments)bounds.push(bounds.at(-1)+s.length);
     const count=segments.length,cap=characterCap??Infinity,pages=[],ranges=[],cache=new Map();let start=0;
     const nonblank=[0];for(const s of segments)nonblank.push(nonblank.at(-1)+Number(/\S/u.test(s)));
     const usable=(a,b)=>b>a&&nonblank[b]>nonblank[a];
     const fits=(a,b)=>{aborted(signal);if(b-a>cap)return false;const key=a+':'+b;if(cache.has(key))return cache.get(key);const m=metrics.measureSlice(bounds[a],bounds[b]);if(typeof m?.fits!=='boolean')throw Error('分页测量结果无效');cache.set(key,m.fits);return m.fits;};
     if(retained){
       const saved=retained.filter(d=>d.nodeId===(row.nodeId??row.id));
       if(saved.length!==1||!Array.isArray(saved[0].pages)||!saved[0].pages.length)throw Error('回接保留分页缺失或有歧义');
       let end=0;const preserved=[];
       for(const page of saved[0].pages){const a=bounds.indexOf(page.start),b=bounds.indexOf(page.end);
        if(a<0||b<0||page.start!==end||page.text!==row.text.slice(page.start,page.end)||!usable(a,b)||!fits(a,b))throw Error('旧分页不能完整放入当前字体布局，请在原工程调整或明确改用重新编排');
        if(++total>MAX_PAGES)throw Error('分页超过 1000 页上限');preserved.push({start:page.start,end:page.end,text:page.text});end=page.end;
       }
       if(end!==row.text.length)throw Error('回接分页未完整覆盖正文');
       result.dialogues.push({nodeId:row.nodeId??row.id,pages:preserved});continue;
      }
      const terminal=/[。！？.!?]/u,closer=/^[”’」』》〉）)\]"']$/u,secondary=/[，,；;、：:]|\s/u;
     const rank=new Uint8Array(count+1);let lastTerminal=false;
     for(let i=0;i<count;i++){const s=segments[i];if(terminal.test(s)){lastTerminal=true;rank[i+1]=2;}else if(closer.test(s)&&lastTerminal)rank[i+1]=2;else{lastTerminal=false;if(secondary.test(s))rank[i+1]=1;}if(i+1<count&&closer.test(segments[i+1])&&rank[i+1]===2)rank[i+1]=0;}
     function natural(a,b){const low=a+Math.ceil((b-a)*.55);for(const level of [2,1])for(let e=b;e>=low;e--){aborted(signal);if(rank[e]===level&&usable(a,e)&&usable(e,count)&&fits(a,e))return e;}return b;}
     if(!row.text){if(!fits(0,0))throw Error('空对白测量失败');pages.push({start:0,end:0,text:''});if(++total>MAX_PAGES)throw Error('分页超过 1000 页上限');}
     while(start<count){
      if(total>=MAX_PAGES)throw Error('分页超过 1000 页上限');
      const limit=Math.min(count,start+cap);let best=start+1;if(!fits(start,best))throw Error('单个 grapheme 无法放入默认布局');
      let step=2,upper=Math.min(start+step,limit);
      while(upper>best&&fits(start,upper)){best=upper;step*=2;upper=Math.min(start+step,limit);}
      let lo=best+1,hi=upper-1;while(lo<=hi){const mid=Math.floor((lo+hi)/2);if(fits(start,mid)){best=mid;lo=mid+1;}else hi=mid-1;}
      if(best<count&&!usable(best,count)){
       let candidate=best-1;while(candidate>start&&!usable(candidate,count))candidate--;
       if(candidate<=start||!usable(start,candidate)||!fits(start,candidate)||!fits(candidate,count))throw Error('尾部空白无法在分页限制内保留');
       best=candidate;
      }
      const end=best===count?best:natural(start,best);if(!usable(start,end))throw Error('分页限制导致纯空白页，无法无损分页');
      ranges.push([start,end]);total++;start=end;
     }
     if(ranges.length>1){const prev=ranges.at(-2),tail=ranges.at(-1),a=prev[0],z=tail[1];if(z-tail[0]<(prev[1]-a)*.25){
      const span=z-a,mid=(a+z)/2,min=Math.max(a+1,z-cap,a+Math.ceil(span*.35)),max=Math.min(z-1,a+cap,a+Math.floor(span*.65));
      const candidates=[];for(let e=min;e<=max;e++){aborted(signal);if(usable(a,e)&&usable(e,z))candidates.push(e);}
      candidates.sort((x,y)=>rank[y]-rank[x]||Math.abs(x-mid)-Math.abs(y-mid)||x-y);
      for(const e of candidates)if(fits(a,e)&&fits(e,z)){prev[1]=e;tail[0]=e;break;}
     }}
     for(const [a,b]of ranges){if(!fits(a,b)||!usable(a,b))throw Error('分页最终测量无效');pages.push({start:bounds[a],end:bounds[b],text:row.text.slice(bounds[a],bounds[b])});}
     result.dialogues.push({nodeId:row.nodeId??row.id,pages});
    }finally{metrics?.dispose?.();}
   }
   aborted(signal);return result;
  }finally{stage.remove();}
 }
 return {preparePagination,LAYOUT,MAX_BYTES,MAX_PAGES};
});
