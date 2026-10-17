'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const {getWindowOptions,loadWindowState,trackWindowState,validateWindowState}=require('./window-state.cjs');
const display=(x,y,width,height)=>({workArea:{x,y,width,height}}),primary=display(0,0,1920,1040);
const saved=(x,y,width,height,maximized=false)=>({version:1,normalBounds:{x,y,width,height},maximized});
function tmp(t){const p=fs.mkdtempSync(path.join(os.tmpdir(),'replay-window-'));t.after(()=>fs.rmSync(p,{recursive:true,force:true}));return path.join(p,'editor-window-state.json');}
test('default uses approved aspect, centers and fits smaller work areas',()=>{
 assert.deepEqual(getWindowOptions({primaryDisplay:primary}),{x:220,y:32,width:1480,height:976,maximized:false});
 const tall=getWindowOptions({primaryDisplay:display(-1000,-200,2000,2000)});assert.equal(tall.height,1206);assert.equal(tall.width,1830);assert.equal(tall.x,-915);assert.equal(tall.y,197);
 const small=getWindowOptions({primaryDisplay:display(0,40,1024,700)});assert.equal(small.width,960);assert.equal(small.height,632);assert.ok(small.y>=72);
  assert.deepEqual(getWindowOptions({primaryDisplay:display(0,0,2560,1400)}),{x:365,y:97,width:1830,height:1206,maximized:false});
  for(const r of [small,tall,getWindowOptions({primaryDisplay:primary})])assert.ok(Math.abs(r.width/r.height-1830/1206)<.005);
});
test('restore preserves user dimensions and negative monitor coordinates',()=>{
 const left=display(-1600,0,1600,1000),state=saved(-1400,50,1200,850,true),before=structuredClone(state);
 assert.deepEqual(getWindowOptions({displays:[primary,left],primaryDisplay:primary,saved:state}),{...state.normalBounds,maximized:true});assert.deepEqual(state,before);
});
test('largest intersection wins and removed monitor clamps full window to nearest display',()=>{
 const left=display(-1600,0,1600,1000);
 const crossing=getWindowOptions({displays:[primary,left],primaryDisplay:primary,saved:saved(-1200,20,1400,850)});assert.equal(crossing.x,-1400);
 const removed=getWindowOptions({displays:[primary],primaryDisplay:primary,saved:saved(-1900,-900,2200,1600)});assert.deepEqual(removed,{x:0,y:0,width:1920,height:1040,maximized:false});
 const right=display(1920,100,1280,1000),near=getWindowOptions({displays:[primary,right],primaryDisplay:primary,saved:saved(5000,200,1000,700)});assert.equal(near.x,2200);assert.equal(near.y,200);
});
test('invalid state and missing displays fall back safely',()=>{
 for(const bad of [null,{},saved(0,0,0,800),saved(0,0,NaN,800),{...saved(0,0,100,100),fullscreen:true},{...saved(0,0,100,100),maximized:'true'}]){assert.equal(validateWindowState(bad),null);assert.deepEqual(getWindowOptions({primaryDisplay:primary,saved:bad}),getWindowOptions({primaryDisplay:primary}));}
 assert.ok(getWindowOptions().height>0);
});
test('loading invalid JSON, oversized data, directories and absent paths is nonthrowing',t=>{
 const file=tmp(t);assert.equal(loadWindowState(file),null);fs.writeFileSync(file,'{');assert.equal(loadWindowState(file),null);fs.writeFileSync(file,' '.repeat(65537));assert.equal(loadWindowState(file),null);assert.equal(loadWindowState(path.dirname(file)),null);
 fs.writeFileSync(file,JSON.stringify(saved(30,40,1000,800,true)));assert.deepEqual(loadWindowState(file),saved(30,40,1000,800,true));
});
class Window extends EventEmitter { constructor(){super();this.bounds={x:30,y:40,width:1200,height:850};this.max=false;this.min=false;this.full=false;this.destroyed=false;}getNormalBounds(){return {...this.bounds};}isMaximized(){return this.max;}isMinimized(){return this.min;}isFullScreen(){return this.full;}isDestroyed(){return this.destroyed;} }
test('adapter saves move resize and max state using normal bounds, never minimized/fullscreen',t=>{
 const file=tmp(t),win=new Window(),tracker=trackWindowState(win,file);win.emit('resize');assert.deepEqual(loadWindowState(file),saved(30,40,1200,850));
 win.bounds.height=940;win.emit('move');win.max=true;win.emit('maximize');assert.deepEqual(loadWindowState(file),saved(30,40,1200,940,true));
 win.min=true;win.bounds={x:-32000,y:-32000,width:1,height:1};win.emit('resize');assert.deepEqual(loadWindowState(file),saved(30,40,1200,940,true));
 win.min=false;win.full=true;win.emit('resize');assert.equal(loadWindowState(file).normalBounds.height,940);
 win.full=false;win.max=false;win.bounds={x:60,y:70,width:1300,height:900};win.emit('unmaximize');assert.deepEqual(loadWindowState(file),saved(60,70,1300,900));
 win.emit('close');win.destroyed=true;win.emit('closed');assert.equal(win.listenerCount('resize'),0);assert.equal(tracker.save(),false);assert.deepEqual(loadWindowState(file),saved(60,70,1300,900));
});
test('adapter IO failure or missing window methods never throws; dispose removes listeners',t=>{
 const file=tmp(t);fs.mkdirSync(file);const win=new Window(),tracker=trackWindowState(win,file);assert.equal(tracker.save(),false);assert.doesNotThrow(()=>win.emit('closed'));const incomplete=new EventEmitter(),a=trackWindowState(incomplete,file);assert.equal(a.save(),false);a.dispose();assert.equal(incomplete.listenerCount('move'),0);
});
