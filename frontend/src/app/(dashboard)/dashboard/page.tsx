"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n/context";
import type { Account, SentLogEntry } from "@/lib/types";

export default function DashboardHome() {
  const t = useT();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [recent, setRecent] = useState<SentLogEntry[]>([]);
  const [queue, setQueue] = useState<Record<string, { pending: number }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [a, r, q] = await Promise.all([
        api.getAccounts().catch(() => [] as Account[]),
        api.getSentLog({ limit: 10 }).catch(() => [] as SentLogEntry[]),
        api.getQueue().catch(() => ({})),
      ]);
      setAccounts(a);
      setRecent(r);
      setQueue(q);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const totals = {
    active: accounts.filter((a) => a.status === "active").length,
    warming: accounts.filter((a) => a.status === "warming").length,
    paused: accounts.filter((a) => a.status === "paused").length,
    banned: accounts.filter((a) => a.status === "banned").length,
    dailySent: accounts.reduce((s, a) => s + (a.daily_sent || 0), 0),
    dailyLimit: accounts.reduce((s, a) => s + (a.daily_limit || 0), 0),
    queued: Object.values(queue).reduce((s, q) => s + (q?.pending ?? 0), 0),
  };

  return (
    <main className="max-w-6xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("dashboard.title")}</h1>
        <p className="text-text-muted text-sm">{t("dashboard.subtitle")}</p>
      </div>

      {error ? (
        <div className="px-4 py-2 bg-accent-red/10 border border-accent-red/30 text-accent-red rounded-lg text-sm">
          {t("dashboard.error.backend", { error })}
        </div>
      ) : null}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <Stat label={t("dashboard.stat.active")} value={totals.active} />
        <Stat label={t("dashboard.stat.warming")} value={totals.warming} />
        <Stat
          label={t("dashboard.stat.paused")}
          value={totals.paused + totals.banned}
        />
        <Stat
          label={t("dashboard.stat.today")}
          value={`${totals.dailySent} / ${totals.dailyLimit}`}
        />
      </div>

      <section className="grid md:grid-cols-2 gap-6">
        <div className="card-elevated p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">{t("dashboard.queue.title")}</h2>
            <Link
              href="/campaigns"
              className="text-xs text-text-muted hover:text-foreground"
            >
              {t("nav.campaigns")} →
            </Link>
          </div>
          {loading ? (
            <div className="text-text-muted text-sm">…</div>
          ) : totals.queued === 0 ? (
            <p className="text-text-muted text-sm">
              {t("dashboard.queue.empty")}
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {Object.entries(queue).map(([aid, q]) => (
                <li
                  key={aid}
                  className="flex items-center justify-between border-b border-card-border/40 pb-2"
                >
                  <span className="font-medium">{aid}</span>
                  <span className="text-text-muted">
                    {t("dashboard.queue.pending", { n: q?.pending ?? 0 })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card-elevated p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">
              {t("dashboard.recent.title")}
            </h2>
            <Link
              href="/campaigns"
              className="text-xs text-text-muted hover:text-foreground"
            >
              {t("nav.campaigns")} →
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="text-text-muted text-sm">
              {t("dashboard.recent.empty")}
            </p>
          ) : (
            <ul className="space-y-1 text-xs font-mono max-h-64 overflow-y-auto">
              {recent
                .slice()
                .reverse()
                .map((e, i) => (
                  <li
                    key={`${e.timestamp}-${i}`}
                    className="flex items-center justify-between gap-2 border-b border-card-border/40 py-1"
                  >
                    <span className="text-text-muted truncate">
                      {new Date(e.timestamp).toLocaleTimeString()}{" "}
                      {e.account_id} →{" "}
                      {e.target_username || e.target_user_id}
                    </span>
                    <span
                      className={
                        e.status === "sent"
                          ? "text-accent-green"
                          : e.status === "skipped"
                          ? "text-text-muted"
                          : e.status === "paused"
                          ? "text-accent-yellow"
                          : "text-accent-red"
                      }
                    >
                      {e.status}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </section>

      <section className="card-elevated p-5">
        <h2 className="text-lg font-semibold mb-3">
          {t("dashboard.actions.title")}
        </h2>
        <ul className="grid md:grid-cols-3 gap-3 text-sm">
          <ActionCard
            href="/accounts"
            title={t("dashboard.actions.addAccount.title")}
            body={t("dashboard.actions.addAccount.body", {
              count: accounts.length,
            })}
          />
          <ActionCard
            href="/groups"
            title={t("dashboard.actions.scrape.title")}
            body={t("dashboard.actions.scrape.body")}
          />
          <ActionCard
            href="/campaigns"
            title={t("dashboard.actions.campaign.title")}
            body={t("dashboard.actions.campaign.body")}
          />
        </ul>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card-elevated p-3 md:p-4">
      <div className="text-text-muted text-[11px] md:text-xs uppercase tracking-wide">
        {label}
      </div>
      <div className="text-xl md:text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}

function ActionCard({
  href,
  title,
  body,
}: {
  href: string;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className="border border-card-border rounded-lg p-4 hover:border-accent-green/40 transition-colors"
    >
      <div className="font-medium">{title}</div>
      <div className="text-text-muted text-xs mt-1">{body}</div>
    </Link>
  );
}
