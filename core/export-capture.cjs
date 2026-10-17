'use strict';
// One extra viewport row outside the explicitly sized stage carries a token.
// Next paint alone may be an older queued frame. Accept only a paint carrying
// the target token, crop the row away, and never use capturePage's copy cache.
function markerBytes(token){if(!Number.isSafeInteger(token)||token<1||token>0xffffff)throw Error('Invalid export paint token');const a=token&255,b=(token>>>8)&255,c=(token>>>16)&255;return [a,b,c,a^b^c^0xa5,0x5a];}
async function capturePaintedFrame(webContents, {width,height,token,checkCancelled=()=>{},timeoutMs=5000,pollMs=20}={}) {
  checkCancelled();const bytes=markerBytes(token);
  if(!Number.isSafeInteger(width)||width<1||!Number.isSafeInteger(height)||height<1)throw Error('Invalid export capture dimensions');
  if(!webContents||typeof webContents.invalidate!=='function'||typeof webContents.on!=='function'||typeof webContents.removeListener!=='function'||typeof webContents.executeJavaScript!=='function'||typeof webContents.isOffscreen!=='function'||!webContents.isOffscreen())throw Error('Export requires offscreen paint acknowledgement');
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0||!Number.isFinite(pollMs)||pollMs<=0)throw Error('Invalid export paint timeout');
  const script=`(()=>{let row=document.getElementById('__replay_export_ack');if(!row){row=document.createElement('div');row.id='__replay_export_ack';document.body.appendChild(row);}Object.assign(row.style,{position:'fixed',left:'0px',top:'${height}px',width:'${bytes.length}px',height:'1px',display:'flex',zIndex:'2147483647',pointerEvents:'none',opacity:'1',transform:'none'});row.replaceChildren(...${JSON.stringify(bytes)}.map(value=>{const pixel=document.createElement('div');Object.assign(pixel.style,{width:'1px',height:'1px',flex:'none',backgroundColor:'rgb('+value+','+value+','+value+')'});return pixel;}));void row.offsetHeight;return true;})()`;
  const image=await new Promise((resolve,reject)=>{
    let settled=false,timer,poll;
    function clean(){clearTimeout(timer);clearInterval(poll);webContents.removeListener('paint',paint);webContents.removeListener('destroyed',destroyed);}
    function finish(error,value){if(settled)return;settled=true;clean();error?reject(error):resolve(value);}
    function check(){checkCancelled();if(webContents.isDestroyed())throw Error('Export webContents destroyed before capture');}
    function destroyed(){finish(Error('Export webContents destroyed before capture'));}
    function paint(details,_dirtyRect,legacyImage){
      if(settled)return;
      try{
        check();const actual=details?.image||legacyImage;
        if(!actual||typeof actual.getSize!=='function'||typeof actual.crop!=='function')throw Error('Missing offscreen paint image');
        const size=actual.getSize();if(size.width!==Math.max(width,bytes.length)||size.height!==height+1)throw Error('Offscreen paint dimensions mismatch');
        const marker=actual.crop({x:0,y:height,width:bytes.length,height:1}).toBitmap();
        // Grayscale makes this independent of RGBA vs BGRA native byte order.
        if(marker.length!==bytes.length*4)throw Error('Offscreen marker bitmap dimensions mismatch');
        if(bytes.some((value,i)=>marker[i*4]!==value||marker[i*4+1]!==value||marker[i*4+2]!==value||marker[i*4+3]!==255))return;
        finish(null,actual.crop({x:0,y:0,width,height}));
      }catch(error){finish(error);}
    }
    webContents.on('paint',paint);webContents.on('destroyed',destroyed);
    timer=setTimeout(()=>finish(Error('Export target paint acknowledgement timed out')),timeoutMs);
    poll=setInterval(()=>{try{check();}catch(error){finish(error);}},pollMs);
    try{check();Promise.resolve(webContents.executeJavaScript(script)).then(()=>{if(settled)return;try{check();webContents.invalidate();}catch(error){finish(error);}},error=>finish(error));}catch(error){finish(error);}
  });
  checkCancelled();return image;
}
module.exports={capturePaintedFrame,markerBytes};
