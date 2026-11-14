import { createRequire } from "node:module";
import { execSync } from "node:child_process";
const { chromium } = createRequire(import.meta.url)(execSync("npm root -g").toString().trim() + "/playwright");
import fs from "node:fs";
const ages=[6,7,8,9,10,11,12,13,14,15,16,17];
const hM=[116.7,122.6,128.1,133.5,139.0,145.2,152.6,159.8,165.3,168.6,169.8,170.7];
const hF=[115.8,121.8,127.6,133.5,140.1,146.6,151.9,154.8,156.5,157.2,157.7,158.0];
const wM=[21.7,24.5,28.0,31.5,35.5,39.6,45.2,50.0,54.7,59.0,60.7,62.5];
const wF=[21.1,23.9,27.3,31.1,35.4,40.3,44.5,47.7,49.9,51.2,52.1,52.5];
const blue="#2f6fd6", red="#e0573e";
function panel(title,unit,m,f,ymin,ymax,step,ox){
  const W=420,H=330,L=ox+52,T=60,R=ox+W-14,B=T+H-70;
  const X=i=>L+(R-L)*i/(ages.length-1), Y=v=>B-(B-T)*(v-ymin)/(ymax-ymin);
  let s=`<text x="${ox+W/2}" y="34" font-size="22" font-weight="700" text-anchor="middle" fill="#173d38">${title}</text>`;
  s+=`<rect x="${X(6)-12}" y="${T}" width="${X(8)-X(6)+24}" height="${B-T}" fill="#fff1d6"/>`;
  s+=`<text x="${(X(6)+X(8))/2}" y="${T+18}" font-size="15" text-anchor="middle" fill="#b5651d" font-weight="700">中学生</text>`;
  for(let v=ymin;v<=ymax;v+=step){s+=`<line x1="${L}" x2="${R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#dde3e1"/><text x="${L-8}" y="${Y(v)+5}" font-size="14" text-anchor="end" fill="#555">${v}</text>`;}
  ages.forEach((a,i)=>{s+=`<text x="${X(i)}" y="${B+20}" font-size="14" text-anchor="middle" fill="#555">${a}</text>`});
  s+=`<text x="${R}" y="${B+40}" font-size="14" text-anchor="end" fill="#555">（歳）</text><text x="${L-8}" y="${T-12}" font-size="14" text-anchor="end" fill="#555">（${unit}）</text>`;
  for(const [d,c] of [[m,blue],[f,red]]){s+=`<polyline fill="none" stroke="${c}" stroke-width="4" points="${d.map((v,i)=>X(i)+","+Y(v)).join(" ")}"/>`+d.map((v,i)=>`<circle cx="${X(i)}" cy="${Y(v)}" r="4.5" fill="${c}"/>`).join("");}
  s+=`<text x="${R-4}" y="${Y(m.at(-1))-12}" font-size="16" fill="${blue}" text-anchor="end" font-weight="700">男子</text><text x="${R-4}" y="${Y(f.at(-1))+24}" font-size="16" fill="${red}" text-anchor="end" font-weight="700">女子</text>`;
  return s;
}
function gain(ox){
  const W=420,H=330,L=ox+52,T=60,R=ox+W-14,B=T+H-70;const ymin=0,ymax=8;
  const n=ages.length-1, bw=(R-L)/n;
  const Y=v=>B-(B-T)*(v-ymin)/(ymax-ymin);
  let s=`<text x="${ox+W/2}" y="34" font-size="22" font-weight="700" text-anchor="middle" fill="#173d38">1年間に伸びた身長</text>`;
  s+=`<rect x="${L+bw*5}" y="${T}" width="${bw*3}" height="${B-T}" fill="#fff1d6"/><text x="${L+bw*6.5}" y="${T+18}" font-size="15" text-anchor="middle" fill="#b5651d" font-weight="700">中学生</text>`;
  for(let v=0;v<=8;v+=2)s+=`<line x1="${L}" x2="${R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#dde3e1"/><text x="${L-8}" y="${Y(v)+5}" font-size="14" text-anchor="end" fill="#555">${v}</text>`;
  for(let i=1;i<ages.length;i++){const x=L+bw*(i-1);const gm=hM[i]-hM[i-1],gf=hF[i]-hF[i-1];
    s+=`<rect x="${x+bw*0.12}" y="${Y(gm)}" width="${bw*0.36}" height="${B-Y(gm)}" fill="${blue}"/><rect x="${x+bw*0.52}" y="${Y(gf)}" width="${bw*0.36}" height="${B-Y(gf)}" fill="${red}"/>`;
    s+=`<text x="${x+bw/2}" y="${B+20}" font-size="13" text-anchor="middle" fill="#555">${ages[i]}</text>`;}
  s+=`<text x="${R}" y="${B+40}" font-size="14" text-anchor="end" fill="#555">（歳）</text><text x="${L-8}" y="${T-12}" font-size="14" text-anchor="end" fill="#555">（cm）</text>`;
  s+=`<rect x="${L+bw*8.2}" y="${T+60}" width="14" height="14" fill="${blue}"/><text x="${L+bw*8.2+20}" y="${T+73}" font-size="15">男子</text><rect x="${L+bw*8.2}" y="${T+88}" width="14" height="14" fill="${red}"/><text x="${L+bw*8.2+20}" y="${T+101}" font-size="15">女子</text>`;
  return s;
}
const fig1=`<svg xmlns="http://www.w3.org/2000/svg" width="1290" height="340" font-family="IPAPGothic">
<rect width="1290" height="340" fill="#fff"/>${panel("身長（平均値）の変化","cm",hM,hF,110,175,10,0)}${panel("体重（平均値）の変化","kg",wM,wF,20,65,10,430)}${gain(860)}</svg>`;
const mascot=(mark)=>`<svg xmlns="http://www.w3.org/2000/svg" width="260" height="260" font-family="IPAPGothic">
<path d="M130 22 C 175 22 240 150 240 190 C 240 232 200 244 130 244 C 60 244 20 232 20 190 C 20 150 85 22 130 22 Z" fill="#ffffff" stroke="#3a3a3a" stroke-width="5"/>
<rect x="62" y="168" width="136" height="76" rx="8" fill="#2f4f3a"/>
<circle cx="100" cy="128" r="9" fill="#3a3a3a"/><circle cx="160" cy="128" r="9" fill="#3a3a3a"/>
<circle cx="84" cy="150" r="10" fill="#f6b3a6" opacity=".8"/><circle cx="176" cy="150" r="10" fill="#f6b3a6" opacity=".8"/>
<path d="M112 150 Q130 166 148 150" fill="none" stroke="#3a3a3a" stroke-width="5" stroke-linecap="round"/>
${mark}</svg>`;
const q=`<circle cx="222" cy="44" r="32" fill="#f39c3d"/><text x="222" y="58" font-size="40" font-weight="700" fill="#fff" text-anchor="middle">?</text>`;
const bulb=`<circle cx="222" cy="44" r="32" fill="#2e9b6a"/><text x="222" y="58" font-size="38" font-weight="700" fill="#fff" text-anchor="middle">!</text>`;
const b=await chromium.launch();const p=await b.newPage({deviceScaleFactor:1.6});
async function shot(svg,file,w,h,transparent){await p.setViewportSize({width:w,height:h});await p.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);await p.screenshot({path:file,omitBackground:!!transparent,type:"png",clip:{x:0,y:0,width:w,height:h}});}
await shot(fig1,"fig1.png",1290,340);
await shot(mascot(q),"mascot_q.png",260,260,true);
await shot(mascot(bulb),"mascot_a.png",260,260,true);
await b.close();
for(const f of ["fig1.png","mascot_q.png","mascot_a.png"])console.log(f,fs.statSync(f).size);
