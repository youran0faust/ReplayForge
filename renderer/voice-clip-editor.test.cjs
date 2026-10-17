const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(){
  const nodes=new Map();class Element{constructor(tag){this.tag=tag;this.children=[];this.events={};this.value='';}set id(v){this._id=v;nodes.set(v,this);}get id(){return this._id;}setAttribute(){}append(...els){this.children.push(...els);}replaceChildren(...els){this.children=els;}addEventListener(k,fn){this.events[k]=fn;}scrollIntoView(){}}
  const document={createElement:tag=>new Element(tag)},container=new Element('div');container.ownerDocument=document;
  const sandbox={document,crypto:{randomUUID:()=> 'cmd'},confirm:()=>true};vm.runInNewContext(fs.readFileSync(require.resolve('./voice-clip-editor.js'),'utf8'),sandbox);
  let packet={documentId:'doc',revision:1,project:{scene:{dialogues:[{id:'d',startFrame:30,voiceClips:[{id:'c',sampleRate:48000,sourceOffsetSamples:0,durationSamples:48000,binding:{dialogueId:'d',mode:'follow'}}]}]}}},prepares=0,dirtyCalls=0,calls=[];
  const options={container,packet:()=>packet,prepare:async()=>{prepares++;return true;},refresh:async()=>{},dirtyChanged:()=>{dirtyCalls++;},replay:{editVoiceClip:async p=>{calls.push(p);return {ok:true};},deleteVoiceClip:async p=>{calls.push(p);return {ok:true};}}};
  const editor=sandbox.createVoiceClipEditor(options);editor.render(packet);
  return {editor,options,nodes,container,calls,get packet(){return packet;},set packet(p){packet=p;},get prepares(){return prepares;},get dirtyCalls(){return dirtyCalls;},input(id,value){const el=nodes.get('voice-clip-'+id);el.value=String(value);(el.events.input||el.events.change)();},click(id){return nodes.get('voice-clip-'+id).onclick();}};
}
test('delete exempts only own busy and refuses an unapplied own draft',async()=>{const f=fixture();f.options.prepare=async o=>{assert(f.editor.busy);if(!o.preserveVoiceClips&&f.editor.busy)throw Error('self busy');return true;};f.input('offset',1600);await f.click('delete');assert.equal(f.calls.length,0);assert(f.editor.dirty);assert.match(f.nodes.get('voice-clip-status').textContent,/先应用或放弃/);f.editor.clear();await f.click('delete');assert.equal(f.calls.length,1);assert.equal(f.calls[0].clipId,'c');assert.equal(f.editor.busy,false);});
test('delete serial changes during prepare block IPC',async()=>{const f=fixture();f.options.prepare=async()=>{const p=f.packet;f.packet={...p,documentId:'switched'};f.editor.render(f.packet);f.packet=p;f.editor.render(p);return true;};await f.click('delete');assert.equal(f.calls.length,0);assert.match(f.nodes.get('voice-clip-status').textContent,/等待期间/);});
test('voice editor mounts only supplied container, publishes aggregate callback and explicitly applies sample-native patch',async()=>{
  const f=fixture();assert.equal(f.container.children[0],f.editor.element);f.input('offset',1600);f.input('duration',3200);f.input('start',45);assert.equal(f.editor.dirty,true);assert.equal(f.calls.length,0);await f.click('apply');assert.equal(f.prepares,1);assert.equal(f.calls.length,1);assert.equal(f.calls[0].patch.sourceOffsetSamples,1600);assert.equal(f.calls[0].patch.binding.followOffsetFrames,15);assert.equal(f.calls[0].clipId,'c');assert.equal(f.editor.dirty,false);assert(f.dirtyCalls>=4);
});
test('same-document stale revision retains draft and blocks replay',async()=>{
  const f=fixture();f.input('offset',12);f.packet={...f.packet,revision:2};f.editor.render(f.packet);await f.click('apply');assert.equal(f.calls.length,0);assert.equal(f.editor.dirty,true);assert.equal(f.prepares,0);assert.equal(f.nodes.get('voice-clip-apply').disabled,true);
});
test('confirmed document switch clears old draft and selection before publishing new document status',async()=>{
  const f=fixture(),d=f.packet.project.scene.dialogues[0];d.voiceClips.push({...d.voiceClips[0],id:'second'});f.editor.render(f.packet);f.editor.select('d','second');f.input('offset',12);const serial=f.editor.serial,publications=[];
  f.options.dirtyChanged=()=>publications.push({documentId:f.options.packet().documentId,dirty:f.editor.dirty,serial:f.editor.serial});
  f.packet={...f.packet,documentId:'another'};f.editor.render(f.packet);await f.editor.publishing;
  assert.equal(f.editor.dirty,false);assert.equal(f.editor.serial,serial+1);assert.equal(f.nodes.get('voice-clip-select').value,JSON.stringify(['d','c']));assert.equal(Number(f.nodes.get('voice-clip-offset').value),0);assert.deepEqual(publications,[{documentId:'another',dirty:false,serial:serial+1}]);assert.equal(f.calls.length,0);
});
test('single gate busy prevents duplicate submits and rejects a document switched during await',async()=>{
  const f=fixture();let release;f.options.prepare=()=>new Promise(resolve=>{release=resolve;});f.input('start',42);const pending=f.click('apply');await Promise.resolve();assert.equal(f.editor.busy,true);await f.click('apply');assert.equal(f.calls.length,0);f.packet={...f.packet,documentId:'new'};release(true);await pending;assert.equal(f.calls.length,0);assert.equal(f.editor.busy,false);assert.equal(f.editor.dirty,true);
});
test('legacy voice selection stays original until parent split, and independent uses effective start',async()=>{
 const f=fixture();f.input('binding','independent');f.input('start',60);await f.click('apply');assert.equal(f.calls[0].patch.binding.mode,'independent');assert.equal(f.calls[0].patch.startFrame,60);assert.equal('followOffsetFrames' in f.calls[0].patch.binding,false);
 const d=f.packet.project.scene.dialogues[0];d.voice=d.voiceClips[0];delete d.voiceClips;f.editor.render(f.packet);assert.equal(f.editor.select('d',null),true);assert.equal(f.nodes.get('voice-clip-apply').disabled,true);await f.click('delete');assert.equal(f.calls.length,1);
});
