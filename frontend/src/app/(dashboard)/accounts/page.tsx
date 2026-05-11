"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AccountLabelEditor from "@/components/AccountLabelEditor";
import AddAccountModal from "@/components/AddAccountModal";
import Pagination from "@/components/Pagination";
import ProxyCell from "@/components/ProxyCell";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n/context";
import type { Account, AccountStatus, WorkerStatus } from "@/lib/types";

const STATUS_STYLES: Record<AccountStatus, string> = {
  warming: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  active: "bg-accent-green/15 text-accent-green border-accent-green/30",
  paused: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  banned: "bg-accent-red/15 text-accent-red border-accent-red/30",
};

function StatusBadge({ status }: { status: AccountStatus }) {
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_STYLES[status] ?? ""}`}
    >
      {status}
    </span>
  );
}

function warmupDay(startedAt: string | null): number | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return null;
  const days = Math.floor((Date.now() - start) / 86_400_000) + 1;
  return days;
}

export default function AccountsPage() {
  const t = useT();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [workers, setWorkers] = useState<WorkerStatus>({});
  const [busy, setBusy] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const refresh = useCallback(async () => {
    try {
      const [accts, w] = await Promise.all([
        api.getAccounts(),
        api.getWorkers().catch(() => ({})),
      ]);
      setAccounts(accts);
      setWorkers(w);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const run = async (id: string, label: string, fn: () => Promise<unknown>) => {
    setBusy((b) => ({ ...b, [id]: label }));
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy((b) => ({ ...b, [id]: null }));
    }
  };

  const checkingAll = busy["__all__"];

  const totals = {
    active: accounts.filter((a) => a.status === "active").length,
    warming: accounts.filter((a) => a.status === "warming").length,
    paused: accounts.filter((a) => a.status === "paused").length,
    banned: accounts.filter((a) => a.status === "banned").length,
    dailySent: accounts.reduce((s, a) => s + (a.daily_sent || 0), 0),
    dailyLimit: accounts.reduce((s, a) => s + (a.daily_limit || 0), 0),
  };

  const paginatedAccounts = useMemo(
    () => accounts.slice((page - 1) * pageSize, page * pageSize),
    [accounts, page, pageSize]
  );

  return (
    <>
      <main className="max-w-6xl mx-auto px-4 md:px-6 py-6 md:py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">{t("accounts.title")}</h1>
          <p className="text-text-muted text-sm">{t("accounts.subtitle")}</p>
        </div>
        {error ? (
          <div className="mb-4 px-4 py-2 bg-accent-red/10 border border-accent-red/30 text-accent-red rounded-lg text-sm">
            {error}
          </div>
        ) : null}

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4 mb-6">
          <SummaryCard label={t("accounts.stat.active")} value={totals.active} />
          <SummaryCard label={t("accounts.stat.warming")} value={totals.warming} />
          <SummaryCard label={t("accounts.stat.paused")} value={totals.paused} />
          <SummaryCard label={t("accounts.stat.banned")} value={totals.banned} />
          <SummaryCard
            label={t("accounts.stat.today")}
            value={`${totals.dailySent} / ${totals.dailyLimit}`}
          />
        </div>

        <div className="flex flex-wrap gap-2 md:gap-3 mb-4">
          <button
            onClick={() => setAddOpen(true)}
            className="px-3 py-1.5 rounded-lg bg-accent-green/20 border border-accent-green/40 text-accent-green text-sm font-medium hover:bg-accent-green/30"
          >
            {t("accounts.add")}
          </button>
          <button
            onClick={() =>
              run("__all__", "health-check-all", () => api.healthCheckAll())
            }
            disabled={!!checkingAll}
            className="px-3 py-1.5 rounded-lg bg-card-bg border border-card-border text-sm hover:bg-card-border disabled:opacity-50"
          >
            {checkingAll ? t("accounts.healthChecking") : t("accounts.healthCheckAll")}
          </button>
          <button
            onClick={() =>
              run("__all__", "start-all", () => api.startAllWorkers())
            }
            className="px-3 py-1.5 rounded-lg bg-card-bg border border-card-border text-sm hover:bg-card-border"
          >
            {t("accounts.startAll")}
          </button>
          <button
            onClick={() =>
              run("__all__", "stop-all", () => api.stopAllWorkers())
            }
            className="px-3 py-1.5 rounded-lg bg-card-bg border border-card-border text-sm hover:bg-card-border"
          >
            {t("accounts.stopAll")}
          </button>
        </div>

        {loading ? (
          <div className="card-elevated p-8 text-center text-text-muted">
            {t("accounts.loading")}
          </div>
        ) : accounts.length === 0 ? (
          <div className="card-elevated p-8 text-center text-text-muted">
            <p className="font-medium text-foreground mb-2">
              {t("accounts.empty.title")}
            </p>
            <p className="text-sm mb-4">{t("accounts.empty.body")}</p>
          </div>
        ) : (
          <div className="bg-card-bg border border-card-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-card-border/50 text-text-muted text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">{t("accounts.table.account")}</th>
                  <th className="text-left px-4 py-2">{t("accounts.table.status")}</th>
                  <th className="text-left px-4 py-2">{t("accounts.table.worker")}</th>
                  <th className="text-left px-4 py-2">{t("accounts.table.warmup")}</th>
                  <th className="text-left px-4 py-2">{t("accounts.table.today")}</th>
                  <th className="text-left px-4 py-2">{t("accounts.table.total")}</th>
                  <th className="text-left px-4 py-2">{t("accounts.table.proxy")}</th>
                  <th className="text-left px-4 py-2">{t("accounts.table.lastError")}</th>
                  <th className="text-right px-4 py-2">{t("accounts.table.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {paginatedAccounts.map((a) => {
                  const day = warmupDay(a.warmup_started_at);
                  const wstate = workers[a.id] ?? "stopped";
                  const b = busy[a.id];
                  return (
                    <tr
                      key={a.id}
                      className="border-t border-card-border/60 hover:bg-card-border/20"
                    >
                      <td className="px-4 py-3">
                        <AccountLabelEditor
                          accountId={a.id}
                          value={a.label}
                          onSaved={refresh}
                        />
                        <div className="text-text-muted text-xs mt-0.5">
                          {a.id} · {a.phone}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={a.status} />
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs ${
                            wstate === "running"
                              ? "text-accent-green"
                              : wstate === "resting"
                              ? "text-accent-yellow"
                              : "text-text-muted"
                          }`}
                          title={
                            wstate === "resting"
                              ? "Worker is in a short internal cooldown after a TG rate-limit event. Auto-resumes on its own — no action needed."
                              : undefined
                          }
                        >
                          {wstate}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-text-muted">
                        {day !== null ? `day ${day}` : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {a.daily_sent} / {a.daily_limit}
                      </td>
                      <td className="px-4 py-3 text-text-muted">
                        {a.total_sent}
                      </td>
                      <td className="px-4 py-3">
                        <ProxyCell
                          type={a.proxy_type}
                          host={a.proxy_host}
                          port={a.proxy_port}
                          username={a.proxy_username ?? null}
                          password={a.proxy_password ?? null}
                        />
                      </td>
                      <td className="px-4 py-3 text-xs max-w-[220px]">
                        {a.last_error ? (
                          <div className="flex items-start gap-1">
                            <span
                              className="text-accent-red truncate"
                              title={a.last_error}
                            >
                              {a.last_error}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                run(a.id, "dismiss-error", () =>
                                  api.updateAccount(a.id, {
                                    dismiss_error: true,
                                  })
                                )
                              }
                              disabled={!!b}
                              title="Dismiss this error"
                              className="text-text-muted hover:text-foreground shrink-0 px-1"
                            >
                              ×
                            </button>
                          </div>
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex flex-wrap gap-1 justify-end">
                          {wstate === "running" ? (
                            <button
                              onClick={() =>
                                run(a.id, "stop-worker", () =>
                                  api.stopWorker(a.id)
                                )
                              }
                              disabled={!!b}
                              title="Stop this account's sender worker"
                              className="px-2 py-1 rounded-md border border-card-border text-xs hover:bg-card-border disabled:opacity-50"
                            >
                              Stop
                            </button>
                          ) : a.status !== "banned" ? (
                            <button
                              onClick={() =>
                                run(a.id, "start-worker", () =>
                                  api.startWorker(a.id)
                                )
                              }
                              disabled={!!b}
                              title="Start this account's sender worker"
                              className="px-2 py-1 rounded-md border border-accent-green/40 text-accent-green text-xs hover:bg-accent-green/10 disabled:opacity-50"
                            >
                              Start
                            </button>
                          ) : null}

                          {a.status === "paused" ? (
                            <button
                              onClick={() =>
                                run(a.id, "resume", () =>
                                  api.resumeAccount(a.id)
                                )
                              }
                              disabled={!!b}
                              className="px-2 py-1 rounded-md border border-card-border text-xs hover:bg-card-border disabled:opacity-50"
                            >
                              {t("accounts.action.resume")}
                            </button>
                          ) : a.status !== "banned" ? (
                            <button
                              onClick={() =>
                                run(a.id, "pause", () =>
                                  api.pauseAccount(a.id)
                                )
                              }
                              disabled={!!b}
                              className="px-2 py-1 rounded-md border border-card-border text-xs hover:bg-card-border disabled:opacity-50"
                            >
                              {t("accounts.action.pause")}
                            </button>
                          ) : null}

                          <button
                            onClick={() =>
                              run(a.id, "health", () =>
                                api.healthCheckAccount(a.id)
                              )
                            }
                            disabled={!!b}
                            className="px-2 py-1 rounded-md border border-card-border text-xs hover:bg-card-border disabled:opacity-50"
                          >
                            {t("accounts.action.check")}
                          </button>

                          <button
                            onClick={() => {
                              if (
                                confirm(
                                  `Remove ${a.id} and delete its session file? The number will need to re-sign in to be re-used.`
                                )
                              ) {
                                run(a.id, "remove", () =>
                                  api.removeAccount(a.id)
                                );
                              }
                            }}
                            disabled={!!b}
                            className="px-2 py-1 rounded-md border border-accent-red/40 text-accent-red text-xs hover:bg-accent-red/10 disabled:opacity-50"
                          >
                            {t("accounts.action.remove")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
            <Pagination
              total={accounts.length}
              page={page}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(n) => {
                setPageSize(n);
                setPage(1);
              }}
              label="accounts"
            />
          </div>
        )}

        <AddAccountModal
          open={addOpen}
          onClose={() => setAddOpen(false)}
          onSuccess={refresh}
        />
      </main>
    </>
  );
}

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="bg-card-bg border border-card-border rounded-xl p-4">
      <div className="text-text-muted text-xs uppercase tracking-wide">
        {label}
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}
