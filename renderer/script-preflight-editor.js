(function(root){
'use strict';
const PAGE_SIZE=100;
function createScriptPreflightEditor(options){
 const doc=options.container.ownerDocument,win=doc.defaultView||root,api=options.api||win.replay;
 const make=(tag,id,text)=>{const e=doc.createElement(tag);if(id)e.id='script-preflight-'+id;if(text!==undefined)e.textContent=String(text);return e;};
 const panel=make('fieldset','editor');panel.append(make('legend','title','剧本预检'),make('p','notice','预检不修改当前工程；生成另存新工程。支持角色/背景、表情、移动与淡入淡出、黑屏遮罩、标题卡、对白显隐、分页/画外音/停顿及PCM16 WAV和BGM淡出；OGG（Vorbis/Opus）及MP3在概要和生成时受控转换为48kHz PCM16 WAV，不支持多流/链式音频或循环标记；支持视频插播；压缩音频和视频在正式生成时会再次规范化。生成前须计算概要并确认，计算概要不会发布工程。回接时选择导出的文本、素材、配置及配套记录；身份不明或改词须校正。未生成的校正仅当前会话有效。'));options.container.append(panel);
 let current=null,generation=0,busy=false,token=null,selection={},report=null,stale=false,selectedId=null,page=0,diagnosticPage=0,message='请选择剧本、素材与配置后预检。';
 const buttons=[];let rowButtons=[],renderedReport=null,renderedSelectedId=null,synced=false,measurementController=null;
 const preparePagination=options.preparePagination||((input)=>{const implementation=win.ScriptGenerationPagination||root.ScriptGenerationPagination||(typeof module!=='undefined'&&module.exports?require('./script-generation-pagination.js'):null);if(typeof implementation?.preparePagination!=='function')throw Error('分页测量 API 不可用');return implementation.preparePagination(input);});
 function button(parent,id,label,fn){const e=make('button',id,label);e.type='button';e.addEventListener('click',()=>{if(!e.disabled&&!busy)return fn();});parent.append(e);buttons.push(e);return e;}
 const picks=['script','assets','config','returnMap'].map((kind,i)=>button(panel,'pick-'+kind,['选择剧本','选择素材目录','选择配置','选择回接记录（可选）'][i],()=>request('pickScriptPreflight',{kind})));
 const run=button(panel,'run','预检',()=>request('runScriptPreflight',{token}));
 let generationPreview=null,approvedPlan=null;
 const clearApproval=()=>{generationPreview=null;approvedPlan=null;};
 const approved=()=>!!generationPreview&&!!approvedPlan&&approvedPlan.documentId===current?.documentId&&approvedPlan.revision===current?.revision&&approvedPlan.token===token;
 const preview=button(panel,'preview','计算生成概要',()=>request('previewScriptGeneration',{token}));
 const generate=button(panel,'generate','确认概要并生成基础工程（另存）',()=>request('generateScriptProject',{token}));
 button(panel,'export-return','导出剧本回接包',async()=>{
  sync();if(!current)return;busy=true;controls();
  try{const result=await api.exportScriptReturnPackage({documentId:current.documentId,expectedRevision:current.revision});message=result?.cancelled?'已取消导出。':result?.ok?'已导出：'+result.root:'导出未完成。';}
  catch(error){message='导出失败：'+error.message;}
  finally{busy=false;render();}
 });
 const reload=button(panel,'refresh','读取会话',()=>refresh());
 const reset=button(panel,'reset','清除预检会话',()=>request('resetScriptPreflight',{token}));
 const chosen=make('p','selection'),status=make('p','status'),summary=make('p','summary'),diagnostics=make('ul','diagnostics');status.setAttribute('role','status');
 const generationSummary=make('p','generation-summary');
 panel.append(chosen,status,make('h3',null,'生成前概要'),generationSummary,make('h3',null,'报告概要'),summary,make('h3',null,'诊断（行号）'),diagnostics);
 const dprev=button(panel,'diagnostic-prev','上一页诊断',()=>{diagnosticPage--;render();}),dnext=button(panel,'diagnostic-next','下一页诊断',()=>{diagnosticPage++;render();}),dpage=make('span','diagnostic-page');panel.append(dpage);
 const list=make('ul','dialogues');panel.append(make('h3',null,'对白列表'),list);
 const prev=button(panel,'prev','上一页对白',()=>{page--;render();}),next=button(panel,'next','下一页对白',()=>{page++;render();}),pageLabel=make('span','page');panel.append(pageLabel);
 const detail=make('p','detail'),resourceLabel=make('label',null,'配音素材：'),resource=make('select','resource');resourceLabel.append(resource);panel.append(detail,resourceLabel);
 const unvoiced=button(panel,'unvoiced','设为无配音',()=>correct('unvoiced')),bind=button(panel,'bind','绑定素材',()=>correct('bind')),auto=button(panel,'auto','恢复自动',()=>correct('reset'));resource.addEventListener('change',controls);
 const text=v=>v==null?'':typeof v==='object'?JSON.stringify(v):String(v);
 const dialogues=()=>report?.nodes?.filter(n=>n.type==='dialogue')||report?.dialogues||[];
 const issues=()=>report?.diagnostics||[];
 const id=row=>row.nodeId??row.id;
 const selected=()=>dialogues().find(row=>id(row)===selectedId);
 const binding=row=>report?.bindings?.find(b=>b.nodeId===id(row))||row?.match||{};
 const label=v=>typeof v==='object'&&v?text(v.relativePath??v.name??v.path??v.label??v.id??v):text(v);
 function controls(){
  for(const b of buttons.concat(rowButtons))b.disabled=busy;
  const missing=!current||current.documentId==null;
  for(const b of picks.concat([reload]))b.disabled=busy||missing;
  preview.disabled=busy||missing||stale||!token||!report?.ok||typeof api?.previewScriptGeneration!=='function';
  generate.disabled=busy||missing||stale||!token||!report?.ok||!approved();
  run.disabled=busy||missing||!token;reset.disabled=busy||missing||!token||stale;
  const invalid=busy||stale||!token||!selected();resource.disabled=!!invalid;unvoiced.disabled=auto.disabled=!!invalid;bind.disabled=!!invalid||!resource.value;
  prev.disabled=busy||page===0;next.disabled=busy||(page+1)*PAGE_SIZE>=dialogues().length;
  dprev.disabled=busy||diagnosticPage===0;dnext.disabled=busy||(diagnosticPage+1)*PAGE_SIZE>=issues().length;
 }
 function render(){
  chosen.textContent=['script','assets','config','returnMap'].map((k,i)=>['剧本','素材','配置','回接记录'][i]+'：'+(label(selection[k])||'未选择')).join('；');status.textContent=message;
  const g=generationPreview,seconds=g?Math.max(0,Math.floor(g.durationSeconds??g.durationFrames/g.fps)):0;
  generationSummary.textContent=g?'总时长 '+String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0')+'（'+text(g.durationFrames)+' 帧 / '+text(g.fps)+' fps）；对白 '+text(g.dialogueCount)+'；分页 '+text(g.pageCount)+'；有配音 '+text(g.voicedDialogueCount)+' / 无配音 '+text(g.unvoicedDialogueCount)+'；角色：'+(g.characters||[]).map(c=>text(c.name)+'（'+text(c.instanceCount)+(c.instanceCount===0?'，画外':'')+'）').join('、')+'；素材 '+text(g.media?.count)+'（图片 '+text(g.media?.images)+' / 音频 '+text(g.media?.audio)+' / 视频 '+text(g.media?.videos)+'；'+text(g.media?.totalBytes)+' 字节）；警告：'+text(g.warnings||[])+'。压缩音频和视频在正式生成时会再次规范化；本概要没有发布工程，请确认后生成。':'尚无有效生成概要；请先预检，再计算生成概要。';
  const reading=report?.summary||{},autoReading=reading.unvoicedTimingMode==='auto';
  const timingSummary=autoReading?'无配音自动阅读（按文字量；最短 '+text(reading.unvoicedMinimumSeconds??3)+' 秒；阅读速度 '+text(reading.unvoicedReadingSpeed??8)+' 字/秒；完整文字停留目标 '+text(reading.dialoguePageHoldSeconds??0.8)+' 秒（受每页时长约束）；揭示速度 '+text(reading.dialogueRevealCharactersPerSecond??30)+' 字/秒；有配音按音频样本时长不变）':'无配音每页 '+text(reading.unvoicedDurationSeconds??3)+' 秒（固定时长，实际分页后累计；有配音按音频时长/样本不变）；读完停留 '+text(reading.dialoguePageHoldSeconds??0.6)+' 秒（不超过每页40%，不增加总时长）';
  summary.textContent=report?(report.preservation?(report.preservation.canPreserve?'回接：保留已有实际帧及声音剪辑，全局阅读参数不覆盖；旧页仍须实际字体检查。 ':'回接：此次重新编排，旧绝对帧不自动沿用。 '):'')+'对白 '+text(report.summary?.dialogues??dialogues().length)+'；素材 '+text(report.summary?.assets??0)+'；错误 '+text(report.summary?.errors??0)+'；警告 '+text(report.summary?.warnings??0)+'；配音 '+text(report.summary?.voices||{})+'；'+timingSummary+'；每页文字容量 '+(report.summary?.dialoguePageMaxCharacters==null?'自动排版':text(report.summary.dialoguePageMaxCharacters)+' 字符上限')+'；阅读设置来源：'+(reading.readingConfigSource==='global'?'全局阅读设置':'剧本JSON'):'尚无预检报告。';
  diagnosticPage=Math.max(0,Math.min(diagnosticPage,Math.ceil(issues().length/PAGE_SIZE)-1));
  diagnostics.replaceChildren(...issues().slice(diagnosticPage*PAGE_SIZE,(diagnosticPage+1)*PAGE_SIZE).map(d=>make('li',null,'行 '+text(d.line??d.lineNumber??'—')+' ['+text(d.severity??'诊断')+' '+text(d.code)+'] '+text(d.message))));dpage.textContent=`第 ${diagnosticPage+1} 页，共 ${issues().length} 条`;
  page=Math.max(0,Math.min(page,Math.ceil(dialogues().length/PAGE_SIZE)-1));rowButtons=[];
  list.replaceChildren(...dialogues().slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE).map(row=>{const li=make('li',null),b=make('button',null);b.type='button';b.textContent='行 '+text(row.line??'—')+' · '+text(row.speaker)+' · '+text(row.text)+' · 匹配：'+text(binding(row).status??row.status??'未匹配');b.setAttribute('aria-pressed',String(id(row)===selectedId));b.addEventListener('click',()=>{if(!busy){selectedId=id(row);render();}});li.append(b);rowButtons.push(b);return li;}));
  pageLabel.textContent=`第 ${page+1} 页，共 ${dialogues().length} 句（每页最多 ${PAGE_SIZE} 句）`;
  const row=selected();detail.textContent=row?'校正所选对白：'+text(row.speaker)+' / '+text(row.text):'请选择一句对白校正；无需手写 JSON。';
  const pendingResource=renderedReport===report&&renderedSelectedId===selectedId?resource.value:null;
  const empty=make('option',null,'请选择配音素材');empty.value='';
  const assets=(report?.assetCatalog||[]).filter(r=>r.kind==='audio'&&r.category==='voice');
  resource.replaceChildren(empty,...assets.map(r=>{const o=make('option',null,label(r));o.value=text(r.id);return o;}));resource.value=pendingResource!==null?pendingResource:row?text(binding(row).resourceId):'';
  renderedReport=report;renderedSelectedId=selectedId;controls();
 }
 function sync(p=options.packet()){
  const next=p?{documentId:p.documentId,revision:p.revision}:null;
  if(synced&&current?.documentId===next?.documentId&&current?.revision===next?.revision)return;
  synced=true;measurementController?.abort();clearApproval();
  if(current?.documentId!==next?.documentId){generation++;token=null;selection={};report=null;selectedId=null;page=diagnosticPage=0;stale=false;message='请选择剧本、素材与配置后预检。';}
  else if(current&&current.revision!==next?.revision){generation++;stale=true;message='文档版本已变化，请重新预检；旧报告仅供参考，校正暂不可用。';}
  current=next;render();
 }
 async function request(method,extra={}){
  if(busy)return false;
  sync();if(!current||current.documentId==null)return false;
  if(method==='previewScriptGeneration'||method==='generateScriptProject'||method==='correctScriptPreflight'||method==='resetScriptPreflight'){if(stale||!token||extra.token!==token)return false;}
  if(method==='runScriptPreflight'&&(!token||extra.token!==token))return false;
  if((method==='previewScriptGeneration'||method==='generateScriptProject')&&!report?.ok)return false;
  if(method==='generateScriptProject'&&!approved())return false;
  if(method==='generateScriptProject')extra={token,paginationPlan:approvedPlan.paginationPlan};
  else clearApproval();
  let measuredPlan=null;
  const captured={...current},epoch=generation,capturedReport=report,capturedToken=token;
  const valid=()=>epoch===generation&&current?.documentId===captured.documentId&&current?.revision===captured.revision&&report===capturedReport&&token===capturedToken;
  busy=true;message='处理中…';render();
  try{
   if(typeof api?.[method]!=='function')throw Error('预检接口不可用：'+method);
   if(method==='previewScriptGeneration'){
    measurementController=new AbortController();message='正在测量默认布局分页…';status.textContent=message;
    const pending=preparePagination({report:capturedReport,document:doc,signal:measurementController.signal});
    // Synchronous injected plans keep legacy test requests synchronous; real measurement is async.
    const paginationPlan=pending&&typeof pending.then==='function'?await pending:pending;
    sync();if(!valid()||measurementController.signal.aborted)return false;
    if(!paginationPlan||paginationPlan.version!==1||paginationPlan.sourceHash!==capturedReport.sourceHash||paginationPlan.layout?.id!=='default-960x540-v1'||paginationPlan.layout.width!==822||paginationPlan.layout.maxLines!==3||!Array.isArray(paginationPlan.dialogues))throw Error('分页测量未返回合法 plan');
    measuredPlan=JSON.parse(JSON.stringify(paginationPlan));
    extra={token:capturedToken,paginationPlan:measuredPlan};
   }
   sync();if(!valid())return false;
   const result=await api[method]({documentId:captured.documentId,expectedRevision:captured.revision,...extra});sync();
   if(!valid())return false;
   if(result?.cancelled){message='已取消，保留原选择、报告和校正。';return false;}
   if(!result?.ok){
    clearApproval();
    const state=result?.state;
    if(state?.documentId===captured.documentId&&(state.revision===undefined||state.revision===captured.revision)&&(state.expectedRevision===undefined||state.expectedRevision===captured.revision)){
     token=state.token??null;selection=state.selection||{};report=state.report||null;if(!selected())selectedId=null;
    }
    throw Error(result?.error?.message||text(result?.error)||'预检失败');
   }
   if(result?.documentId!==captured.documentId||(result?.revision!==undefined&&result.revision!==captured.revision)||(result?.expectedRevision!==undefined&&result.expectedRevision!==captured.revision)){clearApproval();message='已忽略不属于当前文档/版本的迟到结果。';return false;}
   token=result.token??null;selection=result.selection||{};report=result.report||null;if(!selected())selectedId=null;
   if(method==='previewScriptGeneration'&&result.generationPreview&&token&&report?.ok){
    generationPreview=result.generationPreview;approvedPlan={...captured,token,paginationPlan:measuredPlan};
   }else clearApproval();
   if(method==='runScriptPreflight'||method==='pickScriptPreflight')stale=false;
   message=result.generated?'生成成功：'+text(result.generated.file)+'\n当前工程未替换，请通过“打开工程”查看；源剧本和配置已随新工程保存。':stale?'文档版本已变化，请重新预检。':approved()?'生成概要已计算，请核对概要后确认生成；尚未发布工程。':'预检会话已更新；未生成工程，关闭编辑器不保存校正。';return true;
  }catch(error){sync();if(epoch===generation){clearApproval();message='预检失败：'+(error?.message||text(error));}return false;}
  finally{measurementController?.abort();measurementController=null;busy=false;render();}
 }
 function correct(action){
  const resourceId=resource.value,oldId=selectedId,oldToken=token;sync();
  if(busy||stale||!token||token!==oldToken||selectedId!==oldId||!selected())return Promise.resolve(false);
  const payload={token,nodeId:selectedId,action};if(action==='bind'){if(!resourceId)return Promise.resolve(false);payload.resourceId=resourceId;}
  return request('correctScriptPreflight',payload);
 }
 function refresh(){return request('getScriptPreflight');}
 sync();
 return {element:panel,sync,refresh,get busy(){return busy;},get state(){return {documentId:current?.documentId,revision:current?.revision,token,selection,report,generationPreview,stale,busy,selectedNodeId:selectedId,page};}};
}
if(typeof module!=='undefined'&&module.exports)module.exports={createScriptPreflightEditor};else root.createScriptPreflightEditor=createScriptPreflightEditor;
})(typeof globalThis!=='undefined'?globalThis:this);
