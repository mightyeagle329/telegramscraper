"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Account, SentLogEntry } from "@/lib/types";

export default function DashboardHome() {
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
    queued: Object.values(queue).reduce(
      (s, q) => s + (q?.pending ?? 0),
      0
    ),
  };

  return (
    <main className="max-w-6xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Overview</h1>
        <p className="text-text-muted text-sm">
          Fleet status and recent activity across your sender accounts.
        </p>
      </div>

      {error ? (
        <div className="px-4 py-2 bg-accent-red/10 border border-accent-red/30 text-accent-red rounded-lg text-sm">
          {error} — is the Python backend running on port 8000?
        </div>
      ) : null}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Active senders" value={totals.active} />
        <Stat label="Warming up" value={totals.warming} />
        <Stat label="Paused / banned" value={totals.paused + totals.banned} />
        <Stat
          label="Today's DMs"
          value={`${totals.dailySent} / ${totals.dailyLimit}`}
        />
      </div>

      <section className="grid md:grid-cols-2 gap-6">
        <div className="bg-card-bg border border-card-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Queue</h2>
            <Link
              href="/campaigns"
              className="text-xs text-text-muted hover:text-foreground"
            >
              manage →
            </Link>
          </div>
          {loading ? (
            <div className="text-text-muted text-sm">Loading…</div>
          ) : totals.queued === 0 ? (
            <p className="text-text-muted text-sm">
              No DMs queued. Start a campaign from the{" "}
              <Link
                href="/campaigns"
                className="text-foreground hover:underline"
              >
                Campaigns
              </Link>{" "}
              page.
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
                    {q?.pending ?? 0} pending
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-card-bg border border-card-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Recent sends</h2>
            <Link
              href="/campaigns"
              className="text-xs text-text-muted hover:text-foreground"
            >
              all →
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="text-text-muted text-sm">No sends yet.</p>
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
                          ? "text-yellow-400"
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

      <section className="bg-card-bg border border-card-border rounded-xl p-5">
        <h2 className="text-lg font-semibold mb-3">Next actions</h2>
        <ul className="grid md:grid-cols-3 gap-3 text-sm">
          <ActionCard
            href="/accounts"
            title="Add sender accounts"
            body={`${accounts.length}/10 connected.`}
          />
          <ActionCard
            href="/groups"
            title="Scrape groups"
            body="Pull members from Telegram groups you belong to."
          />
          <ActionCard
            href="/campaigns"
            title="Launch a campaign"
            body="Pick a source, write templates, enqueue DMs."
          />
        </ul>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-card-bg border border-card-border rounded-xl p-4">
      <div className="text-text-muted text-xs uppercase tracking-wide">
        {label}
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
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
