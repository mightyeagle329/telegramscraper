"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import type { Group } from "@/lib/types";
import AddGroup from "@/components/AddGroup";
import GroupTable from "@/components/GroupTable";
import StatusBar from "@/components/StatusBar";
import MonitoringPanel from "@/components/MonitoringPanel";

export default function Dashboard() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchGroups = useCallback(async () => {
    try {
      const data = await api.getGroups();
      setGroups(data);
    } catch {
      // Backend might be offline
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-card-border bg-card-bg/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Telegram Group Scraper</h1>
            <p className="text-text-muted text-sm">
              Extract group members for outreach
            </p>
          </div>
          <StatusBar />
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-card-bg border border-card-border rounded-xl p-5">
            <div className="text-text-muted text-sm">Total Groups</div>
            <div className="text-3xl font-bold mt-1">{groups.length}</div>
          </div>
          <div className="bg-card-bg border border-card-border rounded-xl p-5">
            <div className="text-text-muted text-sm">Total Scraped</div>
            <div className="text-3xl font-bold mt-1">
              {groups
                .reduce((sum, g) => sum + g.scraped_count, 0)
                .toLocaleString()}
            </div>
          </div>
          <div className="bg-card-bg border border-card-border rounded-xl p-5">
            <div className="text-text-muted text-sm">Monitoring</div>
            <div className="text-3xl font-bold mt-1">
              {groups.filter((g) => g.status === "monitoring").length}
            </div>
          </div>
        </div>

        {/* Add Group */}
        <AddGroup onGroupAdded={fetchGroups} />

        {/* Monitoring Panel */}
        <MonitoringPanel />

        {/* Groups Table */}
        {loading ? (
          <div className="bg-card-bg border border-card-border rounded-xl p-8 text-center text-text-muted">
            Loading groups...
          </div>
        ) : (
          <GroupTable groups={groups} onRefresh={fetchGroups} />
        )}
      </main>
    </div>
  );
}
