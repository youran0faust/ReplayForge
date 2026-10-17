const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// Existing component-renderer DOM double, extended with real reparenting and
// textContent child clearing. Behavioral contracts, not browser pixels.
class Node {
  constructor(tag) { this.tagName=tag; this.style={}; this.dataset={}; this.children=[]; this.classList={add(){}}; }
  appendChild(n) { n.remove(); this.children.push(n); n.parent=this; return n; }
  replaceChildren(...nodes) { for(const n of this.children) n.parent=null; this.children=[]; nodes.forEach(n=>this.appendChild(n)); }
  remove() { if(this.parent) this.parent.children=this.parent.children.filter(n=>n!==this); this.parent=null; }
  set textContent(value) { this.replaceChildren(); this.text=String(value); this.firstChild=this.text ? {length:this.text.length,textContent:this.text}:null; }
  get textContent() { return this.text || ''; }
  get ownerDocument() { return global.document; }
  get parentElement() { return this.parent; }
  getBoundingClientRect() { return {width:864,height:global.titleTestHeight || 126}; }
  get scrollWidth() { return 864; }
  get scrollHeight() { return global.titleTestHeight || 126; }
}
global.document={createElement:tag=>new Node(tag),fonts:{ready:Promise.resolve()},body:new Node('body')};
global.CSS={highlights:new Map()}; global.Highlight=class extends Set { constructor(...ranges){super(ranges);} };
global.window={Highlight};
global.Range=class {setStart(node,offset){this.startContainer=node;this.startOffset=offset;} setEnd(node,offset){this.endContainer=node;this.endOffset=offset;}};
global.requestAnimationFrame=cb=>cb();
const {createSceneRenderer}=require('./scene-renderer.js');
const rect={x:0,y:0,width:100,height:40};
const definition=(id,kind,visibility)=>({id,kind,visibility,designSize:{width:100,height:40},elements:[{id:'panel',type:'panel',rect,fill:'#abcdef'},{id:'body',type:'text',rect,binding:'activeDialogue.text'}]});
const instance=id=>({id,definitionId:id,x:0,y:0,width:100,height:40,zIndex:2147483647,visibleFrom:0,visibleTo:100});
const project={schemaVersion:4,design:{width:960,height:540},locale:'zh-CN',characterDefinitions:[],componentDefinitions:[definition('always','dialogue-ui','instance-range'),definition('active','dialogue-ui','when-active-dialogue'),definition('decor','decoration','instance-range')],scene:{durationFrames:100,characters:[],components:['always','active','decor'].map(instance)}};
const base={frame:0,background:{color:'#123456'},characters:[{id:'hero',x:20,y:30,width:100,height:200,name:'角色'}],dialogues:[{speakerId:'narrator',text:'原对白',progress:1}]};
const performance=(screenOpacity=0,title=null,dialogueVisible=true)=>({screenOpacity,title,dialogueVisible});
const stage=new Node('stage'), renderer=createSceneRenderer(stage);
renderer.render(base,project);
assert.equal(stage.children.length,4,'legacy projects never create overlays');
const [background,characters,dialogue,components]=stage.children;
assert.equal(characters.children[0].style.opacity,'1');
renderer.render({...base,dialogues:[]},project);
assert.deepEqual(components.children.map(n=>n.dataset.componentId),['always','decor'],'legacy instance-range behavior unchanged');
const malicious='<img src=x onerror=alert(1)>\n序章';
const covered={...base,characters:[{...base.characters[0],opacity:0.25}],performance:performance(0.6,{text:malicious,opacity:0})};
const before=JSON.stringify([covered,project]);
renderer.render(covered,project);
const layer=stage.children[4], [mask,title]=layer.children, text=title.children[0];
assert.equal(JSON.stringify([covered,project]),before,'renderer never changes evaluated state or model');
assert.equal(characters.children[0].style.opacity,'0.25');
assert.equal(mask.style.opacity,'0.6'); assert.equal(mask.style.backgroundColor,'#000000');
for(const node of [layer,mask,title]) assert.equal(node.style.pointerEvents,'none');
assert.equal(title.style.backgroundColor,'#000000'); assert.equal(title.style.opacity,'1'); assert.equal(text.style.opacity,'0');
assert.equal(text.textContent,malicious); assert.equal(text.children.length,0,'safe literal title, never HTML');
assert.equal(text.style.fontSize,'42px'); assert.match(text.style.fontFamily,/Microsoft YaHei/); assert.equal(text.style.color,'#ffffff');
assert.equal(title.style.inset,'0'); assert.equal(title.style.placeItems,'center'); assert.equal(text.style.maxWidth,'90%');
assert.equal(stage.style.width,'960px'); assert.equal(stage.style.height,'540px');
assert.ok(Number(title.style.zIndex)>Number(mask.style.zIndex));
assert.ok(stage.children.indexOf(layer)>stage.children.indexOf(components));
const css=fs.readFileSync(path.join(__dirname,'scene.css'),'utf8');
const componentRule=css.match(/\.stage \.component-layer \{([^}]+)\}/)[1];
assert.match(componentRule,/isolation:isolate/); assert.match(componentRule,/z-index:1/);
assert.equal(layer.style.zIndex,'2'); assert.equal(layer.style.isolation,'isolate','independent context beats huge nested component zIndex');
assert.equal(components.children[0].style.zIndex,'2147483647');
// Deliberately non-monotonic seeks, endpoints, repeated frames, and clear/hide.
const frames=[
  {...base,frame:20,performance:performance(1,{text:'结束',opacity:1},false),dialogues:[],characters:[{...base.characters[0],opacity:0}]},
  {...base,frame:5,performance:performance(0.2,{text:malicious,opacity:0.4})},
  {...base,frame:30,performance:performance()},
  {...base,frame:0,performance:performance(0,null,false)},
  {...base,frame:5,performance:performance(0.2,{text:malicious,opacity:0.4})},
  {...base,frame:30,performance:performance(),dialogues:[]}
];
for(const state of frames){
  renderer.render(state,project);
  assert.equal(stage.children.length,5); assert.equal(stage.children[4],layer,'stable overlay survives component rebuilds');
  assert.equal(mask.style.opacity,String(state.performance.screenOpacity));
  assert.equal(title.style.display,state.performance.title?'grid':'none');
  assert.equal(text.textContent,state.performance.title?.text || '');
  assert.equal(text.style.opacity,String(state.performance.title?.opacity ?? 1));
  assert.equal(title.style.opacity,'1','black backing stays opaque during title fade');
  assert.equal(characters.children[0].style.opacity,String(state.characters[0].opacity ?? 1));
  const visible=state.performance.dialogueVisible && state.dialogues.length>0;
  assert.deepEqual(components.children.map(n=>n.dataset.componentId),visible?['always','active','decor']:['decor']);
  assert.equal(dialogue.hidden,true,'custom UI claims default or performance hides it');
  assert.equal(background.style.backgroundColor,'#123456','overlays do not overwrite the scene');
}
const noComponents={...project,scene:{...project.scene,components:[]}};
renderer.render({...base,performance:performance(0,null,false)},noComponents);
assert.equal(dialogue.hidden,true); assert.equal(dialogue.children[1].textContent,'');
renderer.render({...base,performance:performance()},noComponents);
assert.equal(dialogue.hidden,false); assert.equal(dialogue.children[1].textContent,'原对白');
renderer.render(covered,project);
renderer.render(base,noComponents);
assert.equal(layer.hidden,true); assert.equal(layer.style.display,'none'); assert.equal(mask.style.opacity,'0');
assert.equal(title.hidden,true); assert.equal(text.textContent,''); assert.equal(text.style.opacity,'1');
assert.equal(characters.children[0].style.opacity,'1'); assert.equal(dialogue.hidden,false);
renderer.render({...base,performance:performance()},project);
assert.equal(layer.hidden,false); assert.equal(title.hidden,true);
// Preview and export both instantiate this same production implementation.
for(const file of ['preview.js','export.js']) assert.match(fs.readFileSync(path.join(__dirname,file),'utf8'),/sceneRenderer\s*=\s*window\.sceneRenderer\s*=\s*createSceneRenderer\(/);
(async()=>{
  renderer.render(covered,project); await renderer.ready();
  assert.equal(stage.children[4],layer); assert.equal(text.textContent,malicious); assert.equal(mask.style.opacity,'0.6');
  renderer.render({...covered,performance:performance(0,{text:'styled',opacity:0,style:{fontSize:90,color:'#123456',align:'left'}})},project);
  assert.equal(text.style.fontSize,'90px');assert.equal(text.style.color,'#123456');assert.equal(text.style.textAlign,'left');
  global.titleTestHeight=1000;
  await assert.rejects(renderer.ready(),/标题溢出/);
  renderer.render({...base,performance:performance()},project);await renderer.ready();
  assert.equal(text.style.fontSize,'42px');assert.equal(text.style.textAlign,'center');
  delete global.titleTestHeight;
  console.log('PASS performance-renderer DOM contracts: safe titles, isolated z-order, fades, dialogue UI, random seek, legacy cleanup, shared preview/export readiness (not screenshot parity)');
})().catch(error=>{console.error(error);process.exitCode=1;});
