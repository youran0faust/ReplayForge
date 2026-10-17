'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {validateTitleStyle, resolveTitleStyle} = require('./title-style.cjs');
test('title defaults, partial fields, numeric boundaries and literal colors', () => {
  assert.deepEqual(resolveTitleStyle(), {fontSize:42,color:'#ffffff',align:'center'});
  for (const fontSize of [12,42.5,120]) assert.deepEqual(validateTitleStyle({fontSize}), []);
  for (const align of ['left','center','right']) assert.equal(resolveTitleStyle({align}).align, align);
  assert.deepEqual(resolveTitleStyle({color:'#aAbB09'}), {fontSize:42,color:'#aAbB09',align:'center'});
});
test('strict JSON whitelist rejects CSS, prototypes, symbols, accessors and invalid values', () => {
  const getter = Object.defineProperty({}, 'fontSize', {enumerable:true,get(){throw Error('must not execute');}});
  for (const value of [null,[],new Date(),Object.create({fontSize:42}),getter,{[Symbol('x')]:1},{fontFamily:'x'},{html:'x'},{color:'red'},{color:'#fff'},{color:'#ffffff00'},{color:'url(x)'},{align:'justify'},{fontSize:undefined},{fontSize:'42'},{fontSize:NaN},{fontSize:Infinity},{fontSize:11.99},{fontSize:121}]) {
    assert.ok(validateTitleStyle(value).length); assert.throws(() => resolveTitleStyle(value));
  }
  assert.deepEqual(validateTitleStyle(Object.create(null)), []);
});
test('browser UMD exposes identical API', () => {
  const vm=require('node:vm'), fs=require('node:fs'), context={};
  vm.runInNewContext(fs.readFileSync(__dirname+'/title-style.cjs','utf8'),context);
  assert.equal(context.TitleStyle.resolveTitleStyle().fontSize,42);
});
