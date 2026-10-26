import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
export const configured = /^https:\/\//.test(SUPABASE_URL) && !SUPABASE_ANON_KEY.startsWith('YOUR_');
export const db = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
export const $ = (q,root=document) => root.querySelector(q);
export const $$ = (q,root=document) => [...root.querySelectorAll(q)];
export function esc(x){return String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function dateStr(x){return x?new Date(x).toLocaleString('th-TH',{dateStyle:'medium',timeStyle:'short'}):'-';}
export function assertOk(result){if(result.error)throw result.error;return result.data;}
