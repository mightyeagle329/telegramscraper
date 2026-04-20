import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase auth cookie on every request, and enforces a
 * coarse auth guard: /dashboard/* requires a session, /login|/signup while
 * signed-in redirects to /dashboard.
 *
 * Two modes:
 *   - Supabase configured → full auth flow above.
 *   - Supabase NOT configured (local-dev) → skip auth, and also bounce
 *     /login, /signup, /callback to /dashboard so nobody lands on a broken
 *     form that calls Supabase and errors.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const configured = Boolean(url && key && url.startsWith("http"));

  const pathname = request.nextUrl.pathname;
  const isAuthPage =
    pathname.startsWith("/login") || pathname.startsWith("/signup");
  const isDashboardPage = pathname.startsWith("/dashboard");
  const isCallback = pathname.startsWith("/callback");

  if (!configured) {
    // Local-dev: if the user navigates to an auth page, skip them past it.
    if (isAuthPage || isCallback) {
      const redirect = request.nextUrl.clone();
      redirect.pathname = "/dashboard";
      redirect.search = "";
      return NextResponse.redirect(redirect);
    }
    return response;
  }

  const supabase = createServerClient(url!, key!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && isDashboardPage) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/login";
    redirect.searchParams.set("next", pathname);
    return NextResponse.redirect(redirect);
  }

  if (user && isAuthPage) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/dashboard";
    redirect.searchParams.delete("next");
    return NextResponse.redirect(redirect);
  }

  return response;
}
