"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n/context";
import type { Account } from "@/lib/types";

/**
 * Thin strip below the nav that surfaces TERMINAL account issues only.
 *
 * Transient rate-limit pauses (PeerFlood, FloodWait) are now handled
 * silently by the sender — the account keeps its visible status and
 * self-throttles internally. So this banner only shows when an account
 * is genuinely banned (a state the operator has to act on).
 *
 * Polls every 30s. Renders nothing when every account is healthy.
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
  if (banned === 0) return null;

  return (
    <div className="border-b bg-accent-red/10 border-accent-red/30 text-accent-red">
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs md:text-sm">
        <span className="flex items-center gap-2">
          <WarnIcon />
          <span>
            {banned === 1
              ? `1 ${t("accounts.status.banned")}`
              : `${banned} ${t("accounts.stat.banned").toLowerCase()}`}
          </span>
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
