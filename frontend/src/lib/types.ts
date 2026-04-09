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

export interface Member {
  "User ID": string;
  Username: string;
  "First Name": string;
  "Last Name": string;
  Phone: string;
  "Scraped At": string;
  "Is New": string;
}
