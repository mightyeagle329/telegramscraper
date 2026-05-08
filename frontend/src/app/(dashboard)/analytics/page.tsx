"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type {
  AnalyticsSummary,
  GroupScorecard,
  TrackedGroup,
} from "@/lib/types";

const RANGE_OPTIONS: { days: number; label: string }[] = [
  { days: 7, label: "7 days" },
  { days: 14, label: "14 days" },
  { days: 30, label: "30 days" },
];

export default function AnalyticsPage() {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [days, setDays] = useState(14);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const s = await api.getAnalyticsSummary(days);
      setSummary(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30_000);
    return () => clearInterval(interval);
  }, [refresh]);

  return (
    <main className="max-w-6xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-6">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Analytics</h1>
          <p className="text-text-muted text-sm">
            Performance roll-ups across every account and campaign in the
            selected window. Auto-refreshes every 30 seconds.
          </p>
        </div>
        <div className="inline-flex border border-card-border rounded-lg overflow-hidden text-xs">
          {RANGE_OPTIONS.map((opt, i) => (
            <button
              key={opt.days}
              type="button"
              onClick={() => setDays(opt.days)}
              className={`px-3 py-1.5 transition-colors ${
                i > 0 ? "border-l border-card-border" : ""
              } ${
                days === opt.days
                  ? "bg-card-border/40 text-foreground"
                  : "text-text-muted hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="px-4 py-2 bg-accent-red/10 border border-accent-red/30 text-accent-red rounded-lg text-sm">
          {error}
        </div>
      ) : null}

      {loading && !summary ? (
        <p className="text-text-muted text-sm">Loading…</p>
      ) : !summary ? null : (
        <>
          <TotalsRow summary={summary} />
          <DailyVolumeChart summary={summary} />
          <TrackedGroupsPanel />
          <ScorecardsPanel />
          <PerAccountTable summary={summary} />
          <PerCampaignTable summary={summary} />
          <SkipReasons summary={summary} />
        </>
      )}
    </main>
  );
}

function TotalsRow({ summary }: { summary: AnalyticsSummary }) {
  const t = summary.totals;
  const replyPct = (t.reply_rate * 100).toFixed(1);
  const joinPct = (t.join_rate * 100).toFixed(1);
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
      <Stat label="DMs sent" value={t.sent} />
      <Stat label="Replies" value={t.replied} />
      <Stat
        label="Reply rate"
        value={t.sent > 0 ? `${replyPct}%` : "—"}
        tone={t.reply_rate >= 0.05 ? "good" : undefined}
      />
      <Stat
        label="Group joins"
        value={t.attributed_joined}
        sub={
          t.joined > t.attributed_joined
            ? `+${t.joined - t.attributed_joined} organic`
            : undefined
        }
      />
      <Stat
        label="Join rate"
        value={t.sent > 0 ? `${joinPct}%` : "—"}
        tone={t.join_rate >= 0.02 ? "good" : undefined}
      />
      <Stat label="Unique reach" value={t.unique_targets} />
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: number | string;
  tone?: "good";
  sub?: string;
}) {
  return (
    <div className="card-elevated p-3 md:p-4">
      <div className="text-text-muted text-[11px] md:text-xs uppercase tracking-wide">
        {label}
      </div>
      <div
        className={`text-xl md:text-2xl font-bold mt-1 ${
          tone === "good" ? "text-accent-green" : ""
        }`}
      >
        {value}
      </div>
      {sub ? (
        <div className="text-[10px] text-text-muted mt-1">{sub}</div>
      ) : null}
    </div>
  );
}

function DailyVolumeChart({ summary }: { summary: AnalyticsSummary }) {
  // Max must include every series — otherwise any day where one series
  // exceeds another produces bar heights >100% that overflow the chart.
  const max = useMemo(() => {
    const peak = Math.max(
      0,
      ...summary.daily_volume.map((d) =>
        Math.max(d.sent, d.skipped, d.replied, d.joined)
      )
    );
    return Math.max(1, niceCeil(peak));
  }, [summary]);

  const empty = summary.daily_volume.every(
    (d) =>
      d.sent === 0 && d.skipped === 0 && d.replied === 0 && d.joined === 0
  );

  return (
    <section className="card-elevated p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-lg font-semibold">Daily volume</h2>
        <div className="flex items-center gap-3 text-xs text-text-muted">
          <LegendChip color="bg-accent-green" label="sent" />
          <LegendChip color="bg-accent-blue" label="replied" />
          <LegendChip color="bg-accent-yellow" label="joined" />
          <LegendChip color="bg-text-muted/40" label="skipped" />
        </div>
      </div>
      {empty ? (
        <p className="text-text-muted text-sm">
          No activity in this window yet.
        </p>
      ) : (
        // Two-column grid: a small y-axis on the left, the chart on the right.
        // The chart wrapper is overflow-x-auto so 30-day windows don't squish
        // the bars on narrow viewports — they just scroll.
        <div className="grid grid-cols-[auto_1fr] gap-3">
          <YAxis max={max} />
          <div className="overflow-x-auto -mr-1 pr-1">
            <div
              className="inline-flex items-end gap-1.5"
              style={{ minWidth: "100%" }}
            >
              {summary.daily_volume.map((d) => (
                <DayColumn key={d.date} d={d} max={max} />
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

const CHART_BARS_HEIGHT_PX = 160;

function YAxis({ max }: { max: number }) {
  // Three labels at the top, mid, and bottom of the bars area. Aligned to
  // the bars container's exact pixel height so gridlines line up.
  return (
    <div
      className="flex flex-col justify-between text-[10px] text-text-muted text-right pr-1 pb-[18px]"
      style={{ height: CHART_BARS_HEIGHT_PX }}
    >
      <span>{max}</span>
      <span>{Math.round(max / 2)}</span>
      <span>0</span>
    </div>
  );
}

function DayColumn({
  d,
  max,
}: {
  d: AnalyticsSummary["daily_volume"][number];
  max: number;
}) {
  const sentH = Math.round((d.sent / max) * CHART_BARS_HEIGHT_PX);
  const replyH = Math.round((d.replied / max) * CHART_BARS_HEIGHT_PX);
  const joinH = Math.round((d.joined / max) * CHART_BARS_HEIGHT_PX);
  const skipH = Math.round((d.skipped / max) * CHART_BARS_HEIGHT_PX);
  return (
    <div
      className="flex flex-col items-center"
      title={`${d.date}\n${d.sent} sent · ${d.replied} replied · ${d.joined} joined · ${d.skipped} skipped`}
    >
      <div
        className="flex items-end justify-center gap-0.5"
        style={{ height: CHART_BARS_HEIGHT_PX }}
      >
        <div
          className="w-1.5 bg-accent-green rounded-t"
          style={{ height: sentH }}
        />
        <div
          className="w-1.5 bg-accent-blue rounded-t"
          style={{ height: replyH }}
        />
        <div
          className="w-1.5 bg-accent-yellow rounded-t"
          style={{ height: joinH }}
        />
        <div
          className="w-1.5 bg-text-muted/40 rounded-t"
          style={{ height: skipH }}
        />
      </div>
      <div className="text-[10px] text-text-muted mt-1.5 whitespace-nowrap">
        {d.date.slice(5)}
      </div>
    </div>
  );
}

/**
 * Tracked-groups panel — configure which Telegram groups Outpilot should
 * watch for funnel conversions (e.g. TitanTreasure casino). Each group
 * gets polled on the lifespan scheduler; new joiners are cross-referenced
 * with sent_log to attribute joins back to campaigns/arms.
 */
function TrackedGroupsPanel() {
  const [groups, setGroups] = useState<TrackedGroup[]>([]);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollingId, setPollingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setGroups(await api.listTrackedGroups());
    } catch {
      // Non-fatal — empty list is OK; backend may not be reachable yet.
    }
  }, []);

  useEffect(() => {
    refresh();
    const i = setInterval(refresh, 60_000);
    return () => clearInterval(i);
  }, [refresh]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await api.addTrackedGroup(url.trim());
      setUrl("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add tracked group");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!confirm("Stop tracking this group?")) return;
    await api.removeTrackedGroup(String(id));
    await refresh();
  }

  async function pollNow(id: number) {
    setPollingId(String(id));
    try {
      await api.pollTrackedGroup(String(id));
      await refresh();
    } finally {
      setPollingId(null);
    }
  }

  return (
    <section className="card-elevated p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold">Tracked groups (funnel destination)</h2>
          <p className="text-xs text-text-muted mt-0.5">
            Groups Outpilot watches for new members. Every new joiner is
            cross-referenced with our DM history and credited to the
            campaign / arm that brought them in.
          </p>
        </div>
      </div>

      <form onSubmit={add} className="flex flex-col sm:flex-row gap-2 mb-3">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://t.me/titantreasurecasino"
          className="flex-1 bg-background border border-card-border rounded-lg px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !url.trim()}
          className="px-4 py-2 rounded-lg bg-accent-green/20 border border-accent-green/40 text-accent-green text-sm font-medium hover:bg-accent-green/30 disabled:opacity-50"
        >
          {busy ? "Adding…" : "Track this group"}
        </button>
      </form>

      {error ? (
        <div className="text-accent-red text-sm mb-3">{error}</div>
      ) : null}

      {groups.length === 0 ? (
        <p className="text-text-muted text-sm">
          No groups under tracking yet. Add your destination group above
          (e.g. <code>https://t.me/titantreasurecasino</code>).
        </p>
      ) : (
        <ul className="space-y-2">
          {groups.map((g) => (
            <li
              key={g.group_id}
              className="border-b border-card-border/30 last:border-b-0 pb-2 last:pb-0 flex items-center justify-between gap-3 flex-wrap"
            >
              <div className="min-w-0">
                <div className="font-medium truncate">{g.name}</div>
                <div className="text-xs text-text-muted truncate">
                  {g.url} · {g.members_known.toLocaleString()} members ·
                  {" "}
                  last polled{" "}
                  {g.last_polled_at
                    ? new Date(g.last_polled_at).toLocaleString()
                    : "never"}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <button
                  onClick={() => pollNow(g.group_id)}
                  disabled={pollingId === String(g.group_id)}
                  className="px-2 py-1 border border-card-border rounded hover:border-foreground/40 disabled:opacity-50"
                >
                  {pollingId === String(g.group_id) ? "Polling…" : "Poll now"}
                </button>
                <button
                  onClick={() => remove(g.group_id)}
                  className="text-accent-red hover:underline"
                >
                  remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Scorecards panel — tier candidate scrape-source groups by quality.
 * Reachable% + join rate from past campaigns drive a T1/T2/T3 tier.
 */
function ScorecardsPanel() {
  const [rows, setRows] = useState<GroupScorecard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .getGroupScorecards()
      .then((s) => {
        if (!cancelled) setRows(s);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="card-elevated p-5">
      <div className="mb-3">
        <h2 className="text-lg font-semibold">Source group scorecards</h2>
        <p className="text-xs text-text-muted mt-0.5">
          Tiering for the candidate groups you scrape members from. T1 =
          high reachable %, proven join conversion. T3 = mostly bots or
          dead audience — drop and replace.
        </p>
      </div>
      {loading ? (
        <p className="text-text-muted text-sm">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-text-muted text-sm">
          No scraped groups yet. Add a group on{" "}
          <a href="/groups" className="hover:underline text-foreground">
            /groups
          </a>{" "}
          and run a campaign first.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-text-muted">
              <tr className="border-b border-card-border/60">
                <th className="text-left py-2 font-normal">Group</th>
                <th className="text-center py-2 font-normal">Tier</th>
                <th className="text-right py-2 font-normal">Members</th>
                <th className="text-right py-2 font-normal">Reachable</th>
                <th className="text-right py-2 font-normal">Sent</th>
                <th className="text-right py-2 font-normal">Replies</th>
                <th className="text-right py-2 font-normal">Joins</th>
                <th className="text-right py-2 font-normal">Reply %</th>
                <th className="text-right py-2 font-normal">Join %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.name}
                  className="border-b border-card-border/30 last:border-b-0"
                >
                  <td className="py-1.5 font-medium truncate max-w-[14rem]">
                    {r.name}
                  </td>
                  <td className="text-center py-1.5">
                    <TierChip tier={r.tier} />
                  </td>
                  <td className="text-right py-1.5 font-mono">{r.members}</td>
                  <td className="text-right py-1.5 font-mono">
                    {(r.reachable_pct * 100).toFixed(0)}%
                  </td>
                  <td className="text-right py-1.5 font-mono">{r.sent}</td>
                  <td className="text-right py-1.5 font-mono">{r.replied}</td>
                  <td className="text-right py-1.5 font-mono text-accent-yellow">
                    {r.joined}
                  </td>
                  <td className="text-right py-1.5 font-mono">
                    {r.sent > 0 ? `${(r.reply_rate * 100).toFixed(1)}%` : "—"}
                  </td>
                  <td className="text-right py-1.5 font-mono">
                    {r.sent > 0 ? `${(r.join_rate * 100).toFixed(1)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function TierChip({ tier }: { tier: "T1" | "T2" | "T3" }) {
  const cls = {
    T1: "bg-accent-green/15 text-accent-green border-accent-green/30",
    T2: "bg-accent-yellow/15 text-accent-yellow border-accent-yellow/30",
    T3: "bg-text-muted/15 text-text-muted border-card-border",
  }[tier];
  return (
    <span
      className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full border ${cls}`}
    >
      {tier}
    </span>
  );
}

/** Round `n` up to a "nice" y-axis ceiling — 1, 2, 5, 10, 20, 50, 100 etc.
 *  so the top of the chart sits a touch above the tallest bar instead of
 *  exactly clipping it. */
function niceCeil(n: number): number {
  if (n <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(n)));
  const f = n / exp;
  let nice;
  if (f <= 1) nice = 1;
  else if (f <= 2) nice = 2;
  else if (f <= 5) nice = 5;
  else nice = 10;
  return nice * exp;
}

function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-sm ${color}`} />
      {label}
    </span>
  );
}

function PerAccountTable({ summary }: { summary: AnalyticsSummary }) {
  const rows = summary.per_account;
  return (
    <section className="card-elevated p-5">
      <h2 className="text-lg font-semibold mb-3">Per account</h2>
      {rows.length === 0 ? (
        <p className="text-text-muted text-sm">No accounts yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-text-muted">
              <tr className="border-b border-card-border/60">
                <th className="text-left py-2 font-normal">Account</th>
                <th className="text-left py-2 font-normal">Status</th>
                <th className="text-right py-2 font-normal">Today</th>
                <th className="text-right py-2 font-normal">Sent</th>
                <th className="text-right py-2 font-normal">Replies</th>
                <th className="text-right py-2 font-normal">Joins</th>
                <th className="text-right py-2 font-normal">Reply %</th>
                <th className="text-right py-2 font-normal">Join %</th>
                <th className="text-right py-2 font-normal">Skipped</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.account_id}
                  className="border-b border-card-border/30 last:border-b-0"
                >
                  <td className="py-1.5">
                    <span className="font-medium">{r.label}</span>{" "}
                    <span className="text-text-muted text-xs">
                      ({r.account_id})
                    </span>
                  </td>
                  <td className="py-1.5">
                    <StatusChip status={r.status} />
                  </td>
                  <td className="text-right py-1.5 font-mono">
                    {r.daily_sent}/{r.daily_limit}
                  </td>
                  <td className="text-right py-1.5 font-mono">
                    {r.sent_in_window}
                  </td>
                  <td className="text-right py-1.5 font-mono">
                    {r.replied_in_window}
                  </td>
                  <td className="text-right py-1.5 font-mono text-accent-yellow">
                    {r.joined_in_window}
                  </td>
                  <td className="text-right py-1.5 font-mono">
                    {r.sent_in_window > 0
                      ? `${(r.reply_rate * 100).toFixed(1)}%`
                      : "—"}
                  </td>
                  <td className="text-right py-1.5 font-mono">
                    {r.sent_in_window > 0
                      ? `${(r.join_rate * 100).toFixed(1)}%`
                      : "—"}
                  </td>
                  <td className="text-right py-1.5 font-mono text-text-muted">
                    {r.skipped_in_window}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StatusChip({ status }: { status: string }) {
  const tone = {
    active: "bg-accent-green/15 text-accent-green border-accent-green/30",
    warming:
      "bg-accent-yellow/15 text-accent-yellow border-accent-yellow/30",
    paused: "bg-text-muted/15 text-text-muted border-card-border",
    banned: "bg-accent-red/15 text-accent-red border-accent-red/30",
  }[status] || "bg-card-border/30 text-text-muted border-card-border";
  return (
    <span
      className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full border ${tone}`}
    >
      {status}
    </span>
  );
}

function PerCampaignTable({ summary }: { summary: AnalyticsSummary }) {
  const rows = summary.per_campaign;
  return (
    <section className="card-elevated p-5">
      <h2 className="text-lg font-semibold mb-3">Per campaign</h2>
      {rows.length === 0 ? (
        <p className="text-text-muted text-sm">No campaigns in this window.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-text-muted">
              <tr className="border-b border-card-border/60">
                <th className="text-left py-2 font-normal">Campaign</th>
                <th className="text-left py-2 font-normal">Arms (sent / replied / joined)</th>
                <th className="text-right py-2 font-normal">Sent</th>
                <th className="text-right py-2 font-normal">Replies</th>
                <th className="text-right py-2 font-normal">Joins</th>
                <th className="text-right py-2 font-normal">Reply %</th>
                <th className="text-right py-2 font-normal">Join %</th>
                <th className="text-left py-2 font-normal pl-3">Winner</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr
                  key={c.campaign}
                  className="border-b border-card-border/30 last:border-b-0"
                >
                  <td className="py-1.5 font-medium truncate max-w-[12rem]">
                    {c.campaign}
                  </td>
                  <td className="py-1.5 text-xs text-text-muted">
                    {c.arms
                      .map(
                        (a) =>
                          `${a.name}: ${a.sent}/${a.replied}/${a.joined} (${(
                            a.join_rate * 100
                          ).toFixed(0)}% join)`
                      )
                      .join(" · ")}
                  </td>
                  <td className="text-right py-1.5 font-mono">{c.sent}</td>
                  <td className="text-right py-1.5 font-mono">{c.replied}</td>
                  <td className="text-right py-1.5 font-mono text-accent-yellow">
                    {c.joined}
                  </td>
                  <td className="text-right py-1.5 font-mono">
                    {c.sent > 0 ? `${(c.reply_rate * 100).toFixed(1)}%` : "—"}
                  </td>
                  <td className="text-right py-1.5 font-mono">
                    {c.sent > 0 ? `${(c.join_rate * 100).toFixed(1)}%` : "—"}
                  </td>
                  <td className="pl-3 py-1.5 text-xs">
                    {c.join_winner ? (
                      <span title="Highest join rate">
                        <span className="text-accent-yellow font-bold">
                          {c.join_winner}
                        </span>
                        <span className="text-text-muted"> join</span>
                      </span>
                    ) : null}
                    {c.winner && c.winner !== c.join_winner ? (
                      <span className="block" title="Highest reply rate">
                        <span className="text-accent-green font-bold">
                          {c.winner}
                        </span>
                        <span className="text-text-muted"> reply</span>
                      </span>
                    ) : null}
                    {!c.join_winner && !c.winner ? (
                      <span className="text-text-muted">—</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SkipReasons({ summary }: { summary: AnalyticsSummary }) {
  const rows = summary.skip_reasons;
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className="card-elevated p-5">
      <h2 className="text-lg font-semibold mb-3">Skip reasons</h2>
      {rows.length === 0 ? (
        <p className="text-text-muted text-sm">
          No skips or errors in this window. Nice.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li
              key={r.reason}
              className="grid grid-cols-[1fr_auto_120px] items-center gap-3 text-sm"
            >
              <span className="text-text-muted truncate" title={r.reason}>
                {r.reason}
              </span>
              <span className="font-mono text-xs text-text-muted">
                {r.count}
              </span>
              <div className="h-2 bg-card-border/30 rounded overflow-hidden">
                <div
                  className="h-full bg-accent-yellow/60"
                  style={{ width: `${(r.count / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
