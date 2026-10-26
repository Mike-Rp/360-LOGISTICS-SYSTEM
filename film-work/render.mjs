// Headless Chrome renderer for the deterministic film.html canvas.
// Usage: node render.mjs --still 24  or  node render.mjs --video
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const base=path.dirname(fileURLToPath(import.meta.url));
const chrome='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ffmpeg='C:\\Users\\ADMIN\\AppData\\Local\\CapCut\\Apps\\9.5.0.4050\\ffmpeg.exe';
const profile=fs.mkdtempSync(path.join(base,'chrome-profile-'));
const args=['--headless=new','--no-sandbox','--disable-gpu','--disable-crash-reporter','--no-first-run','--no-default-browser-check','--disable-extensions',
  '--hide-scrollbars','--force-device-scale-factor=1','--window-size=1920,1080',
  '--remote-debugging-port=0',`--user-data-dir=${profile}`,pathToFileURL(path.join(base,'film.html')).href];
const browser=spawn(chrome,args,{windowsHide:true,stdio:['ignore','ignore','pipe']});
let chromeError='';browser.stderr.on('data',data=>{chromeError+=String(data).slice(0,1000)});
let ws,id=0;const pending=new Map();
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function connect(){
  let port;for(let i=0;i<100;i++){const f=path.join(profile,'DevToolsActivePort');if(fs.existsSync(f)){try{port=Number(fs.readFileSync(f,'utf8').split('\n')[0]);if(port)break}catch{}}await wait(100)}
  if(!port)throw new Error('Chrome debugging port did not open. '+chromeError.slice(-1200));
  const pages=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page=pages.find(x=>x.type==='page'&&x.url.includes('film.html'))||pages.find(x=>x.type==='page');
  if(!page)throw new Error('Film page did not open');
  ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})});
  ws.addEventListener('message',event=>{const message=JSON.parse(event.data);const p=pending.get(message.id);if(p){pending.delete(message.id);if(message.error)p.reject(new Error(message.error.message));else p.resolve(message.result)}});
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  let ready;
  for(let attempt=0;attempt<100;attempt++){
    try{ready=await evaluate('window.assetsReady ? window.assetsReady.then(()=>window.missingAssets) : null');if(ready!==null)break}catch{}
    await wait(100);
  }
  if(ready===undefined||ready===null)throw new Error('Film script did not initialize');
  return ready;
}
function send(method,params={}){return new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}))})}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value}
async function capture(t,out){await evaluate(`window.seek(${t})`);const r=await send('Page.captureScreenshot',{format:'jpeg',quality:94,fromSurface:true,captureBeyondViewport:false});fs.writeFileSync(out,Buffer.from(r.data,'base64'))}
async function main(){
  const missing=await connect();
  const stillIndex=process.argv.indexOf('--still');
  if(stillIndex>=0){const t=Number(process.argv[stillIndex+1]||0);const out=path.join(base,`still-${String(t).replace('.','_')}.jpg`);await capture(t,out);console.log(out);if(missing.length)console.log('Missing assets:',missing.join(', '));return}
  const stillsIndex=process.argv.indexOf('--stills');
  if(stillsIndex>=0){for(const value of process.argv[stillsIndex+1].split(',')){const t=Number(value),out=path.join(base,`still-${String(t).replace('.','_')}.jpg`);await capture(t,out);console.log(out)}if(missing.length)console.log('Missing assets:',missing.join(', '));return}
  if(!process.argv.includes('--video'))throw new Error('Use --still <seconds> or --video');
  if(missing.length)throw new Error('Refusing final render: missing authentic source assets: '+missing.join(', '));
  const frames=path.join(base,'frames');fs.mkdirSync(frames,{recursive:true});
  const total=60*60*4; // 60 fps, four subframes per encoded frame.
  for(let n=0;n<total;n++){
    const frame=Math.floor(n/4),sub=n%4;
    const t=frame===3599?0:(frame+(sub+.5)/4)/60;
    await capture(t,path.join(frames,`frame${String(n).padStart(5,'0')}.jpg`));
    if(n%240===0)console.log(`Rendered ${Math.round(n/240)}/60 seconds`);
  }
  const out=path.join(base,'360-Logistics-System-Refined.mp4');
  const options=['-y','-framerate','240','-i',path.join(frames,'frame%05d.jpg'),'-i',path.join(base,'score.wav'),
    '-vf','tmix=frames=4:weights=1 1 1 1,fps=60,format=yuv420p','-frames:v','3600',
    '-c:v','h264_mf','-b:v','18M','-c:a','aac','-b:a','256k','-ar','48000','-t','60',
    '-movflags','+faststart',out];
  const result=spawnSync(ffmpeg,options,{windowsHide:true,stdio:'inherit'});
  if(result.status!==0)throw new Error(`FFmpeg failed with exit ${result.status}`);
  console.log('Final film:',out);
}
try{await main()}catch(error){console.error(error);process.exitCode=1}finally{ws?.close();browser.kill()}
