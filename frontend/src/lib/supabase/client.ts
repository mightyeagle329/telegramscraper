import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for Client Components. Uses the public anon key and
 * respects Row-Level-Security (`auth.uid()` = current signed-in user).
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
