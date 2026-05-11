export interface Group {
  id: string;
  name: string;
  url: string;
  member_count: number;
  scraped_count: number;
  status: string;
  last_scraped: string | null;
}

export interface ScrapeResult {
  group_name: string;
  group_id: string;
  group_url: string;
  total_members_found: number;
  new_members_added: number;
  exported_to_sheet: boolean;
  scraped_at: string;
}

export interface MonitorStatus {
  is_monitoring: boolean;
  interval_seconds: number;
  last_check: string | null;
  new_members_since_last: number;
  started_at?: string;
  group_name?: string;
}

// gspread returns cells with whatever shape they have on the sheet. User IDs
// land as numbers, names as strings, empty cells as empty strings. Coerce
// with String(…) at every use site — never do .toLowerCase() / .includes()
// without coercing first.
export interface Member {
  "User ID": string | number;
  Username: string | number;
  "First Name": string | number;
  "Last Name": string | number;
  Phone: string | number;
  "Scraped At": string;
  "Is New": string;
}

// -------- Phase 1 --------

export type AccountStatus = "warming" | "active" | "paused" | "banned";

export interface AccountHealth {
  connected?: boolean;
  last_check_at?: string | null;
  restricted?: boolean;
}

export interface Account {
  id: string;
  label: string;
  phone: string;
  status: AccountStatus;
  warmup_started_at: string | null;
  daily_limit: number;
  daily_sent: number;
  total_sent: number;
  last_send_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  proxy_host: string | null;
  proxy_port: number | null;
  proxy_type: string | null;
  proxy_username?: string | null;
  proxy_password?: string | null;
  health: AccountHealth;
}

export interface QueueSnapshotEntry {
  pending: number;
  next_targets: { user_id: number; username: string }[];
}

export interface SentLogEntry {
  account_id: string;
  target_user_id: number;
  target_username?: string;
  campaign?: string;
  arm?: string;
  message_id?: number;
  kind?: "primary" | "followup";
  status: "sent" | "skipped" | "paused" | "error";
  reason?: string;
  timestamp: string;
}

/** One A/B test arm in a campaign request (frontend-built).
 *
 * An arm is in either *templates mode* (provide `primary_templates`) or
 * *AI mode* (provide `ai_style`). Mutually exclusive — backend rejects
 * arms that have neither and ignores `primary_templates` when `ai_style`
 * is set.
 */
export interface CampaignArmInput {
  name: string;
  primary_templates?: string[];
  ai_style?: string;
  follow_up_after_days?: number | null;
  follow_up_templates?: string[];
  follow_up_ai_style?: string;
  ai_model?: string;
  ai_two_stage?: boolean;
}

export interface AIStatus {
  configured: boolean;
  model: string;
}

export interface AutoResponseEntry {
  account_id: string;
  recipient_user_id: number;
  recipient_username?: string | null;
  sentiment: "positive" | "neutral" | "negative";
  response?: string;
  message_id?: number | null;
  skipped: boolean;
  skip_reason?: string | null;
  recorded_at: string;
}

export interface AutoResponseConfig {
  enabled: boolean;
  group_url: string;
  style: string;
  fallback: string;
}

export interface CampaignRun {
  run_id: string;
  campaign: string;
  status: "running" | "completed" | "failed";
  started_at: string;
  completed_at: string | null;
  targets_total: number;
  targets_processed: number;
  enqueued: Record<string, Record<string, number>>;
  arms: string[];
  account_ids: string[];
  error: string | null;
}

export interface BotStatus {
  configured: boolean;
  missing?: string[];
  bot_username?: string;
  bot_name?: string;
  chat_id?: string;
  sheet_id?: string;
  tab?: string;
  error?: string;
}

export interface BotQueueRow {
  row: number;
  id: string;
  content: string;
  scheduled_at: string;
  type: string;
  image_url: string;
  chat_id: string;
  posted_at: string;
  status: string;
}

export interface BotHistoryEntry {
  id: string;
  row: number;
  content: string;
  type: string;
  chat_id: string;
  telegram_message_id?: number | null;
  posted_at: string;
  manual: boolean;
}

export interface BotWriterConfig {
  enabled: boolean;
  posts_per_batch: number;
  active_start_hour_utc: number;
  active_end_hour_utc: number;
  content_mix: Record<string, number>;
  brand_context: string;
  model: string;
}

export interface BotWriterPreviewRow {
  type: string;
  content: string;
  scheduled_at: string;
}

export interface BotWriterPreview {
  rows?: BotWriterPreviewRow[];
  count?: number;
  error?: string;
}

export interface BotWriterRunResult {
  generated?: number;
  appended?: number;
  first_scheduled_at?: string | null;
  last_scheduled_at?: string | null;
  skipped?: string;
}

export interface AnalyticsTotals {
  sent: number;
  skipped: number;
  errored: number;
  paused: number;
  replied: number;
  reply_rate: number;
  joined: number;
  attributed_joined: number;
  join_rate: number;
  unique_targets: number;
}

export interface AnalyticsDailyBucket {
  date: string;
  sent: number;
  skipped: number;
  errored: number;
  replied: number;
  joined: number;
}

export interface AnalyticsAccountRow {
  account_id: string;
  label: string;
  status: string;
  daily_sent: number;
  daily_limit: number;
  sent_in_window: number;
  skipped_in_window: number;
  replied_in_window: number;
  joined_in_window: number;
  reply_rate: number;
  join_rate: number;
}

export interface AnalyticsCampaignArm {
  name: string;
  sent: number;
  replied: number;
  joined: number;
  reply_rate: number;
  join_rate: number;
}

export interface AnalyticsCampaignRow {
  campaign: string;
  sent: number;
  replied: number;
  joined: number;
  reply_rate: number;
  join_rate: number;
  arms: AnalyticsCampaignArm[];
  winner: string | null;
  join_winner: string | null;
}

export interface TrackedGroup {
  group_id: number;
  url: string;
  name: string;
  last_polled_at: string | null;
  interval_s: number;
  added_at: string | null;
  members_known: number;
}

export interface JoinEvent {
  user_id: number;
  group_id: number;
  group_name: string;
  joined_at: string;
  source_account: string | null;
  source_campaign: string | null;
  source_arm: string | null;
  attributed: boolean;
}

export interface GroupScorecard {
  name: string;
  members: number;
  reachable_pct: number;
  sent: number;
  replied: number;
  joined: number;
  reply_rate: number;
  join_rate: number;
  tier: "T1" | "T2" | "T3";
  campaigns: string[];
}

export interface AnalyticsSkipReason {
  reason: string;
  count: number;
}

export interface AnalyticsSummary {
  days: number;
  totals: AnalyticsTotals;
  daily_volume: AnalyticsDailyBucket[];
  per_account: AnalyticsAccountRow[];
  per_campaign: AnalyticsCampaignRow[];
  skip_reasons: AnalyticsSkipReason[];
}

/** Per-arm reply rate + join rate report from `/api/campaigns/{name}/stats`. */
export interface CampaignArmStat {
  name: string;
  sent: number;
  replied: number;
  joined: number;
  reply_rate: number;
  join_rate: number;
}

export interface CampaignStats {
  campaign: string;
  arms: CampaignArmStat[];
  winner: string | null;
  join_winner: string | null;
  total_sent: number;
  total_replied: number;
  total_joined: number;
}

export interface ReplyEntry {
  account_id: string;
  sender_user_id: number;
  sender_username?: string | null;
  sender_first_name?: string | null;
  message_id: number;
  text: string;
  received_at: string;
}

export interface WorkerStatus {
  [account_id: string]: "running" | "resting" | "stopped";
}

export interface SignupStartResponse {
  signup_token: string;
  state: "awaiting_code";
  expires_in_s: number;
}

export interface SignupStepResponse {
  state: "awaiting_code" | "awaiting_password" | "completed";
  needs_password?: boolean;
  account?: Account;
}

export interface ProxyInput {
  type: "socks5" | "socks4" | "http";
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
}
