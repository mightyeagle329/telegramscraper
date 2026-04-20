/**
 * Hand-written TypeScript mirror of `supabase/migrations/00001_initial_schema.sql`.
 *
 * When we start using `supabase gen types typescript`, this file gets replaced
 * with the auto-generated one. For now it's concise enough to maintain by hand
 * and keeps the build green without a toolchain dependency.
 */

export type AccountStatusEnum = "warming" | "active" | "paused" | "banned";
export type CampaignStatusEnum =
  | "draft"
  | "running"
  | "paused"
  | "completed"
  | "cancelled";
export type QueueItemStatusEnum =
  | "pending"
  | "sending"
  | "sent"
  | "skipped"
  | "failed";
export type SendLogStatusEnum = "sent" | "skipped" | "paused" | "error";

export interface DbProfile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export interface DbUserSettings {
  user_id: string;
  default_delay_min_s: number;
  default_delay_max_s: number;
  warmup_days: number;
  steady_daily_limit: number;
  default_delete_after_s: number | null;
  min_template_variants: number;
  peer_flood_pause_hours: number;
  operating_start_hour: number | null;
  operating_end_hour: number | null;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export interface DbTelegramAccount {
  id: string;
  user_id: string;
  label: string;
  phone: string;
  telegram_user_id: number | null;
  telegram_username: string | null;
  first_name: string | null;
  last_name: string | null;
  api_id: number | null;
  api_hash: string | null;
  session_data: string | null;
  legacy_session_file: string | null;
  proxy_type: "socks5" | "socks4" | "http" | null;
  proxy_host: string | null;
  proxy_port: number | null;
  proxy_username: string | null;
  proxy_password: string | null;
  status: AccountStatusEnum;
  warmup_started_at: string;
  daily_sent: number;
  daily_reset_at: string | null;
  total_sent: number;
  last_send_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  paused_until: string | null;
  health_connected: boolean | null;
  health_restricted: boolean | null;
  health_checked_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface DbGroupSource {
  id: string;
  user_id: string;
  url: string;
  name: string | null;
  telegram_id: number | null;
  member_count: number | null;
  scrape_mode: "members" | "messages";
  is_monitoring: boolean;
  last_scraped_at: string | null;
  scraped_count: number;
  created_at: string;
  updated_at: string;
}

export interface DbContact {
  id: string;
  user_id: string;
  telegram_user_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  tags: string[];
  first_seen_group: string | null;
  scraped_at: string;
  contacted_at: string | null;
  replied_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbMessageTemplate {
  id: string;
  user_id: string;
  name: string;
  body: string;
  variables: string[];
  times_used: number;
  created_at: string;
  updated_at: string;
}

export interface DbCampaign {
  id: string;
  user_id: string;
  name: string;
  status: CampaignStatusEnum;
  account_ids: string[];
  delete_after_s: number | null;
  delay_min_s: number;
  delay_max_s: number;
  stats_total: number;
  stats_sent: number;
  stats_skipped: number;
  stats_failed: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface DbCampaignContact {
  id: string;
  campaign_id: string;
  contact_id: string;
  account_id: string | null;
  status: QueueItemStatusEnum;
  retry_count: number;
  scheduled_at: string;
  sent_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbSendLog {
  id: string;
  user_id: string;
  account_id: string | null;
  campaign_id: string | null;
  campaign_contact_id: string | null;
  target_telegram_id: number;
  target_username: string | null;
  status: SendLogStatusEnum;
  reason: string | null;
  telegram_message_id: number | null;
  created_at: string;
}

/**
 * Helper: extract {first_name}, {username}, … placeholders from a template
 * body. Used by server actions AND the Python sender — keep the regex in sync
 * with `backend/sender.py::_render_template`.
 */
export function extractTemplateVariables(body: string): string[] {
  const matches = body.match(/\{(\w+)\}/g);
  if (!matches) return [];
  return Array.from(new Set(matches.map((m) => m.slice(1, -1))));
}
