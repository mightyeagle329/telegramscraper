import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { listTemplates } from "@/lib/actions/templates";
import TemplatesManager from "@/components/templates/TemplatesManager";

/**
 * Message templates page. Lives in Supabase (multi-tenant, RLS-scoped).
 * In local-dev mode (no Supabase) we render a friendly "set up Supabase"
 * block since templates can't persist without a DB.
 */
export default async function TemplatesPage() {
  if (!isSupabaseConfigured()) {
    return (
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Templates</h1>
          <p className="text-text-muted text-sm">
            Reusable message variants with <code>{"{first_name}"}</code>-style
            placeholders. Senders pick one at random per send so no two DMs
            ship byte-identical.
          </p>
        </div>
        <div className="bg-card-bg border border-card-border rounded-xl p-8 text-center">
          <p className="font-medium text-white mb-2">
            Templates need Supabase.
          </p>
          <p className="text-sm text-text-muted mb-4 max-w-lg mx-auto">
            You&apos;re in <strong className="text-yellow-400">local dev</strong>{" "}
            mode. Templates are stored in Postgres (Supabase) so they survive
            restarts and can be shared across campaigns; in-memory storage
            would lose them on every refresh.
          </p>
          <Link
            href="https://supabase.com"
            target="_blank"
            rel="noreferrer"
            className="text-sm text-white hover:underline"
          >
            Set up a free Supabase project
          </Link>
          <span className="text-text-muted text-sm"> · </span>
          <span className="text-text-muted text-sm">
            See <code>docs/SETUP-SUPABASE.md</code>
          </span>
        </div>
      </main>
    );
  }

  const result = await listTemplates();
  const templates = result.ok ? result.data : [];
  const error = result.ok ? null : result.error;

  return (
    <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Templates</h1>
        <p className="text-text-muted text-sm">
          Reusable message variants with <code>{"{first_name}"}</code>-style
          placeholders. Workers pick one at random per send so no two DMs ship
          byte-identical.
        </p>
      </div>
      {error ? (
        <div className="px-4 py-2 bg-accent-red/10 border border-accent-red/30 text-accent-red rounded-lg text-sm">
          {error}
        </div>
      ) : null}
      <TemplatesManager initial={templates} />
    </main>
  );
}
