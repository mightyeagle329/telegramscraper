import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Handler for Supabase's auth redirect (email confirmation, password reset,
 * OAuth providers). Supabase sends the user to this URL with a one-time
 * `code`; we exchange it for a session cookie, then send them onward.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // No code or exchange failed — bounce back to login with an error hint.
  const fail = new URL("/login", origin);
  fail.searchParams.set("error", "auth_callback_failed");
  return NextResponse.redirect(fail);
}
