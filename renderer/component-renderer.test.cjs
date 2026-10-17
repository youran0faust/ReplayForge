const assert = require('node:assert/strict');
// Behavioral DOM double: this tests rendering contracts, not browser pixels.
class Node {
  constructor(tag) { this.tagName = tag; this.style = {}; this.dataset = {}; this.children = []; this.classList = {add() {}}; }
  appendChild(n) { this.children.push(n); n.parent = this; return n; }
  replaceChildren(...nodes) { this.children = []; nodes.forEach(n => this.appendChild(n)); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); }
  set textContent(value) { this.text = value; this.firstChild = value ? {length:value.length, textContent:value} : null; }
  get textContent() { return this.text || ''; }
}
global.document = {createElement: tag => new Node(tag), fonts: {ready: Promise.resolve()}};
global.CSS = {highlights: new Map()}; global.Highlight = class extends Set { constructor(...ranges) { super(ranges); }};
global.window = {Highlight};
global.Range = class {setStart(node, offset) { this.startContainer=node; this.startOffset=offset; } setEnd(node, offset) { this.endContainer=node; this.endOffset=offset; }};
global.requestAnimationFrame = cb => cb();
const {createComponentRenderer} = require('./component-renderer.js');
const rect = {x:0,y:0,width:100,height:20};
const definitions = [
  {id:'ui',kind:'dialogue-ui',designSize:{width:100,height:50},visibility:'when-active-dialogue',elements:[
    {id:'panel',type:'panel',rect,fill:'#123456',opacity:0,radius:3,borderWidth:2,borderColor:'#ffffff'},
    {id:'name',type:'text',rect,binding:'activeDialogue.speakerName',fontFamily:'Microsoft YaHei'},
    {id:'body',type:'text',rect,binding:'activeDialogue.text',fontSize:20,reveal:'active-dialogue-progress'},
    {id:'body2',type:'text',rect,binding:'activeDialogue.text',reveal:'active-dialogue-progress'}]},
  {id:'dec',kind:'decoration',designSize:{width:100,height:50},visibility:'instance-range',elements:[
    {id:'img',type:'image',rect,resourceId:'picture',fit:'cover'},
    {id:'literal',type:'text',rect,text:'<img src=x onerror=alert(1)>',fontFamily:'untrusted-font'}]}
];
const instance = (id,definitionId,zIndex=0) => ({id,definitionId,x:12,y:23,width:200,height:100,zIndex,locked:true,visibleFrom:2,visibleTo:8});
const project = {design:{width:960,height:540},locale:'zh-CN',componentDefinitions:definitions,scene:{durationFrames:10,components:[instance('front','ui',5),instance('back','dec',-9)],characters:[{id:'hero',name:'姓名'}]}};
const state = {frame:2,dialogues:[{speakerId:'hero',text:'A👨‍👩‍👧‍👦中B',progress:0.5}],components:[]};
const stage = new Node('stage'), requested=[];
const renderer=createComponentRenderer(stage,{imageStyle:id => {requested.push(id); return 'url("raster-data")';}});
const firstResult = renderer.render(state,project);
assert.deepEqual(firstResult,{customDialogueVisible:true,customBodyVisible:true,customSpeakerVisible:true,warnings:[]});
assert.deepEqual(renderer.layer.children.map(n=>n.dataset.componentId),['back','front']);
let [dec,ui]=renderer.layer.children;
assert.equal(ui.style.transform,'scale(2)'); assert.equal(ui.style.width,'100px'); assert.equal(ui.style.left,'12px');
assert.equal(ui.children[0].style.opacity,'0'); assert.equal(ui.children[0].style.borderWidth,'2px');
assert.equal(ui.children[1].textContent,'姓名'); assert.equal(ui.children[2].style.fontSize,'20px');
assert.equal(ui.children[2].textContent,state.dialogues[0].text);
assert.equal(dec.children[0].style.backgroundSize,'cover'); assert.equal(dec.children[0].style.backgroundImage,'url("raster-data")');
assert.equal(dec.children[1].textContent,'<img src=x onerror=alert(1)>'); assert.equal(dec.children[1].style.fontFamily,'sans-serif');
assert.deepEqual(requested,['picture']);
assert.equal(ui.children[2].dataset.componentOverflow,undefined,'missing mock metrics do not report overflow');
const body = ui.children[2];
Object.assign(body,{clientWidth:100,scrollWidth:100,clientHeight:20,scrollHeight:40});
assert.deepEqual(renderer.checkOverflow(),[body]);
assert.equal(body.dataset.componentOverflow,'true');
assert.deepEqual(firstResult.warnings,[{instanceId:'front',elementId:'body',message:'Text overflows its component bounds; rendering continues without shrinking.'}]);
assert.equal(body.style.fontSize,'20px','overflow must not shrink the text');
Object.assign(body,{scrollWidth:101,scrollHeight:20});
assert.equal(renderer.checkOverflow().length,1,'horizontal overflow is reported');
body.scrollWidth=100;
assert.equal(renderer.checkOverflow().length,0); assert.equal(body.dataset.componentOverflow,undefined,'resolved overflow clears marker');
assert.deepEqual(firstResult.warnings,[],'resolved overflow clears warnings without blocking');
assert.equal(CSS.highlights.get('replay-hidden-tail').size,2);
for(const range of CSS.highlights.get('replay-hidden-tail')) assert.equal(range.startOffset,12,'reveal uses graphemes while keeping full text');
state.dialogues[0].speakerId='narrator'; renderer.render(state,project);
assert.equal(renderer.layer.children[1].children[1].textContent,'旁白');
assert.equal(CSS.highlights.get('replay-hidden-tail').size,2,'rerender cleans stale ranges');
assert.equal(renderer.render({...state,dialogues:[]},project).customDialogueVisible,false);
assert.equal(renderer.layer.children.length,1,'decoration remains without dialogue');
assert.equal(CSS.highlights.get('replay-hidden-tail').size,0);
for(const frame of [1,8]) { renderer.render({...state,frame},project); assert.equal(renderer.layer.children.length,0); }
renderer.render(state,{...project,scene:{...project.scene,components:[]}}); assert.equal(renderer.layer.children.length,0);
// Only explicit dialogue-ui roles claim UI; no inference from text bindings.
for (const roles of [[], ['body'], ['speaker'], ['body','speaker']]) {
  const p={...project,componentDefinitions:[{...definitions[0],roles}]};
  const result=renderer.render(state,p);
  assert.equal(result.customBodyVisible,roles.includes('body'));
  assert.equal(result.customSpeakerVisible,roles.includes('speaker'));
  assert.equal(result.customDialogueVisible,roles.length===2);
  assert.deepEqual(renderer.render({...state,frame:8},p),{customBodyVisible:false,customSpeakerVisible:false,customDialogueVisible:false,warnings:[]});
}
const decorationProject={...project,componentDefinitions:[{...definitions[0],kind:'decoration',roles:['body','speaker']}]};
assert.equal(renderer.render(state,decorationProject).customDialogueVisible,false);
assert.equal(renderer.render(state,decorationProject).customBodyVisible,false);
assert.equal(renderer.render(state,decorationProject).customSpeakerVisible,false);
const alwaysProject={...project,componentDefinitions:[{...definitions[0],visibility:'instance-range'}]};
assert.deepEqual(renderer.render({...state,dialogues:[]},alwaysProject),{customDialogueVisible:false,customBodyVisible:false,customSpeakerVisible:false,warnings:[]});
assert.equal(renderer.layer.children.length,1,'always-visible dialogue UI is rendered but cannot claim an inactive dialogue');
renderer.dispose(); assert.equal(stage.children.length,0);
// Scene integration: image readiness shares raster cache and default dialogue restores.
let decodes=0;
global.Image=class { constructor() {this.naturalWidth=2;this.naturalHeight=2;} decode(){decodes++; return Promise.resolve();} };
const baseCreate=document.createElement;
document.createElement=tag=>{ const n=baseCreate(tag); if(tag==='canvas'){n.getContext=()=>({drawImage(){}});n.toDataURL=()=> 'data:image/png;base64,raster';} return n; };
const {createSceneRenderer}=require('./scene-renderer.js');
(async()=>{
  // Font readiness can change layout after the synchronous render measurement.
  let releaseFonts;
  document.fonts.ready=new Promise(resolve=>{releaseFonts=resolve;});
  const fontRenderer=createComponentRenderer(new Node('stage'));
  const fontResult=fontRenderer.render(state,project);
  const fontBody=fontRenderer.layer.children[1].children[2];
  Object.assign(fontBody,{clientWidth:100,scrollWidth:100,clientHeight:20,scrollHeight:21});
  assert.equal(fontBody.dataset.componentOverflow,undefined);
  releaseFonts(); await document.fonts.ready;
  assert.equal(fontBody.dataset.componentOverflow,'true','font readiness remeasures full text');
  assert.equal(fontResult.warnings[0].instanceId,'front','returned warnings reflect font-ready layout');
  fontRenderer.dispose();
  const sceneStage=new Node('stage'), scene=createSceneRenderer(sceneStage);
  scene.render(state,project,{picture:'local-image'});
  assert.equal(sceneStage.children[2].hidden,true);
  await scene.ready(); assert.equal(decodes,1);
  assert.match(scene.components.layer.children[0].children[0].style.backgroundImage,/data:image\/png/);
  scene.render(state,{...project,scene:{...project.scene,components:[]}});
  assert.equal(sceneStage.children[2].hidden,false);
  assert.equal(scene.components.layer.children.length,0);
  assert.equal(CSS.highlights.get('replay-hidden-tail').size,1,'only legacy revealer remains');
  const legacy=sceneStage.children[2], [legacySpeaker,legacyBody]=legacy.children;
  assert.equal(legacyBody.className,'dialogue-body');
  assert.equal(legacySpeaker.className,'dialogue-speaker');
  assert.equal(legacyBody.textContent,state.dialogues[0].text);
  assert.equal(legacySpeaker.textContent,'旁白');
  const schema3={...project,schemaVersion:3,characterDefinitions:[{id:'shared',name:'共享姓名',color:'#ffffff',expressions:[]}],scene:{...project.scene,characters:[{id:'hero',definitionId:'shared',visibleFrom:100,visibleTo:110}]}};
  const schema3State={...state,characters:[],dialogues:[{speakerId:'hero',text:'离场说话',progress:1}]};
  const frozen=JSON.stringify(schema3);scene.render(schema3State,schema3);
  assert.equal(legacySpeaker.textContent,'共享姓名','offstage speaker resolves through instance definition');
  assert.equal(scene.components.layer.children[1].children[1].textContent,'共享姓名','component speaker resolves offstage instance');
  assert.equal(JSON.stringify(schema3),frozen,'render projections never mutate authoritative model');
  // Schema 4 speaks as a library definition, including with zero instances.
  const schema4={...schema3,schemaVersion:4,characterDefinitions:[...schema3.characterDefinitions,{id:'other',name:'其他身份'}],scene:{...schema3.scene,characters:[]}};
  const definitionState={...schema3State,dialogues:[{speakerId:'shared',text:'无需登场',progress:1}]};
  const assertSpeaker=(p,s,expected)=>{
    const before=JSON.stringify([p,s]);
    scene.render(s,p);
    assert.equal(legacySpeaker.textContent,expected,'default speaker name');
    assert.equal(scene.components.layer.children[1].children[1].textContent,expected,'component speaker name');
    assert.equal(JSON.stringify([p,s]),before,'render never rewrites dialogue speakerId or model');
  };
  assertSpeaker(schema4,definitionState,'共享姓名');
  const colliding={...schema4,scene:{...schema4.scene,characters:[{id:'shared',definitionId:'other',name:'实例别名'},{id:'visible',definitionId:'shared',name:'另一个别名'}]}};
  assertSpeaker(colliding,definitionState,'共享姓名');
  assertSpeaker(colliding,{...definitionState,dialogues:[{speakerId:'visible',text:'not a definition',progress:1}]},'');
  assertSpeaker(schema4,{...definitionState,dialogues:[{speakerId:'narrator',text:'旁白',progress:1}]},'旁白');
  assertSpeaker(schema4,{...definitionState,dialogues:[{speakerId:'missing',text:'unknown',progress:1}]},'');
  for(const schemaVersion of [1,2]) assertSpeaker({...project,schemaVersion},{...definitionState,dialogues:[{speakerId:'hero',text:'旧版',progress:1}]},'姓名');
  // Both renderers defer to the shared public helper when loaded globally.
  const speakerCalls=[];
  global.CharacterDefinitions={getDialogueSpeakerName(p,id){speakerCalls.push([p,id]);return '共享API姓名';}};
  try {
    assertSpeaker(schema4,definitionState,'共享API姓名');
    assert.deepEqual(speakerCalls,[[schema4,'shared'],[schema4,'shared']]);
  } finally { delete global.CharacterDefinitions; }
  global.CharacterDefinitions=require('../core/character-definitions.cjs');
  try {
    assertSpeaker(schema4,definitionState,'共享姓名');
    assertSpeaker(colliding,definitionState,'共享姓名');
    assertSpeaker(schema3,schema3State,'共享姓名');
    for(const schemaVersion of [1,2]) assertSpeaker({...project,schemaVersion},{...definitionState,dialogues:[{speakerId:'hero',text:'旧版',progress:1}]},'姓名');
    const evaluatedProject={...schema4,design:{...schema4.design,fps:30},scene:{...schema4.scene,dialogues:[{id:'dialogue',speakerId:'shared',startFrame:0,endFrame:8,revealFrames:1,text:{'zh-CN':'无需登场'}}]}};
    const evaluated=require('../core/model.cjs').evaluate(evaluatedProject,2);
    assert.equal(evaluated.dialogues[0].speakerId,'shared','evaluation preserves definition identity');
    assert.deepEqual(evaluated.characters,[],'dialogue requires no scene character');
    assertSpeaker(evaluatedProject,evaluated,'共享姓名');
  } finally { delete global.CharacterDefinitions; }
  for(const roles of [[],['body'],['speaker'],['body','speaker']]) {
    const roleProject={...project,componentDefinitions:[{...definitions[0],roles}]};
    const updated={...state,dialogues:[{speakerId:'hero',text:'Updated text',progress:0.25}]};
    scene.render(updated,roleProject);
    assert.equal(legacy.hidden,roles.length===2);
    assert.equal(legacyBody.hidden,roles.includes('body'));
    assert.equal(legacySpeaker.hidden,roles.includes('speaker'));
    assert.equal(legacySpeaker.textContent,'姓名');
    assert.equal(legacyBody.textContent,'Updated text','hidden legacy body is still prepared');
    const tail=[...CSS.highlights.get('replay-hidden-tail')].find(r=>r.startContainer===legacyBody.firstChild);
    assert.equal(tail.startOffset,3,'hidden legacy revealer still advances');
    scene.render({...updated,dialogues:[{...updated.dialogues[0],progress:0.75}]},roleProject);
    assert.equal([...CSS.highlights.get('replay-hidden-tail')].find(r=>r.startContainer===legacyBody.firstChild).startOffset,9);
  }
  const splitProject={...project,componentDefinitions:[{...definitions[0],id:'body-ui',roles:['body']},{...definitions[0],id:'speaker-ui',roles:['speaker']}],scene:{...project.scene,components:[instance('body-instance','body-ui'),instance('speaker-instance','speaker-ui')]}};
  assert.equal(scene.render(state,splitProject).customDialogueVisible,true,'separate instances can jointly claim both roles');
  assert.equal(legacy.hidden,true);
  scene.render(state,decorationProject);
  assert.equal(legacy.hidden,false); assert.equal(legacyBody.hidden,false); assert.equal(legacySpeaker.hidden,false);
  scene.render({...state,dialogues:[]},alwaysProject);
  assert.equal(legacy.hidden,true); assert.equal(legacyBody.hidden,true); assert.equal(legacySpeaker.hidden,true);
  assert.equal(legacyBody.textContent,''); assert.equal(legacySpeaker.textContent,'');
  // Inspect stylesheet structure: bubble belongs only to body; name has its own compact style.
  const css=require('node:fs').readFileSync(require('node:path').join(__dirname,'scene.css'),'utf8');
  const rule=selector=>css.match(new RegExp('\\.stage \\.'+selector+' \\{([^}]+)\\}'))?.[1];
  assert.doesNotMatch(rule('dialogue'),/min-height|padding|background|border/);
  assert.match(rule('dialogue-body'),/min-height:90px/);
  assert.match(rule('dialogue-speaker'),/position:absolute/);
  assert.match(rule('dialogue-speaker'),/bottom:100%/,'speaker does not shift legacy body baseline');
  console.log('PASS component-renderer behavioral DOM tests: range, z-order, uniform group scale, bindings, graphemes, multiple revealers, literal text, shared raster readiness, legacy restore (not screenshot parity)');
})().catch(error=>{console.error(error);process.exitCode=1;});
