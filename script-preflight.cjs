#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {readUtf8,readConfig,scanAssets}=require('./core/script-asset-catalog.cjs');
const {preflight}=require('./core/script-preflight.cjs');
function main(argv){
 if(argv.includes('--help')){console.log('用法：node P2/script-preflight.cjs --script 剧本.txt --assets 素材目录 --config 配置.json [--corrections 校正.json] [--out 新报告.json]\n仅A批预检，不生成工程；报告ok不表示媒体或演出可执行。退出0预检通过，2预检错误，1读取/参数失败。');return 0;}
 const args={};for(let i=0;i<argv.length;i+=2){const key=argv[i];if(!['--script','--assets','--config','--corrections','--out'].includes(key)||!argv[i+1]||argv[i+1].startsWith('--')||Object.hasOwn(args,key))throw Error('参数无效或重复：'+key);args[key]=argv[i+1];}
 for(const key of ['--script','--assets','--config'])if(!args[key])throw Error('缺少参数：'+key);
 const source=readUtf8(path.resolve(args['--script']));
 const config=readConfig(path.resolve(args['--config']));
 const catalog=scanAssets(path.resolve(args['--assets']));
 let corrections;if(args['--corrections'])corrections=JSON.parse(readUtf8(path.resolve(args['--corrections']),{extensions:['.json'],maxBytes:1024*1024}).text);
 const report=preflight({text:source.text,sourceHash:source.hash,config,catalog,corrections});
 const json=JSON.stringify(report,null,2)+'\n';
 if(args['--out']){const target=path.resolve(args['--out']);fs.writeFileSync(target,json,{encoding:'utf8',flag:'wx'});console.log('已写新报告：'+target);console.log(JSON.stringify(report.summary));}else console.log(json);
 return report.ok?0:2;
}
if(require.main===module){try{process.exitCode=main(process.argv.slice(2));}catch(error){console.error(JSON.stringify({severity:'error',code:error.code||'PREFLIGHT_FAILED',message:error.message}));process.exitCode=1;}}
module.exports={main};
