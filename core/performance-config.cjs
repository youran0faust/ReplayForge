'use strict';
const DEFAULTS=Object.freeze({characterFadeSeconds:.5,screenFadeSeconds:.4,titleFadeInSeconds:.5,titleHoldSeconds:2,titleFadeOutSeconds:.5,bgmFadeOutSeconds:.5});
const KEYS=Object.freeze(Object.keys(DEFAULTS));
function validatePerformanceConfig(config){const errors=[];for(const key of KEYS){const v=config?.[key];if(v!==undefined&&(typeof v!=='number'||!Number.isFinite(v)||v<0||v>3600||(['characterFadeSeconds','screenFadeSeconds'].includes(key)&&v===0)))errors.push({severity:'error',code:'INVALID_PERFORMANCE_CONFIG',message:key+' 须为0到3600秒；角色/画面淡变须大于0。'});}const title=resolvePerformanceConfig(config);if(title.titleFadeInSeconds+title.titleHoldSeconds+title.titleFadeOutSeconds<=0)errors.push({severity:'error',code:'INVALID_PERFORMANCE_CONFIG',message:'标题总时长须大于0。'});return errors;}
function resolvePerformanceConfig(config={}){return Object.fromEntries(KEYS.map(k=>[k,config[k]===undefined?DEFAULTS[k]:config[k]]));}
module.exports={DEFAULTS,KEYS,validatePerformanceConfig,resolvePerformanceConfig};
