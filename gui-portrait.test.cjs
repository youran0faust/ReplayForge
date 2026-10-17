'use strict';
const {app,dialog,nativeImage}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'test-output','portrait-'+require('node:crypto').randomUUID());fs.mkdirSync(root,{recursive:true});process.env.REPLAY_RECOVERY_DIR=path.join(root,'recovery');app.disableHardwareAcceleration();
const png=path.join(root,'portrait.png'),pixels=Buffer.alloc(32*48*4);for(let i=0;i<pixels.length;i+=4){pixels[i]=255;pixels[i+3]=255}fs.writeFileSync(png,nativeImage.createFromBitmap(pixels,{width:32,height:48}).toPNG());
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[png]});
app.once('browser-window-created',(_,win)=>win.webContents.once('did-finish-load',async()=>{try{
const result=await win.webContents.executeJavaScript(`(async()=>{
 const $=s=>document.querySelector(s);
 const until=async(p,label)=>{for(let i=0;i<300;i++){if(p())return;await new Promise(r=>setTimeout(r,20))}throw Error('Timed out: '+label)};
 await until(()=>$('#character-select').value,'startup');const originalId=$('#character-select').value;
 await $('#character-add').onclick();const id=$('#character-select').value;
 $('#character-from').value=60;$('#character-to').value=180;await $('#character-apply').onclick();
 const empty=!$('#character-preview img')&&$('#character-preview').textContent.includes('未绑定');const before=await replay.project();
 await $('#character-import').onclick();await until(()=>$('#character-preview img')?.naturalWidth===32,'import');
 const imported=await replay.project(),character=imported.project.scene.characters.find(c=>c.id===id),resource=imported.project.resources.find(r=>r.id===character.resourceId);
 const src=$('#character-preview img').getAttribute('src'),dimensions=[$('#character-preview img').naturalWidth,$('#character-preview img').naturalHeight],metadata=$('#character-preview-info').textContent;
 const inactive=!document.querySelector('[data-character-id="'+id+'"]');
 const select=value=>{$('#character-select').value=value;$('#character-select').onchange()};select(originalId);select(id);select(originalId);select(id);
 await until(()=>$('#character-preview img')?.getAttribute('src')===imported.resourceUrls[resource.id],'inactive select');await $('#apply').onclick();const selected=await replay.project();
 const state=await replay.evaluate(0),missing=structuredClone(imported);delete missing.resourceUrls[resource.id];await previewTest.render(state,missing);
 const noUrl=!$('#character-preview img')&&$('#character-preview').textContent.includes('URL');
 const absent=structuredClone(imported);absent.project.resources=absent.project.resources.filter(r=>r.id!==resource.id);await previewTest.render(state,absent);
 const noResource=!$('#character-preview img')&&$('#character-preview').textContent.includes('不存在');
 const broken=structuredClone(imported);broken.resourceUrls[resource.id]='data:image/png;base64,AAAA';await previewTest.render(state,broken);
 await until(()=>$('#character-preview').textContent.includes('加载失败'),'decode error');const error=!$('#character-preview img')&&$('#character-preview-info').textContent.includes('加载失败');
 await previewTest.render(state,imported);await until(()=>$('#character-preview img')?.naturalHeight===48,'restore');const previewed=await replay.project();
 await $('#character-unbind').onclick();const unbound=await replay.project();
 const cleared=!$('#character-preview img')&&$('#character-preview').textContent.includes('未绑定')&&!$('#character-preview-info').textContent.includes(resource.id);
 await $('#character-import').onclick();await until(()=>$('#character-preview img')?.naturalWidth===32,'reimport');const reimported=await replay.project(),newId=reimported.project.scene.characters.find(c=>c.id===id).resourceId;
 return{empty,inactive,noUrl,noResource,error,cleared,src,expectedSrc:imported.resourceUrls[resource.id],dimensions,metadata,resource,
 selectionUnchanged:JSON.stringify(selected.project)===JSON.stringify(imported.project)&&selected.revision===imported.revision,
 previewUnchanged:JSON.stringify(previewed.project)===JSON.stringify(imported.project)&&previewed.revision===imported.revision,
 revisions:[before.revision,imported.revision,unbound.revision,reimported.revision],updated:$('#character-preview img').getAttribute('src')===reimported.resourceUrls[newId]};
})()`);
for(const key of ['empty','inactive','noUrl','noResource','error','cleared','selectionUnchanged','previewUnchanged','updated'])assert.equal(result[key],true,key);
assert.equal(result.src,result.expectedSrc);assert.deepEqual(result.dimensions,[32,48]);assert.equal(result.resource.width,32);assert.equal(result.resource.height,48);assert.ok(result.metadata.includes('32 × 48'));assert.ok(result.metadata.includes(result.resource.id));for(let i=1;i<4;i++)assert.equal(result.revisions[i],result.revisions[i-1]+1);
const report={status:'PASS',chooser:'native chooser return stub; real PNG import and decode',checks:['selected resource URL','intrinsic dimensions and metadata','inactive rapid reselection','missing resource/URL','decode error','read-only selection/preview','unbind clears','reimport updates'],result};fs.writeFileSync(path.join(__dirname,'test-output/gui-portrait.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.exit(0);
}catch(error){console.error(error);app.exit(1)}}));
setTimeout(()=>{console.error('Portrait GUI test timed out');app.exit(1)},60000).unref();require('./main.cjs');const profile=path.join(root,'profile');fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);app.setPath('sessionData',profile);
