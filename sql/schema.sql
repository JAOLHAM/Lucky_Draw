-- Run once in Supabase SQL Editor. Each account's data is isolated by auth.uid().
create extension if not exists pgcrypto;
create table if not exists public.participants(id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id) on delete cascade,first_name text not null,last_name text not null,staff_code text not null default '',department text not null default '',email text not null default '',phone text default '',extra jsonb not null default '{}'::jsonb,created_at timestamptz not null default now());
create index if not exists participants_owner on public.participants(owner_id);
create table if not exists public.prizes(id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id) on delete cascade,name text not null,quantity integer not null check(quantity>0),created_at timestamptz not null default now());
create table if not exists public.custom_fields(id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id) on delete cascade,label text not null,field_key text not null check(field_key ~ '^[a-z][a-z0-9_]*$'),field_type text not null check(field_type in ('text','number','select','radio')),options jsonb not null default '[]'::jsonb,required boolean not null default false,show_form boolean not null default true,show_table boolean not null default false,show_live boolean not null default false,exportable boolean not null default true,position integer not null default 0,unique(owner_id,field_key));
create table if not exists public.draws(id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id) on delete cascade,prize_id uuid not null references public.prizes(id),participant_id uuid not null references public.participants(id),display_fields jsonb not null default '["first_name","last_name"]',created_at timestamptz not null default now());
create index if not exists draws_owner on public.draws(owner_id);
create table if not exists public.activity_logs(id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id) on delete cascade,action text not null,detail text not null,created_at timestamptz not null default now());
-- Realtime INSERT event. Live page reads only owners' events.
create table if not exists public.live_events(id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id) on delete cascade,draw_id uuid not null references public.draws(id),prize_name text not null,participant jsonb not null,display_fields jsonb not null,created_at timestamptz not null default now());
create index if not exists live_events_owner on public.live_events(owner_id,created_at desc);

alter table public.participants enable row level security;
alter table public.prizes enable row level security;
alter table public.custom_fields enable row level security;
alter table public.draws enable row level security;
alter table public.activity_logs enable row level security;
alter table public.live_events enable row level security;

-- Client CRUD for owned records; draws/events can ONLY be written by secured RPC.
drop policy if exists participants_owner_all on public.participants;
create policy participants_owner_all on public.participants for all to authenticated using (owner_id=auth.uid()) with check (owner_id=auth.uid());
drop policy if exists prizes_owner_all on public.prizes;
create policy prizes_owner_all on public.prizes for all to authenticated using (owner_id=auth.uid()) with check (owner_id=auth.uid());
drop policy if exists fields_owner_all on public.custom_fields;
create policy fields_owner_all on public.custom_fields for all to authenticated using (owner_id=auth.uid()) with check (owner_id=auth.uid());
drop policy if exists draws_owner_select on public.draws;
create policy draws_owner_select on public.draws for select to authenticated using (owner_id=auth.uid());
drop policy if exists logs_owner_select on public.activity_logs;
create policy logs_owner_select on public.activity_logs for select to authenticated using (owner_id=auth.uid());
drop policy if exists live_owner_select on public.live_events;
create policy live_owner_select on public.live_events for select to authenticated using (owner_id=auth.uid());

-- Log trusted prize + field + import changes automatically in database.
create or replace function public.log_change() returns trigger language plpgsql security definer set search_path='' as $$
declare v_owner uuid; v_label text;begin
  if tg_op='DELETE' then v_owner:=old.owner_id; else v_owner:=new.owner_id; end if;
  if tg_table_name='prizes' then
    v_label := case when tg_op='DELETE' then old.name else new.name end;
    insert into public.activity_logs(owner_id,action,detail) values(v_owner,'prize',tg_op || ' ของรางวัล: ' || v_label);
  elsif tg_table_name='custom_fields' then
    v_label := case when tg_op='DELETE' then old.label else new.label end;
    insert into public.activity_logs(owner_id,action,detail) values(v_owner,'field',tg_op || ' Field: ' || v_label);
  elsif tg_table_name='participants' and tg_op='INSERT' then
    insert into public.activity_logs(owner_id,action,detail) values(v_owner,'import','เพิ่มผู้เข้าร่วม: ' || new.first_name || ' ' || new.last_name);
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
drop trigger if exists trg_prize_log on public.prizes;
create trigger trg_prize_log after insert or update or delete on public.prizes for each row execute function public.log_change();
drop trigger if exists trg_field_log on public.custom_fields;
create trigger trg_field_log after insert or update or delete on public.custom_fields for each row execute function public.log_change();
drop trigger if exists trg_participant_log on public.participants;
create trigger trg_participant_log after insert on public.participants for each row execute function public.log_change();

-- Atomic draw with row-lock (prevents over-allocation in parallel tabs) + random winner.
create or replace function public.draw_winner(p_prize_id uuid,p_allow_repeat boolean default false,p_display_fields jsonb default '["first_name","last_name"]'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid; v_prize public.prizes%rowtype; v_taken integer; v_winner public.participants%rowtype; v_draw uuid; v_event jsonb;
begin
  v_user:=auth.uid(); if v_user is null then raise exception 'Login required'; end if;
  select * into v_prize from public.prizes where id=p_prize_id and owner_id=v_user for update;
  if not found then raise exception 'Prize not found'; end if;
  select count(*) into v_taken from public.draws where prize_id=p_prize_id and owner_id=v_user;
  if v_taken>=v_prize.quantity then raise exception 'Prize exhausted'; end if;
  select * into v_winner from public.participants p where p.owner_id=v_user and (p_allow_repeat or not exists(select 1 from public.draws d where d.participant_id=p.id and d.owner_id=v_user)) order by random() limit 1;
  if not found then raise exception 'No eligible participants'; end if;
  insert into public.draws(owner_id,prize_id,participant_id,display_fields) values(v_user,p_prize_id,v_winner.id,p_display_fields) returning id into v_draw;
  v_event:=jsonb_build_object('first_name',v_winner.first_name,'last_name',v_winner.last_name,'staff_code',v_winner.staff_code,'department',v_winner.department,'email',v_winner.email,'phone',v_winner.phone,'extra',v_winner.extra);
  insert into public.live_events(owner_id,draw_id,prize_name,participant,display_fields) values(v_user,v_draw,v_prize.name,v_event,p_display_fields);
  insert into public.activity_logs(owner_id,action,detail) values(v_user,'draw','จับรางวัล '||v_prize.name||' → '||v_winner.first_name||' '||v_winner.last_name);
  return jsonb_build_object('draw_id',v_draw,'prize_name',v_prize.name,'participant',v_event,'display_fields',p_display_fields);
end $$;
revoke all on function public.draw_winner(uuid,boolean,jsonb) from public,anon;
grant execute on function public.draw_winner(uuid,boolean,jsonb) to authenticated;
-- Keep ownership checks effective with RLS for all direct client calls.
DO $$ BEGIN
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='live_events') then
  alter publication supabase_realtime add table public.live_events;
 end if;
END $$;

-- Explicit API privileges, including projects with auto-expose disabled.
grant usage on schema public to authenticated;
grant select,insert,update,delete on public.participants,public.prizes,public.custom_fields to authenticated;
grant select on public.draws,public.activity_logs,public.live_events to authenticated;

-- Whole-event reset is transactional, scoped to authenticated owner.
CREATE OR REPLACE FUNCTION public.reset_event_data()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid;
BEGIN
 v_owner := auth.uid();
 IF v_owner IS NULL THEN RAISE EXCEPTION 'Login required'; END IF;
 -- Prevent concurrent resets for the same account.
 PERFORM pg_advisory_xact_lock(hashtext(v_owner::text)::bigint);
 DELETE FROM public.live_events WHERE owner_id=v_owner;
 DELETE FROM public.draws WHERE owner_id=v_owner;
 DELETE FROM public.prizes WHERE owner_id=v_owner;
 DELETE FROM public.participants WHERE owner_id=v_owner;
 DELETE FROM public.custom_fields WHERE owner_id=v_owner;
 DELETE FROM public.activity_logs WHERE owner_id=v_owner;
END $$;
REVOKE ALL ON FUNCTION public.reset_event_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_event_data() TO authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.participants,public.prizes,public.custom_fields TO authenticated;
GRANT SELECT ON public.draws,public.activity_logs,public.live_events TO authenticated;


-- v1.3.2: new-install preferences and reset integration.

CREATE TABLE IF NOT EXISTS public.event_settings (
  owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_fields jsonb NOT NULL DEFAULT '["first_name","last_name"]'::jsonb
    CHECK (jsonb_typeof(display_fields)='array'),
  selected_prize_id uuid,
  allow_repeat boolean NOT NULL DEFAULT false,
  live_theme text NOT NULL DEFAULT 'classic' CHECK (live_theme IN ('classic','aurora','galaxy','gold')),
  live_caption_template text NOT NULL DEFAULT 'LUCKY DRAW',
  live_prize_template text NOT NULL DEFAULT 'รางวัล {prize}',
  live_winner_template text NOT NULL DEFAULT '{full_name}',
  live_status_template text NOT NULL DEFAULT '🎉 ขอแสดงความยินดี {full_name} ที่ได้รับ {prize}',
  live_accent_color text NOT NULL DEFAULT '#f3c66a',
  live_badge_color text NOT NULL DEFAULT '#f3c66a',
  live_prize_color text NOT NULL DEFAULT '#fff3dc',
  live_frame_color text NOT NULL DEFAULT '#d0a34f',
  live_winner_color text NOT NULL DEFAULT '#fff0c9',
  live_status_color text NOT NULL DEFAULT '#f0ddd0',
  live_frame_background text NOT NULL DEFAULT '#220b0f',
  live_background_path text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.event_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS event_settings_owner_all ON public.event_settings;
CREATE POLICY event_settings_owner_all ON public.event_settings
  FOR ALL TO authenticated
  USING (owner_id=(SELECT auth.uid()))
  WITH CHECK (owner_id=(SELECT auth.uid()));
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_settings TO authenticated;


-- V1.4: uploaded Live Screen backgrounds. Images are public display assets,
-- while write/delete permissions remain scoped to the authenticated owner's folder.
INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES ('live-backgrounds','live-backgrounds',true,8388608,ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public=EXCLUDED.public,
  file_size_limit=EXCLUDED.file_size_limit,
  allowed_mime_types=EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS live_backgrounds_owner_all ON storage.objects;
CREATE POLICY live_backgrounds_owner_all ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id='live-backgrounds' AND (storage.foldername(name))[1]=auth.uid()::text)
  WITH CHECK (bucket_id='live-backgrounds' AND (storage.foldername(name))[1]=auth.uid()::text);

-- Make 'Start Over' clear remembered controls as well as event records.
-- WARNING: Function definition alone does not reset anything; only the reset button invokes it.
CREATE OR REPLACE FUNCTION public.reset_event_data()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid;
BEGIN
  v_owner := auth.uid();
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Login required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_owner::text)::bigint);
  DELETE FROM public.live_events WHERE owner_id=v_owner;
  DELETE FROM public.draws WHERE owner_id=v_owner;
  DELETE FROM public.prizes WHERE owner_id=v_owner;
  DELETE FROM public.participants WHERE owner_id=v_owner;
  DELETE FROM public.custom_fields WHERE owner_id=v_owner;
  DELETE FROM public.event_settings WHERE owner_id=v_owner;
  DELETE FROM public.activity_logs WHERE owner_id=v_owner;
END $$;
REVOKE ALL ON FUNCTION public.reset_event_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_event_data() TO authenticated;
