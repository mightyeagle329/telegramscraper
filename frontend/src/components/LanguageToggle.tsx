"use client";

import { useState } from "react";
import { useLocale } from "@/lib/i18n/context";
import { LOCALES, LOCALE_FLAGS, LOCALE_NAMES } from "@/lib/i18n/messages";

/** Language switcher — flag + dropdown. Lives in the nav. */
export default function LanguageToggle() {
  const { locale, setLocale } = useLocale();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Change language"
        title={LOCALE_NAMES[locale]}
        className="flex items-center gap-1 px-2 py-1 rounded-md bg-background border border-card-border hover:bg-card-border/40 text-sm"
      >
        <span className="text-base leading-none">{LOCALE_FLAGS[locale]}</span>
        <span className="uppercase text-xs font-semibold text-text-muted">
          {locale}
        </span>
      </button>
      {open ? (
        <div
          className="absolute right-0 mt-2 w-40 bg-card-bg border border-card-border rounded-lg shadow-lg py-1 z-30"
          onMouseLeave={() => setOpen(false)}
        >
          {LOCALES.map((l) => {
            const active = l === locale;
            return (
              <button
                key={l}
                onClick={() => {
                  setLocale(l);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-card-border/40 ${
                  active ? "text-accent-green" : ""
                }`}
              >
                <span className="text-base leading-none">{LOCALE_FLAGS[l]}</span>
                <span>{LOCALE_NAMES[l]}</span>
                {active ? (
                  <span className="ml-auto text-xs text-accent-green">✓</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
