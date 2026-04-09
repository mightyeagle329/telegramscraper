"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function MonitoringPanel() {
  const [monitoring, setMonitoring] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);

  const fetchMonitoring = async () => {
    try {
      const data = await api.getAllMonitoring();
      setMonitoring(data);
    } catch {
      // Backend might be offline
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMonitoring();
    const interval = setInterval(fetchMonitoring, 10000);
    return () => clearInterval(interval);
  }, []);

  const activeMonitors = Object.entries(monitoring).filter(
    ([, status]) => status.is_monitoring
  );

  if (loading) return null;

  if (activeMonitors.length === 0) {
    return (
      <div className="bg-card-bg border border-card-border rounded-xl p-6 mb-6">
        <h2 className="text-lg font-semibold mb-2">Monitoring</h2>
        <p className="text-text-muted text-sm">
          No groups being monitored. Click &quot;Monitor&quot; on a group to start
          tracking new members.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-card-bg border border-card-border rounded-xl p-6 mb-6">
      <h2 className="text-lg font-semibold mb-4">
        Active Monitoring ({activeMonitors.length})
      </h2>
      <div className="space-y-3">
        {activeMonitors.map(([url, status]) => (
          <div
            key={url}
            className="flex items-center justify-between bg-background/50 rounded-lg p-3"
          >
            <div>
              <div className="font-medium text-sm">
                {status.group_name || url}
              </div>
              <div className="text-text-muted text-xs">
                Checking every {Math.round(status.interval_seconds / 60)} min
              </div>
            </div>
            <div className="text-right">
              {status.new_members_since_last > 0 ? (
                <div className="text-accent-green text-sm font-medium">
                  +{status.new_members_since_last} new
                </div>
              ) : (
                <div className="text-text-muted text-sm">No new members</div>
              )}
              {status.last_check && (
                <div className="text-text-muted text-xs">
                  Last: {new Date(status.last_check).toLocaleTimeString()}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
