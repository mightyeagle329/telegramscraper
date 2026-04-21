"use client";

import { useState } from "react";

interface Props {
  type: string | null;
  host: string | null;
  port: number | null;
  username?: string | null;
  password?: string | null;
}

/**
 * Full proxy display for the admin accounts table.
 *
 *   socks5://geo.iproyal.com:12321
 *   user:  jSqzrFTV50WZ5DCh
 *   pass:  i425nXwT2TEzIQYb_country-pt_session-xxx_lifetime-24h
 *   [ 📋 copy ]
 *
 * All values visible, no masking, no hover — because only the operator
 * accesses this dashboard and legitimately needs to read their own
 * credentials back.
 */
export default function ProxyCell({
  type,
  host,
  port,
  username,
  password,
}: Props) {
  const [copied, setCopied] = useState(false);

  if (!host || !port) {
    return <span className="text-text-muted text-xs">direct</span>;
  }

  const display = `${type ?? "socks5"}://${host}:${port}`;
  const full =
    username && password
      ? `${type ?? "socks5"}://${username}:${password}@${host}:${port}`
      : display;

  async function copy() {
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy proxy:", full);
    }
  }

  return (
    <div className="text-xs font-mono space-y-0.5 max-w-[320px]">
      <div className="text-foreground break-all">{display}</div>
      {username ? (
        <div className="text-text-muted">
          <span className="inline-block w-10">user:</span>
          <span className="break-all">{username}</span>
        </div>
      ) : null}
      {password ? (
        <div className="text-text-muted">
          <span className="inline-block w-10">pass:</span>
          <span className="break-all">{password}</span>
        </div>
      ) : null}
      {username || password ? (
        <button
          type="button"
          onClick={copy}
          className="mt-1 text-[10px] px-1.5 py-0.5 rounded border border-card-border hover:bg-card-border/40 inline-flex items-center gap-1 font-sans"
        >
          {copied ? (
            <>
              <span className="text-accent-green">✓</span> Copied
            </>
          ) : (
            <>📋 Copy</>
          )}
        </button>
      ) : null}
    </div>
  );
}
