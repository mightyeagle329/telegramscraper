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
  message_id?: number;
  status: "sent" | "skipped" | "paused" | "error";
  reason?: string;
  timestamp: string;
}

export interface WorkerStatus {
  [account_id: string]: "running" | "paused" | "stopped";
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
