"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import StatusBar from "./StatusBar";
import ThemeToggle from "./ThemeToggle";

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
  localDev?: boolean;
}

export default function DashboardNav({ email, initial, localDev }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Close mobile menu on navigation
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

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

  function isActive(href: string) {
    return href === "/dashboard"
      ? pathname === "/dashboard"
      : pathname.startsWith(href);
  }

  return (
    <header className="border-b border-card-border bg-card-bg/80 backdrop-blur-md sticky top-0 z-20">
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-3 flex items-center justify-between gap-3 md:gap-6">
        <Link href="/dashboard" className="font-bold text-lg md:text-xl shrink-0">
          Telegram Outreach
        </Link>

        {/* Desktop nav */}
        <nav className="hidden lg:flex items-center gap-1 text-sm">
          {links.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`px-3 py-1.5 rounded-lg transition-colors ${
                isActive(href)
                  ? "bg-card-border text-foreground"
                  : "text-text-muted hover:text-foreground hover:bg-card-border/40"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2 md:gap-3">
          <div className="hidden sm:block">
            <ThemeToggle />
          </div>
          <div className="hidden md:block">
            <StatusBar />
          </div>

          {localDev ? (
            <span
              title="Supabase not configured — running without auth."
              className="hidden sm:inline text-xs px-2 py-1 rounded-full bg-accent-yellow/15 text-accent-yellow border border-accent-yellow/30"
            >
              local dev
            </span>
          ) : (
            <div className="relative">
              <button
                onClick={() => setMenuOpen((o) => !o)}
                className="w-8 h-8 rounded-full bg-accent-green/20 border border-accent-green/40 text-sm font-semibold text-accent-green"
                aria-label="User menu"
              >
                {initial}
              </button>
              {menuOpen ? (
                <div
                  className="absolute right-0 mt-2 w-56 bg-card-bg border border-card-border rounded-lg shadow-lg py-1"
                  onMouseLeave={() => setMenuOpen(false)}
                >
                  <div className="px-3 py-2 text-xs text-text-muted truncate border-b border-card-border/60">
                    {email}
                  </div>
                  <Link
                    href="/settings"
                    onClick={() => setMenuOpen(false)}
                    className="block px-3 py-2 text-sm hover:bg-card-border/40"
                  >
                    Settings
                  </Link>
                  <button
                    onClick={signOut}
                    disabled={signingOut}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-card-border/40 disabled:opacity-50"
                  >
                    {signingOut ? "Signing out…" : "Sign out"}
                  </button>
                </div>
              ) : null}
            </div>
          )}

          {/* Mobile hamburger */}
          <button
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            className="lg:hidden p-1.5 rounded-md hover:bg-card-border/40"
            onClick={() => setMobileOpen((o) => !o)}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {mobileOpen ? (
                <>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </>
              ) : (
                <>
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="lg:hidden border-t border-card-border bg-card-bg">
          <nav className="max-w-6xl mx-auto px-4 py-2 flex flex-col gap-1">
            {links.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={`px-3 py-2 rounded-lg text-sm ${
                  isActive(href)
                    ? "bg-card-border text-foreground"
                    : "text-text-muted hover:text-foreground hover:bg-card-border/40"
                }`}
              >
                {label}
              </Link>
            ))}
            <div className="pt-2 mt-1 border-t border-card-border/60 flex items-center justify-between gap-3 px-1">
              <ThemeToggle />
              <StatusBar />
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
