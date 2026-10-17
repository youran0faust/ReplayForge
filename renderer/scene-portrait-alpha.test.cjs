'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture({compositor=true,broken=false}={}){
 const node=()=>({style:{},dataset:{},children:[],classList:{add(){}},appendChild(c){this.children.push(c);},replaceChildren(...c){this.children=c;},getBoundingClientRect(){return {width:100,height:200};}});
 const stage=node(),context=vm.createContext({document:{createElement(tag){const n=node();if(tag==='canvas'){n.getContext=()=>({drawImage(){}});n.toDataURL=()=> 'data:image/png;raster';}return n;},fonts:{ready:Promise.resolve()}},Image:class{constructor(){this.naturalWidth=2;this.naturalHeight=2;}decode(){return broken?Promise.reject(Error('invalid PNG')):Promise.resolve();}},requestAnimationFrame:cb=>setImmediate(cb),createTextRevealer:()=>({prepare(){},reveal(){}}),createComponentRenderer:()=>({render(){return {};}}),TitleLayout:{}});
 if(compositor)vm.runInContext(fs.readFileSync(__dirname+'/portrait-compositor.js','utf8'),context);
 vm.runInContext(fs.readFileSync(__dirname+'/scene-renderer.js','utf8'),context);
 const renderer=context.createSceneRenderer(stage),project={design:{width:960,height:540},locale:'zh-CN',scene:{}};
 const render=(character,urls={})=>{renderer.render({background:{color:'#123456'},characters:[{id:'hero',color:'#ffffff',width:100,height:200,x:0,y:0,...character}]},project,urls);return stage.children.find(n=>n.className==='characters').children[0];};
 return{renderer,render};
}
for(const compositor of [false,true])test('resource portrait keeps transparent matte with '+(compositor?'composition API present':'legacy standalone path'),async()=>{
 const f=fixture({compositor});const n=f.render({resourceId:'png'},{png:'file:///transparent.png'});assert.equal(n.style.backgroundColor,'transparent');assert.match(n.style.backgroundImage,/transparent.png/);await f.renderer.ready();
});
test('composed base and overlay-only images both leave scene visible through alpha',async()=>{
 for(const base of [true,false]){const f=fixture(),n=f.render({resourceId:base?'base':null,portraitCanvas:{width:100,height:200},portraitLayers:base?[]:[{id:'face',resourceId:'overlay',x:0,y:0,width:100,height:200}]},{base:'file:///base.png',overlay:'file:///overlay.png'});assert.equal(n.style.backgroundColor,'transparent');assert.equal(n.style.backgroundImage,'none');assert.equal(n.children[0].className,'portrait-composition');await f.renderer.ready();}
});
test('no-image placeholders retain configured color including missing URL and empty composition',()=>{
 for(const character of [{},{resourceId:'missing'},{portraitCanvas:{width:100,height:200},portraitLayers:[]}]){const f=fixture();assert.equal(f.render(character).style.backgroundColor,'#ffffff');}
 const f=fixture();assert.equal(f.render({color:null}).style.backgroundColor,'transparent');
});
test('image to placeholder rerender restores color without carrying an old portrait',()=>{
 const f=fixture();assert.equal(f.render({resourceId:'png'},{png:'file:///transparent.png'}).style.backgroundColor,'transparent');const n=f.render({});assert.equal(n.style.backgroundColor,'#ffffff');assert.equal(n.style.backgroundImage,'none');assert.equal(n.children.length,0);
});
test('decode failure remains observable, never replaced by silent solid matte success',async()=>{
 const f=fixture({broken:true});assert.equal(f.render({resourceId:'bad'},{bad:'file:///bad.png'}).style.backgroundColor,'transparent');await assert.rejects(f.renderer.ready(),/Scene image failed to decode.*invalid PNG/);
});
