"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  type: string | null;
  host: string | null;
  port: number | null;
  username?: string | null;
  password?: string | null;
}

/**
 * Proxy display for the accounts table.
 *
 *   compact:    🔑 socks5://geo.iproyal.com:12321
 *
 *   on hover:   floating popover (fixed to viewport, escapes the table's
 *               overflow:hidden container) with full details:
 *                 Type / Host / Port / Username / Password (masked)
 *                 [show] toggle + [copy full string] button.
 *
 * Popover stays open while the mouse is over EITHER the trigger row OR
 * the popover itself, so the user can click the show/copy buttons.
 *
 * Positioning uses `position: fixed` + getBoundingClientRect so the
 * popover escapes the table's overflow-hidden clipping.
 */
export default function ProxyCell({
  type,
  host,
  port,
  username,
  password,
}: Props) {
  const [hovered, setHovered] = useState(false);
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const hoverInside = useRef(false);

  // Re-position the popover whenever it opens (trigger may have moved
  // due to scrolling, window resize, etc.).
  useEffect(() => {
    if (!hovered || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setCoords({ top: r.bottom + 6, left: r.left });

    const onScroll = () => {
      if (!triggerRef.current) return;
      const r2 = triggerRef.current.getBoundingClientRect();
      setCoords({ top: r2.bottom + 6, left: r2.left });
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [hovered]);

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

  // A small delay before hiding so the user can move from trigger to
  // popover without it disappearing mid-journey.
  function onLeave() {
    hoverInside.current = false;
    setTimeout(() => {
      if (!hoverInside.current) {
        setHovered(false);
        setShown(false);
      }
    }, 120);
  }

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={() => {
          hoverInside.current = true;
          setHovered(true);
        }}
        onMouseLeave={onLeave}
        className="inline-flex items-center gap-1.5 text-xs font-mono cursor-help text-text-muted hover:text-foreground"
      >
        <KeyIcon />
        <span className="truncate max-w-[180px]" title={display}>
          {display}
        </span>
      </span>

      {hovered && coords ? (
        <div
          role="tooltip"
          onMouseEnter={() => {
            hoverInside.current = true;
          }}
          onMouseLeave={onLeave}
          style={{
            position: "fixed",
            top: coords.top,
            left: coords.left,
            maxWidth: "min(340px, calc(100vw - 24px))",
          }}
          className="z-50 bg-card-bg border border-card-border rounded-lg shadow-xl p-3 text-xs space-y-1.5 font-mono"
        >
          <div className="text-text-muted text-[10px] uppercase tracking-wide font-sans mb-1">
            Proxy details
          </div>
          <Row label="Type" value={type ?? "socks5"} />
          <Row label="Host" value={host} />
          <Row label="Port" value={String(port)} />
          {username ? <Row label="User" value={username} breakAll /> : null}
          {password ? (
            <div className="flex items-start gap-2">
              <span className="text-text-muted w-10 shrink-0">Pass:</span>
              <span className="flex-1 break-all">
                {shown ? password : "•".repeat(Math.min(password.length, 16))}
              </span>
              <button
                onClick={() => setShown((s) => !s)}
                type="button"
                className="text-[10px] px-1.5 py-0.5 rounded border border-card-border hover:bg-card-border/40 shrink-0"
              >
                {shown ? "hide" : "show"}
              </button>
            </div>
          ) : null}
          <div className="pt-2 mt-1 border-t border-card-border/40">
            <button
              type="button"
              onClick={copy}
              className="w-full px-2 py-1.5 rounded border border-card-border hover:bg-card-border/40 text-xs font-sans flex items-center justify-center gap-1.5"
            >
              {copied ? (
                <>
                  <span className="text-accent-green">✓</span> Copied
                </>
              ) : (
                <>📋 Copy full proxy string</>
              )}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Row({
  label,
  value,
  breakAll,
}: {
  label: string;
  value: string;
  breakAll?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-text-muted w-10 shrink-0">{label}:</span>
      <span className={`flex-1 ${breakAll ? "break-all" : "truncate"}`}>
        {value}
      </span>
    </div>
  );
}

function KeyIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="8" cy="15" r="4" />
      <path d="M10.85 12.15 19 4M18 5l2 2M15 8l2 2" />
    </svg>
  );
}
