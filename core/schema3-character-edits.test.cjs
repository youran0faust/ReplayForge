'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {ProjectSession}=require('./session.cjs'),{upgradeCharacters}=require('./schema-migration.cjs'),{createExpressionCommands}=require('./expression-command.cjs'),{importImage,unbindImage,importExpressionImage,requireImageTarget,parseImage}=require('./image-import.cjs'),{applyProjectCode}=require('./code-edit.cjs');
function legacy(){return {schemaVersion:1,id:'character-edit-test',title:'test',design:{width:960,height:540,fps:30},locale:'zh-CN',resources:[{id:'base',kind:'image',path:'base.png',mime:'image/png'}],scene:{id:'scene',durationFrames:90,background:{kind:'color',color:'#000000'},characters:[{id:'a',name:'Alice',color:'#ffffff',resourceId:'base',x:0,y:0,width:100,height:200,visibleFrom:0,visibleTo:90,expressions:[{id:'smile',name:'Smile',resourceId:'base'}]}],dialogues:[{id:'d',speakerId:'a',text:{'zh-CN':'你好'},startFrame:0,endFrame:90,revealFrames:30}]}};}
function session(){return new ProjectSession(upgradeCharacters(legacy()));}
function unchanged(s,fn,regex){const before=JSON.stringify(s);assert.throws(fn,regex);assert.equal(JSON.stringify(s),before);}
function roundtrip(s,fn){const before=s.snapshot(),rev=s.revision,result=fn(),after=s.snapshot();assert.equal(s.revision,rev+1);assert(s.undo());assert.deepEqual(s.snapshot(),before);assert(s.redo());assert.deepEqual(s.snapshot(),after);return result;}
test('schema3 refuses legacy appearance mutations before transaction; geometry/delete remain instance-only',()=>{
 const s=session(),message=/在角色模板页编辑，影响全部引用实例/;
 for(const fn of [()=>s.editCharacter('a',{name:'Other'}),()=>s.editCharacter('a',{name:'Alice'}),()=>s.editCharacter('a',{color:'#ffffff'}),()=>s.addExpression('a',{name:'New',resourceId:'base'}),()=>s.editExpression('a','smile',{name:'New',resourceId:'base'}),()=>s.deleteExpression('a','smile'),()=>s.setPortraitCanvas('a',{width:100,height:200})])unchanged(s,fn,message);
 unchanged(s,()=>s.addCharacter(),/从角色库创建/);const definitions=structuredClone(s.project.characterDefinitions);
 roundtrip(s,()=>s.editCharacter('a',{x:20,y:10,width:120,height:220,visibleFrom:1,visibleTo:80}));assert.deepEqual(s.project.characterDefinitions,definitions);assert(!Object.hasOwn(s.project.scene.characters[0],'name'));
 roundtrip(s,()=>s.deleteCharacter('a'));assert.equal(s.project.scene.characters.length,0);assert.equal(s.project.scene.dialogues[0].speakerId,'narrator');assert.deepEqual(s.project.characterDefinitions,definitions);
});
test('events resolve template expressions and mutate only selected instance with stable undo identities',()=>{
 const s=session();s.apply(p=>p.scene.characters.push({...p.scene.characters[0],id:'b'}));const defs=structuredClone(s.project.characterDefinitions);
 const {id}=roundtrip(s,()=>s.addExpressionEvent('b',{frame:20,expressionId:'smile'}));assert.equal(s.project.scene.characters[0].expressionEvents,undefined);roundtrip(s,()=>s.editExpressionEvent('b',id,{frame:21,expressionId:null}));roundtrip(s,()=>s.deleteExpressionEvent('b',id));assert.deepEqual(s.project.characterDefinitions,defs);unchanged(s,()=>s.addExpressionEvent('b',{frame:3,expressionId:'missing'}),/表情不存在/);
});
test('schema3 checked drop uses exact definition source and permits its multiple instances only',()=>{
 const s=session();s.apply(p=>{p.scene.characters.push({...p.scene.characters[0],id:'b'});p.characterDefinitions.push({...p.characterDefinitions[0],id:'other'});p.scene.characters.push({...p.scene.characters[0],id:'c',definitionId:'other'});});
 const win={isDestroyed:()=>false,webContents:{mainFrame:{}}},event={sender:win.webContents,senderFrame:win.webContents.mainFrame},api=createExpressionCommands({getContext:()=>({session:s,documentId:1,win})});
 const payload=(id,source={definitionId:'def_a',expressionId:'smile'})=>({commandId:crypto.randomUUID(),documentId:1,expectedRevision:s.revision,source,target:{characterId:id},atFrame:25});
 for(const id of ['a','b']){const p=payload(id),r=api.dropExpression(event,p);assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.created.characterId,id);assert.deepEqual(api.dropExpression(event,p),r);}
 let before=JSON.stringify(s);assert.equal(api.dropExpression(event,payload('c')).error.code,'CROSS_CHARACTER');assert.equal(JSON.stringify(s),before);assert.equal(api.dropExpression(event,payload('a',{characterId:'a',expressionId:'smile'})).error.code,'INVALID_PAYLOAD');assert.equal(JSON.stringify(s),before);
});
test('schema3 character image target rejected before file access/copy; resource-only import stays available',()=>{
 const s=session(),root=path.resolve(__dirname,'../test-output/schema3-image-'+crypto.randomUUID());fs.mkdirSync(root,{recursive:true});
 try{unchanged(s,()=>importImage(s,{kind:'character',id:'a'},path.join(root,'absent.png'),root),/在角色模板页编辑/);unchanged(s,()=>unbindImage(s,{kind:'character',id:'a'}),/在角色模板页编辑/);assert.deepEqual(fs.readdirSync(root),[]);assert.throws(()=>requireImageTarget(s.project,{kind:'character',id:'a'}),/角色模板页/);
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5WQAAAAASUVORK5CYII=','base64'),source=path.join(root,'author.png');fs.writeFileSync(source,bytes);const defs=structuredClone(s.project.characterDefinitions);const result=roundtrip(s,()=>importExpressionImage(s,source,root,{decodeImage:b=>parseImage(b)}));assert(s.project.resources.some(r=>r.id===result.resourceId));assert.deepEqual(s.project.characterDefinitions,defs);assert.deepEqual(fs.readFileSync(source),bytes);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('schema3 code editing validates definition image bindings and preserves registry/version protections',()=>{
 const s=session(),apply=p=>applyProjectCode(s,{text:JSON.stringify(p),expectedRevision:s.revision});let p=s.snapshot();p.characterDefinitions[0].name='Renamed';roundtrip(s,()=>apply(p));
 p=s.snapshot();p.schemaVersion=2;unchanged(s,()=>apply(p),/Schema version/);p=s.snapshot();p.resources.push({id:'x',kind:'image',path:'x.png'});unchanged(s,()=>apply(p),/Resource registry/);p=s.snapshot();p.characterDefinitions[0].resourceId='missing';unchanged(s,()=>apply(p));p=s.snapshot();p.scene.characters[0].name='embedded';unchanged(s,()=>apply(p));
});
test('legacy schema1/2 retains embedded definition edits and same-character source contract',()=>{
 for(const schemaVersion of [1,2]){const p=legacy();p.schemaVersion=schemaVersion;if(schemaVersion===2)p.scene.dialogues[0].voiceClips=[];const s=new ProjectSession(p);roundtrip(s,()=>s.editCharacter('a',{name:'Old compatible'}));roundtrip(s,()=>s.editExpression('a','smile',{name:'Still embedded',resourceId:'base'}));const win={isDestroyed:()=>false,webContents:{mainFrame:{}}},event={sender:win.webContents,senderFrame:win.webContents.mainFrame},api=createExpressionCommands({getContext:()=>({session:s,documentId:1,win})});const r=api.dropExpression(event,{commandId:crypto.randomUUID(),documentId:1,expectedRevision:s.revision,source:{characterId:'a',expressionId:'smile'},target:{characterId:'a'},atFrame:40});assert.equal(r.ok,true,JSON.stringify(r));}
});
