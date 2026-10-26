-- Lucky Draw V1.3.2: RUN ONCE in the EXISTING Supabase project.
-- Keeps all participants, prizes, winner history, and logs unchanged.
-- Do not run schema.sql again if upgrading an existing project.

CREATE TABLE IF NOT EXISTS public.event_settings (
  owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_fields jsonb NOT NULL DEFAULT '["first_name","last_name"]'::jsonb
    CHECK (jsonb_typeof(display_fields)='array'),
  selected_prize_id uuid,
  allow_repeat boolean NOT NULL DEFAULT false,
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
