import Link from "next/link";

/**
 * Contacts page — placeholder until the Google-Sheets-based contact store
 * is migrated into the Supabase `contacts` + `contact_group_memberships`
 * tables. That migration is tracked as sprint S3 in docs/SETUP-SUPABASE.md.
 *
 * For now, point users to the existing flow: scraped members land in
 * Google Sheets (per-group tabs), and the Campaigns page pulls from them
 * via `/api/campaigns/enqueue-from-sheet`.
 */
export default function ContactsPage() {
  return (
    <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Contacts</h1>
        <p className="text-text-muted text-sm">
          Scraped Telegram users, deduplicated and taggable.
        </p>
      </div>

      <div className="bg-card-bg border border-card-border rounded-xl p-8">
        <div className="max-w-2xl mx-auto text-center">
          <p className="font-medium text-white mb-2">
            Contacts migration is coming next sprint.
          </p>
          <p className="text-sm text-text-muted mb-6">
            Today, scraped users are stored in a linked{" "}
            <strong>Google Sheet</strong> (one tab per group). The Campaigns
            page reads from there via the Python backend. The next sprint
            migrates that data into Supabase so contacts can be filtered,
            tagged, and searched here — and Row-Level Security scopes them
            to each signed-in user.
          </p>
          <div className="flex gap-3 justify-center text-sm">
            <Link
              href="/groups"
              className="px-4 py-2 rounded-lg border border-card-border hover:bg-card-border"
            >
              Go to Groups (scrape members)
            </Link>
            <Link
              href="/campaigns"
              className="px-4 py-2 rounded-lg bg-accent-green/20 border border-accent-green/40 text-accent-green hover:bg-accent-green/30"
            >
              Launch a campaign from a sheet
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
