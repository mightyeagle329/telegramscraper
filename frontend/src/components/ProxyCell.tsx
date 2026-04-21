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
 * Compact proxy display for the accounts table.
 *
 *   default:    socks5://geo.iproyal.com:12321
 *               user: jSqzrFTV50WZ5…   pass: •••  [show] [copy]
 *
 * Clicking `show` reveals the password; `copy` puts the full proxy
 * string onto the clipboard so the operator can paste it back into
 * another form if they need to rotate or re-create the account.
 */
export default function ProxyCell({
  type,
  host,
  port,
  username,
  password,
}: Props) {
  const [shown, setShown] = useState(false);
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
      // Clipboard API may not be available — fall back to a prompt.
      window.prompt("Copy proxy:", full);
    }
  }

  return (
    <div className="text-xs space-y-0.5 max-w-[260px]">
      <div className="font-mono truncate" title={display}>
        {display}
      </div>
      {username ? (
        <div className="flex items-center gap-1.5 text-text-muted">
          <span className="shrink-0">user:</span>
          <span className="font-mono truncate" title={username}>
            {username}
          </span>
        </div>
      ) : null}
      {password ? (
        <div className="flex items-center gap-1.5 text-text-muted">
          <span className="shrink-0">pass:</span>
          <span className="font-mono truncate">
            {shown ? password : "•".repeat(Math.min(password.length, 10))}
          </span>
          <button
            onClick={() => setShown((s) => !s)}
            className="text-[10px] px-1 rounded border border-card-border hover:bg-card-border/40 shrink-0"
            title={shown ? "Hide password" : "Show password"}
            type="button"
          >
            {shown ? "hide" : "show"}
          </button>
          <button
            onClick={copy}
            className="text-[10px] px-1 rounded border border-card-border hover:bg-card-border/40 shrink-0"
            title="Copy full proxy string"
            type="button"
          >
            {copied ? "✓" : "copy"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
