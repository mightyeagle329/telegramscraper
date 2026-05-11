import type {
  Account,
  AIStatus,
  AnalyticsSummary,
  BotHistoryEntry,
  BotQueueRow,
  BotStatus,
  BotWriterConfig,
  BotWriterPreview,
  BotWriterRunResult,
  CampaignArmInput,
  CampaignRun,
  CampaignStats,
  GroupScorecard,
  JoinEvent,
  ProxyInput,
  QueueSnapshotEntry,
  ReplyEntry,
  SentLogEntry,
  SignupStartResponse,
  SignupStepResponse,
  TrackedGroup,
  WorkerStatus,
} from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || "Request failed");
  }
  return res.json();
}

export const api = {
  // Groups
  getGroups: () => request<any[]>("/api/groups"),
  addGroup: (url: string) =>
    request<any>("/api/groups", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
  removeGroup: (id: string) =>
    request<any>(`/api/groups/${id}`, { method: "DELETE" }),

  // Scraping
  scrapeGroup: (id: string) =>
    request<any>(`/api/groups/${id}/scrape`, { method: "POST" }),
  scrapeGroupMessages: (id: string, messageLimit: number = 5000) =>
    request<any>(
      `/api/groups/${id}/scrape-messages?message_limit=${messageLimit}`,
      { method: "POST" }
    ),

  // Monitoring
  startMonitoring: (id: string, interval: number = 300) =>
    request<any>(`/api/groups/${id}/monitor/start?interval=${interval}`, {
      method: "POST",
    }),
  stopMonitoring: (id: string) =>
    request<any>(`/api/groups/${id}/monitor/stop`, { method: "POST" }),
  getMonitorStatus: (id: string) =>
    request<any>(`/api/groups/${id}/monitor`),
  getAllMonitoring: () => request<any>("/api/monitoring"),

  // Sheets
  getSheetStats: () => request<Record<string, number>>("/api/sheets/stats"),
  getSheetMembers: (groupName: string) =>
    request<any>(`/api/sheets/${encodeURIComponent(groupName)}/members`),

  // Health
  health: () => request<any>("/api/health"),

  // -------- Phase 1: Account signup (web-based SMS flow) --------
  signupStart: (body: {
    phone: string;
    label?: string;
    proxy?: ProxyInput | null;
    api_id?: number | null;
    api_hash?: string | null;
  }) =>
    request<SignupStartResponse>(`/api/accounts/signup/start`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  signupVerify: (signup_token: string, code: string) =>
    request<SignupStepResponse>(`/api/accounts/signup/verify`, {
      method: "POST",
      body: JSON.stringify({ signup_token, code }),
    }),
  signupPassword: (signup_token: string, password: string) =>
    request<SignupStepResponse>(`/api/accounts/signup/password`, {
      method: "POST",
      body: JSON.stringify({ signup_token, password }),
    }),
  signupAbandon: (signup_token: string) =>
    request<{ abandoned: boolean }>(`/api/accounts/signup/${signup_token}`, {
      method: "DELETE",
    }),

  // -------- Phase 1: Accounts --------
  getAccounts: () => request<Account[]>("/api/accounts"),
  getAccount: (id: string) => request<Account>(`/api/accounts/${id}`),
  updateAccount: (
    id: string,
    body: { label?: string; dismiss_error?: boolean }
  ) =>
    request<Account>(`/api/accounts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  pauseAccount: (id: string) =>
    request<Account>(`/api/accounts/${id}/pause`, { method: "POST" }),
  resumeAccount: (id: string) =>
    request<Account>(`/api/accounts/${id}/resume`, { method: "POST" }),
  healthCheckAccount: (id: string) =>
    request<any>(`/api/accounts/${id}/health-check`, { method: "POST" }),
  healthCheckAll: () =>
    request<Record<string, any>>(`/api/accounts/health-check-all`, {
      method: "POST",
    }),
  removeAccount: (id: string) =>
    request<any>(`/api/accounts/${id}`, { method: "DELETE" }),

  // -------- Phase 1: Sender --------
  enqueue: (body: {
    account_id: string;
    targets: any[];
    templates: string[];
    delete_after_s?: number | null;
    campaign?: string;
  }) =>
    request<any>(`/api/sender/enqueue`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  distribute: (body: {
    account_ids: string[];
    targets: any[];
    templates: string[];
    delete_after_s?: number | null;
    campaign?: string;
  }) =>
    request<{ enqueued: Record<string, number> }>(`/api/sender/distribute`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getQueue: () =>
    request<Record<string, QueueSnapshotEntry>>(`/api/sender/queue`),
  clearQueueOne: (accountId: string) =>
    request<any>(`/api/sender/queue/${accountId}`, { method: "DELETE" }),
  clearQueueAll: () =>
    request<any>(`/api/sender/queue`, { method: "DELETE" }),
  getSentLog: (params?: { limit?: number; account_id?: string }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.account_id) q.set("account_id", params.account_id);
    const qs = q.toString();
    return request<SentLogEntry[]>(
      `/api/sender/sent-log${qs ? `?${qs}` : ""}`
    );
  },
  startWorker: (id: string) =>
    request<any>(`/api/sender/workers/${id}/start`, { method: "POST" }),
  stopWorker: (id: string) =>
    request<any>(`/api/sender/workers/${id}/stop`, { method: "POST" }),
  startAllWorkers: () =>
    request<any>(`/api/sender/workers/start-all`, { method: "POST" }),
  stopAllWorkers: () =>
    request<any>(`/api/sender/workers/stop-all`, { method: "POST" }),
  getWorkers: () => request<WorkerStatus>(`/api/sender/workers`),

  // -------- Phase 1: Warm-up --------
  getWarmupGroups: () =>
    request<{ urls: string[] }>(`/api/warmup/groups`),
  setWarmupGroups: (urls: string[]) =>
    request<{ urls: string[] }>(`/api/warmup/groups`, {
      method: "PUT",
      body: JSON.stringify({ urls }),
    }),
  runWarmup: (id: string) =>
    request<any>(`/api/warmup/run/${id}`, { method: "POST" }),
  runWarmupAll: () =>
    request<any>(`/api/warmup/run-all`, { method: "POST" }),

  // -------- Phase 1: Campaigns --------
  getReplies: (params?: { limit?: number; account_id?: string }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.account_id) q.set("account_id", params.account_id);
    const qs = q.toString();
    return request<ReplyEntry[]>(`/api/replies${qs ? `?${qs}` : ""}`);
  },

  enqueueFromSheet: (body: {
    sheet_group_name: string;
    account_ids: string[];
    delete_after_s?: number | null;
    campaign?: string;
    limit?: number | null;
    shuffle?: boolean;
    filter_bots?: boolean;
    // Drop targets we've already DM'd from any account (global dedupe).
    // Defaults true on the backend if omitted.
    dedupe_already_contacted?: boolean;
    // Drop targets without a public @username (Telegram can't cold-DM
    // them by user_id alone). Defaults true on the backend.
    require_username?: boolean;
    // Multi-arm A/B form (preferred). Each arm carries its own templates +
    // optional follow-up config; targets are split round-robin across arms.
    arms?: CampaignArmInput[];
    // Legacy single-arm form. Used when `arms` is omitted; backend converts
    // to a single implicit arm named "A".
    templates?: string[];
    follow_up_after_days?: number | null;
    follow_up_templates?: string[];
  }) =>
    request<{
      // "completed" — synchronous inline launch (small / non-AI campaigns).
      // "running_in_background" — large AI campaigns return a run_id and
      // process in the background. Poll `getCampaignRun(run_id)` for progress.
      status: "completed" | "running_in_background";
      run_id?: string;
      enqueued: Record<string, Record<string, number>>;
      targets_found: number;
      filtered_out: number;
      no_username_out: number;
      deduped_out: number;
      arms?: string[];
    }>(`/api/campaigns/enqueue-from-sheet`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getCampaignStats: (campaignName: string) =>
    request<CampaignStats>(
      `/api/campaigns/${encodeURIComponent(campaignName)}/stats`
    ),

  listCampaignRuns: (limit = 30) =>
    request<CampaignRun[]>(`/api/campaigns/runs?limit=${limit}`),
  getCampaignRun: (runId: string) =>
    request<CampaignRun>(`/api/campaigns/runs/${runId}`),

  getAIStatus: () => request<AIStatus>(`/api/campaigns/ai/status`),

  getAnalyticsSummary: (days = 14) =>
    request<AnalyticsSummary>(`/api/analytics/summary?days=${days}`),

  // -------- Phase 3: Funnel — tracked groups + joins + scorecards --------
  listTrackedGroups: () => request<TrackedGroup[]>(`/api/tracked-groups`),
  addTrackedGroup: (url: string, interval_s?: number) =>
    request<TrackedGroup>(`/api/tracked-groups`, {
      method: "POST",
      body: JSON.stringify({ url, interval_s }),
    }),
  removeTrackedGroup: (id: string) =>
    request<{ removed: boolean }>(`/api/tracked-groups/${id}`, { method: "DELETE" }),
  pollTrackedGroup: (id: string) =>
    request<{ joined: number; left: number; total_members: number }>(
      `/api/tracked-groups/${id}/poll`,
      { method: "POST" }
    ),
  pollAllTrackedGroups: () =>
    request<{ results: any[] }>(`/api/tracked-groups/poll-all`, { method: "POST" }),
  getJoins: (params?: { limit?: number; group_id?: number; campaign?: string }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.group_id) q.set("group_id", String(params.group_id));
    if (params?.campaign) q.set("campaign", params.campaign);
    const qs = q.toString();
    return request<JoinEvent[]>(`/api/joins${qs ? `?${qs}` : ""}`);
  },
  getGroupScorecards: () =>
    request<GroupScorecard[]>(`/api/groups/scorecards`),

  // -------- Phase 3: Engagement bot (Sheet → Telegram broadcaster) --------
  getBotStatus: () => request<BotStatus>(`/api/bot/status`),
  getBotQueue: () => request<BotQueueRow[]>(`/api/bot/queue`),
  getBotHistory: (limit = 50) =>
    request<BotHistoryEntry[]>(`/api/bot/history?limit=${limit}`),
  botPostNow: (rowIdx: number) =>
    request<{ ok: boolean; status?: string; row: number; message_id?: number }>(
      `/api/bot/post-now/${rowIdx}`,
      { method: "POST" }
    ),
  botRunCycle: () =>
    request<{ posted: number; errors: number; considered: number }>(
      `/api/bot/run-cycle`,
      { method: "POST" }
    ),

  // -------- Phase 3: AI engagement writer (auto-generates bot posts) --------
  getBotWriterConfig: () => request<BotWriterConfig>(`/api/bot/writer/config`),
  updateBotWriterConfig: (patch: Partial<BotWriterConfig>) =>
    request<BotWriterConfig>(`/api/bot/writer/config`, {
      method: "PUT",
      body: JSON.stringify(patch),
    }),
  previewBotWriter: () =>
    request<BotWriterPreview>(`/api/bot/writer/preview`, { method: "POST" }),
  runBotWriterNow: () =>
    request<BotWriterRunResult>(`/api/bot/writer/run-now`, { method: "POST" }),

  // -------- Phase 3 VA workflow: post CRUD --------
  addBotPost: (body: {
    content: string;
    scheduled_at: string;
    type?: string;
    image_url?: string;
    status?: string;
  }) =>
    request<BotQueueRow>(`/api/bot/post`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  bulkBotPosts: (body: {
    items: { content: string; type?: string; image_url?: string }[];
    spread_days?: number;
    posts_per_day?: number;
    pending_review?: boolean;
  }) =>
    request<{ added: number; rows: BotQueueRow[] }>(`/api/bot/posts/bulk`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateBotPost: (
    rowIdx: number,
    patch: {
      content?: string;
      scheduled_at?: string;
      type?: string;
      image_url?: string;
      status?: string;
    }
  ) =>
    request<BotQueueRow>(`/api/bot/post/${rowIdx}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteBotPost: (rowIdx: number) =>
    request<{ deleted: boolean }>(`/api/bot/post/${rowIdx}`, {
      method: "DELETE",
    }),
  approveBotPost: (rowIdx: number) =>
    request<BotQueueRow>(`/api/bot/post/${rowIdx}/approve`, {
      method: "POST",
    }),
};
