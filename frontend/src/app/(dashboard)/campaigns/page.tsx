"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n/context";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  createTemplate,
  listTemplates,
} from "@/lib/actions/templates";
import ArmsEditor, { type ArmDraft } from "@/components/ArmsEditor";
import type {
  Account,
  CampaignArmInput,
  CampaignStats,
  QueueSnapshotEntry,
  SentLogEntry,
} from "@/lib/types";
import type { DbMessageTemplate } from "@/types/database";

const DEFAULT_PRIMARY_INLINE = [
  "Hey {first_name}, saw you in the group — worth a quick chat?",
  "Hi {first_name}! Quick question about the group we're both in.",
  "Hello @{username}, hope today's good — got a sec?",
].join("\n---\n");

const DEFAULT_FOLLOWUP_INLINE = [
  "Hey {first_name}, just bumping this in case you missed it — quick chat?",
  "Hi {first_name}, following up — happy to share more if helpful.",
  "{first_name}, last nudge — let me know if it's worth a chat or skip.",
].join("\n---\n");

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

function newArm(name: string, primaryInline = ""): ArmDraft {
  return {
    id: makeId(),
    name,
    mode: "templates",
    aiStyle: "",
    primarySelectedIds: [],
    primaryInline,
    followUpDays: "",
    followupSelectedIds: [],
    followupInline: "",
  };
}

export default function CampaignsPage() {
  const t = useT();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [sheets, setSheets] = useState<Record<string, number>>({});
  const [queue, setQueue] = useState<Record<string, QueueSnapshotEntry>>({});
  const [sentLog, setSentLog] = useState<SentLogEntry[]>([]);

  const [library, setLibrary] = useState<DbMessageTemplate[]>([]);
  const supabaseAvailable = isSupabaseConfigured();

  // OpenAI availability — drives whether AI-mode toggle is enabled and
  // which model name we surface in the UI.
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiModel, setAiModel] = useState("gpt-4o-mini");

  const [selectedSheet, setSelectedSheet] = useState("");
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);

  // A/B arms — start with one arm carrying the default placeholder text,
  // so an unchanged form behaves exactly like pre-2B (single arm "A").
  const [arms, setArms] = useState<ArmDraft[]>([newArm("A", DEFAULT_PRIMARY_INLINE)]);

  const [campaignName, setCampaignName] = useState("");
  const [limit, setLimit] = useState<string>("");
  const [deleteAfter, setDeleteAfter] = useState<string>("");
  const [shuffle, setShuffle] = useState(true);
  const [filterBots, setFilterBots] = useState(true);

  const [enqueueing, setEnqueueing] = useState(false);
  const [message, setMessage] = useState<
    { kind: "ok" | "err"; text: string } | null
  >(null);

  // Per-arm stats viewer — keyed by campaign name; pulled on demand.
  const [statsCampaign, setStatsCampaign] = useState<string>("");
  const [stats, setStats] = useState<CampaignStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

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

  const loadLibrary = useCallback(async () => {
    const res = await listTemplates();
    if (res.ok) setLibrary(res.data);
  }, []);

  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);

  useEffect(() => {
    api
      .getAIStatus()
      .then((s) => {
        setAiAvailable(s.configured);
        setAiModel(s.model);
      })
      .catch(() => {
        // Backend unreachable or no endpoint — keep AI off; UI greys it out.
      });
  }, []);

  async function saveInlineToLibrary(variants: string[]) {
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    for (const body of variants) {
      const preview = body.slice(0, 30).replace(/\s+/g, " ").trim();
      await createTemplate({
        name: `Saved ${stamp} — ${preview}`,
        body,
      });
    }
    await loadLibrary();
  }

  // Combine library + inline variants from one arm into a flat string list.
  function combineForArm(
    selectedIds: string[],
    inline: string
  ): string[] {
    const fromLibrary = library
      .filter((t) => selectedIds.includes(t.id))
      .map((t) => t.body);
    const fromInline = inline
      .split(/\n---\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    return [...fromLibrary, ...fromInline];
  }

  // Build the request `arms[]` payload from the editor drafts.
  function buildArmsPayload(): { ok: true; arms: CampaignArmInput[] } | { ok: false; error: string } {
    const out: CampaignArmInput[] = [];
    const seenNames = new Set<string>();
    for (const a of arms) {
      const name = a.name.trim();
      if (!name) {
        return { ok: false, error: "Every arm needs a name (e.g. A, B, control)." };
      }
      if (seenNames.has(name.toUpperCase())) {
        return { ok: false, error: `Duplicate arm name: ${name}.` };
      }
      seenNames.add(name.toUpperCase());

      const followDays = a.followUpDays ? Number(a.followUpDays) : NaN;
      const wantsFollowup = Number.isFinite(followDays) && followDays > 0;
      const followTemplates = wantsFollowup
        ? combineForArm(a.followupSelectedIds, a.followupInline)
        : [];

      if (a.mode === "ai") {
        const style = a.aiStyle.trim();
        if (!style) {
          return {
            ok: false,
            error: `Arm "${name}" is in AI mode but has no style instructions. Tell GPT how the opener should sound.`,
          };
        }
        if (!aiAvailable) {
          return {
            ok: false,
            error: `Arm "${name}" is in AI mode but OPENAI_API_KEY isn't set on the backend.`,
          };
        }
        out.push({
          name,
          ai_style: style,
          follow_up_after_days: wantsFollowup ? followDays : null,
          follow_up_templates: followTemplates,
        });
        continue;
      }

      const primary = combineForArm(a.primarySelectedIds, a.primaryInline);
      if (primary.length === 0) {
        return {
          ok: false,
          error: `Arm "${name}" has no primary template. Add at least one variant.`,
        };
      }

      out.push({
        name,
        primary_templates: primary,
        follow_up_after_days: wantsFollowup ? followDays : null,
        follow_up_templates: followTemplates,
      });
    }
    return { ok: true, arms: out };
  }

  const eligibleAccounts = useMemo(
    () =>
      accounts.filter(
        (a) => a.status === "active" || a.status === "warming"
      ),
    [accounts]
  );

  const toggleAccount = (id: string) => {
    setSelectedAccountIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
    );
  };

  const selectAllEligible = () =>
    setSelectedAccountIds(eligibleAccounts.map((a) => a.id));

  const enqueue = async () => {
    setMessage(null);
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
    const built = buildArmsPayload();
    if (!built.ok) {
      setMessage({ kind: "err", text: built.error });
      return;
    }
    setEnqueueing(true);
    try {
      const result = await api.enqueueFromSheet({
        sheet_group_name: selectedSheet,
        account_ids: selectedAccountIds,
        arms: built.arms,
        delete_after_s: deleteAfter ? Number(deleteAfter) : null,
        campaign: campaignName || selectedSheet,
        limit: limit ? Number(limit) : null,
        shuffle,
        filter_bots: filterBots,
      });
      const totalEnqueued = Object.values(result.enqueued).reduce(
        (s, perArm) => s + Object.values(perArm).reduce((x, n) => x + n, 0),
        0
      );
      const filteredNote =
        result.filtered_out > 0
          ? ` · skipped ${result.filtered_out} likely bot/admin account${
              result.filtered_out === 1 ? "" : "s"
            }`
          : "";
      const armsNote =
        built.arms.length > 1
          ? ` across ${built.arms.length} arms (${built.arms
              .map((a) => a.name)
              .join("/")})`
          : "";
      setMessage({
        kind: "ok",
        text: `Queued ${totalEnqueued} DMs across ${
          Object.keys(result.enqueued).length
        } accounts${armsNote} (from ${result.targets_found} sheet rows)${filteredNote}.`,
      });
      // Pre-load stats for this campaign so the user can watch the A/B
      // race resolve over time.
      const cName = campaignName || selectedSheet;
      setStatsCampaign(cName);
      // Clear the per-launch fields (sheet / limit / campaign name) so the
      // form visibly "resets" without forcing the user to retype arms or
      // re-select accounts. Re-aim the same A/B at a new audience by just
      // picking a new sheet.
      setSelectedSheet("");
      setLimit("");
      setCampaignName("");
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

  // Distinct campaign names from the recent sent log — used to populate the
  // stats picker dropdown so the user can inspect any past campaign.
  const knownCampaigns = useMemo(() => {
    const set = new Set<string>();
    for (const e of sentLog) {
      if (e.campaign) set.add(e.campaign);
    }
    return Array.from(set).sort();
  }, [sentLog]);

  // Pull stats whenever the user picks a campaign. Keep the result fresh
  // by re-pulling on the same poll cycle as the queue (10s).
  useEffect(() => {
    if (!statsCampaign) {
      setStats(null);
      return;
    }
    let cancelled = false;
    const fetchStats = async () => {
      setStatsLoading(true);
      try {
        const s = await api.getCampaignStats(statsCampaign);
        if (!cancelled) setStats(s);
      } catch {
        if (!cancelled) setStats(null);
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    };
    fetchStats();
    const interval = setInterval(fetchStats, 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [statsCampaign]);

  return (
    <>
      <main className="max-w-6xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">{t("campaigns.title")}</h1>
          <p className="text-text-muted text-sm">{t("campaigns.subtitle")}</p>
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
          <h2 className="text-lg font-semibold mb-3">{t("campaigns.new")}</h2>

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
                      const selectable =
                        a.status === "active" || a.status === "warming";
                      const isWarming = a.status === "warming";
                      const selected = selectedAccountIds.includes(a.id);
                      return (
                        <label
                          key={a.id}
                          className={`flex items-center justify-between gap-2 px-2 py-1 rounded text-sm ${
                            selectable
                              ? "cursor-pointer hover:bg-card-border/30"
                              : "opacity-50 cursor-not-allowed"
                          }`}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <input
                              type="checkbox"
                              disabled={!selectable}
                              checked={selected}
                              onChange={() => toggleAccount(a.id)}
                            />
                            <span className="font-medium truncate">{a.label}</span>
                            <span className="text-text-muted text-xs shrink-0">
                              ({a.id})
                            </span>
                            {isWarming ? (
                              <span
                                title="In warm-up — queued DMs will start on day 8"
                                className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-yellow/15 text-accent-yellow border border-accent-yellow/30 shrink-0"
                              >
                                warming
                              </span>
                            ) : null}
                          </span>
                          <span className="text-xs text-text-muted shrink-0">
                            {a.daily_sent}/{a.daily_limit}
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

              <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={shuffle}
                  onChange={(e) => setShuffle(e.target.checked)}
                />
                <span>
                  Shuffle targets before applying limit (recommended — avoids
                  hitting only the most-active posters / admins)
                </span>
              </label>

              <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={filterBots}
                  onChange={(e) => setFilterBots(e.target.checked)}
                />
                <span>
                  Filter bots / admins / official accounts (recommended —
                  drops usernames ending in <code>bot</code> and names
                  containing <code>admin</code>, <code>support</code>,
                  <code>official</code>, <code>news</code>, etc.)
                </span>
              </label>
            </div>

            <div>
              <ArmsEditor
                arms={arms}
                onChange={setArms}
                libraryTemplates={library}
                supabaseAvailable={supabaseAvailable}
                aiAvailable={aiAvailable}
                aiModel={aiModel}
                onSaveInlineToLibrary={saveInlineToLibrary}
              />
              <p className="text-xs text-text-muted mt-3">
                Placeholders: <code>{"{first_name}"}</code>{" "}
                <code>{"{last_name}"}</code> <code>{"{username}"}</code>. Each
                arm picks a template at random per send.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end mt-4">
            <button
              onClick={enqueue}
              disabled={enqueueing}
              className="px-4 py-2 rounded-lg bg-accent-green/20 border border-accent-green/40 text-accent-green text-sm font-medium hover:bg-accent-green/30 disabled:opacity-50"
            >
              {enqueueing ? t("campaigns.launching") : t("campaigns.launch")}
            </button>
          </div>
        </section>

        {/* A/B test stats — viewable for any campaign that has sent log entries */}
        <section className="bg-card-bg border border-card-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <h2 className="text-lg font-semibold">A/B test results</h2>
            <div className="flex items-center gap-2">
              <select
                value={statsCampaign}
                onChange={(e) => setStatsCampaign(e.target.value)}
                className="bg-background border border-card-border rounded-lg px-2 py-1 text-sm"
              >
                <option value="">— pick a campaign —</option>
                {knownCampaigns.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {!statsCampaign ? (
            <p className="text-text-muted text-sm">
              Pick a campaign above to see per-arm reply rates. After ~50+
              primary sends per arm, the winner column highlights the strategy
              with the highest reply rate.
            </p>
          ) : statsLoading && !stats ? (
            <p className="text-text-muted text-sm">Loading…</p>
          ) : !stats || stats.arms.length === 0 ? (
            <p className="text-text-muted text-sm">
              No sends recorded yet for <strong>{statsCampaign}</strong>.
            </p>
          ) : (
            <ArmStatsTable stats={stats} />
          )}
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
            <h2 className="text-lg font-semibold mb-3">{t("campaigns.sends.title")}</h2>
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
                        {e.arm && e.arm !== "A" ? (
                          <span className="ml-1 text-accent-yellow">
                            [{e.arm}]
                          </span>
                        ) : null}
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

function ArmStatsTable({ stats }: { stats: CampaignStats }) {
  const max = Math.max(...stats.arms.map((a) => a.reply_rate), 0);
  return (
    <div>
      <div className="text-xs text-text-muted mb-2">
        {stats.total_sent} primary sends · {stats.total_replied} replies
        {stats.winner ? (
          <>
            {" "}
            · winner: <strong className="text-accent-green">{stats.winner}</strong>
          </>
        ) : null}
      </div>
      <table className="w-full text-sm">
        <thead className="text-text-muted">
          <tr className="border-b border-card-border/60">
            <th className="text-left py-1 font-normal">Arm</th>
            <th className="text-right py-1 font-normal">Sent</th>
            <th className="text-right py-1 font-normal">Replied</th>
            <th className="text-right py-1 font-normal">Reply rate</th>
            <th className="text-left py-1 font-normal w-1/3 pl-3">Bar</th>
          </tr>
        </thead>
        <tbody>
          {stats.arms.map((a) => {
            const isWinner = stats.winner === a.name;
            const pct = (a.reply_rate * 100).toFixed(1);
            const widthPct = max > 0 ? (a.reply_rate / max) * 100 : 0;
            return (
              <tr
                key={a.name}
                className="border-b border-card-border/30 last:border-b-0"
              >
                <td className="py-1.5">
                  <span
                    className={
                      isWinner
                        ? "font-bold text-accent-green"
                        : "font-medium"
                    }
                  >
                    {a.name}
                  </span>
                  {isWinner ? (
                    <span className="ml-2 text-[10px] uppercase tracking-wider text-accent-green">
                      winner
                    </span>
                  ) : null}
                </td>
                <td className="text-right py-1.5 font-mono">{a.sent}</td>
                <td className="text-right py-1.5 font-mono">{a.replied}</td>
                <td className="text-right py-1.5 font-mono">{pct}%</td>
                <td className="pl-3 py-1.5">
                  <div className="h-2 bg-card-border/30 rounded overflow-hidden">
                    <div
                      className={
                        isWinner
                          ? "h-full bg-accent-green"
                          : "h-full bg-accent-blue/60"
                      }
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {stats.total_sent < stats.arms.length * 30 ? (
        <p className="text-xs text-text-muted mt-2 italic">
          Sample is small ({stats.total_sent} sends total). Reply-rate
          differences below ~50 sends per arm are noisy — wait for more data
          before declaring a winner.
        </p>
      ) : null}
    </div>
  );
}
