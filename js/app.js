import { db,configured,$,$$,esc,dateStr,assertOk } from './client.js';
import { buildWinnerRows, winnersCsv } from './winners.js';
const S={user:null,people:[],prizes:[],fields:[],draws:[],logs:[],sheet:[],columns:[],editField:null,peopleColumns:null};
const msg=(t)=>{const el=$('#toast');el.textContent=t;el.style.display='block';clearTimeout(msg.timer);msg.timer=setTimeout(()=>el.style.display='none',4200)};
const run=async(fn)=>{try{await fn()}catch(e){console.error(e);msg('เกิดข้อผิดพลาด: '+e.message)}};
const UI_THEME_KEY='eventdraw_ui_theme';
function currentUiTheme(){return document.documentElement.dataset.theme==='light'?'light':'dark'}
function applyUiTheme(theme,persist=true){
  const next=theme==='light'?'light':'dark';
  if(next==='light')document.documentElement.dataset.theme='light';else delete document.documentElement.dataset.theme;
  const btn=$('#themeToggle');
  if(btn){const light=next==='light';btn.querySelector('span').textContent=light?'☀️':'🌙';btn.setAttribute('aria-label',light?'เปลี่ยนเป็นโหมดมืด':'เปลี่ยนเป็นโหมดสว่าง');btn.title=light?'เปลี่ยนเป็นโหมดมืด':'เปลี่ยนเป็นโหมดสว่าง'}
  if(persist){try{localStorage.setItem(UI_THEME_KEY,next)}catch{}}
}

const getAll=async(table,order='created_at')=>{let rows=[],start=0;for(;;){const x=assertOk(await db.from(table).select('*').order(order,{ascending:false}).range(start,start+999));rows.push(...x);if(x.length<1000)break;start+=1000;}return rows};
const keyLabel={staff_code:'รหัสประจำตัว',first_name:'ชื่อ',last_name:'นามสกุล',department:'แผนก'};
// Preferences are saved per authenticated owner in Supabase (event_settings).
// The local copy is only a recovery journal if a page refresh interrupts a save.
const DEFAULT_FIELDS=['first_name','last_name'];
const LIVE_BACKGROUND_BUCKET='live-backgrounds';
const DEFAULT_LIVE_COPY={
  live_caption_template:'LUCKY DRAW',
  live_prize_template:'รางวัล {prize}',
  live_winner_template:'{full_name}',
  live_status_template:'🎉 ขอแสดงความยินดี {full_name} ที่ได้รับ {prize}'
};
const DEFAULT_LIVE_COLORS={
  live_accent_color:'#f3c66a',
  live_badge_color:'#f3c66a',
  live_prize_color:'#fff3dc',
  live_frame_color:'#d0a34f',
  live_winner_color:'#fff0c9',
  live_status_color:'#f0ddd0',
  live_frame_background:'#220b0f'
};
const defaultSettings=()=>({
  display_fields:[...DEFAULT_FIELDS],selected_prize_id:null,allow_repeat:false,
  ...DEFAULT_LIVE_COPY,...DEFAULT_LIVE_COLORS,live_background_path:null
});
S.settings=defaultSettings();
let settingsSave=Promise.resolve(true),settingsRevision=0;
let pendingBackgroundFile=null,pendingRemoveBackground=false,previewObjectUrl=null,lastTemplateInput=null;
const cacheKey=()=>`eventdraw_settings_v150_${S.user?.id||'guest'}`;
const previousCacheKey=()=>`eventdraw_settings_v140_${S.user?.id||'guest'}`;
const legacyCacheKey=()=>`eventdraw_settings_v132_${S.user?.id||'guest'}`;
const legacyFieldKey=()=>`eventdraw_live_fields_${S.user?.id||'guest'}`;
function readCache(){
  try{return JSON.parse(localStorage.getItem(cacheKey())||localStorage.getItem(previousCacheKey())||localStorage.getItem(legacyCacheKey())||'null')}catch{return null}
}
function writeCache(pending){try{localStorage.setItem(cacheKey(),JSON.stringify({settings:S.settings,pending}))}catch{}}
function cleanTemplate(value,fallback,max){const text=typeof value==='string'?value.trim():'';return (text||fallback).slice(0,max)}
function cleanColor(value,fallback){const text=typeof value==='string'?value.trim():'';return /^#[0-9a-f]{6}$/i.test(text)?text.toLowerCase():fallback}
function normalizeSettings(x){
  const a=x||{};
  const fields=Array.isArray(a.display_fields)?a.display_fields.filter(k=>typeof k==='string'):DEFAULT_FIELDS;
  return {
    display_fields:[...new Set(fields.length?fields:DEFAULT_FIELDS)],
    selected_prize_id:typeof a.selected_prize_id==='string'?a.selected_prize_id:null,
    allow_repeat:!!a.allow_repeat,
    live_caption_template:cleanTemplate(a.live_caption_template,DEFAULT_LIVE_COPY.live_caption_template,160),
    live_prize_template:cleanTemplate(a.live_prize_template,DEFAULT_LIVE_COPY.live_prize_template,200),
    live_winner_template:cleanTemplate(a.live_winner_template,DEFAULT_LIVE_COPY.live_winner_template,240),
    live_status_template:cleanTemplate(a.live_status_template,DEFAULT_LIVE_COPY.live_status_template,320),
    live_accent_color:cleanColor(a.live_accent_color,DEFAULT_LIVE_COLORS.live_accent_color),
    live_badge_color:cleanColor(a.live_badge_color,DEFAULT_LIVE_COLORS.live_badge_color),
    live_prize_color:cleanColor(a.live_prize_color,DEFAULT_LIVE_COLORS.live_prize_color),
    live_frame_color:cleanColor(a.live_frame_color,DEFAULT_LIVE_COLORS.live_frame_color),
    live_winner_color:cleanColor(a.live_winner_color,DEFAULT_LIVE_COLORS.live_winner_color),
    live_status_color:cleanColor(a.live_status_color,DEFAULT_LIVE_COLORS.live_status_color),
    live_frame_background:cleanColor(a.live_frame_background,DEFAULT_LIVE_COLORS.live_frame_background),
    live_background_path:typeof a.live_background_path==='string'&&a.live_background_path.trim()?a.live_background_path.trim():null
  };
}
function settingsMessage(t,error=false){const el=$('#liveSaveStatus');el.textContent=t;el.classList.toggle('save-error',error)}
async function loadSettings(){
  const local=readCache();
  // select('*') keeps old V1.3.x databases readable before the V1.4 migration is applied.
  const result=await db.from('event_settings').select('*').eq('owner_id',S.user.id).maybeSingle();
  assertOk(result);
  let restored=result.data;
  if(local?.pending && local.settings){
    restored=normalizeSettings(local.settings);
    const upsert=await db.from('event_settings').upsert({owner_id:S.user.id,...restored},{onConflict:'owner_id'});
    if(upsert.error)console.warn('Recover Event Settings:',upsert.error.message);
  } else if(!restored){
    let previous=null;
    try{previous=JSON.parse(localStorage.getItem(legacyFieldKey())||'null')}catch{}
    restored={...defaultSettings(),display_fields:Array.isArray(previous)&&previous.length?previous:DEFAULT_FIELDS};
    const upsert=await db.from('event_settings').upsert({owner_id:S.user.id,...restored},{onConflict:'owner_id'});
    if(upsert.error&&/live_caption_template|live_background_path|live_accent_color|live_frame_color|column/i.test(upsert.error.message||'')){
      console.warn('V1.5 migration required:',upsert.error.message);
    }else assertOk(upsert);
  }
  S.settings=normalizeSettings(restored);
  writeCache(false);
  settingsMessage('✓ โหลดการตั้งค่า Live Screen แล้ว');
}
function rememberSettings(){
  const snapshot=normalizeSettings(S.settings);
  writeCache(true);
  const revision=++settingsRevision;
  settingsMessage('กำลังบันทึกการตั้งค่า...');
  settingsSave=settingsSave.catch(()=>false).then(async()=>{
    const r=await db.from('event_settings').upsert({owner_id:S.user.id,...snapshot,updated_at:new Date().toISOString()},{onConflict:'owner_id'});
    if(r.error){
      const migration=/live_caption_template|live_prize_template|live_winner_template|live_status_template|live_background_path|live_accent_color|live_frame_color|column/i.test(r.error.message||'');
      if(revision===settingsRevision)settingsMessage(migration?'บันทึกไม่ได้: กรุณารัน sql/upgrade_v1_5.sql ใน Supabase ก่อน':'บันทึกไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อ',true);
      console.error('Save Event Settings:',r.error);
      return false;
    }
    if(revision===settingsRevision){writeCache(false);settingsMessage('✓ บันทึกการตั้งค่า Live Screen แล้ว')}
    return true;
  });
  return settingsSave;
}
function renderLiveSettingsSummary(){
  $('#liveBackgroundSummary').textContent=S.settings.live_background_path?'พื้นหลัง: รูปภาพที่อัปโหลดเอง':'พื้นหลัง: เวทีม่านแดง (ค่าเริ่มต้น)';
}
$('#drawPrize').addEventListener('change',()=>{S.settings.selected_prize_id=$('#drawPrize').value||null;rememberSettings()});
$('#allowRepeat').addEventListener('change',()=>{S.settings.allow_repeat=$('#allowRepeat').checked;rememberSettings()});
const allFields=()=>[...Object.entries(keyLabel).map(([key,label])=>({field_key:key,label})),...S.fields];
const PEOPLE_STATUS_KEY='__status';
const peoplePrefsKey=()=>`eventdraw_people_table_v170_${S.user?.id||'guest'}`;
const legacyPeoplePrefsKey=()=>`eventdraw_people_table_v160_${S.user?.id||'guest'}`;
const peopleFieldCatalog=()=>[...Object.entries(keyLabel).map(([field_key,label])=>({field_key,label,field_type:'text',builtin:true})),...S.fields.map(f=>({...f,builtin:false})),{field_key:PEOPLE_STATUS_KEY,label:'สถานะ',field_type:'status',builtin:true}];
const defaultPeopleColumns=()=>[...Object.keys(keyLabel),...S.fields.filter(f=>f.show_table).map(f=>f.field_key),PEOPLE_STATUS_KEY];
function normalizePeopleColumns(columns){
  const valid=new Set(peopleFieldCatalog().map(f=>f.field_key));
  const list=Array.isArray(columns)?columns.filter(k=>valid.has(k)):[];
  return [...new Set(list.length?list:defaultPeopleColumns())];
}
function loadPeoplePrefs(){
  let saved=null;try{saved=JSON.parse(localStorage.getItem(peoplePrefsKey())||localStorage.getItem(legacyPeoplePrefsKey())||'null')}catch{}
  S.peopleColumns=normalizePeopleColumns(saved?.columns);
  savePeoplePrefs();
}
function savePeoplePrefs(){try{localStorage.setItem(peoplePrefsKey(),JSON.stringify({columns:normalizePeopleColumns(S.peopleColumns)}))}catch{}}
function reconcilePeoplePrefs(){
  if(!S.peopleColumns){loadPeoplePrefs();return}
  S.peopleColumns=normalizePeopleColumns(S.peopleColumns);savePeoplePrefs();
}
function peopleField(key){return peopleFieldCatalog().find(f=>f.field_key===key)}
function peopleValue(person,key,awarded){
  if(key===PEOPLE_STATUS_KEY)return awarded.has(person.id)?'ได้รางวัลแล้ว':'รอลุ้น';
  if(Object.prototype.hasOwnProperty.call(keyLabel,key))return person[key]??'';
  return person.extra?.[key]??'';
}
function filterPeople(){
  const q=$('#searchPeople').value.trim().toLocaleLowerCase();
  return S.people.filter(p=>!q||JSON.stringify(p).toLocaleLowerCase().includes(q));
}
function selectFields(){return allFields().map(f=>`<option value="${esc(f.field_key)}">${esc(f.label)}</option>`).join('')}
function templateData(person={},prizeName='ของรางวัลตัวอย่าง'){
  const fullName=[person.first_name,person.last_name].filter(Boolean).join(' ').trim();
  return {
    prize:prizeName||'ของรางวัลตัวอย่าง',full_name:fullName||'สมชาย ใจดี',
    staff_code:person.staff_code||'A001',first_name:person.first_name||'สมชาย',last_name:person.last_name||'ใจดี',
    department:person.department||'ฝ่ายกิจกรรม',email:person.email||'example@email.com',phone:person.phone||'0812345678',
    ...(person.extra||{})
  };
}
function applyTemplate(template,data){
  return String(template||'').replace(/\{([a-z][a-z0-9_]*)\}/gi,(token,key)=>Object.prototype.hasOwnProperty.call(data,key)?String(data[key]??'—')||'—':token);
}
function liveVariableItems(){
  const base=[
    ['prize','ของรางวัล'],['full_name','ชื่อ-นามสกุล'],['staff_code','รหัสประจำตัว'],['first_name','ชื่อ'],['last_name','นามสกุล'],['department','แผนก'],['email','อีเมล'],['phone','เบอร์โทร']
  ];
  const custom=S.fields.map(f=>[f.field_key,f.label]);
  return [...base,...custom.filter(([key])=>!base.some(([baseKey])=>baseKey===key))];
}
function liveTemplateInputs(){return ['#liveCaptionTemplate','#livePrizeTemplate','#liveWinnerTemplate','#liveStatusTemplate'].map(id=>$(id))}
const LIVE_COLOR_INPUTS={
  live_accent_color:'#liveAccentColor',live_badge_color:'#liveBadgeColor',live_prize_color:'#livePrizeColor',
  live_frame_color:'#liveFrameColor',live_winner_color:'#liveWinnerColor',live_status_color:'#liveStatusColor',live_frame_background:'#liveFrameBackground'
};
function applyPreviewColors(){
  const preview=$('#livePreview');
  for(const [key,selector] of Object.entries(LIVE_COLOR_INPUTS))preview.style.setProperty(`--${key.replace(/_/g,'-')}`,$(selector).value||DEFAULT_LIVE_COLORS[key]);
}
function loadColorInputs(colors=S.settings){for(const [key,selector] of Object.entries(LIVE_COLOR_INPUTS))$(selector).value=cleanColor(colors[key],DEFAULT_LIVE_COLORS[key]);applyPreviewColors()}
function publicBackgroundUrl(path){return path?db.storage.from(LIVE_BACKGROUND_BUCKET).getPublicUrl(path).data.publicUrl:null}
function setPreviewBackground(url){
  const preview=$('#livePreview');
  preview.classList.toggle('has-custom-background',!!url);
  preview.style.backgroundImage=url?`linear-gradient(#09070ba8,#09070b66), url("${String(url).replace(/"/g,'%22')}")`:'';
}
function updateLivePreview(){
  applyPreviewColors();
  const person=S.people[0]||{};
  const prizeName=S.prizes.find(p=>p.id===$('#drawPrize').value)?.name||S.prizes[0]?.name||'รางวัลใหญ่';
  const data=templateData(person,prizeName);
  $('#previewCaption').textContent=applyTemplate($('#liveCaptionTemplate').value,data);
  $('#previewPrize').textContent=applyTemplate($('#livePrizeTemplate').value,data);
  $('#previewWinner').textContent=applyTemplate($('#liveWinnerTemplate').value,data);
  $('#previewStatus').textContent=applyTemplate($('#liveStatusTemplate').value,data);
}
function renderVariableChips(){
  $('#liveVariableChips').innerHTML=liveVariableItems().map(([key,label])=>`<button type="button" class="variable-chip" data-variable="${esc(key)}"><span>${esc(label)}</span><code>{${esc(key)}}</code></button>`).join('');
}
function resetPendingBackground(){
  pendingBackgroundFile=null;pendingRemoveBackground=false;$('#liveBackgroundFile').value='';$('#liveBackgroundFileName').textContent='ยังไม่ได้เลือกไฟล์ใหม่';
  if(previewObjectUrl){URL.revokeObjectURL(previewObjectUrl);previewObjectUrl=null}
}
function openLiveSettings(){
  resetPendingBackground();
  $('#liveCaptionTemplate').value=S.settings.live_caption_template;
  $('#livePrizeTemplate').value=S.settings.live_prize_template;
  $('#liveWinnerTemplate').value=S.settings.live_winner_template;
  $('#liveStatusTemplate').value=S.settings.live_status_template;
  loadColorInputs();
  renderVariableChips();
  setPreviewBackground(publicBackgroundUrl(S.settings.live_background_path));
  updateLivePreview();
  lastTemplateInput=$('#liveWinnerTemplate');
  $('#liveSettingsDialog').showModal();
}
function closeLiveSettings(){resetPendingBackground();$('#liveSettingsDialog').close()}
function participantTemplateKeys(){
  const participantKeys=new Set(['staff_code','first_name','last_name','department','email','phone',...S.fields.map(f=>f.field_key)]);
  const templates=[$('#liveCaptionTemplate').value,$('#livePrizeTemplate').value,$('#liveWinnerTemplate').value,$('#liveStatusTemplate').value].join(' ');
  const found=[...templates.matchAll(/\{([a-z][a-z0-9_]*)\}/gi)].map(m=>m[1]).filter(k=>participantKeys.has(k));
  if(/\{full_name\}/i.test(templates))found.push('first_name','last_name');
  return [...new Set(found.length?found:DEFAULT_FIELDS)];
}
$('#openLiveSettings').addEventListener('click',openLiveSettings);
$('#closeLiveSettings').addEventListener('click',closeLiveSettings);
$('#cancelLiveSettings').addEventListener('click',closeLiveSettings);
for(const input of liveTemplateInputs()){
  input.addEventListener('focus',()=>{lastTemplateInput=input});
  input.addEventListener('input',updateLivePreview);
}
for(const selector of Object.values(LIVE_COLOR_INPUTS))$(selector).addEventListener('input',updateLivePreview);
$('#resetLiveColors').addEventListener('click',()=>{loadColorInputs(DEFAULT_LIVE_COLORS);updateLivePreview()});
$('#liveVariableChips').addEventListener('click',event=>{
  const button=event.target.closest('[data-variable]');if(!button)return;
  const input=lastTemplateInput||$('#liveWinnerTemplate');
  const token=`{${button.dataset.variable}}`,start=input.selectionStart??input.value.length,end=input.selectionEnd??input.value.length;
  input.setRangeText(token,start,end,'end');input.focus();updateLivePreview();
});
$('#liveBackgroundFile').addEventListener('change',event=>{
  const file=event.target.files?.[0];if(!file)return;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)){event.target.value='';return msg('รองรับเฉพาะ JPG, PNG และ WebP')}
  if(file.size>8*1024*1024){event.target.value='';return msg('รูปพื้นหลังต้องมีขนาดไม่เกิน 8 MB')}
  if(previewObjectUrl)URL.revokeObjectURL(previewObjectUrl);
  previewObjectUrl=URL.createObjectURL(file);pendingBackgroundFile=file;pendingRemoveBackground=false;
  $('#liveBackgroundFileName').textContent=`ไฟล์ใหม่: ${file.name}`;setPreviewBackground(previewObjectUrl);updateLivePreview();
});
$('#removeLiveBackground').addEventListener('click',()=>{
  if(previewObjectUrl){URL.revokeObjectURL(previewObjectUrl);previewObjectUrl=null}
  pendingBackgroundFile=null;pendingRemoveBackground=true;$('#liveBackgroundFile').value='';$('#liveBackgroundFileName').textContent='จะเปลี่ยนกลับเป็นภาพพื้นหลังค่าเริ่มต้น';setPreviewBackground(null);updateLivePreview();
});
$('#liveSettingsForm').addEventListener('submit',event=>{event.preventDefault();run(async()=>{
  const saveBtn=$('#saveLiveSettings');saveBtn.disabled=true;
  const oldPath=S.settings.live_background_path;
  let newPath=oldPath,uploadedPath=null;
  try{
    if(pendingBackgroundFile){
      const ext=({"image/jpeg":"jpg","image/png":"png","image/webp":"webp"})[pendingBackgroundFile.type]||'jpg';
      uploadedPath=`${S.user.id}/background-${Date.now()}.${ext}`;
      const upload=await db.storage.from(LIVE_BACKGROUND_BUCKET).upload(uploadedPath,pendingBackgroundFile,{cacheControl:'3600',upsert:false,contentType:pendingBackgroundFile.type});
      if(upload.error){
        if(/bucket|not found/i.test(upload.error.message||''))throw Error('ยังไม่มี Storage bucket สำหรับ Live Screen กรุณารัน sql/upgrade_v1_5.sql ก่อน');
        throw upload.error;
      }
      newPath=uploadedPath;
    }else if(pendingRemoveBackground)newPath=null;
    const next=normalizeSettings({...S.settings,
      live_caption_template:$('#liveCaptionTemplate').value,
      live_prize_template:$('#livePrizeTemplate').value,
      live_winner_template:$('#liveWinnerTemplate').value,
      live_status_template:$('#liveStatusTemplate').value,
      live_accent_color:$('#liveAccentColor').value,
      live_badge_color:$('#liveBadgeColor').value,
      live_prize_color:$('#livePrizeColor').value,
      live_frame_color:$('#liveFrameColor').value,
      live_winner_color:$('#liveWinnerColor').value,
      live_status_color:$('#liveStatusColor').value,
      live_frame_background:$('#liveFrameBackground').value,
      live_background_path:newPath,
      display_fields:participantTemplateKeys()
    });
    S.settings=next;
    const saved=await rememberSettings();
    if(!saved){if(uploadedPath)await db.storage.from(LIVE_BACKGROUND_BUCKET).remove([uploadedPath]);throw Error('บันทึกการตั้งค่า Live Screen ไม่สำเร็จ')}
    if(oldPath&&oldPath!==newPath)db.storage.from(LIVE_BACKGROUND_BUCKET).remove([oldPath]).then(({error})=>{if(error)console.warn('Remove old background:',error.message)});
    renderLiveSettingsSummary();closeLiveSettings();msg('บันทึก Live Screen เรียบร้อย');
  }finally{saveBtn.disabled=false}
})});
function refetchUI(){renderDash();renderFields();renderLogs();renderWinners();renderLiveSettingsSummary()}
async function refresh(){[S.people,S.prizes,S.fields,S.draws,S.logs]=await Promise.all(['participants','prizes','custom_fields','draws','activity_logs'].map(t=>getAll(t,t==='custom_fields'?'position':'created_at')));reconcilePeoplePrefs();refetchUI()}
function page(name){$$('.page').forEach(el=>el.hidden=el.id!==name);$$('.nav').forEach(el=>el.classList.toggle('active',el.dataset.page===name));$('#pageTitle').textContent={dashboard:'Dashboard',import:'Import Excel / CSV',fields:'Custom Fields',history:'History & Logs',winners:'ผู้ได้รับรางวัล'}[name]}
function renderDash(){const selectedPrize=S.settings.selected_prize_id;const awarded=new Set(S.draws.map(d=>d.participant_id));const remain=S.prizes.map(p=>({p,left:p.quantity-S.draws.filter(d=>d.prize_id===p.id).length}));$('#statAll').textContent=S.people.length;$('#statWon').textContent=awarded.size;$('#statPrizes').textContent=remain.filter(x=>x.left>0).length;$('#statUnits').textContent=remain.reduce((a,x)=>a+Math.max(0,x.left),0)+' รางวัลที่ยังแจกได้';$('#drawPrize').innerHTML='<option value="">-- เลือกของรางวัล --</option>'+remain.filter(x=>x.left>0).map(({p,left})=>`<option value="${p.id}">${esc(p.name)} (${left} คงเหลือ)</option>`).join('');if([...$('#drawPrize').options].some(x=>x.value===selectedPrize))$('#drawPrize').value=selectedPrize;$('#allowRepeat').checked=S.settings.allow_repeat;$('#drawBtn').disabled=!remain.some(x=>x.left>0)||!S.people.length;
$('#prizeList').innerHTML=remain.length?remain.map(({p,left})=>`<div class="prize-item"><div><strong>${esc(p.name)}</strong><span class="muted">คงเหลือ ${left}/${p.quantity}</span></div><div><button class="secondary" data-prize-edit="${p.id}">แก้ไข</button> <button class="danger" data-prize-del="${p.id}">ลบ</button></div></div>`).join(''):'<p class="muted">ยังไม่มีของรางวัล</p>';
const columns=normalizePeopleColumns(S.peopleColumns).map(peopleField).filter(Boolean);$('#peopleHead').innerHTML='<tr>'+columns.map(f=>`<th>${esc(f.label)}</th>`).join('')+'</tr>';const filtered=filterPeople();$('#peopleBody').innerHTML=filtered.length?filtered.map(p=>`<tr>${columns.map(f=>{if(f.field_key===PEOPLE_STATUS_KEY)return `<td>${awarded.has(p.id)?'<span class="green">✓ ได้รางวัลแล้ว</span>':'<span class="muted">รอลุ้น</span>'}</td>`;const value=peopleValue(p,f.field_key,awarded);return `<td>${esc(value||'—')}</td>`}).join('')}</tr>`).join(''):`<tr><td colspan="${Math.max(1,columns.length)}">ไม่พบรายชื่อ</td></tr>`;
const last=S.draws[0];if(last){const p=S.people.find(x=>x.id===last.participant_id),pr=S.prizes.find(x=>x.id===last.prize_id);$('#latest').innerHTML=`ผู้โชคดีล่าสุด<br><b>${esc(p?.first_name)} ${esc(p?.last_name)}</b><br>${esc(pr?.name)}`;}else $('#latest').textContent='ยังไม่มีผลการสุ่ม';}
function renderFields(){$('#fieldsBody').innerHTML=S.fields.length?S.fields.map(f=>`<tr><td>${esc(f.label)}</td><td>${esc(f.field_key)}</td><td>${esc(f.field_type)}</td><td>${f.required?'✅':'❌'}</td><td>${f.show_form?'✅':'❌'}</td><td>${f.show_table?'✅':'❌'}</td><td>${f.show_live?'✅':'❌'}</td><td>${f.exportable?'✅':'❌'}</td><td><button class="secondary" data-edit-field="${f.id}">แก้ไข</button> <button class="danger" data-del-field="${f.id}">ลบ</button></td></tr>`).join(''):'<tr><td colspan="9">ยังไม่มี Custom Field</td></tr>';}
function filteredWinners() {
  const rows = buildWinnerRows(S.people, S.prizes, S.draws);
  const term = $('#searchWinners').value.trim().toLocaleLowerCase();
  if (!term) return rows;
  return rows.filter(row => [row.staff_code, row.first_name, row.last_name, row.department, ...row.prizes]
    .some(value => String(value).toLocaleLowerCase().includes(term)));
}
function renderWinners() {
  const all = buildWinnerRows(S.people, S.prizes, S.draws);
  const filtered = filteredWinners();
  $('#winnersSummary').textContent = `ผู้ได้รับรางวัลทั้งหมด ${all.length} คน • แสดง ${filtered.length} คน • จับรางวัลไปแล้ว ${S.draws.length} ครั้ง`;
  $('#exportWinnersBtn').disabled = !filtered.length;
  $('#winnersBody').innerHTML = filtered.length ? filtered.map(row => `<tr>
    <td>${esc(row.staff_code || '—')}</td>
    <td>${esc(row.first_name)}</td>
    <td>${esc(row.last_name)}</td>
    <td>${esc(row.department || '—')}</td>
    <td class="winner-prizes">${esc(row.prizes.join(', '))}</td>
    <td>${row.count}</td>
    <td>${esc(dateStr(row.latest_at))}</td>
  </tr>`).join('') : '<tr><td colspan="7" class="muted">ยังไม่มีผู้ได้รับรางวัลที่ตรงกับการค้นหา</td></tr>';
}
$('#searchWinners').addEventListener('input', renderWinners);
$('#exportWinnersBtn').addEventListener('click', () => {
  // Export currently filtered winners, with one row per person (all their prizes comma-separated).
  const rows = filteredWinners();
  if (!rows.length) return msg('ไม่มีรายชื่อผู้ได้รับรางวัลสำหรับ Export');
  const blob = new Blob([winnersCsv(rows)], {type:'text/csv;charset=utf-8;'});
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = `eventdraw-winners-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1200);
  msg(`Export ผู้ได้รับรางวัล ${rows.length} คนสำเร็จ`);
});
function renderLogs(){const filter=$('#logFilter').value;const list=S.logs.filter(x=>filter==='all'||x.action===filter);$('#logsBody').innerHTML=list.length?list.map(x=>`<tr><td>${esc(dateStr(x.created_at))}</td><td>${esc(x.action)}</td><td>${esc(x.detail)}</td><td>${esc(S.user.email)}</td></tr>`).join(''):'<tr><td colspan="4">ไม่มีรายการ</td></tr>';}

let peopleColumnDraft=[],draggedPeopleColumn=null;
function orderedPeopleCatalog(){
  const catalog=peopleFieldCatalog(), map=new Map(catalog.map(f=>[f.field_key,f]));
  const selected=normalizePeopleColumns(S.peopleColumns);
  return [...selected.map(k=>map.get(k)).filter(Boolean),...catalog.filter(f=>!selected.includes(f.field_key))];
}
function openPeopleColumns(){peopleColumnDraft=orderedPeopleCatalog().map((f,i)=>({key:f.field_key,visible:normalizePeopleColumns(S.peopleColumns).includes(f.field_key),order:i}));renderPeopleColumnsDraft();$('#peopleColumnsDialog').showModal()}
function renderPeopleColumnsDraft(){
  const map=new Map(peopleFieldCatalog().map(f=>[f.field_key,f]));
  $('#peopleColumnsList').innerHTML=peopleColumnDraft.map((item,i)=>{const f=map.get(item.key);if(!f)return'';return `<div class="column-order-item" draggable="true" data-column-key="${esc(item.key)}"><span class="drag-handle" title="ลากเพื่อเรียงลำดับ">⋮⋮</span><label><input type="checkbox" data-column-visible="${esc(item.key)}" ${item.visible?'checked':''}> <span>${esc(f.label)}</span></label><code>${esc(item.key===PEOPLE_STATUS_KEY?'status':item.key)}</code><div class="column-move-actions"><button type="button" class="column-move" data-column-up="${esc(item.key)}" ${i===0?'disabled':''}>↑</button><button type="button" class="column-move" data-column-down="${esc(item.key)}" ${i===peopleColumnDraft.length-1?'disabled':''}>↓</button></div></div>`}).join('');
}
function movePeopleColumn(key,delta){const i=peopleColumnDraft.findIndex(x=>x.key===key),j=i+delta;if(i<0||j<0||j>=peopleColumnDraft.length)return;[peopleColumnDraft[i],peopleColumnDraft[j]]=[peopleColumnDraft[j],peopleColumnDraft[i]];renderPeopleColumnsDraft()}
$('#openPeopleColumns').onclick=openPeopleColumns;
$('#closePeopleColumns').onclick=$('#cancelPeopleColumns').onclick=()=>$('#peopleColumnsDialog').close();
$('#peopleColumnsForm').onsubmit=e=>{e.preventDefault();const selected=peopleColumnDraft.filter(x=>x.visible).map(x=>x.key);if(!selected.length){msg('ต้องเลือกอย่างน้อย 1 คอลัมน์');return}S.peopleColumns=selected;savePeoplePrefs();$('#peopleColumnsDialog').close();renderDash();msg('บันทึกลำดับคอลัมน์แล้ว')};
$('#peopleColumnsList').onchange=e=>{const el=e.target.closest('[data-column-visible]');if(!el)return;const item=peopleColumnDraft.find(x=>x.key===el.dataset.columnVisible);if(item)item.visible=el.checked};
$('#peopleColumnsList').onclick=e=>{const up=e.target.closest('[data-column-up]'),down=e.target.closest('[data-column-down]');if(up)movePeopleColumn(up.dataset.columnUp,-1);if(down)movePeopleColumn(down.dataset.columnDown,1)};
$('#peopleColumnsList').addEventListener('dragstart',e=>{const row=e.target.closest('[data-column-key]');if(!row)return;draggedPeopleColumn=row.dataset.columnKey;row.classList.add('dragging');e.dataTransfer.effectAllowed='move'});
$('#peopleColumnsList').addEventListener('dragend',e=>{e.target.closest('[data-column-key]')?.classList.remove('dragging');draggedPeopleColumn=null});
$('#peopleColumnsList').addEventListener('dragover',e=>{e.preventDefault();const target=e.target.closest('[data-column-key]');$$('.column-order-item.drag-over').forEach(x=>x.classList.remove('drag-over'));if(target&&draggedPeopleColumn&&target.dataset.columnKey!==draggedPeopleColumn)target.classList.add('drag-over')});
$('#peopleColumnsList').addEventListener('dragleave',e=>{e.target.closest('[data-column-key]')?.classList.remove('drag-over')});
$('#peopleColumnsList').addEventListener('drop',e=>{e.preventDefault();const target=e.target.closest('[data-column-key]');$$('.column-order-item.drag-over').forEach(x=>x.classList.remove('drag-over'));if(!target||!draggedPeopleColumn||target.dataset.columnKey===draggedPeopleColumn)return;const from=peopleColumnDraft.findIndex(x=>x.key===draggedPeopleColumn),to=peopleColumnDraft.findIndex(x=>x.key===target.dataset.columnKey);if(from<0||to<0)return;const [moved]=peopleColumnDraft.splice(from,1);peopleColumnDraft.splice(to,0,moved);renderPeopleColumnsDraft()});
$('#selectAllPeopleColumns').onclick=()=>{peopleColumnDraft.forEach(x=>x.visible=true);renderPeopleColumnsDraft()};
$('#resetPeopleColumns').onclick=()=>{const defaults=defaultPeopleColumns();const catalog=peopleFieldCatalog();peopleColumnDraft=[...defaults.map(k=>catalog.find(f=>f.field_key===k)).filter(Boolean),...catalog.filter(f=>!defaults.includes(f.field_key))].map((f,i)=>({key:f.field_key,visible:defaults.includes(f.field_key),order:i}));renderPeopleColumnsDraft()};


$('#themeToggle').onclick=()=>applyUiTheme(currentUiTheme()==='dark'?'light':'dark');

async function authInit(){if(!configured){$('#authTitle').textContent='กรุณาตั้งค่า Supabase ก่อน';msg('แก้ไข js/config.js และรัน sql/schema.sql ก่อน');return}const {data:{session}}=await db.auth.getSession();if(session)await signedIn(session.user);db.auth.onAuthStateChange((_event,s)=>{if(!s){S.user=null;$('#auth').hidden=false;$('#app').hidden=true}})}
async function signedIn(user){S.user=user;S.peopleColumns=null;$('#auth').hidden=true;$('#app').hidden=false;$('#account').textContent=user.email;applyUiTheme(currentUiTheme(),false);await loadSettings();await refresh();}
let signup = false;
const confirmPasswordField = $('#confirmPasswordField');
const confirmPasswordInput = $('#authForm').elements.namedItem('confirm_password');
const passwordInput = $('#authForm').elements.namedItem('password');
const passwordVisibility = $('#togglePasswordVisibility');
const confirmVisibility = $('#toggleConfirmVisibility');
const eyeIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>`;
const eyeOffIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 5.2a10.2 10.2 0 0 1 1.4-.1c6.4 0 10 6.9 10 6.9a15.6 15.6 0 0 1-3.7 4.5M6.2 6.2C3.5 8 2 12 2 12s3.6 7 10 7c1.6 0 3-.4 4.2-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>`;
function setPasswordVisibility(input,button,visible,kind){
  input.type=visible?'text':'password';
  button.setAttribute('aria-pressed',String(visible));
  button.setAttribute('aria-label',`${visible?'ซ่อน':'แสดง'}รหัสผ่าน${kind}`);
  button.innerHTML=visible?eyeOffIcon:eyeIcon;
}
function resetPasswordVisibility(){
  setPasswordVisibility(passwordInput,passwordVisibility,false,'');
  setPasswordVisibility(confirmPasswordInput,confirmVisibility,false,'ที่ยืนยัน');
}
passwordVisibility.onclick=()=>setPasswordVisibility(passwordInput,passwordVisibility,passwordInput.type==='password','');
confirmVisibility.onclick=()=>setPasswordVisibility(confirmPasswordInput,confirmVisibility,confirmPasswordInput.type==='password','ที่ยืนยัน');
resetPasswordVisibility();

$('#toggleAuth').onclick = () => {
  signup = !signup;
  $('#authTitle').textContent = signup ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ';
  $('#authSubmit').textContent = signup ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ';
  $('#toggleAuth').textContent = signup ? 'มีบัญชีแล้ว? เข้าสู่ระบบ' : 'ยังไม่มีบัญชี? สมัครสมาชิก';
  confirmPasswordField.hidden = !signup;
  passwordVisibility.hidden = !signup;
  resetPasswordVisibility();
  confirmPasswordInput.disabled = !signup;
  confirmPasswordInput.required = signup;
  passwordInput.autocomplete = signup ? 'new-password' : 'current-password';
  confirmPasswordInput.value = '';
  confirmPasswordInput.setCustomValidity('');
};

confirmPasswordInput.addEventListener('input', () => confirmPasswordInput.setCustomValidity(''));
passwordInput.addEventListener('input', () => confirmPasswordInput.setCustomValidity(''));

$('#authForm').onsubmit = (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const email = form.elements.namedItem('email').value.trim();
  const password = passwordInput.value;
  if (signup && password !== confirmPasswordInput.value) {
    confirmPasswordInput.setCustomValidity('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
    confirmPasswordInput.reportValidity();
    return;
  }
  confirmPasswordInput.setCustomValidity('');
  run(async () => {
    if (!configured) throw Error('ยังไม่ได้ใส่ Supabase URL / Key');
    const r = signup
      ? await db.auth.signUp({ email, password })
      : await db.auth.signInWithPassword({ email, password });
    assertOk(r);
    if (r.data.session) await signedIn(r.data.user);
    else msg('สมัครแล้ว แต่ยังไม่ได้ Session: ปิด Confirm email ใน Supabase Auth settings');
  });
};
$('#logout').onclick=()=>run(async()=>{assertOk(await db.auth.signOut())});$$('.nav').forEach(b=>b.onclick=()=>page(b.dataset.page));$('#openLive').onclick=$('#liveBtn').onclick=()=>window.open('live.html','_blank','noopener');$('#searchPeople').oninput=renderDash;$('#logFilter').onchange=renderLogs;
const prizeDialog=$('#prizeDialog'),prizeForm=$('#prizeForm'),prizeName=$('#prizeName'),prizeQuantity=$('#prizeQuantity');
function openPrizeEditor(prize=null){
  const editing=!!prize;
  const used=editing?S.draws.filter(x=>x.prize_id===prize.id).length:0;
  const minimum=editing?Math.max(1,used):1;
  prizeForm.reset();
  $('#prizeEditId').value=editing?prize.id:'';
  prizeName.value=editing?prize.name:'';
  prizeQuantity.value=editing?prize.quantity:1;
  prizeQuantity.min=String(minimum);
  $('#prizeDialogTitle').textContent=editing?'✎ แก้ไขของรางวัล':'+ เพิ่มของรางวัล';
  $('#prizeDialogSubtitle').textContent=editing?'แก้ไขชื่อและจำนวนของรางวัล แล้วกดบันทึกเพื่อยืนยัน':'กรอกชื่อของรางวัลและจำนวนที่ต้องการใช้ในการสุ่ม';
  $('#savePrize').textContent=editing?'บันทึกการแก้ไข':'เพิ่มของรางวัล';
  const help=$('#prizeQuantityHelp');
  help.classList.toggle('is-warning',editing&&used>0);
  help.textContent=editing&&used>0?`รางวัลนี้แจกไปแล้ว ${used} รางวัล จึงกำหนดจำนวนรวมต่ำกว่า ${minimum} ไม่ได้`:'กำหนดจำนวนรางวัลทั้งหมดที่สามารถแจกได้';
  prizeDialog.showModal();
  requestAnimationFrame(()=>prizeName.focus());
}
function closePrizeEditor(){if(prizeDialog.open)prizeDialog.close()}
$('#openPrizeDialog').onclick=()=>openPrizeEditor();
$('#closePrizeDialog').onclick=$('#cancelPrizeDialog').onclick=closePrizeEditor;
prizeDialog.addEventListener('click',e=>{if(e.target===prizeDialog)closePrizeEditor()});
prizeForm.onsubmit=e=>{e.preventDefault();run(async()=>{
  const fd=new FormData(prizeForm),id=String(fd.get('prize_id')||''),name=String(fd.get('name')||'').trim(),quantity=Number(fd.get('quantity'));
  if(!name)throw Error('กรุณากรอกชื่อของรางวัล');
  const used=id?S.draws.filter(x=>x.prize_id===id).length:0,minimum=id?Math.max(1,used):1;
  if(!Number.isInteger(quantity)||quantity<minimum)throw Error(`จำนวนต้องเป็นเลขจำนวนเต็มและไม่ต่ำกว่า ${minimum}`);
  if(id){assertOk(await db.from('prizes').update({name,quantity}).eq('id',id));msg('บันทึกการแก้ไขรางวัลแล้ว')}
  else{assertOk(await db.from('prizes').insert({owner_id:S.user.id,name,quantity}));msg('เพิ่มรางวัลแล้ว')}
  closePrizeEditor();await refresh();
})};
$('#prizeList').onclick=e=>run(async()=>{const edit=e.target.closest('[data-prize-edit]'),del=e.target.closest('[data-prize-del]');const id=edit?.dataset.prizeEdit||del?.dataset.prizeDel;if(!id)return;const p=S.prizes.find(x=>x.id===id);if(edit){openPrizeEditor(p);return}else if(del){if(S.draws.some(x=>x.prize_id===id)){msg('ไม่สามารถลบรางวัลที่มีประวัติการสุ่มแล้ว');return}if(!confirm('ลบของรางวัลนี้?'))return;assertOk(await db.from('prizes').delete().eq('id',id));}await refresh()});
$('#drawBtn').onclick=()=>{const id=$('#drawPrize').value,p=S.prizes.find(x=>x.id===id);if(!p){msg('เลือกของรางวัลก่อน');return}$('#confirmText').textContent=`สุ่มรางวัล “${p.name}” จำนวน 1 สิทธิ์ ${$('#allowRepeat').checked?'(อนุญาตคนเดิมชนะซ้ำ)':'(ไม่ซ้ำผู้ได้รับรางวัล)'}`;$('#confirmDialog').showModal()};
$('#confirmDialog').addEventListener('close',()=>{if($('#confirmDialog').returnValue!=='confirm')return;run(async()=>{const id=$('#drawPrize').value;$('#drawBtn').disabled=true;try{S.settings.selected_prize_id=id;S.settings.allow_repeat=$('#allowRepeat').checked;const saved=await rememberSettings();if(!saved)throw Error('ยังบันทึกการตั้งค่าหน้า Live ไม่สำเร็จ กรุณาลองใหม่');const displayFields=S.settings.display_fields?.length?S.settings.display_fields:DEFAULT_FIELDS;const res=assertOk(await db.rpc('draw_winner',{p_prize_id:id,p_allow_repeat:S.settings.allow_repeat,p_display_fields:displayFields}));await refresh();msg('สุ่มสำเร็จ! '+res.participant.first_name+' '+res.participant.last_name)}finally{$('#drawBtn').disabled=false}})});
const fieldForm=$('#fieldForm');function clearEdit(){S.editField=null;fieldForm.reset();$('#saveField').textContent='เพิ่ม Field';$('#cancelField').hidden=true;fieldForm.elements.field_key.disabled=false}$('#cancelField').onclick=clearEdit;
fieldForm.onsubmit=e=>{e.preventDefault();run(async()=>{const fd=new FormData(fieldForm),obj={owner_id:S.user.id,label:String(fd.get('label')).trim(),field_key:String(fd.get('field_key')).trim(),field_type:fd.get('field_type'),options:String(fd.get('options')||'').split(',').map(s=>s.trim()).filter(Boolean),required:fd.has('required'),show_form:fd.has('show_form'),show_table:fd.has('show_table'),show_live:fd.has('show_live'),exportable:fd.has('exportable')};if(['staff_code','first_name','last_name','department','email','phone'].includes(obj.field_key))throw Error('Key นี้เป็น Field พื้นฐาน');if(['select','radio'].includes(obj.field_type)&&!obj.options.length)throw Error('โปรดระบุตัวเลือก');if(S.editField)assertOk(await db.from('custom_fields').update(obj).eq('id',S.editField));else assertOk(await db.from('custom_fields').insert({...obj,position:S.fields.length}));clearEdit();await refresh()})};
$('#fieldsBody').onclick=e=>run(async()=>{const edit=e.target.closest('[data-edit-field]'),del=e.target.closest('[data-del-field]'),id=edit?.dataset.editField||del?.dataset.delField;if(!id)return;const f=S.fields.find(x=>x.id===id);if(del){if(!confirm(`ลบ Field ${f.label}? ข้อมูลเดิมในผู้เข้าร่วมยังเก็บไว้ใน extra`))return;assertOk(await db.from('custom_fields').delete().eq('id',id));await refresh();return}S.editField=id;for(const k of ['label','field_key','field_type'])fieldForm.elements[k].value=f[k];fieldForm.elements.options.value=(f.options||[]).join(', ');for(const k of ['required','show_form','show_table','show_live','exportable'])fieldForm.elements[k].checked=f[k];fieldForm.elements.field_key.disabled=true;$('#saveField').textContent='บันทึกการแก้ไข';$('#cancelField').hidden=false;fieldForm.scrollIntoView({behavior:'smooth'})});
// XLSX loaded dynamically only when importing; workbook parser runs locally in browser.
let XLSX;$('#fileInput').onchange=e=>run(async()=>{const file=e.target.files[0];if(!file)return;if(!XLSX){XLSX=await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs')}const buf=await file.arrayBuffer(),book=XLSX.read(buf,{type:'array'}),sheet=book.Sheets[book.SheetNames[0]];S.sheet=XLSX.utils.sheet_to_json(sheet,{defval:'',raw:false});S.columns=[...new Set(S.sheet.flatMap(Object.keys))];if(!S.columns.length)throw Error('ไม่พบหัวคอลัมน์ในไฟล์');$('#mappingArea').hidden=false;$('#fileSummary').textContent=`จับคู่คอลัมน์ (${S.sheet.length} แถว)`;renderMapping()});
function renderMapping(){$('#mappingBody').innerHTML=S.columns.map((col,i)=>{const matched=allFields().find(f=>f.label.toLowerCase()===col.toLowerCase()||f.field_key.toLowerCase()===col.toLowerCase()||({'รหัสพนักงาน':'staff_code','รหัส':'staff_code','employee_id':'staff_code','employee id':'staff_code','ชื่อจริง':'first_name','firstname':'first_name','first name':'first_name','lastname':'last_name','last name':'last_name','ฝ่าย':'department'}[col.trim().toLowerCase()]===f.field_key));return `<tr><td>${esc(col)}</td><td>${esc(S.sheet[0]?.[col])}</td><td><select class="map-select" data-col="${i}"><option value="">-- ไม่ใช้ --</option>${allFields().map(f=>`<option value="${esc(f.field_key)}" ${matched?.field_key===f.field_key?'selected':''}>${esc(f.label)}</option>`).join('')}</select></td></tr>`}).join('');$$('.map-select').forEach(s=>s.onchange=updateMapping);updateMapping()}
function mapped(){const pairs=$$('.map-select').filter(x=>x.value).map(x=>[S.columns[Number(x.dataset.col)],x.value]);const targetKeys=pairs.map(x=>x[1]);if(new Set(targetKeys).size!==targetKeys.length)throw Error('ไม่สามารถจับคู่หลายคอลัมน์กับ Field เดียวกัน');for(const k of ['first_name','last_name'])if(!targetKeys.includes(k))throw Error('ต้องจับคู่ '+keyLabel[k]);const rows=S.sheet.map((row,i)=>{const obj={staff_code:'',first_name:'',last_name:'',department:'',extra:{}};for(const [col,k] of pairs){const f=S.fields.find(x=>x.field_key===k);if(f)obj.extra[k]=String(row[col]??'').trim();else obj[k]=String(row[col]??'').trim()}const bad=!obj.first_name||!obj.last_name||S.fields.some(f=>f.required&&!String(obj.extra[f.field_key]??'').trim());return {obj,bad,index:i+2}});return rows}
function updateMapping(){try{const rows=mapped(),bad=rows.filter(r=>r.bad);$('#totalRows').textContent=rows.length;$('#validRows').textContent=rows.length-bad.length;$('#badRows').textContent=bad.length;$('#importProblems').textContent=bad.length?'ตัวอย่างแถวที่ไม่สมบูรณ์: '+bad.slice(0,12).map(r=>r.index).join(', '):'ทุกแถวพร้อมนำเข้า';$('#importBtn').disabled=!rows.length}catch(e){$('#importProblems').textContent=e.message;$('#importBtn').disabled=true;$('#validRows').textContent='0';$('#badRows').textContent='–'}}
$('#importAll').onchange=updateMapping;$('#clearFile').onclick=()=>{$('#fileInput').value='';$('#mappingArea').hidden=true;S.sheet=[]};
// Authenticated imports: refresh stale sessions once, without re-sending successful batches.
function isExpiredJwt(error) {
  return /jwt expired|token has expired|pgrst301/i.test(String(error?.message || '')) ||
    error?.code === 'PGRST301';
}
async function renewLogin() {
  const { data, error } = await db.auth.refreshSession();
  if (error || !data?.session?.user) {
    throw new Error('Session หมดอายุและต่ออายุไม่ได้ กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่ก่อนนำเข้า');
  }
  S.user = data.session.user;
}
async function ensureImportSession() {
  const { data, error } = await db.auth.getSession();
  if (error || !data?.session?.user) {
    throw new Error('กรุณาเข้าสู่ระบบใหม่ก่อนนำเข้ารายชื่อ');
  }
  // Supabase normally refreshes automatically; this handles a stale browser session.
  const expiresAt = data.session.expires_at;
  if (expiresAt && expiresAt * 1000 < Date.now() + 60_000) {
    await renewLogin();
  }
  S.user = (await db.auth.getUser()).data?.user || data.session.user;
}
async function insertImportBatch(batch) {
  let result = await db.from('participants').insert(batch);
  if (result.error && isExpiredJwt(result.error)) {
    await renewLogin();
    result = await db.from('participants').insert(batch);
  }
  assertOk(result);
}
$('#importBtn').onclick = () => run(async () => {
  const all = mapped();
  const rows = all.filter(r => $('#importAll').checked || !r.bad);
  if (!rows.length) throw Error('ไม่มีแถวที่นำเข้าได้');
  if (!confirm(`นำเข้า ${rows.length} รายชื่อ? (การนำเข้าซ้ำจะเพิ่มรายชื่อซ้ำ)`)) return;
  $('#importBtn').disabled = true;
  let inserted = 0;
  try {
    await ensureImportSession();
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100).map(r => ({ owner_id: S.user.id, ...r.obj }));
      try {
        await insertImportBatch(batch);
        inserted += batch.length;
      } catch (error) {
        if (inserted) throw new Error(`นำเข้าสำเร็จไปแล้ว ${inserted} รายชื่อ ก่อนพบข้อผิดพลาด: ${error.message} (อย่านำเข้าทั้งไฟล์ซ้ำ)`);
        throw error;
      }
    }
    msg('นำเข้า ' + inserted + ' รายชื่อสำเร็จ');
    $('#clearFile').click();
    await refresh();
    page('dashboard');
  } finally {
    $('#importBtn').disabled = false;
  }
});

function personFieldInput(f){const key=f.field_key;const id=`person_${key}`;const label=`${esc(f.label)}${['first_name','last_name'].includes(key)?' *':''}`;const required=['first_name','last_name'].includes(key)||Boolean(f.required);if(f.field_type==='select'||f.field_type==='radio'){return `<label for="${id}">${label}<select id="${id}" name="${esc(key)}" ${required?'required':''}><option value="">-- เลือก --</option>${(f.options||[]).map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select></label>`}return `<label for="${id}">${label}<input id="${id}" name="${esc(key)}" type="${f.field_type==='number'?'number':'text'}" ${required?'required':''} ${key==='staff_code'?'placeholder="เช่น A0012"':''}></label>`}
$('#addPersonBtn').onclick=()=>{$('#personFormFields').innerHTML=[...Object.entries(keyLabel).map(([field_key,label])=>({field_key,label,field_type:'text'})),...S.fields.filter(f=>f.show_form)].map(personFieldInput).join('');$('#personForm').reset();$('#personDialog').showModal()};
$('#cancelPerson').onclick=()=>$('#personDialog').close();
$('#personForm').onsubmit=e=>{e.preventDefault();run(async()=>{const fd=new FormData(e.currentTarget),obj={owner_id:S.user.id,staff_code:String(fd.get('staff_code')||'').trim(),first_name:String(fd.get('first_name')||'').trim(),last_name:String(fd.get('last_name')||'').trim(),department:String(fd.get('department')||'').trim(),extra:{}};if(!obj.first_name||!obj.last_name)throw Error('กรุณากรอกชื่อและนามสกุล');for(const f of S.fields.filter(f=>f.show_form)){const val=String(fd.get(f.field_key)||'').trim();if(f.required&&!val)throw Error('กรุณากรอก '+f.label);obj.extra[f.field_key]=val}$('#savePerson').disabled=true;try{assertOk(await db.from('participants').insert(obj));$('#personDialog').close();await refresh();msg('เพิ่มรายชื่อสำเร็จ')}finally{$('#savePerson').disabled=false}})};
$('#resetBtn').onclick=()=>{$('#resetPhrase').value='';$('#resetDialog').showModal()};
$('#cancelReset').onclick=()=>$('#resetDialog').close();
$('#resetForm').onsubmit=e=>{e.preventDefault();if($('#resetPhrase').value!=='RESET'){msg('ต้องพิมพ์ RESET ตัวพิมพ์ใหญ่เท่านั้น');return}run(async()=>{const btn=$('#resetForm button[type=submit]');btn.disabled=true;const backgroundPath=S.settings.live_background_path;try{assertOk(await db.rpc('reset_event_data'));if(backgroundPath){const removed=await db.storage.from(LIVE_BACKGROUND_BUCKET).remove([backgroundPath]);if(removed.error)console.warn('Reset background cleanup:',removed.error.message)}$('#resetDialog').close();S.sheet=[];S.columns=[];$('#fileInput').value='';$('#mappingArea').hidden=true;$('#searchPeople').value='';S.settings=defaultSettings();localStorage.removeItem(cacheKey());localStorage.removeItem(previousCacheKey());localStorage.removeItem(legacyCacheKey());localStorage.removeItem(legacyFieldKey());localStorage.removeItem(peoplePrefsKey());localStorage.removeItem(legacyPeoplePrefsKey());S.peopleColumns=null;settingsMessage('✓ คืนค่าการแสดงผลเริ่มต้นแล้ว');await refresh();msg('เริ่มต้นใหม่เรียบร้อย ข้อมูลในบัญชีถูกล้างแล้ว')}finally{btn.disabled=false}})};
run(authInit);
