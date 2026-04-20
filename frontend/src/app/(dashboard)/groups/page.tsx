"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { api } from "@/lib/api";
import type { Group } from "@/lib/types";
import AddGroup from "@/components/AddGroup";
import GroupTable from "@/components/GroupTable";
import MonitoringPanel from "@/components/MonitoringPanel";
import Pagination from "@/components/Pagination";
import { useT } from "@/lib/i18n/context";

export default function GroupsPage() {
  const t = useT();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

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

  const paginated = useMemo(
    () => groups.slice((page - 1) * pageSize, page * pageSize),
    [groups, page, pageSize]
  );

  return (
    <>
      <main className="max-w-6xl mx-auto px-4 md:px-6 py-6 md:py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">{t("groups.title")}</h1>
          <p className="text-text-muted text-sm">{t("groups.subtitle")}</p>
        </div>
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4 mb-6">
          <div className="card-elevated p-4 md:p-5">
            <div className="text-text-muted text-xs md:text-sm">
              {t("groups.stat.total")}
            </div>
            <div className="text-2xl md:text-3xl font-bold mt-1">
              {groups.length}
            </div>
          </div>
          <div className="card-elevated p-4 md:p-5">
            <div className="text-text-muted text-xs md:text-sm">
              {t("groups.stat.scraped")}
            </div>
            <div className="text-2xl md:text-3xl font-bold mt-1">
              {groups
                .reduce((sum, g) => sum + g.scraped_count, 0)
                .toLocaleString()}
            </div>
          </div>
          <div className="card-elevated p-4 md:p-5 col-span-2 md:col-span-1">
            <div className="text-text-muted text-xs md:text-sm">
              {t("groups.stat.monitoring")}
            </div>
            <div className="text-2xl md:text-3xl font-bold mt-1">
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
          <div className="card-elevated p-8 text-center text-text-muted">
            Loading groups...
          </div>
        ) : groups.length === 0 ? (
          <GroupTable groups={[]} onRefresh={fetchGroups} />
        ) : (
          <>
            <GroupTable groups={paginated} onRefresh={fetchGroups} />
            {groups.length > pageSize ? (
              <div className="bg-card-bg border border-card-border rounded-xl mt-2">
                <Pagination
                  total={groups.length}
                  page={page}
                  pageSize={pageSize}
                  onPageChange={setPage}
                  onPageSizeChange={(n) => {
                    setPageSize(n);
                    setPage(1);
                  }}
                  label="groups"
                />
              </div>
            ) : null}
          </>
        )}
      </main>
    </>
  );
}
