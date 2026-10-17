'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {rehydrateManagedCatalog,readManagedMapping}=require('./script-managed-catalog.cjs');
test('managed catalog rejects missing or invalid source before trusting aliases',()=>{
 assert.throws(()=>rehydrateManagedCatalog({catalog:{assets:[{id:'x',relativePath:'视频/__replay_normalized_x.mp4',category:'video',kind:'video'}]},source:{version:3,mediaMappings:[]},assetsRoot:'.'}),e=>['MANAGED_MEDIA_INVALID','AUDIO_PROVENANCE_INVALID'].includes(e.code));
});
test('physical managed mapping reader rejects unknown mapping and traversal',()=>{
 assert.throws(()=>readManagedMapping({mapping:{resourceId:'asset_000000000000000000000000',category:'video',relativePath:'视频/a.mp4',hash:'0'.repeat(64),videoNormalization:{version:1}},source:{version:3,mediaMappings:[]},assetsRoot:'.'}),e=>['MANAGED_MEDIA_INVALID','AUDIO_PROVENANCE_INVALID'].includes(e.code));
});
