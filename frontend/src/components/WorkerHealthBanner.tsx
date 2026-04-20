"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n/context";
import type { Account } from "@/lib/types";

/**
 * Thin strip below the nav that surfaces unhealthy accounts.
 *
 *   - Renders nothing when every account is `warming` or `active`.
 *   - Yellow banner if ≥1 account is `paused`.
 *   - Red banner if ≥1 account is `banned` (always takes priority).
 *
 * Polls every 30s. Separate from the /accounts page refresh so the badge
 * shows no matter which dashboard route the user is on.
 */
export default function WorkerHealthBanner() {
  const t = useT();
  const [accounts, setAccounts] = useState<Account[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await api.getAccounts();
        if (!cancelled) setAccounts(data);
      } catch {
        if (!cancelled) setAccounts(null);
      }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!accounts) return null;
  const banned = accounts.filter((a) => a.status === "banned").length;
  const paused = accounts.filter((a) => a.status === "paused").length;
  if (banned === 0 && paused === 0) return null;

  const isBan = banned > 0;
  const style = isBan
    ? "bg-accent-red/10 border-accent-red/30 text-accent-red"
    : "bg-accent-yellow/10 border-accent-yellow/30 text-accent-yellow";

  return (
    <div className={`border-b ${style}`}>
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs md:text-sm">
        <span className="flex items-center gap-2">
          <WarnIcon />
          {isBan ? (
            <span>
              {banned === 1
                ? `1 ${t("accounts.status.banned")}`
                : `${banned} ${t("accounts.stat.banned").toLowerCase()}`}
              {paused > 0
                ? ` · ${paused} ${t("accounts.stat.paused").toLowerCase()}`
                : ""}
            </span>
          ) : (
            <span>
              {paused === 1
                ? `1 ${t("accounts.status.paused")}`
                : `${paused} ${t("accounts.stat.paused").toLowerCase()}`}
            </span>
          )}
        </span>
        <Link
          href="/accounts"
          className="underline hover:no-underline shrink-0 self-start sm:self-center"
        >
          {t("nav.accounts")} →
        </Link>
      </div>
    </div>
  );
}

function WarnIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
