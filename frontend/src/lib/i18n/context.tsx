"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_LOCALE,
  LOCALES,
  messages,
  type Locale,
} from "./messages";

interface Ctx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<Ctx | null>(null);
const STORAGE_KEY = "to-locale";

function isLocale(x: string | null | undefined): x is Locale {
  return !!x && (LOCALES as readonly string[]).includes(x);
}

function renderTemplate(
  template: string,
  vars?: Record<string, string | number>
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k];
    return v === undefined || v === null ? `{${k}}` : String(v);
  });
}

/**
 * LocaleProvider — wraps the app and exposes `useT()`.
 *
 * Resolves the initial locale on mount in this order:
 *   1. `localStorage.to-locale`
 *   2. `navigator.language` (if it starts with one of our supported codes)
 *   3. DEFAULT_LOCALE
 *
 * Also reflects the choice onto `<html lang>` so screen readers and browsers
 * pick up the right language.
 */
export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    let resolved: Locale = DEFAULT_LOCALE;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (isLocale(stored)) {
        resolved = stored;
      } else if (typeof navigator !== "undefined" && navigator.language) {
        const prefix = navigator.language.slice(0, 2).toLowerCase();
        if (isLocale(prefix)) resolved = prefix;
      }
    } catch {
      // ignore
    }
    setLocaleState(resolved);
    document.documentElement.setAttribute("lang", resolved);
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // ignore
    }
    document.documentElement.setAttribute("lang", l);
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const dict = messages[locale] ?? messages[DEFAULT_LOCALE];
      const raw =
        dict[key] ?? messages[DEFAULT_LOCALE][key] ?? key; // fallback chain
      return renderTemplate(raw, vars);
    },
    [locale]
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useT(): Ctx["t"] {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    // Provider missing (e.g. in a server component) — fall back to EN so
    // nothing blows up; strings still render, just not translated.
    return (key: string, vars?: Record<string, string | number>) => {
      const raw = messages[DEFAULT_LOCALE][key] ?? key;
      return renderTemplate(raw, vars);
    };
  }
  return ctx.t;
}

export function useLocale(): Pick<Ctx, "locale" | "setLocale"> {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    return { locale: DEFAULT_LOCALE, setLocale: () => {} };
  }
  return { locale: ctx.locale, setLocale: ctx.setLocale };
}
