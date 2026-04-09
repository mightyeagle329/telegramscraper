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
  getSheetStats: () => request<any>("/api/sheets/stats"),
  getSheetMembers: (groupName: string) =>
    request<any>(`/api/sheets/${encodeURIComponent(groupName)}/members`),

  // Health
  health: () => request<any>("/api/health"),
};
