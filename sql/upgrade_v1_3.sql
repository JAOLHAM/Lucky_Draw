-- Lucky Draw v1.3: run ONCE on existing Supabase project. Does NOT erase existing data.
-- Safe to re-run schema updates. Reset is only invoked by clicking the reset button.
ALTER TABLE public.participants ADD COLUMN IF NOT EXISTS staff_code text NOT NULL DEFAULT '';
ALTER TABLE public.participants ADD COLUMN IF NOT EXISTS department text NOT NULL DEFAULT '';
ALTER TABLE public.participants ALTER COLUMN email SET DEFAULT '';
ALTER TABLE public.participants ALTER COLUMN phone SET DEFAULT '';
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
