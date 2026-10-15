'use strict';
/* Temperature Litmerk – mobile; no external JavaScript libraries. OAuth2 authorization code + PKCE. */
const $=id=>document.getElementById(id);
const sensors=[['Ts','soba','Ts_min','Ts_max','#4169e1'],['Tz','zunanja','Tz_min','Tz_max','#dc143c'],['Tm','mansarda','Tm_min','Tm_max','#228b22'],['Tg','garaža','Tg_min','Tg_max','#9400d3'],['Twc','sanitarije','Twc_min','Twc_max','#ff8c00']];
const months=['','januar','februar','marec','april','maj','junij','julij','avgust','september','oktober','november','december'];
const githubApi='https://api.github.com/repos/Litmerk-temperature/Temperature-Litmerk/contents/meseci';
const githubRaw='https://raw.githubusercontent.com/Litmerk-temperature/Temperature-Litmerk/main/meseci/';
let files=[], rows=[], year=0,month=0,selectedDay=1;
const fmt=n=>n===null||!Number.isFinite(n)?'–':n.toFixed(1).replace('.',',')+' °C';
const status=(message,error=false)=>{$('busy').textContent=message;$('busy').className=error?'error':'';};
function init(){
  $('year').onchange=fillMonths;
  $('month').onchange=loadMonth;
  $('prev').onclick=()=>chooseDay(selectedDay-1);
  $('next').onclick=()=>chooseDay(selectedDay+1);
  $('day').oninput=e=>chooseDay(+e.target.value);
  const cv=$('chart');
  cv.addEventListener('pointerdown',pointerDay);
  cv.addEventListener('pointermove',e=>{if(e.buttons)pointerDay(e)});
  window.addEventListener('resize',()=>requestAnimationFrame(draw));
  if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
  listFiles();
}
async function listFiles(){
  status('Berem seznam mesecev z GitHuba ...');files=[];
  try{
    const r=await fetch(githubApi,{cache:'no-store',headers:{'Accept':'application/vnd.github+json'}});
    if(!r.ok)throw new Error('GitHub HTTP '+r.status);
    const entries=await r.json();
    if(!Array.isArray(entries))throw new Error('GitHub ni vrnil seznama datotek.');
    for(const f of entries){
      const m=/^(\d{2})_(\d{1,2})TEM\.TXT$/i.exec(f.name||'');
      if(!m||f.type!=='file')continue;
      const mm=+m[2];if(mm<1||mm>12)continue;
      files.push({year:2000+(+m[1]),month:mm,name:f.name});
    }
    files.sort((a,b)=>a.year-b.year||a.month-b.month);
    const y=$('year');y.innerHTML='';
    [...new Set(files.map(f=>f.year))].forEach(n=>y.add(new Option(n,n)));
    if(!files.length)throw new Error('Ni datotek oblike 26_8TEM.TXT.');
    y.disabled=false;y.value=String(files[files.length-1].year);fillMonths();
  }catch(e){status('Ne morem prebrati seznama mesecev: '+e.message,true)}
}
function fillMonths(){const y=+$('year').value,m=$('month');m.innerHTML='';files.filter(f=>f.year===y).forEach(f=>m.add(new Option(months[f.month],f.month)));m.disabled=false;if(m.options.length){m.selectedIndex=m.options.length-1;loadMonth()}}
function parse(text){
 const lines=text.replace(/^\uFEFF/,'').replace(/\r/g,'').split('\n');let h=lines.findIndex(s=>s.includes('Ts_min')&&s.includes('Ts_max'));if(h<0)throw new Error('Datoteka nima stolpcev Ts_min in Ts_max.');
 const headers=lines[h].split(';').map(s=>s.trim()),ix={};headers.forEach((x,i)=>ix[x]=i);
 sensors.forEach(s=>{if(ix[s[2]]===undefined||ix[s[3]]===undefined)throw new Error('Manjka stolpec '+s[2]+' ali '+s[3])});
 const result=[];for(const line of lines.slice(h+1)){
 if(!line.trim())continue;const p=line.split(';');let match=/^(\d{1,2})(?:[.\/-]|$)/.exec((p[0]||'').trim());if(!match)match=/^(\d{1,2})[.\/-]/.exec((p[1]||'').trim());if(!match)continue;
 const d=+match[1];if(d<1||d>31)continue;const o={Day:d};for(const s of sensors)for(const key of [s[2],s[3]]){const v=(p[ix[key]]||'').trim().replace(',','.');o[key]=v!==''&&Number.isFinite(Number(v))?Number(v):null}result.push(o);
 }
 return result.sort((a,b)=>a.Day-b.Day);
}
async function loadMonth(){
  year=+$('year').value;month=+$('month').value;
  const f=files.find(x=>x.year===year&&x.month===month);if(!f)return;
  status('Nalagam '+f.name+' ...');
  try{
    const r=await fetch(githubRaw+encodeURIComponent(f.name),{cache:'no-store'});
    if(!r.ok)throw new Error('GitHub HTTP '+r.status);
    const bytes=await r.arrayBuffer();
    let txt=new TextDecoder('utf-8').decode(bytes);
    if(txt.includes('\uFFFD'))txt=new TextDecoder('windows-1250').decode(bytes);
    rows=parse(txt);selectedDay=rows.length?rows[rows.length-1].Day:1;
    $('day').max=new Date(year,month,0).getDate();$('day').value=selectedDay;
    status(f.name+' | '+rows.length+' dni');renderStats();renderDay();requestAnimationFrame(draw);
  }catch(e){status('Napaka v '+f.name+': '+e.message,true)}
}
function renderStats(){
 $('statsTitle').textContent='MIN / MAX – '+months[month]+' '+year;
 $('stats').className='';$('stats').innerHTML=sensors.map(s=>{
 let lo=null,hi=null,ld=null,hd=null;for(const r of rows){const a=r[s[2]],b=r[s[3]];if(a!==null&&(lo===null||a<lo)){lo=a;ld=r.Day}if(b!==null&&(hi===null||b>hi)){hi=b;hd=r.Day}}
 return `<div class="sensor"><strong style="color:${s[4]}">${s[0]} (${s[1]})</strong><div class="stats"><div class="stat">MIN: ${fmt(lo)}<small>${ld?ld+'. '+month+'. '+year:''}</small></div><div class="stat">MAX: ${fmt(hi)}<small>${hd?hd+'. '+month+'. '+year:''}</small></div></div></div>`;
 }).join('');
}
function chooseDay(d){selectedDay=Math.min(new Date(year,month,0).getDate(),Math.max(1,d));$('day').value=selectedDay;renderDay();draw()}
function renderDay(){const r=rows.find(x=>x.Day===selectedDay);$('dayInfo').innerHTML='<strong>'+selectedDay+'. '+months[month]+' '+year+'</strong>'+(r?'<div style="display:flex;gap:8px 18px;flex-wrap:wrap;margin-top:7px">'+sensors.map(s=>`<span><b style="color:${s[4]}">${s[0]}:</b> ${fmt(r[s[2]])} / ${fmt(r[s[3]])}</span>`).join('')+'</div>':'<p>Za ta dan ni podatkov.</p>')}
function pointerDay(e){if(!rows.length)return;const r=$('chart').getBoundingClientRect(),x=e.clientX-r.left;const left=49,right=14,days=new Date(year,month,0).getDate();chooseDay(Math.round(1+(x-left)/Math.max(1,r.width-left-right)*(days-1)))}
function draw(){
 const c=$('chart'),r=c.getBoundingClientRect();if(!r.width||!r.height)return;const dpr=Math.min(2,devicePixelRatio||1);c.width=Math.round(r.width*dpr);c.height=Math.round(r.height*dpr);const ctx=c.getContext('2d');ctx.scale(dpr,dpr);
 const w=r.width,h=r.height,L=49,R=14,T=15,B=34,pw=Math.max(10,w-L-R),ph=Math.max(10,h-T-B);
 ctx.clearRect(0,0,w,h);if(!rows.length){ctx.fillStyle='#6b7890';ctx.textAlign='center';ctx.fillText('Ni podatkov za prikaz',w/2,h/2);return}
 let lo=Infinity,hi=-Infinity;for(const row of rows)for(const s of sensors)for(const k of [s[2],s[3]])if(row[k]!==null){lo=Math.min(lo,row[k]);hi=Math.max(hi,row[k])}if(!Number.isFinite(lo)){lo=0;hi=40}lo=Math.floor(lo-1);hi=Math.ceil(hi+1);if(hi===lo)hi=lo+1;
 const days=new Date(year,month,0).getDate(),px=day=>L+(day-1)/(days-1)*pw,py=v=>T+(hi-v)/(hi-lo)*ph;
 ctx.font='12px system-ui';ctx.lineWidth=1;ctx.textAlign='right';for(let i=0;i<=5;i++){const v=lo+(hi-lo)*i/5,y=py(v);ctx.strokeStyle='#e4eaf2';ctx.beginPath();ctx.moveTo(L,y);ctx.lineTo(w-R,y);ctx.stroke();ctx.fillStyle='#53657b';ctx.fillText(v.toFixed(0)+'°',L-6,y+4)}
 ctx.textAlign='center';const stride=w<440?5:w<800?3:2;for(let d=1;d<=days;d++)if(d===1||d===days||d%stride===0){const x=px(d);ctx.fillStyle='#69788c';ctx.fillText(d+'.',x,h-10)}
 for(const s of sensors)for(let k=2;k<=3;k++){ctx.strokeStyle=s[4];ctx.lineWidth=k===3?2:1.4;ctx.setLineDash(k===2?[5,4]:[]);ctx.beginPath();let start=true;for(const row of rows){const v=row[s[k]];if(v===null)continue;if(start){ctx.moveTo(px(row.Day),py(v));start=false}else ctx.lineTo(px(row.Day),py(v))}ctx.stroke();ctx.setLineDash([])}
 ctx.strokeStyle='#46576b';ctx.lineWidth=1;const x=px(selectedDay);ctx.beginPath();ctx.moveTo(x,T);ctx.lineTo(x,h-B);ctx.stroke();
}
window.addEventListener('DOMContentLoaded',init);
