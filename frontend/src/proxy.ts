import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Next.js 16 renamed `middleware.ts` → `proxy.ts`. Same role: runs before
 * every matched request. Ours refreshes Supabase auth cookies and guards
 * /dashboard/* behind a valid session.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Run on every route except Next.js static assets + common image files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
