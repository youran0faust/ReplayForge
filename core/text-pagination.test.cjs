'use strict';
const assert=require('node:assert/strict'),test=require('node:test'),{paginateText}=require('./text-pagination.cjs');
test('exact grapheme slices',()=>{const text='A👩‍🚀BC',p=paginateText({text,maxLines:1,measureSlice:(s,e)=>({fits:Array.from(text.slice(s,e)).length<=3,lineCount:1})});assert.equal(p.map(x=>x.text).join(''),text);});
test('diagnostics',()=>{assert.throws(()=>paginateText({text:'x',measureSlice:()=>({fits:false,lineCount:1})}),/不可断/);assert.throws(()=>paginateText({text:'x',measureSlice:()=>null}),/必须返回/);});
