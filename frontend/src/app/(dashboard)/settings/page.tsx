import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { loadSettings } from "@/lib/actions/settings";
import SettingsForm from "@/components/settings/SettingsForm";

export default async function SettingsPage() {
  if (!isSupabaseConfigured()) {
    return (
      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-text-muted text-sm">
            Profile, sending defaults, and security.
          </p>
        </div>
        <div className="bg-card-bg border border-card-border rounded-xl p-8 text-center">
          <p className="font-medium text-white mb-2">Settings need Supabase.</p>
          <p className="text-sm text-text-muted mb-4 max-w-lg mx-auto">
            You&apos;re in <strong className="text-yellow-400">local dev</strong>{" "}
            mode. Profile + preferences live in Postgres (Supabase). Set it up
            to enable this page.
          </p>
          <Link
            href="/"
            className="text-sm text-text-muted hover:text-white underline"
          >
            See docs/SETUP-SUPABASE.md
          </Link>
        </div>
      </main>
    );
  }

  const res = await loadSettings();
  const profile = res.ok ? res.data.profile : null;
  const settings = res.ok ? res.data.settings : null;
  const loadError = res.ok ? null : res.error;

  return (
    <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-text-muted text-sm">
          Profile, sending defaults, and security.
        </p>
      </div>
      {loadError ? (
        <div className="px-4 py-2 bg-accent-red/10 border border-accent-red/30 text-accent-red rounded-lg text-sm">
          {loadError}
        </div>
      ) : null}
      <SettingsForm profile={profile} settings={settings} />
    </main>
  );
}
