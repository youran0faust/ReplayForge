'use strict';
const {randomUUID}=require('node:crypto');
const {parseScript}=require('./script-parser.cjs');
const key=n=>JSON.stringify(n.type==='dialogue'?['dialogue',n.speaker,n.expression,n.text]:n.type==='command'?['command',n.name,n.args]:[n.type,n.level,n.text]);
// No line-number identity or arbitrary duplicate-sentence tie breaking.
function reconcileNodes(text,source){
 const parsed=parseScript(text,{characters:source.config.characters,defaultLayout:source.config.defaultLayout});
 const old=source.nodes,fresh=parsed.nodes,matches=new Map(),used=new Set(),diagnostics=[];
 if(text===source.text){fresh.forEach((n,i)=>{if(old[i]&&key(n)===key(old[i].baseline)){matches.set(i,old[i]);used.add(i);}});}
 else {
  const groups=new Map();old.forEach((o,i)=>{const k=key(o.baseline);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(i);});
  const counts=new Map();fresh.forEach(n=>counts.set(key(n),(counts.get(key(n))||0)+1));
  fresh.forEach((n,i)=>{const candidates=groups.get(key(n))||[];if(candidates.length===1&&counts.get(key(n))===1){matches.set(i,old[candidates[0]]);used.add(candidates[0]);}});
  // A single changed dialogue between two established adjacent anchors is identifiable.
  for(let i=0;i<fresh.length;i++){
   if(matches.has(i)||fresh[i].type!=='dialogue')continue;
   const before=i===0?-1:old.indexOf(matches.get(i-1)),after=i===fresh.length-1?old.length:old.indexOf(matches.get(i+1));
   if((i===0||matches.has(i-1))&&(i===fresh.length-1||matches.has(i+1))&&after-before===2&&!used.has(before+1)){
    const candidate=old[before+1];
    if(candidate.baseline.type==='dialogue'&&candidate.baseline.speaker===fresh[i].speaker&&
     !old.some((o,j)=>j!==before+1&&key(o.baseline)===key(candidate.baseline))&&
     !fresh.some((n,j)=>j!==i&&key(n)===key(fresh[i]))){matches.set(i,candidate);used.add(before+1);}
   }
  }
 }
 const previousBindings=[],identities=[];
 fresh.forEach((n,i)=>{
  const matched=matches.get(i);identities.push({nodeId:n.id,stableId:matched?.stableId||randomUUID()});
  if(matched){const b=source.bindings.find(b=>b.nodeId===matched.nodeId);if(b)previousBindings.push({...b,nodeId:n.id});}
  else if(n.type==='dialogue'){
   previousBindings.push({nodeId:n.id,status:'reviewRequired',textBaseline:n.text});
   diagnostics.push({severity:'warning',code:'REIMPORT_IDENTITY_REVIEW',nodeId:n.id,line:n.line,column:n.column,message:'新增或身份有歧义的对白，请明确绑定素材或设为无配音；不按行号猜测旧身份。'});
  }
 });
 return {nodes:fresh,identities,previousBindings,diagnostics,parserDiagnostics:parsed.diagnostics};
}
module.exports={reconcileNodes};
