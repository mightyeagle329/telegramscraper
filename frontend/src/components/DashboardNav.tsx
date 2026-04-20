"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import StatusBar from "./StatusBar";

const links = [
  { href: "/dashboard", label: "Overview" },
  { href: "/groups", label: "Groups" },
  { href: "/contacts", label: "Contacts" },
  { href: "/accounts", label: "Accounts" },
  { href: "/templates", label: "Templates" },
  { href: "/campaigns", label: "Campaigns" },
];

interface Props {
  email?: string;
  initial?: string;
  /** If true, render a "local dev" badge instead of the auth user-menu. */
  localDev?: boolean;
}

export default function DashboardNav({ email, initial, localDev }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/login");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <header className="border-b border-card-border bg-card-bg/50 backdrop-blur-sm sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-6">
        <Link href="/dashboard" className="font-bold text-xl">
          Telegram Outreach
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          {links.map(({ href, label }) => {
            const active =
              href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`px-3 py-1.5 rounded-lg transition-colors ${
                  active
                    ? "bg-card-border text-white"
                    : "text-text-muted hover:text-white"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          <StatusBar />

          {localDev ? (
            <span
              title="Supabase not configured — running without auth. Set NEXT_PUBLIC_SUPABASE_URL / ANON_KEY in .env.local to enable multi-user mode."
              className="text-xs px-2 py-1 rounded-full bg-yellow-500/15 text-yellow-400 border border-yellow-500/30"
            >
              local dev
            </span>
          ) : (
            <div className="relative">
              <button
                onClick={() => setMenuOpen((o) => !o)}
                className="w-8 h-8 rounded-full bg-accent-green/20 border border-accent-green/40 text-sm font-semibold"
                aria-label="User menu"
              >
                {initial}
              </button>
              {menuOpen ? (
                <div
                  className="absolute right-0 mt-2 w-56 bg-card-bg border border-card-border rounded-lg shadow-lg py-1"
                  onMouseLeave={() => setMenuOpen(false)}
                >
                  <div className="px-3 py-2 text-xs text-text-muted truncate border-b border-card-border/40">
                    {email}
                  </div>
                  <Link
                    href="/settings"
                    onClick={() => setMenuOpen(false)}
                    className="block px-3 py-2 text-sm hover:bg-card-border"
                  >
                    Settings
                  </Link>
                  <button
                    onClick={signOut}
                    disabled={signingOut}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-card-border disabled:opacity-50"
                  >
                    {signingOut ? "Signing out…" : "Sign out"}
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
