"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import type { Group } from "@/lib/types";
import AddGroup from "@/components/AddGroup";
import GroupTable from "@/components/GroupTable";
import MonitoringPanel from "@/components/MonitoringPanel";

export default function GroupsPage() {
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
    <>
      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Groups</h1>
          <p className="text-text-muted text-sm">
            Extract group members for outreach.
          </p>
        </div>
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
    </>
  );
}
