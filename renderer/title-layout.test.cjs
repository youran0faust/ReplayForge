'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {applyTitleTextStyle,measureTitle,createTitleLayoutProbe}=require('./title-layout.js');
// Synthetic geometry tests contract only; actual text shaping requires browser evidence.
function dom() {
  const state={width:900,height:63};
  const document={fonts:{ready:Promise.resolve()},createElement(){return {ownerDocument:document,style:{},children:[],appendChild(n){this.children.push(n);n.parentElement=this;},remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this);},getBoundingClientRect(){return {width:state.width,height:state.height};},get scrollWidth(){return Math.round(state.width);},get scrollHeight(){return Math.round(state.height);}};}};
  document.body=document.createElement('body');return {document,state};
}
test('probe shares style, awaits font readiness, detects both axes and cleans temporary DOM',async()=>{
  const {document,state}=dom(),probe=createTitleLayoutProbe(document);
  let resolve;document.fonts.ready=new Promise(r=>resolve=r);
  const pending=probe.measure({text:'<b>literal</b>\n标题',style:{fontSize:80,align:'left'}},{width:1000,height:500});
  const host=document.body.children[0],text=host.children[0];
  assert.equal(text.textContent,'<b>literal</b>\n标题');assert.equal(text.style.fontSize,'80px');assert.equal(text.style.lineHeight,'1.5');assert.equal(text.style.maxHeight,'none');assert.equal(host.style.visibility,'hidden');
  state.height=451;resolve();const result=await pending;
  assert.equal(result.fits,false);assert.equal(result.overflowY,true);assert.equal(result.availableHeight,450);assert.equal(document.body.children.length,0);
  state.height=63;state.width=901;assert.equal((await probe.measure({text:'x'},{width:1000,height:500})).overflowX,true);
  state.width=900;assert.equal((await probe.measure({text:'x'},{width:1000,height:500})).fits,true);
  probe.dispose();await assert.rejects(probe.measure({text:'x'},{width:1000,height:500}),/disposed/);
});
test('current title measurement ignores hidden ancestors and zero letter opacity',()=>{
  const {document,state}=dom(),stage=document.createElement('div'),card=document.createElement('div'),text=document.createElement('div');
  Object.assign(stage.style,{width:'1000px',height:'500px',display:'none'});stage.appendChild(card);card.appendChild(text);
  applyTitleTextStyle(text,{fontSize:120,color:'#123456',align:'right'});text.style.opacity='0';text.textContent='标题';card.hidden=true;
  state.height=600;assert.equal(measureTitle(card,text).overflowY,true);assert.equal(text.style.opacity,'0');assert.equal(text.style.fontSize,'120px');assert.equal(document.body.children.length,0);
});
test('browser UMD exports and font rejection cleanup',async()=>{
  const fs=require('node:fs'),vm=require('node:vm'),context={};
  vm.runInNewContext(fs.readFileSync(__dirname+'/../core/title-style.cjs','utf8'),context);
  vm.runInNewContext(fs.readFileSync(__dirname+'/title-layout.js','utf8'),context);assert.equal(typeof context.TitleLayout.measureTitle,'function');
  const {document}=dom();document.fonts.ready=Promise.reject(Error('font failed'));
  await assert.rejects(createTitleLayoutProbe(document).measure({text:'x'},{width:1000,height:500}),/font failed/);assert.equal(document.body.children.length,0);
});
