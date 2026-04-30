"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/context";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import Logo from "@/components/Logo";

export default function LandingContent() {
  const t = useT();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-card-border">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-4 flex items-center justify-between gap-3">
          <Link href="/" className="shrink-0">
            <Logo size={28} withWordmark />
          </Link>
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

      {/* Hero */}
      <section className="relative overflow-hidden">
        {/* Soft gradient backdrop, reads on dark + light themes. */}
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none opacity-50"
          style={{
            background:
              "radial-gradient(60% 50% at 50% 0%, rgba(74, 222, 128, 0.18), transparent 70%)",
          }}
        />
        <div className="relative max-w-5xl mx-auto px-4 md:px-6 pt-16 md:pt-24 pb-12 md:pb-16 text-center">
          <span className="inline-block text-[11px] uppercase tracking-[0.2em] text-text-muted px-3 py-1 rounded-full border border-card-border bg-card-bg">
            {t("landing.hero.eyebrow")}
          </span>
          <h1 className="text-4xl md:text-6xl font-bold leading-tight tracking-tight mt-5">
            {t("landing.hero.title")}
          </h1>
          <p className="text-text-muted text-base md:text-lg mt-5 md:mt-6 max-w-2xl mx-auto">
            {t("landing.hero.body")}
          </p>
          <div className="mt-8 md:mt-10 flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/signup"
              className="px-6 py-3 rounded-lg bg-accent-green/20 border border-accent-green/40 text-accent-green font-medium hover:bg-accent-green/30 text-center"
            >
              {t("landing.cta.primary")}
            </Link>
            <Link
              href="/login"
              className="px-6 py-3 rounded-lg border border-card-border text-text-muted hover:text-foreground text-center"
            >
              {t("landing.cta.secondary")}
            </Link>
          </div>
        </div>
      </section>

      <main className="max-w-6xl mx-auto px-4 md:px-6 pb-16 md:pb-24">
        {/* Feature grid — 6 cards in 2 rows of 3 */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
          <Feature
            tone="green"
            iconPath="M3 11l18-8-7 18-2-8-9-2z"
            title={t("landing.feature.multi.title")}
            body={t("landing.feature.multi.body")}
          />
          <Feature
            tone="blue"
            iconPath="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M5 19l3-3M16 8l3-3"
            title={t("landing.feature.ai.title")}
            body={t("landing.feature.ai.body")}
          />
          <Feature
            tone="yellow"
            iconPath="M3 17l4-4 4 4 7-7M14 6h7v7"
            title={t("landing.feature.ab.title")}
            body={t("landing.feature.ab.body")}
          />
          <Feature
            tone="green"
            iconPath="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
            title={t("landing.feature.replies.title")}
            body={t("landing.feature.replies.body")}
          />
          <Feature
            tone="blue"
            iconPath="M3 12a9 9 0 1 0 9-9M3 12h6M3 12l3-3M3 12l3 3"
            title={t("landing.feature.warmup.title")}
            body={t("landing.feature.warmup.body")}
          />
          <Feature
            tone="yellow"
            iconPath="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
            title={t("landing.feature.safety.title")}
            body={t("landing.feature.safety.body")}
          />
        </div>

        {/* How it works + Requirements */}
        <div className="mt-16 md:mt-24 grid md:grid-cols-2 gap-8 md:gap-12">
          <div>
            <h2 className="text-xl md:text-2xl font-semibold">
              {t("landing.how.title")}
            </h2>
            <ol className="text-text-muted text-sm mt-4 space-y-3">
              {[
                t("landing.how.1"),
                t("landing.how.2"),
                t("landing.how.3"),
                t("landing.how.4"),
                t("landing.how.5"),
              ].map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-accent-green/15 text-accent-green text-xs font-semibold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h2 className="text-xl md:text-2xl font-semibold">
              {t("landing.need.title")}
            </h2>
            <ul className="text-text-muted text-sm mt-4 space-y-3">
              {[
                t("landing.need.api"),
                t("landing.need.phone"),
                t("landing.need.proxy"),
                t("landing.need.openai"),
              ].map((line, i) => (
                <li key={i} className="flex gap-3">
                  <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-accent-green mt-2" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Final CTA */}
        <div className="mt-16 md:mt-24 card-elevated p-8 md:p-12 text-center">
          <h2 className="text-2xl md:text-3xl font-bold">
            {t("landing.hero.title")}
          </h2>
          <p className="text-text-muted text-sm md:text-base mt-3 max-w-xl mx-auto">
            {t("landing.hero.body")}
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/signup"
              className="px-6 py-3 rounded-lg bg-accent-green/20 border border-accent-green/40 text-accent-green font-medium hover:bg-accent-green/30 text-center"
            >
              {t("landing.cta.primary")}
            </Link>
          </div>
        </div>
      </main>

      <footer className="border-t border-card-border">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 flex items-center justify-between text-xs text-text-muted">
          <span className="flex items-center gap-2">
            <Logo size={16} />
            <span>
              {t("app.name")} · {new Date().getFullYear()}
            </span>
          </span>
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

interface FeatureProps {
  title: string;
  body: string;
  iconPath: string;
  tone: "green" | "blue" | "yellow";
}

function Feature({ title, body, iconPath, tone }: FeatureProps) {
  const toneClass = {
    green: "bg-accent-green/15 text-accent-green border-accent-green/30",
    blue: "bg-accent-blue/15 text-accent-blue border-accent-blue/30",
    yellow:
      "bg-accent-yellow/15 text-accent-yellow border-accent-yellow/30",
  }[tone];
  return (
    <div className="card-elevated p-5 md:p-6">
      <div
        className={`w-10 h-10 rounded-lg border flex items-center justify-center ${toneClass}`}
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={iconPath} />
        </svg>
      </div>
      <h3 className="font-semibold text-base md:text-lg mt-4">{title}</h3>
      <p className="text-text-muted text-sm mt-2 leading-relaxed">{body}</p>
    </div>
  );
}
