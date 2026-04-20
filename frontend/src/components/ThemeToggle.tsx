"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light" | "system";
const STORAGE_KEY = "to-theme";

/** Small tri-state theme switch: light / dark / system. */
export default function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "system";
    applyTheme(stored);
    setThemeState(stored);
  }, []);

  function applyTheme(t: Theme) {
    const html = document.documentElement;
    if (t === "system") {
      html.removeAttribute("data-theme");
    } else {
      html.setAttribute("data-theme", t);
    }
  }

  function setTheme(t: Theme) {
    setThemeState(t);
    applyTheme(t);
    localStorage.setItem(STORAGE_KEY, t);
  }

  // Avoid hydration mismatch: render a placeholder until after mount.
  if (!mounted) {
    return <div className="w-[88px] h-7" aria-hidden />;
  }

  const options: { value: Theme; label: string; icon: React.ReactNode }[] = [
    { value: "light", label: "Light", icon: <SunIcon /> },
    { value: "system", label: "System", icon: <SystemIcon /> },
    { value: "dark", label: "Dark", icon: <MoonIcon /> },
  ];

  return (
    <div
      role="tablist"
      aria-label="Theme"
      className="flex items-center gap-0.5 bg-background border border-card-border rounded-full p-0.5"
    >
      {options.map(({ value, label, icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            role="tab"
            aria-selected={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={`rounded-full p-1 transition-colors ${
              active
                ? "bg-card-border text-foreground"
                : "text-text-muted hover:text-foreground"
            }`}
          >
            {icon}
          </button>
        );
      })}
    </div>
  );
}

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SystemIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}
