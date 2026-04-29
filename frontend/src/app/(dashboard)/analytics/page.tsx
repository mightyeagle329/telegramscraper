"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { AnalyticsSummary } from "@/lib/types";

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
  const ratePct = (t.reply_rate * 100).toFixed(1);
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
      <Stat label="DMs sent" value={t.sent} />
      <Stat label="Replies" value={t.replied} />
      <Stat
        label="Reply rate"
        value={t.sent > 0 ? `${ratePct}%` : "—"}
        tone={t.reply_rate >= 0.05 ? "good" : undefined}
      />
      <Stat label="Unique reach" value={t.unique_targets} />
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "good";
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
    </div>
  );
}

function DailyVolumeChart({ summary }: { summary: AnalyticsSummary }) {
  const max = useMemo(
    () => Math.max(1, ...summary.daily_volume.map((d) => d.sent)),
    [summary]
  );
  return (
    <section className="card-elevated p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-lg font-semibold">Daily volume</h2>
        <div className="flex items-center gap-3 text-xs text-text-muted">
          <LegendChip color="bg-accent-green" label="sent" />
          <LegendChip color="bg-accent-blue" label="replied" />
          <LegendChip color="bg-text-muted/40" label="skipped" />
        </div>
      </div>
      {summary.daily_volume.every((d) => d.sent === 0 && d.skipped === 0) ? (
        <p className="text-text-muted text-sm">
          No activity in this window yet.
        </p>
      ) : (
        <div className="flex items-end gap-1 h-44">
          {summary.daily_volume.map((d) => {
            const sentH = (d.sent / max) * 100;
            const skipH = (d.skipped / max) * 100;
            const replyH = (d.replied / max) * 100;
            return (
              <div
                key={d.date}
                className="flex-1 flex flex-col items-center gap-1 group"
                title={`${d.date}\n${d.sent} sent · ${d.replied} replied · ${d.skipped} skipped`}
              >
                <div className="w-full flex items-end justify-center gap-0.5 h-36">
                  <div
                    className="w-2 bg-accent-green rounded-t"
                    style={{ height: `${sentH}%` }}
                  />
                  <div
                    className="w-2 bg-accent-blue rounded-t"
                    style={{ height: `${replyH}%` }}
                  />
                  <div
                    className="w-2 bg-text-muted/40 rounded-t"
                    style={{ height: `${skipH}%` }}
                  />
                </div>
                <div className="text-[10px] text-text-muted whitespace-nowrap">
                  {d.date.slice(5)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
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
                <th className="text-right py-2 font-normal">Reply rate</th>
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
                  <td className="text-right py-1.5 font-mono">
                    {r.sent_in_window > 0
                      ? `${(r.reply_rate * 100).toFixed(1)}%`
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
                <th className="text-left py-2 font-normal">Arms</th>
                <th className="text-right py-2 font-normal">Sent</th>
                <th className="text-right py-2 font-normal">Replies</th>
                <th className="text-right py-2 font-normal">Reply rate</th>
                <th className="text-left py-2 font-normal pl-4">Winner</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr
                  key={c.campaign}
                  className="border-b border-card-border/30 last:border-b-0"
                >
                  <td className="py-1.5 font-medium truncate max-w-xs">
                    {c.campaign}
                  </td>
                  <td className="py-1.5 text-xs text-text-muted">
                    {c.arms
                      .map(
                        (a) =>
                          `${a.name}: ${a.sent}/${a.replied} (${(
                            a.reply_rate * 100
                          ).toFixed(0)}%)`
                      )
                      .join(" · ")}
                  </td>
                  <td className="text-right py-1.5 font-mono">{c.sent}</td>
                  <td className="text-right py-1.5 font-mono">{c.replied}</td>
                  <td className="text-right py-1.5 font-mono">
                    {c.sent > 0 ? `${(c.reply_rate * 100).toFixed(1)}%` : "—"}
                  </td>
                  <td className="pl-4 py-1.5">
                    {c.winner ? (
                      <span className="text-accent-green font-bold">
                        {c.winner}
                      </span>
                    ) : (
                      <span className="text-text-muted text-xs">—</span>
                    )}
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
