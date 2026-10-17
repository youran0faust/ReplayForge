'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {TextDecoder}=require('node:util');
const {validateReadingConfig}=require('./script-reading-budget.cjs');
const {KEYS:PERFORMANCE_KEYS,validatePerformanceConfig}=require('./performance-config.cjs');
const categories={'角色':'character','背景':'background','配音':'voice','音乐':'music','音效':'sfx','视频':'video'};
const formats={character:['.png','.jpg','.jpeg'],background:['.png','.jpg','.jpeg'],voice:['.wav','.mp3','.ogg'],music:['.wav','.mp3','.ogg'],sfx:['.wav','.mp3','.ogg'],video:['.mp4']};
const inside=(root,file)=>{const r=path.relative(root,file);return r===''||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));};
function fail(code,message){throw Object.assign(new Error(message),{code});}
function regularFile(file,maxBytes){const s=fs.lstatSync(file);if(s.isSymbolicLink()||!s.isFile())fail('NOT_REGULAR_FILE','只接受普通文件');if(s.size>maxBytes)fail('FILE_TOO_LARGE','文件超过读取限制');return s;}
function readUtf8(file,{extensions=['.txt','.md'],maxBytes=4*1024*1024}={}){
 if(!extensions.includes(path.extname(file).toLowerCase()))fail('UNSUPPORTED_EXTENSION','文件扩展名不支持');
 regularFile(file,maxBytes);const bytes=fs.readFileSync(file);if(bytes.length>maxBytes)fail('FILE_TOO_LARGE','文件超过读取限制');
 let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('INVALID_UTF8','必须使用UTF-8编码');}
 if(text.includes('\0'))fail('NUL_TEXT','文本包含NUL');if(!text.trim())fail('EMPTY_TEXT','文本为空');
 return {text,hash:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
}
function scanAssets(root,{maxFiles=10000,maxDepth=12}={}){
 const diagnostics=[],assets=[];if(!Number.isSafeInteger(maxFiles)||maxFiles<1||!Number.isSafeInteger(maxDepth)||maxDepth<1)fail('INVALID_LIMIT','扫描限制无效');
 const supplied=fs.lstatSync(root);if(supplied.isSymbolicLink()||!supplied.isDirectory())fail('INVALID_ROOT','素材根目录须为普通目录');
 root=fs.realpathSync(root);let seen=0,stopped=false;
 function diag(code,message,relativePath){diagnostics.push({severity:'error',code,message,relativePath});}
 function walk(dir,category,depth){if(stopped)return;if(depth>maxDepth){diag('ASSET_DEPTH_LIMIT','素材目录层级超限',path.relative(root,dir));return;}
  const entries=fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
  for(const e of entries){if(stopped)break;const file=path.join(dir,e.name),relativePath=path.relative(root,file).split(path.sep).join('/');
   if(++seen>maxFiles){diag('ASSET_COUNT_LIMIT','扫描条目超限',relativePath);stopped=true;break;}
   const s=fs.lstatSync(file);if(s.isSymbolicLink()){diag('ASSET_LINK_REJECTED','不扫描链接或junction',relativePath);continue;}
   if(!inside(root,fs.realpathSync(file))){diag('ASSET_PATH_ESCAPE','素材越出授权目录',relativePath);continue;}
   if(s.isDirectory()){walk(file,category,depth+1);continue;}
   if(!s.isFile()){diag('ASSET_NOT_REGULAR','素材不是普通文件',relativePath);continue;}
   const ext=path.extname(e.name).toLowerCase();if(!formats[category].includes(ext)){diagnostics.push({severity:'warning',code:'ASSET_EXTENSION_UNSUPPORTED',message:'该类别暂不识别此扩展名',relativePath});continue;}
   const kind=['voice','music','sfx'].includes(category)?'audio':category==='video'?'video':'image';
   assets.push({id:'asset_'+crypto.createHash('sha256').update(relativePath).digest('hex').slice(0,24),kind,category,relativePath,categoryPath:relativePath.split('/').slice(1).join('/'),size:s.size,mediaStatus:'unprobed'});
  }
 }
 for(const [folder,category] of Object.entries(categories)){const dir=path.join(root,folder);if(!fs.existsSync(dir))continue;const s=fs.lstatSync(dir);if(s.isSymbolicLink()||!s.isDirectory()){diag('ASSET_CATEGORY_INVALID','分类目录必须为普通目录',folder);continue;}walk(dir,category,1);}
 return {version:1,assets,diagnostics,mediaValidated:false};
}
function resolveAsset(assets,category,reference){
 if(typeof reference!=='string'||!reference||reference.includes('\0')||path.posix.isAbsolute(reference)||path.win32.isAbsolute(reference)||/[:]/u.test(reference))return {status:'invalid',candidates:[]};
 const ref=reference.replaceAll('\\','/');if(ref.split('/').some(p=>p==='..'||p===''||p==='.' ))return {status:'invalid',candidates:[]};
 const candidates=assets.filter(a=>a.category===category&&(ref.includes('/')?(a.categoryPath===ref||a.relativePath===ref):path.posix.basename(a.relativePath)===ref));
 return {status:candidates.length===1?'matched':candidates.length?'ambiguous':'missing',candidates};
}
function readConfig(file){
 const {text}=readUtf8(file,{extensions:['.json'],maxBytes:1024*1024});let config;try{config=JSON.parse(text);}catch{fail('INVALID_CONFIG_JSON','素材配置不是有效JSON');}
 if(!config||Array.isArray(config)||config.version!==1||!Array.isArray(config.characters))fail('INVALID_CONFIG','配置须为version:1及characters数组');
 if(Object.keys(config).some(k=>![...PERFORMANCE_KEYS,'version','characters','defaultLayout','unvoicedDurationSeconds','dialoguePageMaxCharacters','dialoguePageHoldSeconds','unvoicedTimingMode','unvoicedMinimumSeconds','unvoicedReadingSpeed','dialogueRevealCharactersPerSecond'].includes(k)))fail('UNKNOWN_CONFIG_FIELD','未知配置字段');
 if(config.defaultLayout!==undefined&&!['单人','双人','三人','四人'].includes(config.defaultLayout))fail('INVALID_LAYOUT','默认布局无效');
 if(config.unvoicedDurationSeconds!==undefined&&(!Number.isFinite(config.unvoicedDurationSeconds)||config.unvoicedDurationSeconds<=0||config.unvoicedDurationSeconds>3600))fail('INVALID_DURATION','无配音每页时长必须大于0且不超过3600秒');
 if(config.dialoguePageMaxCharacters!==undefined&&(!Number.isInteger(config.dialoguePageMaxCharacters)||config.dialoguePageMaxCharacters<1||config.dialoguePageMaxCharacters>1000))fail('INVALID_PAGE_MAX_CHARACTERS','每页字素数上限必须为1至1000的整数');
 const readingDiagnostics=[...validateReadingConfig(config),...validatePerformanceConfig(config)];if(readingDiagnostics.length)fail(readingDiagnostics[0].code,readingDiagnostics[0].message);
 const names=new Set(),codes=new Set();for(const c of config.characters){
  if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!['name','voiceCode','expressions','defaultExpression','image','expressionImages'].includes(k)))fail('INVALID_CHARACTER_CONFIG','角色配置字段无效');
  if(typeof c.name!=='string'||!c.name.trim()||names.has(c.name))fail('DUPLICATE_CHARACTER','角色名为空或重复');names.add(c.name);
  if(c.voiceCode!==undefined&&(typeof c.voiceCode!=='string'||! /^[A-Za-z][A-Za-z0-9]*$/.test(c.voiceCode)||codes.has(c.voiceCode.toUpperCase())))fail('INVALID_VOICE_CODE','配音代号须为唯一字母数字标识且以字母开头');if(c.voiceCode)codes.add(c.voiceCode.toUpperCase());
  if(c.expressions!==undefined&&(!Array.isArray(c.expressions)||c.expressions.some(e=>typeof e!=='string'||!e.trim())||new Set(c.expressions).size!==c.expressions.length))fail('INVALID_EXPRESSIONS','表情名称列表无效');
  if(c.image!==undefined&&(typeof c.image!=='string'||resolveAsset([],'character',c.image).status==='invalid'))fail('INVALID_CHARACTER_IMAGE','角色底图引用须为包内相对路径');
  if(c.expressionImages!==undefined){if(!c.expressionImages||typeof c.expressionImages!=='object'||Array.isArray(c.expressionImages))fail('INVALID_EXPRESSION_IMAGES','表情图片映射无效');for(const [name,ref] of Object.entries(c.expressionImages))if(!c.expressions?.includes(name)||typeof ref!=='string'||resolveAsset([],'character',ref).status==='invalid')fail('INVALID_EXPRESSION_IMAGES','表情图片须引用已登记表情与包内相对路径');}
  if(c.defaultExpression!==undefined&&(!Array.isArray(c.expressions)||!c.expressions.includes(c.defaultExpression)))fail('INVALID_DEFAULT_EXPRESSION','默认表情须在表情名称列表中');
 }
 return config;
}
module.exports={readUtf8,scanAssets,resolveAsset,readConfig};
