-- EVENTDRAW V1.4.0 upgrade
-- Run ONCE in Supabase SQL Editor when upgrading an existing V1.3.x database.
-- This does not delete participants, prizes, draws, logs, or existing settings.

ALTER TABLE public.event_settings
  ADD COLUMN IF NOT EXISTS live_caption_template text NOT NULL DEFAULT 'LUCKY DRAW',
  ADD COLUMN IF NOT EXISTS live_prize_template text NOT NULL DEFAULT 'รางวัล {prize}',
  ADD COLUMN IF NOT EXISTS live_winner_template text NOT NULL DEFAULT '{full_name}',
  ADD COLUMN IF NOT EXISTS live_status_template text NOT NULL DEFAULT '🎉 ขอแสดงความยินดี {full_name} ที่ได้รับ {prize}',
  ADD COLUMN IF NOT EXISTS live_background_path text;

-- Keep existing event_settings RLS policy/grants from V1.3.x.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_settings TO authenticated;

-- Live Screen background uploads. These images are intended to be displayed publicly
-- on the Live Screen; only the signed-in owner may upload/update/delete files in their folder.
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
