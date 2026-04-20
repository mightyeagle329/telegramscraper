"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { Group } from "@/lib/types";

interface GroupTableProps {
  groups: Group[];
  onRefresh: () => void;
}

export default function GroupTable({ groups, onRefresh }: GroupTableProps) {
  const [scraping, setScraping] = useState<string | null>(null);
  const [monitoring, setMonitoring] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, any>>({});
  const [error, setError] = useState("");

  const handleScrape = async (group: Group) => {
    setScraping(group.id);
    setError("");
    try {
      const result = await api.scrapeGroup(group.id);
      setResults((prev) => ({ ...prev, [group.id]: result }));
      onRefresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setScraping(null);
    }
  };

  const handleScrapeMessages = async (group: Group) => {
    setScraping(group.id);
    setError("");
    try {
      const result = await api.scrapeGroupMessages(group.id, 5000);
      setResults((prev) => ({ ...prev, [group.id]: result }));
      onRefresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setScraping(null);
    }
  };

  const handleMonitorToggle = async (group: Group) => {
    const isCurrentlyMonitoring = group.status === "monitoring";
    try {
      if (isCurrentlyMonitoring) {
        await api.stopMonitoring(group.id);
      } else {
        await api.startMonitoring(group.id);
      }
      onRefresh();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleDelete = async (group: Group) => {
    if (!confirm(`Remove "${group.name}" from tracking?`)) return;
    try {
      await api.removeGroup(group.id);
      onRefresh();
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (groups.length === 0) {
    return (
      <div className="bg-card-bg border border-card-border rounded-xl p-8 text-center text-text-muted">
        No groups added yet. Add a Telegram group URL above to get started.
      </div>
    );
  }

  return (
    <div className="bg-card-bg border border-card-border rounded-xl overflow-hidden">
      <div className="p-4 border-b border-card-border">
        <h2 className="text-lg font-semibold">
          Tracked Groups ({groups.length})
        </h2>
      </div>

      {error && (
        <div className="px-4 py-2 bg-accent-red/10 text-accent-red text-sm">
          {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-card-border text-left text-text-muted text-sm">
              <th className="px-4 py-3">Group</th>
              <th className="px-4 py-3">Members</th>
              <th className="px-4 py-3">Scraped</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Last Scraped</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr
                key={group.id}
                className="border-b border-card-border/50 hover:bg-card-border/20 transition-colors"
              >
                <td className="px-4 py-3">
                  <div>
                    <div className="font-medium">{group.name}</div>
                    <div className="text-text-muted text-sm">{group.url}</div>
                  </div>
                </td>
                <td className="px-4 py-3 text-text-muted">
                  {group.member_count.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-text-muted">
                  {group.scraped_count.toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                      group.status === "monitoring"
                        ? "bg-accent-green/20 text-accent-green"
                        : "bg-accent-blue/20 text-accent-blue"
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        group.status === "monitoring"
                          ? "bg-accent-green animate-pulse"
                          : "bg-accent-blue"
                      }`}
                    />
                    {group.status === "monitoring" ? "Monitoring" : "Active"}
                  </span>
                </td>
                <td className="px-4 py-3 text-text-muted text-sm">
                  {group.last_scraped
                    ? new Date(group.last_scraped).toLocaleString()
                    : "Never"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => handleScrape(group)}
                      disabled={scraping === group.id}
                      className="bg-accent-purple hover:bg-accent-purple/80 disabled:opacity-50 text-foreground text-sm px-3 py-1.5 rounded-lg transition-colors"
                      title="Scrape member list (works for supergroups)"
                    >
                      {scraping === group.id ? "Scraping..." : "Scrape Members"}
                    </button>
                    <button
                      onClick={() => handleScrapeMessages(group)}
                      disabled={scraping === group.id}
                      className="bg-accent-blue/80 hover:bg-accent-blue disabled:opacity-50 text-foreground text-sm px-3 py-1.5 rounded-lg transition-colors"
                      title="Extract users from message history (works for broadcast channels)"
                    >
                      {scraping === group.id ? "Scraping..." : "Scrape Messages"}
                    </button>
                    <button
                      onClick={() => handleMonitorToggle(group)}
                      className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
                        group.status === "monitoring"
                          ? "bg-accent-red/20 text-accent-red hover:bg-accent-red/30"
                          : "bg-accent-green/20 text-accent-green hover:bg-accent-green/30"
                      }`}
                    >
                      {group.status === "monitoring" ? "Stop" : "Monitor"}
                    </button>
                    <button
                      onClick={() => handleDelete(group)}
                      className="text-accent-red/60 hover:text-accent-red transition-colors p-1.5"
                      title="Remove group"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>

                  {results[group.id] && (
                    <div className="mt-2 text-xs text-accent-green">
                      Found {results[group.id].total_members_found} members,{" "}
                      {results[group.id].new_members_added} new added to sheet
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
