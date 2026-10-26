import {db,configured,$,assertOk} from './client.js';

const caption=$('#liveCaption');
const main=$('#liveName');
const prize=$('#livePrize');
const status=$('#liveStatus');
const LIVE_BACKGROUND_BUCKET='live-backgrounds';
const DEFAULT_COPY={
  live_caption_template:'LUCKY DRAW',
  live_prize_template:'รางวัล {prize}',
  live_winner_template:'{full_name}',
  live_status_template:'🎉 ขอแสดงความยินดี {full_name} ที่ได้รับ {prize}'
};
const DEFAULT_COLORS={
  live_accent_color:'#f3c66a',live_badge_color:'#f3c66a',live_prize_color:'#fff3dc',
  live_frame_color:'#d0a34f',live_winner_color:'#fff0c9',live_status_color:'#f0ddd0',live_frame_background:'#220b0f'
};
let liveSettings={...DEFAULT_COPY,...DEFAULT_COLORS,live_background_path:null};
let lastEventId=null;
let lastEventTime=0;
let lastEventData=null;
let eventQueue=Promise.resolve();
let playing=false;
let liveOwner=null;

function cleanColor(value,fallback){return typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value.trim())?value.trim().toLowerCase():fallback}
function normalizeSettings(value){
  const x=value||{};
  return {
    live_caption_template:typeof x.live_caption_template==='string'&&x.live_caption_template.trim()?x.live_caption_template:DEFAULT_COPY.live_caption_template,
    live_prize_template:typeof x.live_prize_template==='string'&&x.live_prize_template.trim()?x.live_prize_template:DEFAULT_COPY.live_prize_template,
    live_winner_template:typeof x.live_winner_template==='string'&&x.live_winner_template.trim()?x.live_winner_template:DEFAULT_COPY.live_winner_template,
    live_status_template:typeof x.live_status_template==='string'&&x.live_status_template.trim()?x.live_status_template:DEFAULT_COPY.live_status_template,
    live_accent_color:cleanColor(x.live_accent_color,DEFAULT_COLORS.live_accent_color),
    live_badge_color:cleanColor(x.live_badge_color,DEFAULT_COLORS.live_badge_color),
    live_prize_color:cleanColor(x.live_prize_color,DEFAULT_COLORS.live_prize_color),
    live_frame_color:cleanColor(x.live_frame_color,DEFAULT_COLORS.live_frame_color),
    live_winner_color:cleanColor(x.live_winner_color,DEFAULT_COLORS.live_winner_color),
    live_status_color:cleanColor(x.live_status_color,DEFAULT_COLORS.live_status_color),
    live_frame_background:cleanColor(x.live_frame_background,DEFAULT_COLORS.live_frame_background),
    live_background_path:typeof x.live_background_path==='string'&&x.live_background_path.trim()?x.live_background_path.trim():null
  };
}
function templateData(event={}){
  const person=event.participant||{};
  return {
    prize:event.prize_name||'—',
    full_name:[person.first_name,person.last_name].filter(Boolean).join(' ').trim()||'—',
    staff_code:person.staff_code||'—',first_name:person.first_name||'—',last_name:person.last_name||'—',
    department:person.department||'—',email:person.email||'—',phone:person.phone||'—',
    ...(person.extra||{})
  };
}
function applyTemplate(template,event){
  const data=templateData(event);
  return String(template||'').replace(/\{([a-z][a-z0-9_]*)\}/gi,(token,key)=>Object.prototype.hasOwnProperty.call(data,key)?String(data[key]??'—')||'—':token);
}
function publicBackgroundUrl(path){return path?db.storage.from(LIVE_BACKGROUND_BUCKET).getPublicUrl(path).data.publicUrl:null}
function applyColors(){
  const root=document.body;
  for(const key of Object.keys(DEFAULT_COLORS))root.style.setProperty(`--${key.replace(/_/g,'-')}`,liveSettings[key]);
}
function applyBackground(path){
  const url=publicBackgroundUrl(path);
  document.body.classList.toggle('has-custom-background',!!url);
  document.body.style.backgroundImage=url?`linear-gradient(#0805095c,#0805095c), url("${String(url).replace(/"/g,'%22')}")`:'';
}
function renderEvent(event){
  caption.textContent=applyTemplate(liveSettings.live_caption_template,event);
  prize.textContent=applyTemplate(liveSettings.live_prize_template,event);
  main.textContent=applyTemplate(liveSettings.live_winner_template,event);
  status.textContent=applyTemplate(liveSettings.live_status_template,event);
}
function renderIdle(){
  caption.textContent=liveSettings.live_caption_template.replace(/\{[^}]+\}/g,'').trim()||'LUCKY DRAW';
  prize.textContent='พร้อมเริ่มการจับรางวัล';
  main.textContent='✦ GOOD LUCK ✦';
  status.textContent='กำลังรอผู้ควบคุมกดสุ่มจาก Dashboard';
}
async function syncLiveSettings(){
  if(!liveOwner)return;
  const response=await db.from('event_settings').select('*').eq('owner_id',liveOwner).maybeSingle();
  if(response.error){console.warn('Live settings sync:',response.error.message);return}
  const next=normalizeSettings(response.data);
  const changed=JSON.stringify(next)!==JSON.stringify(liveSettings);
  liveSettings=next;
  applyBackground(liveSettings.live_background_path);
  applyColors();
  if(changed&&!playing){if(lastEventData)renderEvent(lastEventData);else renderIdle()}
}

const canvas=$('#confetti');
const ctx=canvas.getContext('2d');
let flakes=[],frame=0;
function fireworks(){
  canvas.width=innerWidth;canvas.height=innerHeight;
  const colors=['#ffd56a','#fff5d5','#ff6b6b','#f4a7c5','#ffffff'];
  flakes=Array.from({length:240},()=>({x:canvas.width/2,y:canvas.height*.45,vx:(Math.random()-.5)*20,vy:(Math.random()-.85)*20,g:.15+Math.random()*.14,r:2+Math.random()*5,color:colors[Math.floor(Math.random()*colors.length)],life:100+Math.random()*60}));
  frame=0;
  function step(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    for(const f of flakes){f.x+=f.vx;f.y+=f.vy;f.vy+=f.g;f.life--;ctx.fillStyle=f.color;ctx.fillRect(f.x,f.y,f.r,f.r*1.6)}
    flakes=flakes.filter(f=>f.life>0);
    if(flakes.length&&frame++<170)requestAnimationFrame(step);
    else ctx.clearRect(0,0,canvas.width,canvas.height);
  }
  requestAnimationFrame(step);
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function play(event){
  playing=true;
  try{
    caption.textContent=applyTemplate(liveSettings.live_caption_template,event);
    prize.textContent=applyTemplate(liveSettings.live_prize_template,event);
    status.textContent='กำลังสุ่มผู้โชคดี...';
    main.classList.add('spinning');
    const {data}=await db.from('participants').select('first_name,last_name').limit(150);
    const pool=data?.length?data.map(x=>[x.first_name,x.last_name].filter(Boolean).join(' ')):['GOOD LUCK','LUCKY DRAW'];
    let elapsed=0;
    while(elapsed<3600){
      main.textContent=pool[Math.floor(Math.random()*pool.length)];
      const delay=elapsed<2400?55:Math.min(330,55+(elapsed-2400)/5);
      await sleep(delay);elapsed+=delay;
    }
    renderEvent(event);fireworks();
  }finally{playing=false;main.classList.remove('spinning')}
}
function setCurrentEvent(event,animate){
  if(!event||event.id===lastEventId)return;
  const eventTime=new Date(event.created_at||0).getTime();
  if(eventTime&&eventTime<lastEventTime)return;
  lastEventId=event.id;lastEventTime=Math.max(lastEventTime,eventTime);lastEventData=event;
  if(animate){
    eventQueue=eventQueue.then(()=>play(event)).catch(error=>{
      console.error('Live animation error:',error);status.textContent='การแสดงผลขัดข้อง กรุณารีเฟรชหน้า Live';main.classList.remove('spinning');
    });
  }else renderEvent(event);
}
async function fetchLatest(initial=false){
  const response=await db.from('live_events').select('id,created_at,prize_name,participant,display_fields').eq('owner_id',liveOwner).order('created_at',{ascending:false}).limit(1);
  const events=assertOk(response);
  if(!events.length){
    if(!playing){lastEventId=null;lastEventTime=0;lastEventData=null;renderIdle()}
    return;
  }
  setCurrentEvent(events[0],!initial);
}
async function start(){
  if(!configured){$('#liveLogin').hidden=false;$('#liveLogin').textContent='กรุณาตั้งค่า js/config.js ก่อน';return}
  const {data:{session}}=await db.auth.getSession();
  if(!session){$('#liveLogin').hidden=false;return}
  liveOwner=session.user.id;
  await syncLiveSettings();
  await fetchLatest(true);
  db.channel('eventdraw-live-'+liveOwner)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'live_events',filter:'owner_id=eq.'+liveOwner},payload=>setCurrentEvent(payload.new,true))
    .subscribe(state=>{if(state==='CHANNEL_ERROR')status.textContent='Realtime ขัดข้อง กำลังตรวจผลผ่านระบบสำรอง...'});
  setInterval(()=>fetchLatest().catch(error=>console.error('Live sync:',error)),2500);
  setInterval(()=>syncLiveSettings().catch(error=>console.error('Live settings sync:',error)),3000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){fetchLatest().catch(console.error);syncLiveSettings().catch(console.error)}});
}
start().catch(error=>{$('#liveLogin').hidden=false;$('#liveLogin').textContent=error.message});
