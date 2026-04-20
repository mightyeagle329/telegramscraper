"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type {
  Account,
  QueueSnapshotEntry,
  SentLogEntry,
} from "@/lib/types";

export default function CampaignsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [sheets, setSheets] = useState<Record<string, number>>({});
  const [queue, setQueue] = useState<Record<string, QueueSnapshotEntry>>({});
  const [sentLog, setSentLog] = useState<SentLogEntry[]>([]);

  const [selectedSheet, setSelectedSheet] = useState("");
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [templatesRaw, setTemplatesRaw] = useState(
    [
      "Hey {first_name}, saw you in the group — worth a quick chat?",
      "Hi {first_name}! Quick question about the group we're both in.",
      "Hello @{username}, hope today's good — got a sec?",
    ].join("\n---\n")
  );
  const [campaignName, setCampaignName] = useState("");
  const [limit, setLimit] = useState<string>("");
  const [deleteAfter, setDeleteAfter] = useState<string>("");
  const [enqueueing, setEnqueueing] = useState(false);
  const [message, setMessage] = useState<
    { kind: "ok" | "err"; text: string } | null
  >(null);

  const refresh = useCallback(async () => {
    try {
      const [a, s, q, log] = await Promise.all([
        api.getAccounts(),
        api.getSheetStats().catch(() => ({})),
        api.getQueue().catch(() => ({})),
        api.getSentLog({ limit: 30 }).catch(() => []),
      ]);
      setAccounts(a);
      setSheets(s);
      setQueue(q);
      setSentLog(log);
    } catch (e) {
      setMessage({
        kind: "err",
        text: e instanceof Error ? e.message : "Failed to load",
      });
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const eligibleAccounts = useMemo(
    () => accounts.filter((a) => a.status === "active"),
    [accounts]
  );

  const parseTemplates = () =>
    templatesRaw
      .split(/\n---\n/)
      .map((s) => s.trim())
      .filter(Boolean);

  const toggleAccount = (id: string) => {
    setSelectedAccountIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
    );
  };

  const selectAllEligible = () =>
    setSelectedAccountIds(eligibleAccounts.map((a) => a.id));

  const enqueue = async () => {
    setMessage(null);
    const templates = parseTemplates();
    if (!selectedSheet) {
      setMessage({ kind: "err", text: "Pick a source sheet." });
      return;
    }
    if (selectedAccountIds.length === 0) {
      setMessage({
        kind: "err",
        text: "Pick at least one active sender account.",
      });
      return;
    }
    if (templates.length === 0) {
      setMessage({
        kind: "err",
        text: "Add at least one message template (separate variants with '---').",
      });
      return;
    }
    setEnqueueing(true);
    try {
      const result = await api.enqueueFromSheet({
        sheet_group_name: selectedSheet,
        account_ids: selectedAccountIds,
        templates,
        delete_after_s: deleteAfter ? Number(deleteAfter) : null,
        campaign: campaignName || selectedSheet,
        limit: limit ? Number(limit) : null,
      });
      const totalEnqueued = Object.values(result.enqueued).reduce(
        (s, n) => s + n,
        0
      );
      setMessage({
        kind: "ok",
        text: `Queued ${totalEnqueued} DMs across ${
          Object.keys(result.enqueued).length
        } accounts (from ${result.targets_found} sheet rows).`,
      });
      await refresh();
    } catch (e) {
      setMessage({
        kind: "err",
        text: e instanceof Error ? e.message : "Enqueue failed",
      });
    } finally {
      setEnqueueing(false);
    }
  };

  const totalPending = Object.values(queue).reduce(
    (s, q) => s + (q.pending ?? 0),
    0
  );

  return (
    <>
      <main className="max-w-6xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Campaigns</h1>
          <p className="text-text-muted text-sm">
            Send DMs at scale across your sender fleet.
          </p>
        </div>
        {message ? (
          <div
            className={`px-4 py-2 rounded-lg text-sm border ${
              message.kind === "ok"
                ? "bg-accent-green/10 border-accent-green/30 text-accent-green"
                : "bg-accent-red/10 border-accent-red/30 text-accent-red"
            }`}
          >
            {message.text}
          </div>
        ) : null}

        <section className="bg-card-bg border border-card-border rounded-xl p-5">
          <h2 className="text-lg font-semibold mb-3">New campaign</h2>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="block text-xs uppercase text-text-muted mb-1">
                  Source sheet
                </label>
                <select
                  value={selectedSheet}
                  onChange={(e) => setSelectedSheet(e.target.value)}
                  className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">— pick a scraped group —</option>
                  {Object.entries(sheets).map(([name, count]) => (
                    <option key={name} value={name}>
                      {name} ({count} members)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs uppercase text-text-muted mb-1">
                  Sender accounts
                </label>
                <div className="space-y-1 max-h-48 overflow-y-auto border border-card-border rounded-lg p-2 bg-background">
                  {accounts.length === 0 ? (
                    <div className="text-text-muted text-xs p-2">
                      No accounts. Run{" "}
                      <code className="text-xs">python add_account.py</code>.
                    </div>
                  ) : (
                    accounts.map((a) => {
                      const active = a.status === "active";
                      const selected = selectedAccountIds.includes(a.id);
                      return (
                        <label
                          key={a.id}
                          className={`flex items-center justify-between gap-2 px-2 py-1 rounded text-sm ${
                            active
                              ? "cursor-pointer hover:bg-card-border/30"
                              : "opacity-50 cursor-not-allowed"
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              disabled={!active}
                              checked={selected}
                              onChange={() => toggleAccount(a.id)}
                            />
                            <span className="font-medium">{a.label}</span>
                            <span className="text-text-muted text-xs">
                              ({a.id} · {a.status})
                            </span>
                          </span>
                          <span className="text-xs text-text-muted">
                            {a.daily_sent}/{a.daily_limit} today
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
                <div className="flex gap-2 mt-2 text-xs">
                  <button
                    type="button"
                    onClick={selectAllEligible}
                    className="text-text-muted hover:text-foreground"
                  >
                    select all active ({eligibleAccounts.length})
                  </button>
                  <span className="text-text-muted">·</span>
                  <button
                    type="button"
                    onClick={() => setSelectedAccountIds([])}
                    className="text-text-muted hover:text-foreground"
                  >
                    clear
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs uppercase text-text-muted mb-1">
                    Campaign name
                  </label>
                  <input
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                    placeholder="(defaults to sheet)"
                    className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs uppercase text-text-muted mb-1">
                    Limit
                  </label>
                  <input
                    value={limit}
                    onChange={(e) => setLimit(e.target.value)}
                    placeholder="all"
                    className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs uppercase text-text-muted mb-1">
                    Delete after (s)
                  </label>
                  <input
                    value={deleteAfter}
                    onChange={(e) => setDeleteAfter(e.target.value)}
                    placeholder="off"
                    className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs uppercase text-text-muted mb-1">
                Message templates (separate variants with a line containing{" "}
                <code className="text-xs">---</code>). Placeholders:{" "}
                <code>{"{first_name}"}</code> <code>{"{last_name}"}</code>{" "}
                <code>{"{username}"}</code>
              </label>
              <textarea
                value={templatesRaw}
                onChange={(e) => setTemplatesRaw(e.target.value)}
                rows={14}
                className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm font-mono"
              />
              <div className="text-xs text-text-muted mt-1">
                {parseTemplates().length} template variant(s) detected — the
                sender picks one at random per send.
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end mt-4">
            <button
              onClick={enqueue}
              disabled={enqueueing}
              className="px-4 py-2 rounded-lg bg-accent-green/20 border border-accent-green/40 text-accent-green text-sm font-medium hover:bg-accent-green/30 disabled:opacity-50"
            >
              {enqueueing ? "Enqueueing…" : "Enqueue campaign"}
            </button>
          </div>
        </section>

        <section className="grid md:grid-cols-2 gap-6">
          <div className="bg-card-bg border border-card-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">
                Queue ({totalPending} pending)
              </h2>
              {totalPending > 0 ? (
                <button
                  onClick={async () => {
                    if (confirm("Clear ALL pending DMs from every queue?")) {
                      await api.clearQueueAll();
                      refresh();
                    }
                  }}
                  className="text-xs text-accent-red hover:underline"
                >
                  clear all
                </button>
              ) : null}
            </div>
            {Object.keys(queue).length === 0 ? (
              <div className="text-text-muted text-sm">Queue is empty.</div>
            ) : (
              <ul className="space-y-2 text-sm">
                {Object.entries(queue).map(([aid, q]) => (
                  <li
                    key={aid}
                    className="flex items-center justify-between border-b border-card-border/40 pb-2"
                  >
                    <span>
                      <span className="font-medium">{aid}</span>{" "}
                      <span className="text-text-muted">
                        — {q.pending} pending
                      </span>
                    </span>
                    <button
                      onClick={async () => {
                        if (confirm(`Clear ${aid}'s queue?`)) {
                          await api.clearQueueOne(aid);
                          refresh();
                        }
                      }}
                      className="text-xs text-text-muted hover:text-accent-red"
                    >
                      clear
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-card-bg border border-card-border rounded-xl p-5">
            <h2 className="text-lg font-semibold mb-3">Recent sends</h2>
            {sentLog.length === 0 ? (
              <div className="text-text-muted text-sm">No sends yet.</div>
            ) : (
              <ul className="space-y-1 text-xs font-mono max-h-64 overflow-y-auto">
                {sentLog
                  .slice()
                  .reverse()
                  .map((e, i) => (
                    <li
                      key={`${e.timestamp}-${i}`}
                      className="flex items-center justify-between gap-2 border-b border-card-border/40 py-1"
                    >
                      <span className="text-text-muted truncate">
                        {new Date(e.timestamp).toLocaleTimeString()}{" "}
                        {e.account_id} → {e.target_username || e.target_user_id}
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
      </main>
    </>
  );
}
