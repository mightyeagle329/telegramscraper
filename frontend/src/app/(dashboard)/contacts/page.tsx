"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import Pagination from "@/components/Pagination";
import { useT } from "@/lib/i18n/context";
import type { Member } from "@/lib/types";

type SortKey =
  | "User ID"
  | "Username"
  | "First Name"
  | "Last Name"
  | "Scraped At";

type FilterPreset = "all" | "new" | "username" | "phone";

export default function ContactsPage() {
  const t = useT();
  const [sheets, setSheets] = useState<Record<string, number>>({});
  const [group, setGroup] = useState<string>("");
  const [members, setMembers] = useState<Member[]>([]);
  const [query, setQuery] = useState("");
  const [preset, setPreset] = useState<FilterPreset>("all");
  const [sortKey, setSortKey] = useState<SortKey>("Scraped At");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [loadingSheets, setLoadingSheets] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Load the list of scraped groups on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stats = await api.getSheetStats();
        if (cancelled) return;
        setSheets(stats);
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

  // Reset to first page whenever filters change.
  useEffect(() => {
    setPage(1);
  }, [query, preset, group, sortKey, sortDir]);

  const filtered = useMemo(() => {
    // FIX: gspread returns numeric cells as numbers, so coerce every field to
    // string before doing any string ops. This was crashing the page on type-
    // to-search because `(number).includes(q)` is a TypeError.
    const q = query.trim().toLowerCase();

    const matchesPreset = (m: Member) => {
      switch (preset) {
        case "new":
          return String(m["Is New"] ?? "") === "NEW";
        case "username":
          return !!String(m.Username ?? "").trim();
        case "phone":
          return !!String(m.Phone ?? "").trim();
        case "all":
        default:
          return true;
      }
    };

    return members.filter((m) => {
      if (!matchesPreset(m)) return false;
      if (!q) return true;
      const first = String(m["First Name"] ?? "").toLowerCase();
      const last = String(m["Last Name"] ?? "").toLowerCase();
      const uname = String(m.Username ?? "").toLowerCase();
      const uid = String(m["User ID"] ?? "");
      return (
        first.includes(q) ||
        last.includes(q) ||
        uname.includes(q) ||
        uid.includes(q)
      );
    });
  }, [members, query, preset]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      const va = String(a[sortKey] ?? "").toLowerCase();
      const vb = String(b[sortKey] ?? "").toLowerCase();
      if (sortKey === "Scraped At") {
        // ISO strings sort correctly lexicographically
        return va < vb ? -dir : va > vb ? dir : 0;
      }
      if (sortKey === "User ID") {
        const na = Number(va) || 0;
        const nb = Number(vb) || 0;
        return (na - nb) * dir;
      }
      return va < vb ? -dir : va > vb ? dir : 0;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const paginated = useMemo(
    () => sorted.slice((page - 1) * pageSize, page * pageSize),
    [sorted, page, pageSize]
  );

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "Scraped At" ? "desc" : "asc");
    }
  }

  function exportCsv() {
    const cols: SortKey[] | string[] = [
      "User ID",
      "Username",
      "First Name",
      "Last Name",
      "Phone",
      "Scraped At",
      "Is New",
    ];
    const header = cols.map(csvEscape).join(",");
    const rows = sorted.map((m) =>
      cols.map((c) => csvEscape(String(m[c as keyof Member] ?? ""))).join(",")
    );
    const body = [header, ...rows].join("\n");
    const blob = new Blob(["\ufeff" + body], { type: "text/csv;charset=utf-8" });
    const filename = `${(group || "contacts").replace(/[^a-z0-9-_]+/gi, "_")}.csv`;
    triggerDownload(blob, filename);
  }

  const totalSheets = Object.keys(sheets).length;
  const totalMembers = Object.values(sheets).reduce((s, n) => s + n, 0);
  const newCount = members.filter(
    (m) => String(m["Is New"] ?? "") === "NEW"
  ).length;

  return (
    <main className="max-w-6xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("contacts.title")}</h1>
        <p className="text-text-muted text-sm">{t("contacts.subtitle")}</p>
      </div>

      {error ? (
        <div className="px-4 py-2 bg-accent-red/10 border border-accent-red/30 text-accent-red rounded-lg text-sm">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <Stat label={t("contacts.stat.groups")} value={totalSheets} />
        <Stat
          label={t("contacts.stat.total")}
          value={totalMembers.toLocaleString()}
        />
        <Stat
          label={group ? t("contacts.stat.inGroup") : t("contacts.stat.pickGroup")}
          value={members.length.toLocaleString()}
        />
        <Stat label={t("contacts.stat.new")} value={newCount} />
      </div>

      {loadingSheets ? (
        <div className="card-elevated p-6 text-center text-text-muted text-sm">
          {t("contacts.loadingGroups")}
        </div>
      ) : totalSheets === 0 ? (
        <EmptyState />
      ) : (
        <div className="card-elevated overflow-hidden">
          <div className="p-3 md:p-4 border-b border-card-border flex flex-col md:flex-row md:items-center gap-3">
            <select
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              className="min-w-0 w-full md:w-60 bg-background border border-card-border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">{t("contacts.pick")}</option>
              {Object.entries(sheets).map(([name, count]) => (
                <option key={name} value={name}>
                  {name} ({count})
                </option>
              ))}
            </select>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("contacts.search")}
              className="min-w-0 flex-1 bg-background border border-card-border rounded-lg px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={exportCsv}
              disabled={sorted.length === 0}
              className="shrink-0 px-3 py-2 rounded-lg border border-card-border text-sm hover:bg-card-border/40 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Export visible rows as CSV"
            >
              ⬇ CSV
            </button>
          </div>

          {/* Filter chips */}
          <div className="px-3 md:px-4 py-2 border-b border-card-border flex flex-wrap items-center gap-2 text-xs">
            <Chip active={preset === "all"} onClick={() => setPreset("all")}>
              All ({members.length})
            </Chip>
            <Chip active={preset === "new"} onClick={() => setPreset("new")}>
              New ({newCount})
            </Chip>
            <Chip
              active={preset === "username"}
              onClick={() => setPreset("username")}
            >
              {t("contacts.filterUsername")}
            </Chip>
            <Chip active={preset === "phone"} onClick={() => setPreset("phone")}>
              Has phone
            </Chip>
          </div>

          {loadingMembers ? (
            <div className="p-6 text-center text-text-muted text-sm">
              {t("contacts.loadingMembers")}
            </div>
          ) : sorted.length === 0 ? (
            <div className="p-6 text-center text-text-muted text-sm">
              {members.length > 0
                ? t("contacts.empty.noMatch")
                : t("contacts.empty.pickGroup")}
            </div>
          ) : (
            <>
              {/* Mobile: cards */}
              <ul className="md:hidden divide-y divide-card-border/40">
                {paginated.map((m) => (
                  <li key={String(m["User ID"])} className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium truncate">
                          {[m["First Name"], m["Last Name"]]
                            .map((x) => String(x ?? "").trim())
                            .filter(Boolean)
                            .join(" ") || "(no name)"}
                        </div>
                        <div className="text-xs text-text-muted truncate">
                          {m.Username
                            ? `@${String(m.Username)}`
                            : "no username"}{" "}
                          · {String(m["User ID"])}
                        </div>
                      </div>
                      {String(m["Is New"] ?? "") === "NEW" ? (
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
                      <SortableTh
                        active={sortKey === "User ID"}
                        dir={sortDir}
                        onClick={() => toggleSort("User ID")}
                      >
                        {t("contacts.table.userId")}
                      </SortableTh>
                      <SortableTh
                        active={sortKey === "Username"}
                        dir={sortDir}
                        onClick={() => toggleSort("Username")}
                      >
                        {t("contacts.table.username")}
                      </SortableTh>
                      <SortableTh
                        active={sortKey === "First Name"}
                        dir={sortDir}
                        onClick={() => toggleSort("First Name")}
                      >
                        {t("contacts.table.firstName")}
                      </SortableTh>
                      <SortableTh
                        active={sortKey === "Last Name"}
                        dir={sortDir}
                        onClick={() => toggleSort("Last Name")}
                      >
                        {t("contacts.table.lastName")}
                      </SortableTh>
                      <th className="text-left px-4 py-2">
                        {t("contacts.table.phone")}
                      </th>
                      <SortableTh
                        active={sortKey === "Scraped At"}
                        dir={sortDir}
                        onClick={() => toggleSort("Scraped At")}
                      >
                        {t("contacts.table.scraped")}
                      </SortableTh>
                      <th className="text-left px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((m) => (
                      <tr
                        key={String(m["User ID"])}
                        className="border-t border-card-border/40 hover:bg-card-border/20"
                      >
                        <td className="px-4 py-2 font-mono text-xs">
                          {String(m["User ID"] ?? "")}
                        </td>
                        <td className="px-4 py-2">
                          {m.Username ? (
                            <a
                              href={`https://t.me/${String(m.Username)}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-accent-blue hover:underline"
                            >
                              @{String(m.Username)}
                            </a>
                          ) : (
                            <span className="text-text-muted">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          {String(m["First Name"] ?? "") || "—"}
                        </td>
                        <td className="px-4 py-2">
                          {String(m["Last Name"] ?? "") || "—"}
                        </td>
                        <td className="px-4 py-2 text-text-muted text-xs">
                          {String(m.Phone ?? "") || "—"}
                        </td>
                        <td className="px-4 py-2 text-text-muted text-xs whitespace-nowrap">
                          {formatShortDate(String(m["Scraped At"] ?? ""))}
                        </td>
                        <td className="px-4 py-2">
                          {String(m["Is New"] ?? "") === "NEW" ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-green/15 text-accent-green border border-accent-green/30">
                              NEW
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                total={sorted.length}
                page={page}
                pageSize={pageSize}
                onPageChange={setPage}
                onPageSizeChange={(n) => {
                  setPageSize(n);
                  setPage(1);
                }}
                label="contacts"
              />
            </>
          )}
        </div>
      )}
    </main>
  );
}

// ─── Helpers + small presentational bits ──────────────────────────────

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

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full border transition-colors ${
        active
          ? "bg-accent-green/15 border-accent-green/40 text-accent-green"
          : "border-card-border text-text-muted hover:text-foreground hover:border-card-border/80"
      }`}
    >
      {children}
    </button>
  );
}

function SortableTh({
  active,
  dir,
  onClick,
  children,
}: {
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <th className="text-left px-4 py-2 select-none">
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 uppercase text-xs tracking-wide hover:text-foreground ${
          active ? "text-foreground" : "text-text-muted"
        }`}
      >
        <span>{children}</span>
        <span className="text-[10px]">
          {active ? (dir === "asc" ? "▲" : "▼") : "⇅"}
        </span>
      </button>
    </th>
  );
}

function EmptyState() {
  const t = useT();
  return (
    <div className="card-elevated p-6 md:p-8 text-center">
      <p className="font-medium mb-2">{t("contacts.emptyAll.title")}</p>
      <p className="text-sm text-text-muted mb-4 max-w-lg mx-auto">
        {t("contacts.emptyAll.body")}
      </p>
      <Link
        href="/groups"
        className="inline-block px-4 py-2 rounded-lg bg-accent-green/20 border border-accent-green/40 text-accent-green text-sm font-medium hover:bg-accent-green/30"
      >
        {t("contacts.emptyAll.cta")}
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

function csvEscape(v: string): string {
  if (v == null) return "";
  const needsQuotes = /[",\n\r]/.test(v);
  const escaped = v.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Free memory a tick later so Safari can consume the blob.
  setTimeout(() => URL.revokeObjectURL(url), 100);
}
