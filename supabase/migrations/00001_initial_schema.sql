-- ============================================================================
-- Telegram Outreach Automation — initial schema
-- ============================================================================
-- Multi-tenant via Supabase Auth + RLS. Every table is scoped to auth.uid().
-- ----------------------------------------------------------------------------
-- This migration maps the Phase 1 Python data model (accounts.json, queue.json,
-- sent_log.json) into Postgres so the Next.js frontend, the Python worker, and
-- any future TypeScript worker can all share one source of truth.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";


-- ────────────────────────────────────────────────────────────────────────────
-- Enums
-- ────────────────────────────────────────────────────────────────────────────

CREATE TYPE account_status AS ENUM (
  'warming',      -- in the 7-day zero-DM warm-up runway
  'active',       -- healthy, can send DMs per daily ladder
  'paused',       -- manually paused, or auto-paused by error_handler
  'banned'        -- terminal (PhoneNumberBannedError / UserDeactivatedBan)
);

CREATE TYPE campaign_status AS ENUM (
  'draft',
  'running',
  'paused',
  'completed',
  'cancelled'
);

CREATE TYPE queue_item_status AS ENUM (
  'pending',      -- waiting to be sent
  'sending',      -- claimed by a worker (optimistic lock)
  'sent',
  'skipped',      -- target refused (privacy / blocked / deactivated)
  'failed'
);

CREATE TYPE send_log_status AS ENUM (
  'sent',
  'skipped',
  'paused',       -- account paused by error_handler during this send
  'error'
);


-- ────────────────────────────────────────────────────────────────────────────
-- profiles — one row per Supabase auth user, SaaS-specific metadata
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name     TEXT,
  avatar_url    TEXT,
  timezone      TEXT NOT NULL DEFAULT 'UTC',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ────────────────────────────────────────────────────────────────────────────
-- telegram_accounts — sender accounts managed by the worker
-- ────────────────────────────────────────────────────────────────────────────
-- Mirrors backend/accounts.py::new_account_record(). The `session_data` column
-- replaces the `sessions/acc_XXX.session` file when the worker ports over to
-- TypeScript. While the Python worker still runs, session files remain on
-- disk and `session_data` stays NULL for those accounts.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE telegram_accounts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Identity
  label                TEXT NOT NULL DEFAULT '',
  phone                TEXT NOT NULL,
  telegram_user_id     BIGINT,
  telegram_username    TEXT,
  first_name           TEXT,
  last_name            TEXT,

  -- API credentials (per-account override; null = shared from env)
  api_id               INTEGER,
  api_hash             TEXT,

  -- Session
  -- For the Python worker this stays NULL and the real session lives in
  -- backend/sessions/acc_XXX.session. For a future TS worker this will hold
  -- the GramJS StringSession.
  session_data         TEXT,
  legacy_session_file  TEXT,

  -- Proxy (IPRoyal SOCKS5). Decomposed so the worker can read fields directly
  -- without parsing a URL.
  proxy_type           TEXT CHECK (proxy_type IN ('socks5', 'socks4', 'http')),
  proxy_host           TEXT,
  proxy_port           INTEGER,
  proxy_username       TEXT,
  proxy_password       TEXT,

  -- Status + warm-up (matches the 7-day-zero + ladder curve in accounts.py)
  status               account_status NOT NULL DEFAULT 'warming',
  warmup_started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Counters
  daily_sent           INTEGER NOT NULL DEFAULT 0,
  daily_reset_at       TIMESTAMPTZ,
  total_sent           INTEGER NOT NULL DEFAULT 0,
  last_send_at         TIMESTAMPTZ,

  -- Error bookkeeping
  last_error           TEXT,
  last_error_at        TIMESTAMPTZ,
  paused_until         TIMESTAMPTZ,    -- 48h cooldown after PeerFlood, etc.

  -- Health probe cache
  health_connected     BOOLEAN,
  health_restricted    BOOLEAN,
  health_checked_at    TIMESTAMPTZ,

  -- Bookkeeping
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at           TIMESTAMPTZ,

  CONSTRAINT uq_telegram_accounts_user_phone UNIQUE (user_id, phone)
);

CREATE INDEX idx_telegram_accounts_user ON telegram_accounts(user_id)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_telegram_accounts_status ON telegram_accounts(user_id, status)
  WHERE deleted_at IS NULL;


-- ────────────────────────────────────────────────────────────────────────────
-- group_sources — Telegram groups the user scrapes from
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE group_sources (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  url              TEXT NOT NULL,              -- t.me/… or invite link
  name             TEXT,
  telegram_id      BIGINT,
  member_count     INTEGER,
  scrape_mode      TEXT NOT NULL DEFAULT 'members'
                   CHECK (scrape_mode IN ('members', 'messages')),
  is_monitoring    BOOLEAN NOT NULL DEFAULT false,
  last_scraped_at  TIMESTAMPTZ,
  scraped_count    INTEGER NOT NULL DEFAULT 0,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_group_sources_user_url UNIQUE (user_id, url)
);

CREATE INDEX idx_group_sources_user ON group_sources(user_id);


-- ────────────────────────────────────────────────────────────────────────────
-- contacts — scraped Telegram users (deduplicated per owner)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE contacts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  telegram_user_id   BIGINT NOT NULL,
  username           TEXT,
  first_name         TEXT,
  last_name          TEXT,
  phone              TEXT,

  tags               TEXT[] NOT NULL DEFAULT '{}',
  first_seen_group   UUID REFERENCES group_sources(id) ON DELETE SET NULL,
  scraped_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  contacted_at       TIMESTAMPTZ,
  replied_at         TIMESTAMPTZ,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_contacts_user_tg UNIQUE (user_id, telegram_user_id)
);

CREATE INDEX idx_contacts_user ON contacts(user_id);
CREATE INDEX idx_contacts_tg_id ON contacts(telegram_user_id);


-- M:N contact ↔ group membership (a user can be scraped from multiple groups)
CREATE TABLE contact_group_memberships (
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  group_id   UUID NOT NULL REFERENCES group_sources(id) ON DELETE CASCADE,
  seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_id, group_id)
);


-- ────────────────────────────────────────────────────────────────────────────
-- message_templates — message variants with {first_name} etc. placeholders
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE message_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  body          TEXT NOT NULL,
  variables     TEXT[] NOT NULL DEFAULT '{}',
  times_used    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_message_templates_user ON message_templates(user_id);


-- ────────────────────────────────────────────────────────────────────────────
-- campaigns — a batch of DMs across a set of contacts using a set of templates
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE campaigns (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  status            campaign_status NOT NULL DEFAULT 'draft',

  -- Which accounts send for this campaign (round-robin targets)
  account_ids       UUID[] NOT NULL DEFAULT '{}',

  -- Send options
  delete_after_s    INTEGER,                   -- null = don't send-delete
  delay_min_s       INTEGER NOT NULL DEFAULT 45,
  delay_max_s       INTEGER NOT NULL DEFAULT 180,

  -- Aggregates (denormalised for dashboard speed)
  stats_total       INTEGER NOT NULL DEFAULT 0,
  stats_sent        INTEGER NOT NULL DEFAULT 0,
  stats_skipped     INTEGER NOT NULL DEFAULT 0,
  stats_failed      INTEGER NOT NULL DEFAULT 0,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ
);

CREATE INDEX idx_campaigns_user_status ON campaigns(user_id, status);


-- Campaign ↔ templates (weighted pool of variants, worker picks random)
CREATE TABLE campaign_templates (
  campaign_id  UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  template_id  UUID NOT NULL REFERENCES message_templates(id) ON DELETE RESTRICT,
  weight       INTEGER NOT NULL DEFAULT 1 CHECK (weight > 0),
  sort_order   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (campaign_id, template_id)
);


-- ────────────────────────────────────────────────────────────────────────────
-- campaign_contacts — the send queue (one row per contact per campaign)
-- ────────────────────────────────────────────────────────────────────────────
-- Workers claim rows atomically by updating `pending → sending` in a single
-- UPDATE to prevent duplicate sends across concurrent workers.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE campaign_contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  account_id      UUID REFERENCES telegram_accounts(id) ON DELETE SET NULL,

  status          queue_item_status NOT NULL DEFAULT 'pending',
  retry_count     INTEGER NOT NULL DEFAULT 0,

  scheduled_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at         TIMESTAMPTZ,
  last_error      TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_campaign_contact UNIQUE (campaign_id, contact_id)
);

CREATE INDEX idx_campaign_contacts_queue
  ON campaign_contacts(campaign_id, status, scheduled_at)
  WHERE status = 'pending';
CREATE INDEX idx_campaign_contacts_account
  ON campaign_contacts(account_id, status);


-- ────────────────────────────────────────────────────────────────────────────
-- send_logs — append-only audit trail of every send attempt
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE send_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id          UUID REFERENCES telegram_accounts(id) ON DELETE SET NULL,
  campaign_id         UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  campaign_contact_id UUID REFERENCES campaign_contacts(id) ON DELETE SET NULL,

  target_telegram_id  BIGINT NOT NULL,
  target_username     TEXT,
  status              send_log_status NOT NULL,
  reason              TEXT,                    -- error text / skip reason
  telegram_message_id BIGINT,                  -- the sent message id, if sent

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_send_logs_user_time ON send_logs(user_id, created_at DESC);
CREATE INDEX idx_send_logs_account ON send_logs(account_id, created_at DESC);


-- ────────────────────────────────────────────────────────────────────────────
-- Row-Level Security
-- ────────────────────────────────────────────────────────────────────────────
-- Every table scoped to `auth.uid()`. Workers must use the service-role
-- client (admin.ts) which bypasses RLS.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE profiles                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_accounts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_sources                ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_group_memberships    ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_templates            ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_templates           ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_contacts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE send_logs                    ENABLE ROW LEVEL SECURITY;


-- profiles: a user can see/update their own row.
CREATE POLICY profiles_select ON profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY profiles_update ON profiles FOR UPDATE USING (id = auth.uid());
CREATE POLICY profiles_insert ON profiles FOR INSERT WITH CHECK (id = auth.uid());

-- Straight ownership policy for every owner-scoped table.
CREATE POLICY telegram_accounts_owner ON telegram_accounts
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY group_sources_owner ON group_sources
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY contacts_owner ON contacts
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY message_templates_owner ON message_templates
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY campaigns_owner ON campaigns
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY send_logs_owner ON send_logs
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Transitive ownership: contact_group_memberships, campaign_templates,
-- campaign_contacts inherit the owner from the parent row.
CREATE POLICY contact_group_memberships_owner ON contact_group_memberships
  FOR ALL USING (EXISTS (
    SELECT 1 FROM contacts c
    WHERE c.id = contact_group_memberships.contact_id
      AND c.user_id = auth.uid()
  ));

CREATE POLICY campaign_templates_owner ON campaign_templates
  FOR ALL USING (EXISTS (
    SELECT 1 FROM campaigns c
    WHERE c.id = campaign_templates.campaign_id
      AND c.user_id = auth.uid()
  ));

CREATE POLICY campaign_contacts_owner ON campaign_contacts
  FOR ALL USING (EXISTS (
    SELECT 1 FROM campaigns c
    WHERE c.id = campaign_contacts.campaign_id
      AND c.user_id = auth.uid()
  ));


-- ────────────────────────────────────────────────────────────────────────────
-- Triggers: updated_at auto-bump + profile bootstrap on signup
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION bump_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles', 'telegram_accounts', 'group_sources', 'contacts',
    'message_templates', 'campaigns', 'campaign_contacts'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_updated_at
        BEFORE UPDATE ON %1$s
        FOR EACH ROW EXECUTE FUNCTION bump_updated_at();', t
    );
  END LOOP;
END $$;

-- Auto-create a profiles row when a new auth.users row appears.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
