'use strict';
const READING_DEFAULTS=Object.freeze({unvoicedTimingMode:'fixed',unvoicedMinimumSeconds:3,unvoicedReadingSpeed:8,dialogueRevealCharactersPerSecond:30,autoPageHoldSeconds:.8,fixedPageHoldSeconds:.6});
const rules=[['unvoicedMinimumSeconds',.1,3600,'INVALID_UNVOICED_MINIMUM_SECONDS'],['unvoicedReadingSpeed',1,100,'INVALID_UNVOICED_READING_SPEED'],['dialogueRevealCharactersPerSecond',1,200,'INVALID_REVEAL_CHARACTERS_PER_SECOND'],['dialoguePageHoldSeconds',0,60,'INVALID_PAGE_HOLD_SECONDS']];
function validateReadingConfig(config={}){
 const diagnostics=[];
 if(!config||typeof config!=='object'||Array.isArray(config))return[{severity:'error',code:'INVALID_READING_CONFIG',message:'阅读配置须为对象'}];
 if(config.unvoicedTimingMode!==undefined&&!['auto','fixed'].includes(config.unvoicedTimingMode))diagnostics.push({severity:'error',code:'INVALID_UNVOICED_TIMING_MODE',message:'unvoicedTimingMode须为auto或fixed'});
 for(const [key,min,max,code]of rules){const v=config[key];if(v!==undefined&&(!Number.isFinite(v)||v<min||v>max))diagnostics.push({severity:'error',code,message:`${key}须为${min}到${max}的有限数值`});}
 return diagnostics;
}
function resolveReadingConfig(config={}){
 const errors=validateReadingConfig(config);if(errors.length)throw Object.assign(Error(errors[0].message),{code:errors[0].code});
 const unvoicedTimingMode=config.unvoicedTimingMode??READING_DEFAULTS.unvoicedTimingMode;
 return {unvoicedTimingMode,unvoicedMinimumSeconds:config.unvoicedMinimumSeconds??3,unvoicedReadingSpeed:config.unvoicedReadingSpeed??8,dialogueRevealCharactersPerSecond:config.dialogueRevealCharactersPerSecond??30,dialoguePageHoldSeconds:config.dialoguePageHoldSeconds??(unvoicedTimingMode==='auto'?.8:.6)};
}
function measureReadingText(text){
 if(typeof text!=='string')throw TypeError('Reading text must be a string');
 const graphemes=new Intl.Segmenter('und',{granularity:'grapheme'}),words=new Intl.Segmenter('en',{granularity:'word'});
 let units=0,nonWhitespaceGraphemes=0;
 for(const word of words.segment(text)){
  let latinRun=false;
  for(const {segment:g}of graphemes.segment(word.segment)){
   if(/^\s+$/u.test(g)){latinRun=false;continue;}nonWhitespaceGraphemes++;
   if(/^[\p{Script=Latin}\p{N}\p{M}]+$/u.test(g)&&/[\p{Script=Latin}\p{N}]/u.test(g)){if(!latinRun)units+=2;latinRun=true;}
   else{units+=/^\p{P}+$/u.test(g)?.25:1;}
  }
 }
 return {units,nonWhitespaceGraphemes};
}
// Ignore only machine roundoff at an exact frame boundary (e.g. 8.3*30).
const ceilFrame=value=>Math.ceil(value-Number.EPSILON*Math.max(1,Math.abs(value))*4);
function calculateRevealBudget(text,durationFrames,{speed,holdSeconds}={},fps=30){
 if(!Number.isSafeInteger(durationFrames)||durationFrames<1)throw RangeError('durationFrames must be a positive safe integer');
 if(!Number.isFinite(fps)||fps<=0)throw RangeError('fps must be positive');
 if(!Number.isFinite(speed)||speed<1||speed>200)throw RangeError('speed must be from1 to200');
 if(!Number.isFinite(holdSeconds)||holdSeconds<0||holdSeconds>60)throw RangeError('holdSeconds must be from0 to60');
 const {nonWhitespaceGraphemes}=measureReadingText(text);
 const holdFrames=Math.min(ceilFrame(holdSeconds*fps),Math.floor(durationFrames*.4),durationFrames-1);
 const revealFrames=Math.min(Math.max(1,ceilFrame(nonWhitespaceGraphemes/speed*fps)),durationFrames-holdFrames);
 return {revealFrames,holdFrames,nonWhitespaceGraphemes};
}
function calculateReadingBudget(text,config={},fps=30){
 const c=resolveReadingConfig(config);if(!Number.isFinite(fps)||fps<=0)throw RangeError('fps must be positive');
 const measurement=measureReadingText(text),frames=Math.max(1,ceilFrame(Math.max(c.unvoicedMinimumSeconds,measurement.units/c.unvoicedReadingSpeed+c.dialoguePageHoldSeconds)*fps));
 if(!Number.isSafeInteger(frames))throw RangeError('Reading duration exceeds safe integer range');
 const {holdFrames,revealFrames}=calculateRevealBudget(text,frames,{speed:c.dialogueRevealCharactersPerSecond,holdSeconds:c.dialoguePageHoldSeconds},fps);
 return {...measurement,frames,revealFrames,holdFrames};
}
module.exports={READING_DEFAULTS,validateReadingConfig,resolveReadingConfig,measureReadingText,calculateReadingBudget,calculateRevealBudget};
