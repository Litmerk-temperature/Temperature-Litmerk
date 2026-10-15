'use strict';
/* Temperature Litmerk – mobile; no external JavaScript libraries. OAuth2 authorization code + PKCE. */
const $=id=>document.getElementById(id);
const sensors=[['Ts','soba','Ts_min','Ts_max','#4169e1'],['Tz','zunanja','Tz_min','Tz_max','#dc143c'],['Tm','mansarda','Tm_min','Tm_max','#228b22'],['Tg','garaža','Tg_min','Tg_max','#9400d3'],['Twc','sanitarije','Twc_min','Twc_max','#ff8c00']];
const months=['','januar','februar','marec','april','maj','junij','julij','avgust','september','oktober','november','december'];
const scope='openid profile offline_access Files.Read';
const redirect=location.origin+location.pathname;
const authority='https://login.microsoftonline.com/consumers/oauth2/v2.0';
let files=[], rows=[], year=0,month=0,selectedDay=1, token=null,tokenExpiry=0,refreshToken=null, loginBusy=false;
let clientId=localStorage.getItem('litmerk_client_id')||'';
let folder=localStorage.getItem('litmerk_folder')||'Sluzba/Temperature_Litmerk/meseci';
const fmt=n=>n===null||!Number.isFinite(n)?'–':n.toFixed(1).replace('.',',')+' °C';
const status=(message,error=false)=>{$('busy').textContent=message;$('busy').className=error?'error':'';};
function authStatus(message){$('authStatus').textContent=message;}
function init(){
 $('clientId').value=clientId;$('folder').value=folder;$('redirect').textContent=redirect;
 $('login').onclick=login;$('logout').onclick=logout;
 $('saveClient').onclick=()=>{clientId=$('clientId').value.trim();localStorage.setItem('litmerk_client_id',clientId);status('ID shranjen. Zdaj klikni Prijava OneDrive.')};
 $('saveFolder').onclick=()=>{folder=$('folder').value.trim().replace(/^\/+|\/+$/g,'');localStorage.setItem('litmerk_folder',folder);if(token)listFiles()};
 $('copyRedirect').onclick=()=>navigator.clipboard.writeText(redirect).then(()=>status('Naslov kopiran.'));
 $('year').onchange=fillMonths;$('month').onchange=loadMonth;
 $('prev').onclick=()=>chooseDay(selectedDay-1);$('next').onclick=()=>chooseDay(selectedDay+1);
 $('day').oninput=e=>chooseDay(+e.target.value);
 const cv=$('chart');cv.addEventListener('pointerdown',pointerDay);cv.addEventListener('pointermove',e=>{if(e.buttons)pointerDay(e)});
 window.addEventListener('resize',()=>requestAnimationFrame(draw));
 if('serviceWorker' in navigator && location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
 handleReturn().then(()=>{if(token||refreshToken)listFiles().catch(e=>status(e.message,true));else if(clientId)status('Klikni Prijava OneDrive za povezavo.');}).catch(e=>status('Prijava ni uspela: '+e.message,true));
}
function b64url(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function randomString(){const b=new Uint8Array(32);crypto.getRandomValues(b);return b64url(b)}
async function login(){
 if(!clientId){document.querySelector('.settings').open=true;status('Najprej vnesi Application (client) ID.',true);return}
 const verifier=randomString(),state=randomString();sessionStorage.setItem('litmerk_pkce',verifier);sessionStorage.setItem('litmerk_state',state);
 const challenge=b64url(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
 const u=new URL(authority+'/authorize');Object.entries({client_id:clientId,response_type:'code',redirect_uri:redirect,response_mode:'query',scope,code_challenge:challenge,code_challenge_method:'S256',state}).forEach(([k,v])=>u.searchParams.set(k,v));
 location.assign(u.href);
}
async function handleReturn(){
 const q=new URLSearchParams(location.search);
 if(q.has('error')){history.replaceState(null,'',redirect);throw new Error(q.get('error_description')||q.get('error'))}
 if(q.has('code')){
  const expected=sessionStorage.getItem('litmerk_state'),verifier=sessionStorage.getItem('litmerk_pkce');
  if(!expected||q.get('state')!==expected||!verifier)throw new Error('Varnostna preverba prijave ni uspela.');
  sessionStorage.removeItem('litmerk_state');sessionStorage.removeItem('litmerk_pkce');
  history.replaceState(null,'',redirect);
  await exchange({grant_type:'authorization_code',code:q.get('code'),code_verifier:verifier,redirect_uri:redirect});
 }else{
  refreshToken=localStorage.getItem('litmerk_refresh')||null;
  if(refreshToken){try{await renew()}catch(e){refreshToken=null;localStorage.removeItem('litmerk_refresh');authStatus('Potrebna prijava')}}
 }
}
async function exchange(params){
 const body=new URLSearchParams(Object.assign({client_id:clientId,scope},params));
 const r=await fetch(authority+'/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
 const j=await r.json();if(!r.ok)throw new Error(j.error_description||j.error||'Napaka pri prijavi');
 token=j.access_token;tokenExpiry=Date.now()+(j.expires_in-90)*1000;
 if(j.refresh_token){refreshToken=j.refresh_token;localStorage.setItem('litmerk_refresh',refreshToken)}
 authStatus('OneDrive povezan');$('login').hidden=true;$('logout').hidden=false;
}
async function renew(){if(!refreshToken)throw new Error('Potrebna ponovna prijava');await exchange({grant_type:'refresh_token',refresh_token:refreshToken})}
async function access(){if(!token||Date.now()>tokenExpiry)await renew();return token}
function logout(){token=null;refreshToken=null;localStorage.removeItem('litmerk_refresh');authStatus('Odjavljen');$('login').hidden=false;$('logout').hidden=true;files=[];rows=[];$('year').disabled=true;$('month').disabled=true;status('Odjavljen.');draw();}
async function graph(path){
 let r=await fetch('https://graph.microsoft.com/v1.0'+path,{headers:{Authorization:'Bearer '+await access()}});
 if(r.status===401){await renew();r=await fetch('https://graph.microsoft.com/v1.0'+path,{headers:{Authorization:'Bearer '+await access()}})}
 if(!r.ok){let err;try{err=(await r.json()).error.message}catch{}throw new Error(err||'OneDrive: HTTP '+r.status)}
 return r;
}
const encodedPath=()=>folder.split('/').filter(Boolean).map(encodeURIComponent).join('/');
async function listFiles(){
 if(!clientId){status('Najprej nastavi ID aplikacije.',true);return}
 status('Berem seznam mesecev iz OneDrive ...');files=[];
 try{
 let next='/me/drive/root:/'+encodedPath()+':/children?$select=id,name,file&$top=200';
 while(next){const j=await(await graph(next)).json();for(const f of j.value||[]){const m=/^(\d{2})_(\d{1,2})TEM\.TXT$/i.exec(f.name);if(m&&f.file){const mm=+m[2];if(mm>=1&&mm<=12)files.push({year:2000+(+m[1]),month:mm,id:f.id,name:f.name})}}next=j['@odata.nextLink']||null;if(next)next=next.replace('https://graph.microsoft.com/v1.0','')}
 files.sort((a,b)=>a.year-b.year||a.month-b.month);
 const y=$('year');y.innerHTML='';[...new Set(files.map(f=>f.year))].forEach(n=>y.add(new Option(n,n)));
 if(!files.length){status('V mapi ni datotek oblike 26_8TEM.TXT.',true);return}
 y.disabled=false;y.value=String(files[files.length-1].year);fillMonths();
 }catch(e){authStatus('Napaka povezave');status('Ne morem prebrati mape: '+e.message,true)}
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
 year=+$('year').value;month=+$('month').value;const f=files.find(x=>x.year===year&&x.month===month);if(!f)return;
 status('Nalagam '+f.name+' ...');
 try{
 const metadata=await(await graph('/me/drive/items/'+encodeURIComponent(f.id))).json();
 const downloadUrl=metadata['@microsoft.graph.downloadUrl'];
 if(!downloadUrl)throw new Error('OneDrive ni vrnil povezave za prenos datoteke.');
 const r=await fetch(downloadUrl);if(!r.ok)throw new Error('Prenos datoteke: HTTP '+r.status);
 const bytes=await r.arrayBuffer();let txt=new TextDecoder('utf-8').decode(bytes);if(txt.includes('\uFFFD'))txt=new TextDecoder('windows-1250').decode(bytes);
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
 ctx.clearRect(0,0,w,h);if(!rows.length){ctx.fillStyle='#6b7890';ctx.textAlign='center';ctx.fillText('Poveži OneDrive in izberi mesec',w/2,h/2);return}
 let lo=Infinity,hi=-Infinity;for(const row of rows)for(const s of sensors)for(const k of [s[2],s[3]])if(row[k]!==null){lo=Math.min(lo,row[k]);hi=Math.max(hi,row[k])}if(!Number.isFinite(lo)){lo=0;hi=40}lo=Math.floor(lo-1);hi=Math.ceil(hi+1);if(hi===lo)hi=lo+1;
 const days=new Date(year,month,0).getDate(),px=day=>L+(day-1)/(days-1)*pw,py=v=>T+(hi-v)/(hi-lo)*ph;
 ctx.font='12px system-ui';ctx.lineWidth=1;ctx.textAlign='right';for(let i=0;i<=5;i++){const v=lo+(hi-lo)*i/5,y=py(v);ctx.strokeStyle='#e4eaf2';ctx.beginPath();ctx.moveTo(L,y);ctx.lineTo(w-R,y);ctx.stroke();ctx.fillStyle='#53657b';ctx.fillText(v.toFixed(0)+'°',L-6,y+4)}
 ctx.textAlign='center';const stride=w<440?5:w<800?3:2;for(let d=1;d<=days;d++)if(d===1||d===days||d%stride===0){const x=px(d);ctx.fillStyle='#69788c';ctx.fillText(d+'.',x,h-10)}
 for(const s of sensors)for(let k=2;k<=3;k++){ctx.strokeStyle=s[4];ctx.lineWidth=k===3?2:1.4;ctx.setLineDash(k===2?[5,4]:[]);ctx.beginPath();let start=true;for(const row of rows){const v=row[s[k]];if(v===null)continue;if(start){ctx.moveTo(px(row.Day),py(v));start=false}else ctx.lineTo(px(row.Day),py(v))}ctx.stroke();ctx.setLineDash([])}
 ctx.strokeStyle='#46576b';ctx.lineWidth=1;const x=px(selectedDay);ctx.beginPath();ctx.moveTo(x,T);ctx.lineTo(x,h-B);ctx.stroke();
}
window.addEventListener('DOMContentLoaded',init);
