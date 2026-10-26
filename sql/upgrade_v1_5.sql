-- EVENTDRAW V1.5.0 upgrade
-- Safe upgrade for an existing V1.3.x / V1.4.x Supabase project.
-- Run ONCE (safe to run again). It does NOT delete participants, prizes, draws, logs, or winners.

ALTER TABLE public.event_settings
  ADD COLUMN IF NOT EXISTS live_caption_template text NOT NULL DEFAULT 'LUCKY DRAW',
  ADD COLUMN IF NOT EXISTS live_prize_template text NOT NULL DEFAULT 'รางวัล {prize}',
  ADD COLUMN IF NOT EXISTS live_winner_template text NOT NULL DEFAULT '{full_name}',
  ADD COLUMN IF NOT EXISTS live_status_template text NOT NULL DEFAULT '🎉 ขอแสดงความยินดี {full_name} ที่ได้รับ {prize}',
  ADD COLUMN IF NOT EXISTS live_background_path text,
  ADD COLUMN IF NOT EXISTS live_accent_color text NOT NULL DEFAULT '#f3c66a',
  ADD COLUMN IF NOT EXISTS live_badge_color text NOT NULL DEFAULT '#f3c66a',
  ADD COLUMN IF NOT EXISTS live_prize_color text NOT NULL DEFAULT '#fff3dc',
  ADD COLUMN IF NOT EXISTS live_frame_color text NOT NULL DEFAULT '#d0a34f',
  ADD COLUMN IF NOT EXISTS live_winner_color text NOT NULL DEFAULT '#fff0c9',
  ADD COLUMN IF NOT EXISTS live_status_color text NOT NULL DEFAULT '#f0ddd0',
  ADD COLUMN IF NOT EXISTS live_frame_background text NOT NULL DEFAULT '#220b0f';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_settings TO authenticated;

-- Background uploads used by the Live Screen.
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
