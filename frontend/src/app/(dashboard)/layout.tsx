import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import DashboardNav from "@/components/DashboardNav";

/**
 * Layout wrapping every protected dashboard page.
 *
 * Two modes:
 *   - Supabase configured → check the session via Supabase; redirect to
 *     /login if missing. `proxy.ts` already enforces this at the edge; we
 *     re-check here as defence in depth.
 *   - Supabase NOT configured → skip auth and render in single-user local
 *     dev mode. All pages accessible directly. This lets developers run
 *     the app locally without standing up Supabase.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isSupabaseConfigured()) {
    return (
      <div className="min-h-screen bg-background">
        <DashboardNav localDev />
        {children}
      </div>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-background">
      <DashboardNav
        email={user.email ?? ""}
        initial={(user.email ?? "?").charAt(0).toUpperCase()}
      />
      {children}
    </div>
  );
}
