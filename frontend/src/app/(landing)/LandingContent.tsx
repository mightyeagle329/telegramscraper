"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/context";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";

export default function LandingContent() {
  const t = useT();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-card-border">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-4 flex items-center justify-between gap-3">
          <div className="font-bold text-lg md:text-xl">{t("app.name")}</div>
          <nav className="flex items-center gap-2 text-sm">
            <div className="hidden sm:flex items-center gap-2">
              <LanguageToggle />
              <ThemeToggle />
            </div>
            <Link
              href="/login"
              className="px-3 py-1.5 rounded-lg text-text-muted hover:text-foreground"
            >
              {t("nav.signIn")}
            </Link>
            <Link
              href="/signup"
              className="px-3 py-1.5 rounded-lg bg-accent-green/20 border border-accent-green/40 text-accent-green font-medium hover:bg-accent-green/30"
            >
              {t("nav.signUp")}
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 md:px-6 py-12 md:py-20">
        <div className="max-w-3xl">
          <h1 className="text-3xl md:text-5xl font-bold leading-tight">
            {t("landing.hero.title")}
          </h1>
          <p className="text-text-muted text-base md:text-lg mt-4 md:mt-6">
            {t("landing.hero.body")}
          </p>
          <div className="mt-6 md:mt-8 flex flex-col sm:flex-row gap-3">
            <Link
              href="/signup"
              className="px-5 py-3 rounded-lg bg-accent-green/20 border border-accent-green/40 text-accent-green font-medium hover:bg-accent-green/30 text-center"
            >
              {t("landing.cta.primary")}
            </Link>
            <Link
              href="/login"
              className="px-5 py-3 rounded-lg border border-card-border text-text-muted hover:text-foreground text-center"
            >
              {t("landing.cta.secondary")}
            </Link>
          </div>
        </div>

        <div className="mt-12 md:mt-16 grid md:grid-cols-3 gap-4 md:gap-6">
          <Feature
            title={t("landing.feature.multi.title")}
            body={t("landing.feature.multi.body")}
          />
          <Feature
            title={t("landing.feature.warmup.title")}
            body={t("landing.feature.warmup.body")}
          />
          <Feature
            title={t("landing.feature.safety.title")}
            body={t("landing.feature.safety.body")}
          />
        </div>

        <div className="mt-16 md:mt-20 border-t border-card-border pt-8 md:pt-10 grid md:grid-cols-2 gap-6 md:gap-8">
          <div>
            <h2 className="text-xl md:text-2xl font-semibold">
              {t("landing.how.title")}
            </h2>
            <ol className="text-text-muted text-sm mt-3 space-y-2 list-decimal list-inside">
              <li>{t("landing.how.1")}</li>
              <li>{t("landing.how.2")}</li>
              <li>{t("landing.how.3")}</li>
              <li>{t("landing.how.4")}</li>
              <li>{t("landing.how.5")}</li>
            </ol>
          </div>
          <div>
            <h2 className="text-xl md:text-2xl font-semibold">
              {t("landing.need.title")}
            </h2>
            <ul className="text-text-muted text-sm mt-3 space-y-2 list-disc list-inside">
              <li>{t("landing.need.api")}</li>
              <li>{t("landing.need.phone")}</li>
              <li>{t("landing.need.proxy")}</li>
            </ul>
          </div>
        </div>
      </main>

      <footer className="border-t border-card-border mt-12 md:mt-20">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 flex items-center justify-between text-xs text-text-muted">
          <span>{t("app.name")} · {new Date().getFullYear()}</span>
          <div className="flex items-center gap-4">
            <Link href="/login" className="hover:text-foreground">
              {t("nav.signIn")}
            </Link>
            <Link href="/signup" className="hover:text-foreground">
              {t("nav.signUp")}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="card-elevated p-5 md:p-6">
      <h3 className="font-semibold text-lg">{title}</h3>
      <p className="text-text-muted text-sm mt-2">{body}</p>
    </div>
  );
}
