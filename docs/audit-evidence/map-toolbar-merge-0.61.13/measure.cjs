const {chromium,expect}=require('/workspace/VHSlide/node_modules/@playwright/test');
const fs=require('fs'),{execFile}=require('child_process'),{promisify}=require('util'),exec=promisify(execFile);
(async()=>{const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});try{const ctx=await browser.newContext();await ctx.addInitScript(()=>{window.google={accounts:{id:{initialize:o=>window.__googleConfig=o,renderButton:e=>e.textContent='Googleでログイン'}}}});await ctx.route('**/*',async route=>{const req=route.request(),url=req.url();if(!url.startsWith('https://vhslide.overdozer1124.workers.dev/')||req.method()!=='GET')return route.abort();const dir=fs.mkdtempSync('/tmp/vhslide-auth-fetch-');try{await exec('curl',['-H','Cache-Control: no-cache','--fail','--silent','--show-error','--compressed','--max-time','30','--dump-header',dir+'/h','--output',dir+'/b',url]);const blocks=fs.readFileSync(dir+'/h','utf8').trim().split(/\r?\n\r?\n/),lines=blocks.at(-1).split(/\r?\n/),headers={};for(const line of lines.slice(1)){const i=line.indexOf(':');if(i>0){const k=line.slice(0,i).toLowerCase();if(!['content-encoding','content-length','transfer-encoding','connection'].includes(k))headers[k]=line.slice(i+1).trim()}}await route.fulfill({status:Number(lines[0].split(' ')[1]),headers,body:fs.readFileSync(dir+'/b')})}finally{fs.rmSync(dir,{recursive:true,force:true})}});

const phase=process.argv[2]||'before';
const page=await ctx.newPage();await page.setViewportSize({width:1366,height:768});
const book=JSON.parse(fs.readFileSync('/workspace/VHSlide/public/samples/vhslide-10x40.json','utf8'));
await page.addInitScript(book=>localStorage.setItem('vhslide-deck-v1',JSON.stringify(book)),book);
await page.goto('https://vhslide.overdozer1124.workers.dev/',{waitUntil:'domcontentloaded'});
await expect(page.locator('.slide-card')).toHaveCount(400);
await expect(page.locator('.map-toolbar')).toBeVisible();
const metrics=await page.evaluate(()=>{const rect=s=>{const b=document.querySelector(s).getBoundingClientRect();return {y:b.y,height:b.height}};return {viewport:{width:innerWidth,height:innerHeight},map:rect('.map-scroll'),bar:rect('.view-bar'),toolbar:rect('.map-toolbar'),mapToolbarInTopBar:!!document.querySelector('.view-bar .map-toolbar')}});
fs.writeFileSync(`/tmp/vhslide-06113-${phase}-metrics.json`,JSON.stringify(metrics,null,2));
await page.screenshot({path:`/tmp/vhslide-06113-${phase}-map.png`});console.log(JSON.stringify(metrics));
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
