"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n/context";
import type { Account, ReplyEntry, SentLogEntry } from "@/lib/types";

const PAGE_SIZE = 10;

export default function DashboardHome() {
  const t = useT();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [recent, setRecent] = useState<SentLogEntry[]>([]);
  const [replies, setReplies] = useState<ReplyEntry[]>([]);
  const [queue, setQueue] = useState<Record<string, { pending: number }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Limits grow by PAGE_SIZE on each "Load more" click. Auto-refresh uses
  // these same numbers so newly loaded entries don't snap back to 10 on
  // the next interval tick.
  const [replyLimit, setReplyLimit] = useState(PAGE_SIZE);
  const [recentLimit, setRecentLimit] = useState(PAGE_SIZE);
  const [loadingMoreReplies, setLoadingMoreReplies] = useState(false);
  const [loadingMoreRecent, setLoadingMoreRecent] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [a, r, q, rep] = await Promise.all([
        api.getAccounts().catch(() => [] as Account[]),
        api
          .getSentLog({ limit: recentLimit })
          .catch(() => [] as SentLogEntry[]),
        api.getQueue().catch(() => ({})),
        api
          .getReplies({ limit: replyLimit })
          .catch(() => [] as ReplyEntry[]),
      ]);
      setAccounts(a);
      setRecent(r);
      setQueue(q);
      setReplies(rep);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [replyLimit, recentLimit]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15_000);
    return () => clearInterval(interval);
  }, [refresh]);

  // Backend returned fewer than asked for → we've hit the end of the file.
  const hasMoreReplies = replies.length >= replyLimit;
  const hasMoreRecent = recent.length >= recentLimit;

  async function loadMoreReplies() {
    setLoadingMoreReplies(true);
    try {
      const next = replyLimit + PAGE_SIZE;
      const rep = await api.getReplies({ limit: next });
      setReplies(rep);
      setReplyLimit(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load more");
    } finally {
      setLoadingMoreReplies(false);
    }
  }

  async function loadMoreRecent() {
    setLoadingMoreRecent(true);
    try {
      const next = recentLimit + PAGE_SIZE;
      const r = await api.getSentLog({ limit: next });
      setRecent(r);
      setRecentLimit(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load more");
    } finally {
      setLoadingMoreRecent(false);
    }
  }

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
          {recent.length > 0 && hasMoreRecent ? (
            <div className="flex justify-center mt-3">
              <button
                onClick={loadMoreRecent}
                disabled={loadingMoreRecent}
                className="text-xs px-3 py-1.5 border border-card-border rounded-lg text-text-muted hover:text-foreground hover:border-foreground/40 disabled:opacity-50 transition-colors"
              >
                {loadingMoreRecent ? "Loading…" : `Load ${PAGE_SIZE} more`}
              </button>
            </div>
          ) : null}
        </div>
      </section>

      <section className="card-elevated p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Replies</h2>
          <span className="text-xs text-text-muted">
            {replies.length === 0
              ? "Live — replies will appear here automatically"
              : `${replies.length} most recent`}
          </span>
        </div>
        {replies.length === 0 ? (
          <p className="text-text-muted text-sm">
            No replies yet. The system listens on each sender account; when
            someone replies to one of our DMs, it shows here and any pending
            follow-up to that contact is auto-cancelled.
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {replies
              .slice()
              .reverse()
              .map((r, i) => (
                <li
                  key={`${r.account_id}-${r.message_id}-${i}`}
                  className="border-b border-card-border/40 pb-2 last:border-b-0"
                >
                  <div className="flex items-center justify-between gap-2 text-xs text-text-muted">
                    <span>
                      <span className="text-foreground font-medium">
                        {r.sender_username
                          ? `@${r.sender_username}`
                          : r.sender_first_name || r.sender_user_id}
                      </span>{" "}
                      → {r.account_id}
                    </span>
                    <span>
                      {new Date(r.received_at).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="text-sm mt-1 break-words">
                    {r.text || <em className="text-text-muted">(no text)</em>}
                  </div>
                </li>
              ))}
          </ul>
        )}
        {replies.length > 0 && hasMoreReplies ? (
          <div className="flex justify-center mt-4">
            <button
              onClick={loadMoreReplies}
              disabled={loadingMoreReplies}
              className="text-xs px-3 py-1.5 border border-card-border rounded-lg text-text-muted hover:text-foreground hover:border-foreground/40 disabled:opacity-50 transition-colors"
            >
              {loadingMoreReplies
                ? "Loading…"
                : `Load ${PAGE_SIZE} more`}
            </button>
          </div>
        ) : null}
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
