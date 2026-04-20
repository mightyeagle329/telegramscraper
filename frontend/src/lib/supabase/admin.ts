import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client.
 *
 * Bypasses Row-Level-Security. Use ONLY from:
 *   - Route handlers that have authenticated the user by other means, OR
 *   - Background workers / cron tasks with no per-user auth context.
 *
 * NEVER import this in a Client Component — `SUPABASE_SERVICE_ROLE_KEY` is
 * server-only and exposing it would let anyone bypass RLS.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
