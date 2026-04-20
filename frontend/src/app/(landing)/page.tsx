import Link from "next/link";
import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default function LandingPage() {
  // In local-dev mode (no Supabase) the landing page is dead weight — skip
  // straight to the dashboard so `npm run dev` + `python main.py` works like
  // the pre-auth app did.
  if (!isSupabaseConfigured()) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-card-border">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="font-bold text-xl">Telegram Outreach</div>
          <nav className="flex items-center gap-2 text-sm">
            <Link
              href="/login"
              className="px-3 py-1.5 rounded-lg text-text-muted hover:text-foreground"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="px-3 py-1.5 rounded-lg bg-accent-green/20 border border-accent-green/40 text-accent-green font-medium hover:bg-accent-green/30"
            >
              Sign up
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-20">
        <div className="max-w-3xl">
          <h1 className="text-5xl font-bold leading-tight">
            Telegram outreach that doesn&apos;t get your accounts banned.
          </h1>
          <p className="text-text-muted text-lg mt-6">
            Scrape groups, warm up sender accounts automatically, and send
            personalised DMs at scale with random delays and per-account
            proxies. Built-in safety rails so Telegram doesn&apos;t notice.
          </p>
          <div className="mt-8 flex gap-3">
            <Link
              href="/signup"
              className="px-5 py-3 rounded-lg bg-accent-green/20 border border-accent-green/40 text-accent-green font-medium hover:bg-accent-green/30"
            >
              Get started
            </Link>
            <Link
              href="/login"
              className="px-5 py-3 rounded-lg border border-card-border text-text-muted hover:text-foreground"
            >
              I have an account
            </Link>
          </div>
        </div>

        <div className="mt-16 grid md:grid-cols-3 gap-6">
          <Feature
            title="Multi-account sender"
            body="Register up to 10 Telegram accounts, each with its own residential proxy. Round-robin campaigns spread load and evade ban triggers."
          />
          <Feature
            title="Warm-up on autopilot"
            body="New accounts run a 7-day warm-up — join groups, read, react. Then DMs ramp from 3/day to 50/day over two weeks. Zero manual tuning."
          />
          <Feature
            title="Safety that self-recovers"
            body="PeerFlood, FloodWait, privacy errors — classified and handled per account. Flagged accounts auto-pause, banned ones freeze. Your fleet keeps sending."
          />
        </div>

        <div className="mt-20 border-t border-card-border pt-10 grid md:grid-cols-2 gap-6">
          <div>
            <h2 className="text-2xl font-semibold">How it works</h2>
            <ol className="text-text-muted text-sm mt-3 space-y-2 list-decimal list-inside">
              <li>Sign up, connect a Telegram account via SMS in the dashboard.</li>
              <li>Paste group links to scrape; members dedupe into your contacts.</li>
              <li>Write 3+ message templates with <code>{"{first_name}"}</code> placeholders.</li>
              <li>Launch a campaign. Sender sends DMs at random 45–180s intervals across your fleet.</li>
              <li>Watch the dashboard live — pause, resume, or re-route at any time.</li>
            </ol>
          </div>
          <div>
            <h2 className="text-2xl font-semibold">What you&apos;ll need</h2>
            <ul className="text-text-muted text-sm mt-3 space-y-2 list-disc list-inside">
              <li><strong>Telegram API credentials</strong> from <Link href="https://my.telegram.org" target="_blank" className="text-foreground hover:underline">my.telegram.org</Link> (free).</li>
              <li><strong>Virtual or physical phone numbers</strong> for up to 10 sender accounts.</li>
              <li><strong>Residential proxies</strong> (e.g. IPRoyal sticky sessions, ~$20–30/mo for the fleet).</li>
            </ul>
          </div>
        </div>
      </main>

      <footer className="border-t border-card-border mt-20">
        <div className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between text-xs text-text-muted">
          <span>Telegram Outreach · {new Date().getFullYear()}</span>
          <div className="flex items-center gap-4">
            <Link href="/login" className="hover:text-foreground">
              Log in
            </Link>
            <Link href="/signup" className="hover:text-foreground">
              Sign up
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-card-bg border border-card-border rounded-xl p-6">
      <h3 className="font-semibold text-lg">{title}</h3>
      <p className="text-text-muted text-sm mt-2">{body}</p>
    </div>
  );
}
