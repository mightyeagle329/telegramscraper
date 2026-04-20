"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { Member } from "@/lib/types";

export default function ContactsPage() {
  const [sheets, setSheets] = useState<Record<string, number>>({});
  const [group, setGroup] = useState<string>("");
  const [members, setMembers] = useState<Member[]>([]);
  const [query, setQuery] = useState("");
  const [onlyWithUsername, setOnlyWithUsername] = useState(false);
  const [loadingSheets, setLoadingSheets] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the list of scraped groups on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stats = await api.getSheetStats();
        if (cancelled) return;
        setSheets(stats);
        // Auto-pick the largest group so the user sees data immediately.
        const biggest = Object.entries(stats).sort(
          (a, b) => b[1] - a[1]
        )[0]?.[0];
        if (biggest) setGroup(biggest);
        setError(null);
      } catch (e) {
        if (!cancelled)
          setError(
            e instanceof Error
              ? e.message
              : "Couldn't load group stats from the Python backend."
          );
      } finally {
        if (!cancelled) setLoadingSheets(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load members whenever the selected group changes.
  const loadMembers = useCallback(async (name: string) => {
    if (!name) {
      setMembers([]);
      return;
    }
    setLoadingMembers(true);
    try {
      const res = await api.getSheetMembers(name);
      setMembers(res.members as Member[]);
      setError(null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't load members for that group."
      );
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  useEffect(() => {
    loadMembers(group);
  }, [group, loadMembers]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members.filter((m) => {
      if (onlyWithUsername && !m.Username) return false;
      if (!q) return true;
      return (
        (m["First Name"] ?? "").toLowerCase().includes(q) ||
        (m["Last Name"] ?? "").toLowerCase().includes(q) ||
        (m.Username ?? "").toLowerCase().includes(q) ||
        (m["User ID"] ?? "").includes(q)
      );
    });
  }, [members, query, onlyWithUsername]);

  const totalSheets = Object.keys(sheets).length;
  const totalMembers = Object.values(sheets).reduce((s, n) => s + n, 0);
  const newCount = members.filter((m) => m["Is New"] === "NEW").length;

  return (
    <main className="max-w-6xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Contacts</h1>
        <p className="text-text-muted text-sm">
          Scraped Telegram users, pulled live from your Google Sheet via the
          Python backend.
        </p>
      </div>

      {error ? (
        <div className="px-4 py-2 bg-accent-red/10 border border-accent-red/30 text-accent-red rounded-lg text-sm">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <Stat label="Groups scraped" value={totalSheets} />
        <Stat
          label="Total contacts"
          value={totalMembers.toLocaleString()}
        />
        <Stat
          label={group ? "In this group" : "Pick a group"}
          value={members.length.toLocaleString()}
        />
        <Stat label="New this run" value={newCount} />
      </div>

      {loadingSheets ? (
        <div className="card-elevated p-6 text-center text-text-muted text-sm">
          Loading groups…
        </div>
      ) : totalSheets === 0 ? (
        <EmptyState />
      ) : (
        <div className="card-elevated overflow-hidden">
          <div className="p-3 md:p-4 border-b border-card-border flex flex-col md:flex-row md:items-center gap-3">
            <select
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              className="bg-background border border-card-border rounded-lg px-3 py-2 text-sm md:w-60"
            >
              <option value="">— pick a group —</option>
              {Object.entries(sheets).map(([name, count]) => (
                <option key={name} value={name}>
                  {name} ({count})
                </option>
              ))}
            </select>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, username, or ID…"
              className="flex-1 bg-background border border-card-border rounded-lg px-3 py-2 text-sm"
            />
            <label className="flex items-center gap-2 text-xs text-text-muted shrink-0">
              <input
                type="checkbox"
                checked={onlyWithUsername}
                onChange={(e) => setOnlyWithUsername(e.target.checked)}
              />
              Has @username
            </label>
          </div>

          {loadingMembers ? (
            <div className="p-6 text-center text-text-muted text-sm">
              Loading members…
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-text-muted text-sm">
              No matching contacts. {members.length > 0 ? "Try clearing the filter." : "Pick a group above."}
            </div>
          ) : (
            <>
              {/* Mobile: cards */}
              <ul className="md:hidden divide-y divide-card-border/40">
                {filtered.slice(0, 200).map((m) => (
                  <li key={m["User ID"]} className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium truncate">
                          {[m["First Name"], m["Last Name"]]
                            .filter(Boolean)
                            .join(" ") || "(no name)"}
                        </div>
                        <div className="text-xs text-text-muted truncate">
                          {m.Username ? `@${m.Username}` : "no username"} ·{" "}
                          {m["User ID"]}
                        </div>
                      </div>
                      {m["Is New"] === "NEW" ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-green/15 text-accent-green border border-accent-green/30 shrink-0">
                          NEW
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>

              {/* Desktop: table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-card-border/40 text-text-muted text-xs uppercase">
                    <tr>
                      <th className="text-left px-4 py-2">User ID</th>
                      <th className="text-left px-4 py-2">Username</th>
                      <th className="text-left px-4 py-2">First name</th>
                      <th className="text-left px-4 py-2">Last name</th>
                      <th className="text-left px-4 py-2">Phone</th>
                      <th className="text-left px-4 py-2">Scraped</th>
                      <th className="text-left px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, 500).map((m) => (
                      <tr
                        key={m["User ID"]}
                        className="border-t border-card-border/40 hover:bg-card-border/20"
                      >
                        <td className="px-4 py-2 font-mono text-xs">
                          {m["User ID"]}
                        </td>
                        <td className="px-4 py-2">
                          {m.Username ? (
                            <a
                              href={`https://t.me/${m.Username}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-accent-blue hover:underline"
                            >
                              @{m.Username}
                            </a>
                          ) : (
                            <span className="text-text-muted">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          {m["First Name"] || "—"}
                        </td>
                        <td className="px-4 py-2">
                          {m["Last Name"] || "—"}
                        </td>
                        <td className="px-4 py-2 text-text-muted text-xs">
                          {m.Phone || "—"}
                        </td>
                        <td className="px-4 py-2 text-text-muted text-xs whitespace-nowrap">
                          {formatShortDate(m["Scraped At"])}
                        </td>
                        <td className="px-4 py-2">
                          {m["Is New"] === "NEW" ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-green/15 text-accent-green border border-accent-green/30">
                              NEW
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filtered.length > 500 ? (
                  <div className="px-4 py-3 text-xs text-text-muted border-t border-card-border/40 text-center">
                    Showing first 500 of {filtered.length.toLocaleString()}.
                    Use the search box to narrow down.
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
      )}
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

function EmptyState() {
  return (
    <div className="card-elevated p-6 md:p-8 text-center">
      <p className="font-medium mb-2">No scraped contacts yet.</p>
      <p className="text-sm text-text-muted mb-4 max-w-lg mx-auto">
        Go to <strong>Groups</strong>, add a Telegram group, and click{" "}
        <strong>Scrape Members</strong> (or <strong>Scrape Messages</strong>{" "}
        for broadcast channels). Contacts populate here automatically.
      </p>
      <Link
        href="/groups"
        className="inline-block px-4 py-2 rounded-lg bg-accent-green/20 border border-accent-green/40 text-accent-green text-sm font-medium hover:bg-accent-green/30"
      >
        Go to Groups
      </Link>
    </div>
  );
}

function formatShortDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
