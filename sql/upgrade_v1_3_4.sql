-- EVENTDRAW V1.3.4: run once in your EXISTING Supabase project after V1.3.2.
-- Adds ONLY the persisted Live Screen background-theme selection.
-- Does not clear participants, winners, prizes or logs.
-- Safe to run again (IF NOT EXISTS) but only needed once.

ALTER TABLE public.event_settings
  ADD COLUMN IF NOT EXISTS live_theme text NOT NULL DEFAULT 'classic';

-- Constrain allowed values while allowing safe repeated execution.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_settings_live_theme_allowed'
      AND conrelid = 'public.event_settings'::regclass
  ) THEN
    ALTER TABLE public.event_settings
      ADD CONSTRAINT event_settings_live_theme_allowed
      CHECK (live_theme IN ('classic','aurora','galaxy','gold'));
  END IF;
END $$;

-- V1.3.2 already granted authenticated access to event_settings and configured its RLS policy.
-- No extra policies, tables, or authorization keys are needed.
