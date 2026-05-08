"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type {
  BotHistoryEntry,
  BotQueueRow,
  BotStatus,
  BotWriterConfig,
  BotWriterPreviewRow,
} from "@/lib/types";

const POST_TYPES = ["win", "game", "engagement", "poll"];

export default function BotPage() {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [queue, setQueue] = useState<BotQueueRow[]>([]);
  const [history, setHistory] = useState<BotHistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [s, q, h] = await Promise.all([
        api.getBotStatus(),
        api.getBotQueue().catch(() => [] as BotQueueRow[]),
        api.getBotHistory(50).catch(() => [] as BotHistoryEntry[]),
      ]);
      setStatus(s);
      setQueue(q);
      setHistory(h);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    refresh();
    const i = setInterval(refresh, 30_000);
    return () => clearInterval(i);
  }, [refresh]);

  async function runCycleNow() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.botRunCycle();
      setError(
        `Cycle ran: ${r.posted} posted, ${r.errors} errors, ${r.considered} considered.`
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to run cycle");
    } finally {
      setBusy(false);
    }
  }

  // Three queue buckets (Phase 3 VA workflow):
  //   pendingReview — AI-generated, awaiting VA approval
  //   scheduled    — empty/approved status, future scheduled_at, hasn't posted
  //   posted       — has posted_at
  const pendingReview = useMemo(
    () =>
      queue.filter(
        (q) => !q.posted_at && (q.status || "").toLowerCase() === "pending_review"
      ),
    [queue]
  );
  const scheduled = useMemo(
    () =>
      queue.filter(
        (q) =>
          !q.posted_at &&
          (q.status || "").toLowerCase() !== "pending_review"
      ),
    [queue]
  );
  const posted = useMemo(
    () => queue.filter((q) => !!q.posted_at),
    [queue]
  );

  return (
    <main className="max-w-6xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-6">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Engagement bot</h1>
          <p className="text-text-muted text-sm">
            Posts content into the destination Telegram group on schedule.
            Use Compose or Bulk import to add wins; AI fills the gaps and
            queues content for your review.
          </p>
        </div>
        <button
          onClick={runCycleNow}
          disabled={busy || !status?.configured}
          className="px-3 py-1.5 rounded-lg border border-card-border text-sm hover:border-foreground/40 disabled:opacity-50"
        >
          {busy ? "Running…" : "Run cycle now"}
        </button>
      </div>

      {error ? (
        <div className="px-4 py-2 rounded-lg text-sm border bg-card-bg border-card-border text-text-muted">
          {error}
        </div>
      ) : null}

      <StatusCard status={status} />

      <QuickStats
        pending={pendingReview.length}
        scheduled={scheduled.length}
        posted={posted.length}
      />

      <ComposeCard onCreated={refresh} disabled={!status?.configured} />

      <BulkImportCard onImported={refresh} disabled={!status?.configured} />

      {pendingReview.length > 0 ? (
        <PendingReviewPanel rows={pendingReview} onChange={refresh} />
      ) : null}

      <ScheduledQueuePanel
        rows={scheduled}
        onChange={refresh}
        configured={!!status?.configured}
      />

      <PostedHistoryPanel rows={posted} />

      <AIWriterPanel />
    </main>
  );
}

// =========================================================================

function StatusCard({ status }: { status: BotStatus | null }) {
  if (!status) {
    return (
      <section className="card-elevated p-5">
        <p className="text-text-muted text-sm">Loading bot status…</p>
      </section>
    );
  }
  if (!status.configured) {
    return (
      <section className="card-elevated p-5 border-accent-yellow/30">
        <h2 className="text-lg font-semibold mb-2">Bot not configured</h2>
        <p className="text-sm text-text-muted">
          Set the following environment variables in <code>backend/.env</code>{" "}
          and restart the backend:
        </p>
        <ul className="list-disc list-inside text-sm mt-2 space-y-1 font-mono text-text-muted">
          {(status.missing || []).map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </section>
    );
  }
  if (status.error) {
    return (
      <section className="card-elevated p-5 border-accent-red/30">
        <h2 className="text-lg font-semibold mb-2">Bot configured, but unreachable</h2>
        <p className="text-sm text-accent-red break-words">{status.error}</p>
      </section>
    );
  }
  return (
    <section className="card-elevated p-5">
      <h2 className="text-lg font-semibold mb-2">Bot connected</h2>
      <div className="grid sm:grid-cols-2 gap-3 text-sm">
        <Detail label="Bot" value={`@${status.bot_username || "?"}`} />
        <Detail label="Posting to chat_id" value={status.chat_id || "—"} />
        <Detail label="Sheet" value={status.sheet_id || "—"} mono />
        <Detail label="Sheet tab" value={status.tab || "Posts"} />
      </div>
    </section>
  );
}

function QuickStats({
  pending,
  scheduled,
  posted,
}: {
  pending: number;
  scheduled: number;
  posted: number;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <Stat label="Pending review" value={pending} accent="yellow" />
      <Stat label="Scheduled" value={scheduled} accent="green" />
      <Stat label="Posted (this session)" value={posted} />
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "yellow" | "green";
}) {
  const tone =
    accent === "yellow"
      ? "text-accent-yellow"
      : accent === "green"
      ? "text-accent-green"
      : "";
  return (
    <div className="card-elevated p-3 md:p-4">
      <div className="text-text-muted text-[11px] md:text-xs uppercase tracking-wide">
        {label}
      </div>
      <div className={`text-xl md:text-2xl font-bold mt-1 ${tone}`}>{value}</div>
    </div>
  );
}

// =========================================================================

/** Single-post composer — fast path when the client texts you one new win
 *  and the VA wants to schedule it without opening the spreadsheet. */
function ComposeCard({
  onCreated,
  disabled,
}: {
  onCreated: () => Promise<void> | void;
  disabled: boolean;
}) {
  const [content, setContent] = useState("");
  const [type, setType] = useState("win");
  const [scheduledAt, setScheduledAt] = useState(defaultScheduleLocalDateTime());
  const [imageUrl, setImageUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setBusy(true);
    setFeedback(null);
    try {
      const utc = localInputToUtcIso(scheduledAt);
      const row = await api.addBotPost({
        content: content.trim(),
        scheduled_at: utc,
        type,
        image_url: imageUrl.trim() || undefined,
      });
      setFeedback(`Scheduled ${row.id} at ${utc}.`);
      setContent("");
      setImageUrl("");
      setScheduledAt(defaultScheduleLocalDateTime());
      await onCreated();
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : "Failed to add post");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card-elevated p-5">
      <div className="mb-3">
        <h2 className="text-lg font-semibold">Compose a single post</h2>
        <p className="text-xs text-text-muted mt-0.5">
          Quick way to add one win or announcement. Goes straight into the
          schedule — no review step.
        </p>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
          placeholder="🎰 LuckyMike just hit $850 on Mega Slots! Big spin tonight 🔥"
          disabled={disabled}
          className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm"
        />
        <div className="grid sm:grid-cols-3 gap-3">
          <label className="block text-xs">
            <span className="text-text-muted block mb-1">Type</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              disabled={disabled}
              className="w-full bg-background border border-card-border rounded px-2 py-1.5 text-sm"
            >
              {POST_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs sm:col-span-2">
            <span className="text-text-muted block mb-1">
              Scheduled at (your local time)
            </span>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              disabled={disabled}
              className="w-full bg-background border border-card-border rounded px-2 py-1.5 text-sm"
            />
          </label>
        </div>
        <input
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          placeholder="Optional image URL (https://...) — sends as a photo with the content as caption"
          disabled={disabled}
          className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-xs"
        />
        <div className="flex items-center justify-between gap-3 flex-wrap">
          {feedback ? (
            <div className="text-xs text-text-muted">{feedback}</div>
          ) : (
            <span />
          )}
          <button
            type="submit"
            disabled={disabled || busy || !content.trim()}
            className="px-4 py-2 rounded-lg bg-accent-green/20 border border-accent-green/40 text-accent-green text-sm font-medium hover:bg-accent-green/30 disabled:opacity-50"
          >
            {busy ? "Adding…" : "Schedule post"}
          </button>
        </div>
      </form>
    </section>
  );
}

// =========================================================================

/** Bulk-paste wins from the client (one per line) and spread them across
 *  N days. The headline VA productivity feature. */
function BulkImportCard({
  onImported,
  disabled,
}: {
  onImported: () => Promise<void> | void;
  disabled: boolean;
}) {
  const [text, setText] = useState("");
  const [type, setType] = useState("win");
  const [days, setDays] = useState(1);
  const [perDay, setPerDay] = useState("");
  const [pendingReview, setPendingReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const lines = useMemo(
    () =>
      text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean),
    [text]
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (lines.length === 0) return;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await api.bulkBotPosts({
        items: lines.map((content) => ({ content, type })),
        spread_days: days,
        posts_per_day: perDay ? Number(perDay) : undefined,
        pending_review: pendingReview,
      });
      setFeedback(
        `Imported ${result.added} of ${lines.length} posts.` +
          (pendingReview
            ? " Marked pending review — approve them below before they go live."
            : " They'll publish on the schedule.")
      );
      setText("");
      await onImported();
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : "Bulk import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card-elevated p-5">
      <div className="mb-3">
        <h2 className="text-lg font-semibold">
          Bulk import wins ({lines.length} {lines.length === 1 ? "line" : "lines"} ready)
        </h2>
        <p className="text-xs text-text-muted mt-0.5">
          Paste many posts (one per line). Outpilot spreads them evenly
          across the next {days} {days === 1 ? "day" : "days"} during the
          configured active hours.
        </p>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={
            "🎰 LuckyMike won $850 on Mega Slots\n" +
            "🔥 Sarah hit $1,200 on Diamond Rush\n" +
            "💰 Jake just took $400 home from Fortune Wheel\n..."
          }
          disabled={disabled}
          className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm font-mono"
        />
        <div className="grid sm:grid-cols-3 gap-3">
          <label className="block text-xs">
            <span className="text-text-muted block mb-1">Type for all</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              disabled={disabled}
              className="w-full bg-background border border-card-border rounded px-2 py-1.5 text-sm"
            >
              {POST_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs">
            <span className="text-text-muted block mb-1">Spread over (days)</span>
            <input
              type="number"
              min={1}
              max={7}
              value={days}
              onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))}
              disabled={disabled}
              className="w-full bg-background border border-card-border rounded px-2 py-1.5 text-sm"
            />
          </label>
          <label className="block text-xs">
            <span className="text-text-muted block mb-1">
              Posts per day (blank = auto)
            </span>
            <input
              type="number"
              min={1}
              value={perDay}
              onChange={(e) => setPerDay(e.target.value)}
              disabled={disabled}
              className="w-full bg-background border border-card-border rounded px-2 py-1.5 text-sm"
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer select-none">
          <input
            type="checkbox"
            checked={pendingReview}
            onChange={(e) => setPendingReview(e.target.checked)}
            disabled={disabled}
          />
          <span>
            Import as <strong>pending review</strong> — they show in the
            review queue below; you approve each before going live. Off
            by default since you usually trust client-supplied wins.
          </span>
        </label>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          {feedback ? (
            <div className="text-xs text-text-muted">{feedback}</div>
          ) : (
            <span />
          )}
          <button
            type="submit"
            disabled={disabled || busy || lines.length === 0}
            className="px-4 py-2 rounded-lg bg-accent-green/20 border border-accent-green/40 text-accent-green text-sm font-medium hover:bg-accent-green/30 disabled:opacity-50"
          >
            {busy ? "Importing…" : `Import ${lines.length} post${lines.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </form>
    </section>
  );
}

// =========================================================================

/** AI-generated posts awaiting VA approval. Approve / edit / reject inline. */
function PendingReviewPanel({
  rows,
  onChange,
}: {
  rows: BotQueueRow[];
  onChange: () => Promise<void> | void;
}) {
  return (
    <section className="card-elevated p-5 border-accent-yellow/30">
      <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">
            Pending review ({rows.length})
          </h2>
          <p className="text-xs text-text-muted mt-0.5">
            AI-generated posts waiting on VA approval. Approve to release
            for publishing, edit to fix, or delete to drop entirely.
          </p>
        </div>
      </div>
      <ul className="space-y-3">
        {rows.map((r) => (
          <PendingRow key={r.row} row={r} onChange={onChange} />
        ))}
      </ul>
    </section>
  );
}

function PendingRow({
  row,
  onChange,
}: {
  row: BotQueueRow;
  onChange: () => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.content);
  const [busy, setBusy] = useState<"" | "approve" | "edit" | "delete">("");

  async function approve() {
    setBusy("approve");
    try {
      await api.approveBotPost(row.row);
      await onChange();
    } finally {
      setBusy("");
    }
  }
  async function saveEdit() {
    setBusy("edit");
    try {
      await api.updateBotPost(row.row, { content: draft });
      setEditing(false);
      await onChange();
    } finally {
      setBusy("");
    }
  }
  async function remove() {
    if (!confirm("Delete this post?")) return;
    setBusy("delete");
    try {
      await api.deleteBotPost(row.row);
      await onChange();
    } finally {
      setBusy("");
    }
  }

  return (
    <li className="border border-card-border/40 rounded-lg p-3">
      <div className="flex items-center justify-between gap-3 text-xs text-text-muted mb-2">
        <span className="font-mono">
          row {row.row} · {row.type || "—"}
        </span>
        <span className="font-mono">
          {row.scheduled_at
            ? new Date(row.scheduled_at).toLocaleString()
            : "(no schedule)"}
        </span>
      </div>
      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm"
        />
      ) : (
        <div className="text-sm break-words mb-2">{row.content}</div>
      )}
      <div className="flex items-center gap-2 text-xs flex-wrap mt-2">
        {editing ? (
          <>
            <button
              onClick={saveEdit}
              disabled={busy === "edit"}
              className="px-2 py-1 rounded bg-accent-green/20 border border-accent-green/40 text-accent-green disabled:opacity-50"
            >
              {busy === "edit" ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setDraft(row.content);
              }}
              className="px-2 py-1 rounded border border-card-border hover:border-foreground/40"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              onClick={approve}
              disabled={busy === "approve"}
              className="px-2 py-1 rounded bg-accent-green/20 border border-accent-green/40 text-accent-green disabled:opacity-50"
            >
              {busy === "approve" ? "Approving…" : "Approve"}
            </button>
            <button
              onClick={() => setEditing(true)}
              className="px-2 py-1 rounded border border-card-border hover:border-foreground/40"
            >
              Edit
            </button>
            <button
              onClick={remove}
              disabled={busy === "delete"}
              className="px-2 py-1 rounded border border-accent-red/30 text-accent-red hover:bg-accent-red/10 disabled:opacity-50"
            >
              {busy === "delete" ? "Deleting…" : "Reject"}
            </button>
          </>
        )}
      </div>
    </li>
  );
}

// =========================================================================

function ScheduledQueuePanel({
  rows,
  onChange,
  configured,
}: {
  rows: BotQueueRow[];
  onChange: () => Promise<void> | void;
  configured: boolean;
}) {
  return (
    <section className="card-elevated p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-lg font-semibold">
          Scheduled queue ({rows.length})
        </h2>
        <span className="text-xs text-text-muted">
          Auto-publishes on each post&apos;s scheduled time.
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="text-text-muted text-sm">
          Nothing scheduled. Compose a post above or use Bulk import — or
          enable AI auto-write at the bottom of the page.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <ScheduledRow
              key={r.row}
              row={r}
              onChange={onChange}
              disabled={!configured}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ScheduledRow({
  row,
  onChange,
  disabled,
}: {
  row: BotQueueRow;
  onChange: () => Promise<void> | void;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(row.content);
  const [scheduledAt, setScheduledAt] = useState(
    utcIsoToLocalInput(row.scheduled_at) || ""
  );
  const [busy, setBusy] = useState<"" | "post" | "edit" | "delete">("");

  async function postNow() {
    setBusy("post");
    try {
      await api.botPostNow(row.row);
      await onChange();
    } finally {
      setBusy("");
    }
  }
  async function saveEdit() {
    setBusy("edit");
    try {
      const utc = scheduledAt ? localInputToUtcIso(scheduledAt) : row.scheduled_at;
      await api.updateBotPost(row.row, { content, scheduled_at: utc });
      setEditing(false);
      await onChange();
    } finally {
      setBusy("");
    }
  }
  async function remove() {
    if (!confirm("Delete this post?")) return;
    setBusy("delete");
    try {
      await api.deleteBotPost(row.row);
      await onChange();
    } finally {
      setBusy("");
    }
  }

  return (
    <li className="border-b border-card-border/40 last:border-b-0 pb-2 last:pb-0">
      <div className="flex items-center justify-between gap-3 text-xs text-text-muted">
        <span className="font-mono">
          row {row.row} · {row.type || "—"}
          {row.status ? (
            <span className="ml-1 text-accent-green">· {row.status}</span>
          ) : null}
        </span>
        <span className="font-mono">
          {row.scheduled_at
            ? new Date(row.scheduled_at).toLocaleString()
            : "(no schedule)"}
        </span>
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
            className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm"
          />
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="bg-background border border-card-border rounded px-2 py-1.5 text-sm"
          />
        </div>
      ) : (
        <div className="text-sm break-words mt-1 line-clamp-2">{row.content}</div>
      )}
      <div className="flex items-center gap-2 text-xs flex-wrap mt-2">
        {editing ? (
          <>
            <button
              onClick={saveEdit}
              disabled={busy === "edit"}
              className="px-2 py-1 rounded bg-accent-green/20 border border-accent-green/40 text-accent-green disabled:opacity-50"
            >
              {busy === "edit" ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setContent(row.content);
                setScheduledAt(utcIsoToLocalInput(row.scheduled_at) || "");
              }}
              className="px-2 py-1 rounded border border-card-border hover:border-foreground/40"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              onClick={postNow}
              disabled={disabled || busy === "post"}
              className="px-2 py-1 rounded border border-card-border hover:border-foreground/40 disabled:opacity-50"
            >
              {busy === "post" ? "Posting…" : "Post now"}
            </button>
            <button
              onClick={() => setEditing(true)}
              className="px-2 py-1 rounded border border-card-border hover:border-foreground/40"
            >
              Edit
            </button>
            <button
              onClick={remove}
              disabled={busy === "delete"}
              className="px-2 py-1 rounded border border-accent-red/30 text-accent-red hover:bg-accent-red/10 disabled:opacity-50"
            >
              {busy === "delete" ? "Deleting…" : "Delete"}
            </button>
          </>
        )}
      </div>
    </li>
  );
}

// =========================================================================

function PostedHistoryPanel({ rows }: { rows: BotQueueRow[] }) {
  return (
    <section className="card-elevated p-5">
      <h2 className="text-lg font-semibold mb-3">
        Posted ({rows.length})
      </h2>
      {rows.length === 0 ? (
        <p className="text-text-muted text-sm">Nothing posted yet from this sheet.</p>
      ) : (
        <ul className="space-y-2 text-sm max-h-96 overflow-y-auto pr-1">
          {rows
            .slice()
            .reverse()
            .map((q) => (
              <li
                key={q.row}
                className="border-b border-card-border/40 pb-2 last:border-b-0"
              >
                <div className="flex items-center justify-between gap-3 text-xs text-text-muted">
                  <span>
                    <span className="font-mono">row {q.row}</span> ·{" "}
                    {q.type || "—"}
                  </span>
                  <span className="font-mono">
                    {q.posted_at ? new Date(q.posted_at).toLocaleString() : ""}
                  </span>
                </div>
                <div className="text-sm mt-1 break-words line-clamp-2">
                  {q.content}
                </div>
                {q.status && q.status !== "posted" ? (
                  <div className="text-xs text-accent-red mt-1">
                    {q.status}
                  </div>
                ) : null}
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}

// =========================================================================

function Detail({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-text-muted">
        {label}
      </div>
      <div
        className={`mt-0.5 ${mono ? "font-mono text-xs break-all" : "font-medium"}`}
      >
        {value}
      </div>
    </div>
  );
}

// =========================================================================
// AI engagement writer (auto-generates pending-review posts) — stays at the
// bottom because most VA work goes through Compose / Bulk above.

function AIWriterPanel() {
  const [cfg, setCfg] = useState<BotWriterConfig | null>(null);
  const [busy, setBusy] = useState<"" | "save" | "preview" | "run">("");
  const [preview, setPreview] = useState<BotWriterPreviewRow[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setCfg(await api.getBotWriterConfig());
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!cfg) {
    return (
      <section className="card-elevated p-5">
        <p className="text-text-muted text-sm">Loading AI writer…</p>
      </section>
    );
  }

  function update<K extends keyof BotWriterConfig>(
    key: K,
    value: BotWriterConfig[K]
  ) {
    setCfg({ ...cfg!, [key]: value });
  }

  function updateMix(type: string, value: number) {
    setCfg({
      ...cfg!,
      content_mix: { ...cfg!.content_mix, [type]: Math.max(0, value) },
    });
  }

  async function save() {
    if (!cfg) return;
    setBusy("save");
    setFeedback(null);
    try {
      const updated = await api.updateBotWriterConfig(cfg);
      setCfg(updated);
      setFeedback("Saved.");
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy("");
    }
  }

  async function doPreview() {
    setBusy("preview");
    setFeedback(null);
    setPreview([]);
    try {
      const r = await api.previewBotWriter();
      if (r.error) {
        setFeedback(r.error);
      } else {
        setPreview(r.rows || []);
        setFeedback(`Generated ${r.count ?? 0} sample post(s) (not written to sheet).`);
      }
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setBusy("");
    }
  }

  async function doRunNow() {
    setBusy("run");
    setFeedback(null);
    try {
      const r = await api.runBotWriterNow();
      if (r.skipped) {
        setFeedback(`Skipped: ${r.skipped}`);
      } else {
        setFeedback(
          `Generated ${r.generated ?? 0} posts; ${r.appended ?? 0} added as ` +
            "Pending review (approve them above).",
        );
      }
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : "Run failed");
    } finally {
      setBusy("");
    }
  }

  const mixTypes: { key: string; label: string; help: string }[] = [
    { key: "win", label: "Wins", help: "Fabricated player wins (highest social proof)" },
    { key: "game", label: "Game / event announcements", help: "Tournaments, daily challenges, drops" },
    { key: "engagement", label: "Engagement questions", help: "Open questions to spark replies" },
    { key: "poll", label: "Polls", help: "2-tap A vs B questions" },
  ];

  return (
    <section className="card-elevated p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold">AI engagement writer (advanced)</h2>
          <p className="text-xs text-text-muted mt-0.5">
            Optional — when enabled, GPT auto-fills the pending-review queue every 12 hours so the VA always has content to approve. Most VA work goes through Compose / Bulk above; this fills the gaps.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => update("enabled", e.target.checked)}
          />
          <span className={cfg.enabled ? "text-accent-green font-medium" : "text-text-muted"}>
            {cfg.enabled ? "Enabled" : "Disabled"}
          </span>
        </label>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs uppercase text-text-muted mb-1">
            Brand context (style/voice for GPT)
          </label>
          <textarea
            value={cfg.brand_context}
            onChange={(e) => update("brand_context", e.target.value)}
            rows={5}
            className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <label className="block text-xs">
              <span className="text-text-muted block mb-1">Posts / batch</span>
              <input
                type="number"
                min={1}
                max={20}
                value={cfg.posts_per_batch}
                onChange={(e) =>
                  update("posts_per_batch", Math.max(1, Number(e.target.value) || 1))
                }
                className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-xs">
              <span className="text-text-muted block mb-1">Active start (UTC)</span>
              <input
                type="number"
                min={0}
                max={23}
                value={cfg.active_start_hour_utc}
                onChange={(e) =>
                  update(
                    "active_start_hour_utc",
                    Math.max(0, Math.min(23, Number(e.target.value) || 0))
                  )
                }
                className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-xs">
              <span className="text-text-muted block mb-1">Active end (UTC)</span>
              <input
                type="number"
                min={0}
                max={23}
                value={cfg.active_end_hour_utc}
                onChange={(e) =>
                  update(
                    "active_end_hour_utc",
                    Math.max(0, Math.min(23, Number(e.target.value) || 0))
                  )
                }
                className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm"
              />
            </label>
          </div>
          <p className="text-[10px] text-text-muted">
            US peak ~ 14:00 UTC start, 04:00 UTC end (10am-midnight EST). If end ≤ start, window crosses midnight.
          </p>
          <div>
            <label className="block text-xs uppercase text-text-muted mb-1">Model</label>
            <select
              value={cfg.model}
              onChange={(e) => update("model", e.target.value)}
              className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">(default — gpt-4o-mini)</option>
              <option value="gpt-4o-mini">gpt-4o-mini (cheap, fast)</option>
              <option value="gpt-4o">gpt-4o (premium quality)</option>
            </select>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <label className="block text-xs uppercase text-text-muted mb-2">
          Content mix (relative weights)
        </label>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {mixTypes.map((t) => (
            <div key={t.key}>
              <label className="text-xs flex justify-between mb-1">
                <span>{t.label}</span>
                <span className="font-mono text-text-muted">{cfg.content_mix[t.key] ?? 0}</span>
              </label>
              <input
                type="number"
                min={0}
                value={cfg.content_mix[t.key] ?? 0}
                onChange={(e) => updateMix(t.key, Number(e.target.value) || 0)}
                className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm"
              />
              <p className="text-[10px] text-text-muted mt-1">{t.help}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mt-4">
        <button
          onClick={save}
          disabled={busy !== ""}
          className="px-3 py-1.5 rounded-lg bg-accent-green/20 border border-accent-green/40 text-accent-green text-sm font-medium hover:bg-accent-green/30 disabled:opacity-50"
        >
          {busy === "save" ? "Saving…" : "Save settings"}
        </button>
        <button
          onClick={doPreview}
          disabled={busy !== ""}
          className="px-3 py-1.5 rounded-lg border border-card-border text-sm hover:border-foreground/40 disabled:opacity-50"
        >
          {busy === "preview" ? "Generating…" : "Preview a batch (no sheet write)"}
        </button>
        <button
          onClick={doRunNow}
          disabled={busy !== ""}
          className="px-3 py-1.5 rounded-lg border border-card-border text-sm hover:border-foreground/40 disabled:opacity-50"
        >
          {busy === "run" ? "Generating…" : "Generate + queue for review"}
        </button>
      </div>

      {feedback ? (
        <div className="mt-3 text-sm text-text-muted">{feedback}</div>
      ) : null}

      {preview.length > 0 ? (
        <div className="mt-4">
          <div className="text-xs uppercase text-text-muted mb-2">
            Preview ({preview.length})
          </div>
          <ul className="space-y-2">
            {preview.map((p, i) => (
              <li key={i} className="border border-card-border/40 rounded-lg p-3">
                <div className="flex items-center justify-between text-xs text-text-muted mb-1">
                  <span className="uppercase tracking-wide">{p.type}</span>
                  <span className="font-mono">
                    {new Date(p.scheduled_at).toLocaleString()}
                  </span>
                </div>
                <div className="text-sm break-words">{p.content}</div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

// =========================================================================
// Helpers — datetime conversion between the <input type="datetime-local">
// value (always in the user's local timezone, no tz suffix) and the UTC
// ISO strings the backend stores.

function defaultScheduleLocalDateTime(): string {
  // Default = 30 minutes from now in local time, rounded to the next 5min.
  const dt = new Date(Date.now() + 30 * 60 * 1000);
  dt.setSeconds(0, 0);
  const m = dt.getMinutes();
  dt.setMinutes(m + (5 - (m % 5 || 5)));
  return formatLocalForInput(dt);
}

function formatLocalForInput(dt: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}` +
    `T${pad(dt.getHours())}:${pad(dt.getMinutes())}`
  );
}

function localInputToUtcIso(local: string): string {
  if (!local) return "";
  // The browser parses "YYYY-MM-DDTHH:MM" as local time.
  return new Date(local).toISOString();
}

function utcIsoToLocalInput(iso: string): string {
  if (!iso) return "";
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return "";
  return formatLocalForInput(dt);
}
