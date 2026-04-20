-- ============================================================================
-- 00002 — user_settings
-- ============================================================================
-- Per-user defaults for sending behaviour. Overrides Python worker's compiled-in
-- constants when populated; the worker falls back to its defaults when null.
-- ============================================================================

CREATE TABLE user_settings (
  user_id             UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Send delays (random jitter between two DMs from the same account)
  default_delay_min_s INTEGER NOT NULL DEFAULT 45 CHECK (default_delay_min_s >= 10),
  default_delay_max_s INTEGER NOT NULL DEFAULT 180 CHECK (default_delay_max_s > default_delay_min_s),

  -- Warm-up
  warmup_days         INTEGER NOT NULL DEFAULT 7 CHECK (warmup_days BETWEEN 0 AND 30),
  steady_daily_limit  INTEGER NOT NULL DEFAULT 50 CHECK (steady_daily_limit BETWEEN 1 AND 200),

  -- Send-delete
  default_delete_after_s INTEGER,       -- null = no send-delete

  -- Safety
  min_template_variants  INTEGER NOT NULL DEFAULT 3 CHECK (min_template_variants >= 1),
  peer_flood_pause_hours INTEGER NOT NULL DEFAULT 48 CHECK (peer_flood_pause_hours BETWEEN 1 AND 168),

  -- Operating hours (UTC). null = always on.
  operating_start_hour INTEGER CHECK (operating_start_hour BETWEEN 0 AND 23),
  operating_end_hour   INTEGER CHECK (operating_end_hour BETWEEN 0 AND 23),
  timezone             TEXT NOT NULL DEFAULT 'UTC',

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_settings_owner ON user_settings
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TRIGGER trg_user_settings_updated_at
  BEFORE UPDATE ON user_settings
  FOR EACH ROW EXECUTE FUNCTION bump_updated_at();

-- Extend the handle_new_user trigger so every new signup also gets a
-- user_settings row with our defaults.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
  INSERT INTO user_settings (user_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Backfill for users created before this migration.
INSERT INTO user_settings (user_id)
SELECT id FROM auth.users
WHERE id NOT IN (SELECT user_id FROM user_settings)
ON CONFLICT (user_id) DO NOTHING;
