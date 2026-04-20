"use client";

import { useCallback, useEffect, useState } from "react";
import AddAccountModal from "@/components/AddAccountModal";
import { api } from "@/lib/api";
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
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [workers, setWorkers] = useState<WorkerStatus>({});
  const [busy, setBusy] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

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

  return (
    <>
      <main className="max-w-6xl mx-auto px-4 md:px-6 py-6 md:py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Accounts</h1>
          <p className="text-text-muted text-sm">
            Sender accounts — status, warm-up, daily quotas.
          </p>
        </div>
        {error ? (
          <div className="mb-4 px-4 py-2 bg-accent-red/10 border border-accent-red/30 text-accent-red rounded-lg text-sm">
            {error}
          </div>
        ) : null}

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <SummaryCard label="Active" value={totals.active} />
          <SummaryCard label="Warming" value={totals.warming} />
          <SummaryCard label="Paused" value={totals.paused} />
          <SummaryCard label="Banned" value={totals.banned} />
          <SummaryCard
            label="Today's DMs"
            value={`${totals.dailySent} / ${totals.dailyLimit}`}
          />
        </div>

        <div className="flex flex-wrap gap-3 mb-4">
          <button
            onClick={() => setAddOpen(true)}
            className="px-3 py-1.5 rounded-lg bg-accent-green/20 border border-accent-green/40 text-accent-green text-sm font-medium hover:bg-accent-green/30"
          >
            + Add account
          </button>
          <button
            onClick={() =>
              run("__all__", "health-check-all", () => api.healthCheckAll())
            }
            disabled={!!checkingAll}
            className="px-3 py-1.5 rounded-lg bg-card-bg border border-card-border text-sm hover:bg-card-border disabled:opacity-50"
          >
            {checkingAll ? "Running health check…" : "Health check all"}
          </button>
          <button
            onClick={() =>
              run("__all__", "start-all", () => api.startAllWorkers())
            }
            className="px-3 py-1.5 rounded-lg bg-card-bg border border-card-border text-sm hover:bg-card-border"
          >
            Start all workers
          </button>
          <button
            onClick={() =>
              run("__all__", "stop-all", () => api.stopAllWorkers())
            }
            className="px-3 py-1.5 rounded-lg bg-card-bg border border-card-border text-sm hover:bg-card-border"
          >
            Stop all workers
          </button>
        </div>

        {loading ? (
          <div className="bg-card-bg border border-card-border rounded-xl p-8 text-center text-text-muted">
            Loading accounts…
          </div>
        ) : accounts.length === 0 ? (
          <div className="bg-card-bg border border-card-border rounded-xl p-8 text-center text-text-muted">
            <p className="font-medium text-foreground mb-2">No accounts yet.</p>
            <p className="text-sm mb-4">
              Click <strong>+ Add account</strong> above to onboard your first
              sender (phone + IPRoyal sticky session + SMS code, all from this
              page).
            </p>
            <p className="text-xs text-text-muted">
              Prefer the terminal?{" "}
              <code className="text-xs">python add_account.py</code> from the
              backend folder also works.
            </p>
          </div>
        ) : (
          <div className="bg-card-bg border border-card-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-card-border/50 text-text-muted text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Account</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="text-left px-4 py-2">Worker</th>
                  <th className="text-left px-4 py-2">Warm-up</th>
                  <th className="text-left px-4 py-2">Today</th>
                  <th className="text-left px-4 py-2">Total sent</th>
                  <th className="text-left px-4 py-2">Proxy</th>
                  <th className="text-left px-4 py-2">Last error</th>
                  <th className="text-right px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const day = warmupDay(a.warmup_started_at);
                  const wstate = workers[a.id] ?? "stopped";
                  const b = busy[a.id];
                  return (
                    <tr
                      key={a.id}
                      className="border-t border-card-border/60 hover:bg-card-border/20"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium">{a.label}</div>
                        <div className="text-text-muted text-xs">
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
                              : wstate === "paused"
                              ? "text-blue-400"
                              : "text-text-muted"
                          }`}
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
                      <td className="px-4 py-3 text-text-muted text-xs">
                        {a.proxy_host
                          ? `${a.proxy_type}://${a.proxy_host}:${a.proxy_port}`
                          : "direct"}
                      </td>
                      <td className="px-4 py-3 text-xs text-accent-red max-w-[220px] truncate">
                        {a.last_error ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex gap-1">
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
                              Resume
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
                              Pause
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
                            Check
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
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
