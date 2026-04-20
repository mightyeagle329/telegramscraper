/**
 * Returns true iff Supabase env vars are set.
 *
 * When false, the app runs in "local dev mode": no login gate, no multi-
 * tenant scoping, direct access to the Python backend on :8000. Useful for
 * developing / testing without spinning up Supabase.
 */
export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return Boolean(url && key && url.startsWith("http"));
}
